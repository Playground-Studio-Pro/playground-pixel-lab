import type { LogoRaster } from "@/components/shell/calibration/draw";
import { resampleArea, type RgbaImage } from "@/engines/resample";

/**
 * The test card logo, resized in JavaScript instead of by `drawImage`. Chromium's scaled `drawImage` filters
 * differently on a GPU canvas and on one it has moved to the CPU after `getImageData`, so the same frame came
 * out with different logo pixels depending on what the canvas drew and read before. Resized here, then drawn
 * 1:1, the logo is the same bytes on every canvas.
 *
 * The source pixels are read once at native size (a 1:1 copy, no filtering). The last few sizes are kept, so a
 * preview being resized doesn't keep a stale copy of every size it passed through.
 */
const KEEP = 4;

export function createLogoRaster(image: HTMLImageElement): LogoRaster {
  let source: RgbaImage | null = null;
  const sizes = new Map<string, HTMLCanvasElement>();
  const read = (): RgbaImage => {
    if (source) return source;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return (source = { data, width, height });
  };
  return {
    at(width, height) {
      if (width < 1 || height < 1) return null;
      const key = `${width}x${height}`;
      const hit = sizes.get(key);
      if (hit) {
        sizes.delete(key);
        sizes.set(key, hit);
        return hit;
      }
      const resized = resampleArea(read(), width, height);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(resized.data), width, height), 0, 0);
      sizes.set(key, canvas);
      while (sizes.size > KEEP) sizes.delete(sizes.keys().next().value!);
      return canvas;
    },
  };
}
