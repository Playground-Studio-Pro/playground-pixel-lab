/**
 * A tiny software 2D canvas for pixel-exact tests in Node: solid fills, 1:1 image copies and image data,
 * with scale-and-translate transforms. Enough for scene composition, per-screen targets and masks.
 * Anything else throws, so a test can't pass by drawing nothing.
 */

type Transform = [number, number, number, number, number, number];

function parseColor(c: string): [number, number, number] {
  if (/^#[0-9a-f]{3}$/i.test(c)) c = "#" + c.slice(1).split("").map((h) => h + h).join("");
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(c);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  throw new Error(`soft canvas: unsupported color ${c}`);
}

export class SoftCanvas {
  data = new Uint8ClampedArray(0);
  private w = 0;
  private h = 0;
  private ctx: SoftContext | null = null;
  constructor(width = 300, height = 150) {
    this.resize(width, height);
  }
  get width() { return this.w; }
  set width(v: number) { this.resize(v, this.h); }
  get height() { return this.h; }
  set height(v: number) { this.resize(this.w, v); }
  private resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
    for (let i = 3; i < this.data.length; i += 4) this.data[i] = 255;
  }
  getContext() {
    return (this.ctx ??= new SoftContext(this));
  }
}

export class SoftContext {
  private t: Transform = [1, 0, 0, 1, 0, 0];
  private stack: { t: Transform; fill: string }[] = [];
  fillStyle = "#000000";
  imageSmoothingEnabled = true;
  globalCompositeOperation = "source-over";
  constructor(readonly canvas: SoftCanvas) {}
  save() { this.stack.push({ t: [...this.t] as Transform, fill: this.fillStyle }); }
  restore() {
    const s = this.stack.pop();
    if (s) { this.t = s.t; this.fillStyle = s.fill; }
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
    if (b !== 0 || c !== 0) throw new Error("soft canvas: rotation isn't supported");
    this.t = [a, b, c, d, e, f];
  }
  private box(x: number, y: number, w: number, h: number) {
    const [a, , , d, e, f] = this.t;
    const x0 = Math.max(0, Math.round(x * a + e)), y0 = Math.max(0, Math.round(y * d + f));
    const x1 = Math.min(this.canvas.width, Math.round((x + w) * a + e)), y1 = Math.min(this.canvas.height, Math.round((y + h) * d + f));
    return { x0, y0, x1, y1 };
  }
  fillRect(x: number, y: number, w: number, h: number) {
    const [r, g, b] = parseColor(this.fillStyle);
    const { x0, y0, x1, y1 } = this.box(x, y, w, h);
    const W = this.canvas.width, D = this.canvas.data;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const o = (yy * W + xx) * 4;
      D[o] = r; D[o + 1] = g; D[o + 2] = b; D[o + 3] = 255;
    }
  }
  drawImage(src: SoftCanvas, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) {
    if (sw !== dw || sh !== dh || this.t[0] !== 1 || this.t[3] !== 1) throw new Error("soft canvas: only 1:1 copies are supported");
    const ox = dx + this.t[4], oy = dy + this.t[5];
    for (let y = 0; y < sh; y++) {
      const ty = oy + y, syy = sy + y;
      if (ty < 0 || ty >= this.canvas.height || syy < 0 || syy >= src.height) continue;
      for (let x = 0; x < sw; x++) {
        const tx = ox + x, sxx = sx + x;
        if (tx < 0 || tx >= this.canvas.width || sxx < 0 || sxx >= src.width) continue;
        const so = (syy * src.width + sxx) * 4, to = (ty * this.canvas.width + tx) * 4;
        this.canvas.data[to] = src.data[so]; this.canvas.data[to + 1] = src.data[so + 1]; this.canvas.data[to + 2] = src.data[so + 2]; this.canvas.data[to + 3] = 255;
      }
    }
  }
  getImageData(x: number, y: number, w: number, h: number) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let r = 0; r < h; r++) out.set(this.canvas.data.subarray(((y + r) * this.canvas.width + x) * 4, ((y + r) * this.canvas.width + x + w) * 4), r * w * 4);
    return { width: w, height: h, data: out };
  }
  putImageData(image: { width: number; height: number; data: Uint8ClampedArray }, x: number, y: number) {
    for (let r = 0; r < image.height; r++) this.canvas.data.set(image.data.subarray(r * image.width * 4, (r + 1) * image.width * 4), ((y + r) * this.canvas.width + x) * 4);
  }
}

/** Makes `document.createElement("canvas")` return soft canvases. */
export function installSoftCanvas() {
  (globalThis as { document?: unknown }).document = { createElement: (tag: string) => { if (tag !== "canvas") throw new Error(tag); return new SoftCanvas(); } };
}

export const softContext = (w: number, h: number) => new SoftCanvas(w, h).getContext() as unknown as CanvasRenderingContext2D & SoftContext;
