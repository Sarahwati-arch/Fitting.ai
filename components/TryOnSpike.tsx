"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { OneEuroFilter } from "@/lib/oneEuro";
import { GarmentRenderer } from "@/lib/garmentRenderer";
import { cutoutGarment } from "@/lib/cutout";
import { createPoseLandmarker } from "@/lib/pose";
import { computeQuad, estimateHips, DEFAULT_FIT, type FitParams, type Pt } from "@/lib/garmentFit";

// MediaPipe pose landmark indices. In the raw (unmirrored) frame, the person's LEFT side
// appears on the image RIGHT, so 12/24 are the image-left shoulder/hip.
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_HIP = 23;
const R_HIP = 24;
const MIN_VISIBILITY = 0.5;
const LOST_FRAMES_BEFORE_RESET = 15;

type Status = "idle" | "loading" | "running" | "error";
type Smoothing = { minCutoff: number; beta: number };

export default function TryOnSpike() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const dbgCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GarmentRenderer | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopLoopRef = useRef<(() => void) | null>(null);
  const filtersRef = useRef<OneEuroFilter[]>(Array.from({ length: 8 }, () => new OneEuroFilter()));

  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [fps, setFps] = useState(0);
  const [garmentName, setGarmentName] = useState<string | null>(null);
  const [busyCutout, setBusyCutout] = useState(false);
  const [skipRemoval, setSkipRemoval] = useState(false);
  const [showDebug, setShowDebug] = useState(true);
  const [fit, setFit] = useState<FitParams>(DEFAULT_FIT);
  const [smoothing, setSmoothing] = useState<Smoothing>({ minCutoff: 1.0, beta: 0.01 });
  const [aspect, setAspect] = useState(4 / 3);

  // The render loop reads the latest values from refs so sliders never restart it.
  const fitRef = useRef(fit);
  const smoothRef = useRef(smoothing);
  const debugRef = useRef(showDebug);
  fitRef.current = fit;
  smoothRef.current = smoothing;
  debugRef.current = showDebug;

  useEffect(() => {
    try {
      rendererRef.current = new GarmentRenderer(glCanvasRef.current!);
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "WebGL init failed");
    }
    return () => {
      stopCamera();
      rendererRef.current?.dispose();
      landmarkerRef.current?.close();
      rendererRef.current = null;
      landmarkerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopCamera = useCallback(() => {
    stopLoopRef.current?.();
    stopLoopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop()); // release the camera light
    streamRef.current = null;
    const v = videoRef.current;
    if (v) v.srcObject = null;
    rendererRef.current?.clear();
    dbgCanvasRef.current?.getContext("2d")?.clearRect(0, 0, 99999, 99999);
    filtersRef.current.forEach((f) => f.reset());
    setFps(0);
    setStatus("idle");
    setMessage("");
  }, []);

  const startCamera = useCallback(async () => {
    const video = videoRef.current;
    const glCanvas = glCanvasRef.current;
    const dbg = dbgCanvasRef.current;
    if (!video || !glCanvas || !dbg) return;

    try {
      setStatus("loading");
      setMessage("Loading pose model…");
      if (!landmarkerRef.current) landmarkerRef.current = await createPoseLandmarker();

      setMessage("Waiting for camera permission…");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      glCanvas.width = dbg.width = vw;
      glCanvas.height = dbg.height = vh;
      setAspect(vw / vh);
      setStatus("running");
      setMessage("");

      const landmarker = landmarkerRef.current!;
      const renderer = rendererRef.current;
      const dctx = dbg.getContext("2d")!;
      let lastVideoTime = -1;
      let lostFrames = 0;
      let frames = 0;
      let lastFpsT = performance.now();
      let cancelled = false;
      let handle = 0;
      const hasRVFC = "requestVideoFrameCallback" in video;

      const schedule = () => {
        if (cancelled) return;
        handle = hasRVFC
          ? (video as any).requestVideoFrameCallback(frame)
          : requestAnimationFrame(frame);
      };

      const frame = () => {
        if (cancelled) return;
        if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          const nowMs = performance.now();
          const res = landmarker.detectForVideo(video, nowMs);
          const lm = res.landmarks[0];
          dctx.clearRect(0, 0, vw, vh);

          const vis = (i: number) => lm?.[i]?.visibility ?? 0;
          const shouldersOk = !!lm && vis(L_SHOULDER) > MIN_VISIBILITY && vis(R_SHOULDER) > MIN_VISIBILITY;

          if (!shouldersOk) {
            lostFrames++;
            renderer?.clear();
            if (lostFrames > LOST_FRAMES_BEFORE_RESET) filtersRef.current.forEach((f) => f.reset());
          } else {
            lostFrames = 0;
            const px = (i: number): Pt => [lm[i].x * vw, lm[i].y * vh];
            let sl = px(R_SHOULDER); // image-left
            let sr = px(L_SHOULDER); // image-right
            let hl: Pt;
            let hr: Pt;
            const hipsOk = vis(L_HIP) > MIN_VISIBILITY && vis(R_HIP) > MIN_VISIBILITY;
            if (hipsOk) {
              hl = px(R_HIP);
              hr = px(L_HIP);
            } else {
              [hl, hr] = estimateHips(sl, sr);
            }

            const { minCutoff, beta } = smoothRef.current;
            const t = nowMs / 1000;
            const raw = [sl, sr, hl, hr];
            const out: Pt[] = raw.map((p, n) => {
              const fx = filtersRef.current[n * 2];
              const fy = filtersRef.current[n * 2 + 1];
              fx.minCutoff = fy.minCutoff = minCutoff;
              fx.beta = fy.beta = beta;
              return [fx.filter(p[0], t), fy.filter(p[1], t)];
            });
            [sl, sr, hl, hr] = out as [Pt, Pt, Pt, Pt];

            const quad = computeQuad(sl, sr, hl, hr, fitRef.current);
            renderer?.draw(quad);

            if (debugRef.current) {
              dctx.lineWidth = 2;
              dctx.strokeStyle = "rgba(29,92,99,0.9)";
              dctx.beginPath();
              dctx.moveTo(...quad[0]);
              dctx.lineTo(...quad[1]);
              dctx.lineTo(...quad[3]);
              dctx.lineTo(...quad[2]);
              dctx.closePath();
              dctx.stroke();
              dctx.fillStyle = hipsOk ? "#1d5c63" : "#c2410c"; // orange = hips estimated
              [sl, sr, hl, hr].forEach(([x, y]) => {
                dctx.beginPath();
                dctx.arc(x, y, 5, 0, Math.PI * 2);
                dctx.fill();
              });
            }
          }

          frames++;
          if (nowMs - lastFpsT >= 1000) {
            setFps(Math.round((frames * 1000) / (nowMs - lastFpsT)));
            frames = 0;
            lastFpsT = nowMs;
          }
        }
        schedule();
      };

      stopLoopRef.current = () => {
        cancelled = true;
        if (hasRVFC) (video as any).cancelVideoFrameCallback(handle);
        else cancelAnimationFrame(handle);
      };
      schedule();
    } catch (e) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStatus("error");
      setMessage(describeError(e));
    }
  }, []);

  const onGarmentFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
        setMessage("Use a PNG, JPEG or WebP image.");
        return;
      }
      setBusyCutout(true);
      setMessage(skipRemoval ? "Preparing garment…" : "Removing background (first run downloads the model)…");
      try {
        const t0 = performance.now();
        const bmp = await cutoutGarment(file, { skipRemoval });
        rendererRef.current?.setGarment(bmp);
        setGarmentName(file.name);
        setMessage(`Garment ready in ${((performance.now() - t0) / 1000).toFixed(1)} s.`);
      } catch (e) {
        setMessage(describeError(e));
      } finally {
        setBusyCutout(false);
      }
    },
    [skipRemoval],
  );

  const running = status === "running";

  return (
    <main className="shell">
      <section className="stage-wrap">
        <div className="stage" style={{ aspectRatio: String(aspect) }}>
          {/* Video and both canvases share one mirrored wrapper, so landmark x needs no flipping. */}
          <div className="mirror">
            <video ref={videoRef} playsInline muted />
            <canvas ref={glCanvasRef} />
            <canvas ref={dbgCanvasRef} />
          </div>
          {!running && (
            <div className="stage-empty">
              <p>{status === "loading" ? message : "Add a garment, then start the camera."}</p>
            </div>
          )}
          {running && <span className="fps">{fps} fps</span>}
        </div>
        {status === "error" && <p className="error">{message}</p>}
      </section>

      <aside className="panel">
        <h1>fitting.ai</h1>
        <p className="sub">Realtime try-on spike</p>

        <div className="group">
          <label className="file">
            <span>{busyCutout ? "Working…" : "Upload garment photo"}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busyCutout}
              onChange={(e) => onGarmentFile(e.target.files?.[0])}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={skipRemoval} onChange={(e) => setSkipRemoval(e.target.checked)} />
            Photo is already a transparent PNG
          </label>
          <p className="hint">{garmentName ?? "No garment yet."}</p>
        </div>

        <div className="group">
          {running ? (
            <button className="btn secondary" onClick={stopCamera}>Stop camera</button>
          ) : (
            <button className="btn" onClick={startCamera} disabled={status === "loading"}>
              {status === "loading" ? "Starting…" : "Start camera"}
            </button>
          )}
          {running && message && <p className="hint">{message}</p>}
        </div>

        <div className="group">
          <h2>Fit</h2>
          <Slider label="Width" value={fit.widthScale} min={1.2} max={2.8} step={0.05} onChange={(v) => setFit({ ...fit, widthScale: v })} />
          <Slider label="Top offset" value={fit.topOffset} min={-0.1} max={0.3} step={0.01} onChange={(v) => setFit({ ...fit, topOffset: v })} />
          <Slider label="Length" value={fit.lengthScale} min={0.6} max={1.6} step={0.02} onChange={(v) => setFit({ ...fit, lengthScale: v })} />
          <Slider label="Taper" value={fit.taper} min={0.6} max={1.2} step={0.01} onChange={(v) => setFit({ ...fit, taper: v })} />
        </div>

        <div className="group">
          <h2>Smoothing</h2>
          <Slider label="Min cutoff" value={smoothing.minCutoff} min={0.1} max={5} step={0.1} onChange={(v) => setSmoothing({ ...smoothing, minCutoff: v })} />
          <Slider label="Beta" value={smoothing.beta} min={0} max={0.1} step={0.001} onChange={(v) => setSmoothing({ ...smoothing, beta: v })} />
          <p className="hint">Lower min cutoff = steadier but laggier. Higher beta = less lag when you move.</p>
        </div>

        <label className="check">
          <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} />
          Show anchor points (orange = hips estimated)
        </label>
      </aside>
    </main>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
      />
      <output>{props.value.toFixed(props.step < 0.01 ? 3 : 2)}</output>
    </label>
  );
}

function describeError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === "NotAllowedError") return "Camera access was denied. Allow it in the browser's site settings and try again.";
    if (e.name === "NotFoundError") return "No camera found on this device.";
    if (e.name === "NotReadableError") return "The camera is in use by another app.";
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}
