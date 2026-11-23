export type Pt = [number, number];

export type FitParams = {
  widthScale: number; // garment top width relative to shoulder width
  topOffset: number; // how far above the shoulder line the garment starts (fraction of torso length)
  lengthScale: number; // garment length relative to shoulder-to-hip distance
  taper: number; // bottom width relative to top width
};

export const DEFAULT_FIT: FitParams = {
  widthScale: 1.9,
  topOffset: 0.08,
  lengthScale: 1.15,
  taper: 0.85,
};

/**
 * Returns the garment quad corners [TL, TR, BL, BR] in video pixels.
 * `sl` / `hl` are the shoulder/hip that appear on the image-left of the raw (unmirrored) frame.
 */
export function computeQuad(
  sl: Pt,
  sr: Pt,
  hl: Pt,
  hr: Pt,
  p: FitParams,
): [Pt, Pt, Pt, Pt] {
  const mS: Pt = [(sl[0] + sr[0]) / 2, (sl[1] + sr[1]) / 2];
  const mH: Pt = [(hl[0] + hr[0]) / 2, (hl[1] + hr[1]) / 2];

  const ux = sr[0] - sl[0];
  const uy = sr[1] - sl[1];
  const sw = Math.hypot(ux, uy) || 1;
  const u: Pt = [ux / sw, uy / sw];

  const dx = mH[0] - mS[0];
  const dy = mH[1] - mS[1];
  const torso = Math.hypot(dx, dy) || 1;
  const d: Pt = [dx / torso, dy / torso];

  const hwTop = (sw * p.widthScale) / 2;
  const hwBot = hwTop * p.taper;
  const len = torso * p.lengthScale;

  const top: Pt = [mS[0] - d[0] * torso * p.topOffset, mS[1] - d[1] * torso * p.topOffset];
  const bot: Pt = [top[0] + d[0] * len, top[1] + d[1] * len];

  return [
    [top[0] - u[0] * hwTop, top[1] - u[1] * hwTop],
    [top[0] + u[0] * hwTop, top[1] + u[1] * hwTop],
    [bot[0] - u[0] * hwBot, bot[1] - u[1] * hwBot],
    [bot[0] + u[0] * hwBot, bot[1] + u[1] * hwBot],
  ];
}

/** When hips are out of frame (typical for a seated webcam), estimate them from the shoulders. */
export function estimateHips(sl: Pt, sr: Pt): [Pt, Pt] {
  const ux = sr[0] - sl[0];
  const uy = sr[1] - sl[1];
  const sw = Math.hypot(ux, uy) || 1;
  const u: Pt = [ux / sw, uy / sw];
  const d: Pt = [-u[1], u[0]]; // perpendicular, pointing down the torso
  const k = 1.45 * sw;
  return [
    [sl[0] + d[0] * k + u[0] * 0.12 * sw, sl[1] + d[1] * k + u[1] * 0.12 * sw],
    [sr[0] + d[0] * k - u[0] * 0.12 * sw, sr[1] + d[1] * k - u[1] * 0.12 * sw],
  ];
}
