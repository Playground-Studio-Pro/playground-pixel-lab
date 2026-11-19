/**
 * Deterministic image resampling. The browser's own `drawImage` scaling is not a pure function of its input:
 * Chromium filters differently on a GPU canvas and on a canvas it has moved to the CPU after reads, so the same
 * draw gives different pixels depending on what the canvas did before. Images that must come out the same on
 * every draw are resized here once, then drawn 1:1.
 *
 * Box (area) filter in premultiplied alpha: each output pixel is the area-weighted mean of the source pixels it
 * covers. Exact for integer ratios, never rings, and works both ways (upscaling degrades to nearest with
 * blended seams). Pure: no DOM.
 */

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** Straight (non-premultiplied) RGBA, row-major, 4 bytes per pixel, as `ImageData.data`. */
  readonly data: Uint8ClampedArray;
}

/** For each output index, the source indexes it covers and their weights (summing to 1). */
function weights(from: number, to: number): { start: Int32Array; count: Int32Array; w: Float64Array; stride: number } {
  const ratio = from / to;
  const stride = Math.ceil(ratio) + 2;
  const start = new Int32Array(to);
  const count = new Int32Array(to);
  const w = new Float64Array(to * stride);
  for (let o = 0; o < to; o++) {
    const a = o * ratio;
    const b = (o + 1) * ratio;
    const first = Math.floor(a);
    const last = Math.min(from - 1, Math.ceil(b) - 1);
    start[o] = first;
    count[o] = last - first + 1;
    for (let i = first; i <= last; i++) w[o * stride + (i - first)] = (Math.min(b, i + 1) - Math.max(a, i)) / ratio;
  }
  return { start, count, w, stride };
}

/** Resizes `src` to `width` × `height` with a box filter. Same input, same bytes, everywhere. */
export function resampleArea(src: RgbaImage, width: number, height: number): RgbaImage {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new RangeError(`Invalid size ${width} × ${height}.`);
  const { width: sw, height: sh, data } = src;
  if (width === sw && height === sh) return { width, height, data: new Uint8ClampedArray(data) };
  // Premultiply into floats.
  const pre = new Float64Array(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const a = data[i * 4 + 3] / 255;
    pre[i * 4] = data[i * 4] * a;
    pre[i * 4 + 1] = data[i * 4 + 1] * a;
    pre[i * 4 + 2] = data[i * 4 + 2] * a;
    pre[i * 4 + 3] = data[i * 4 + 3];
  }
  // Horizontal pass: sw → width.
  const hx = weights(sw, width);
  const mid = new Float64Array(width * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < hx.count[x]; k++) {
        const wt = hx.w[x * hx.stride + k];
        const s = (y * sw + hx.start[x] + k) * 4;
        r += pre[s] * wt;
        g += pre[s + 1] * wt;
        b += pre[s + 2] * wt;
        a += pre[s + 3] * wt;
      }
      const d = (y * width + x) * 4;
      mid[d] = r;
      mid[d + 1] = g;
      mid[d + 2] = b;
      mid[d + 3] = a;
    }
  }
  // Vertical pass: sh → height, then unpremultiply.
  const vy = weights(sh, height);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < vy.count[y]; k++) {
        const wt = vy.w[y * vy.stride + k];
        const s = ((vy.start[y] + k) * width + x) * 4;
        r += mid[s] * wt;
        g += mid[s + 1] * wt;
        b += mid[s + 2] * wt;
        a += mid[s + 3] * wt;
      }
      const d = (y * width + x) * 4;
      const alpha = Math.round(a);
      out[d + 3] = alpha;
      if (alpha > 0) {
        const k = 255 / a;
        out[d] = Math.round(r * k);
        out[d + 1] = Math.round(g * k);
        out[d + 2] = Math.round(b * k);
      }
    }
  }
  return { width, height, data: out };
}
