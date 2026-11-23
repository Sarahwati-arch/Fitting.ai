// One Euro Filter (Casiez et al., 2012): low lag when moving fast, low jitter when still.
// Feed it pixel coordinates. If you feed normalized 0..1 values, beta must be scaled up.

class LowPass {
  private y: number | null = null;
  filter(x: number, alpha: number): number {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
}

const alphaFor = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuroFilter {
  private xf = new LowPass();
  private dxf = new LowPass();
  private prev: number | null = null;
  private prevT: number | null = null;

  constructor(
    public minCutoff = 1.0,
    public beta = 0.01,
    public dCutoff = 1.0,
  ) {}

  filter(value: number, tSec: number): number {
    if (this.prev === null || this.prevT === null) {
      this.prev = value;
      this.prevT = tSec;
      this.xf.filter(value, 1);
      this.dxf.filter(0, 1);
      return value;
    }
    const dt = Math.max(tSec - this.prevT, 1e-3);
    const dValue = (value - this.prev) / dt;
    const edValue = this.dxf.filter(dValue, alphaFor(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edValue);
    const out = this.xf.filter(value, alphaFor(cutoff, dt));
    this.prev = value;
    this.prevT = tSec;
    return out;
  }

  reset() {
    this.xf = new LowPass();
    this.dxf = new LowPass();
    this.prev = null;
    this.prevT = null;
  }
}
