import type { Pt } from "./garmentFit";

const COLS = 10;
const ROWS = 14;

const VERT = `
attribute vec2 aPos;
attribute vec2 aUV;
uniform vec2 uRes;
varying vec2 vUV;
void main() {
  vec2 clip = vec2(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vUV = aUV;
}`;

const FRAG = `
precision mediump float;
uniform sampler2D uTex;
varying vec2 vUV;
void main() {
  gl_FragColor = texture2D(uTex, vUV);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) ?? "shader compile failed");
  }
  return s;
}

/**
 * Draws one garment texture on a subdivided grid whose corners follow a quad.
 * The grid is the hook for later mesh warping (sleeve curve, torso bend).
 */
export class GarmentRenderer {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private tex: WebGLTexture | null = null;
  private posBuf: WebGLBuffer;
  private uvBuf: WebGLBuffer;
  private idxBuf: WebGLBuffer;
  private idxCount: number;
  private positions = new Float32Array((COLS + 1) * (ROWS + 1) * 2);
  private aPos: number;
  private aUV: number;
  private uRes: WebGLUniformLocation;
  hasGarment = false;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
    });
    if (!gl) throw new Error("WebGL is not available in this browser.");
    this.gl = gl;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) ?? "program link failed");
    }
    this.prog = prog;
    this.aPos = gl.getAttribLocation(prog, "aPos");
    this.aUV = gl.getAttribLocation(prog, "aUV");
    this.uRes = gl.getUniformLocation(prog, "uRes")!;

    const uvs = new Float32Array((COLS + 1) * (ROWS + 1) * 2);
    let k = 0;
    for (let j = 0; j <= ROWS; j++) {
      for (let i = 0; i <= COLS; i++) {
        uvs[k++] = i / COLS;
        uvs[k++] = j / ROWS;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < COLS; i++) {
        const a = j * (COLS + 1) + i;
        const b = a + 1;
        const c = a + (COLS + 1);
        const d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    this.idxCount = idx.length;

    this.posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.positions.byteLength, gl.DYNAMIC_DRAW);

    this.uvBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);

    this.idxBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alpha
  }

  setGarment(bmp: ImageBitmap) {
    const gl = this.gl;
    if (this.tex) gl.deleteTexture(this.tex);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.tex = tex;
    this.hasGarment = true;
  }

  clear() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** quad = [TL, TR, BL, BR] in canvas pixels. */
  draw(quad: [Pt, Pt, Pt, Pt]) {
    const gl = this.gl;
    this.clear();
    if (!this.tex) return;

    const [tl, tr, bl, br] = quad;
    let k = 0;
    for (let j = 0; j <= ROWS; j++) {
      const v = j / ROWS;
      const lx = tl[0] + (bl[0] - tl[0]) * v;
      const ly = tl[1] + (bl[1] - tl[1]) * v;
      const rx = tr[0] + (br[0] - tr[0]) * v;
      const ry = tr[1] + (br[1] - tr[1]) * v;
      for (let i = 0; i <= COLS; i++) {
        const u = i / COLS;
        this.positions[k++] = lx + (rx - lx) * u;
        this.positions[k++] = ly + (ry - ly) * u;
      }
    }

    gl.useProgram(this.prog);
    gl.uniform2f(this.uRes, this.canvas.width, this.canvas.height);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.positions);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
    gl.enableVertexAttribArray(this.aUV);
    gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, 0, 0);

    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.drawElements(gl.TRIANGLES, this.idxCount, gl.UNSIGNED_SHORT, 0);
  }

  dispose() {
    const gl = this.gl;
    if (this.tex) gl.deleteTexture(this.tex);
    gl.deleteBuffer(this.posBuf);
    gl.deleteBuffer(this.uvBuf);
    gl.deleteBuffer(this.idxBuf);
    gl.deleteProgram(this.prog);
  }
}
