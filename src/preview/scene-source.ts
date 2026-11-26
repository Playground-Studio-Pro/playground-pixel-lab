import { rasterizeMask, type ScreenMask } from "@/engines/content/mask";
import type { FrameInput, FrameSource } from "./contract";

/**
 * Composite sources for scenes and masks. Each one is a `FrameSource`, so the Live preview, the MP4
 * export and its per-screen targets play it like any other source. The mapping never changes: only the
 * pixels inside a screen's master rectangle do.
 */

export interface SceneOverrideSource {
  readonly screenId: string;
  readonly source: FrameSource;
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

/**
 * Draws `base` over the whole master, then each override inside its screen's master rectangle only.
 * The override sees a local frame: the size of that screen, with the screen at 0, 0. With no overrides
 * it is `base` itself, so the pixels are the same by construction.
 */
export function composeScene(base: FrameSource, overrides: readonly SceneOverrideSource[]): FrameSource {
  if (overrides.length === 0) return base;
  const buffers = new Map<string, HTMLCanvasElement>();
  return {
    id: `scene:${base.id}+${overrides.map((o) => `${o.screenId}=${o.source.id}`).join(",")}`,
    name: base.name,
    draw(ctx, input, options) {
      base.draw(ctx, input, options);
      const s = options.scale;
      for (const o of overrides) {
        const screen = input.screens.find((sc) => sc.id === o.screenId);
        if (!screen || screen.width < 1 || screen.height < 1) continue;
        const w = Math.max(1, Math.ceil(screen.width * s));
        const h = Math.max(1, Math.ceil(screen.height * s));
        let buffer = buffers.get(o.screenId);
        if (!buffer) buffers.set(o.screenId, (buffer = canvas(w, h)));
        if (buffer.width !== w) buffer.width = w;
        if (buffer.height !== h) buffer.height = h;
        const bctx = buffer.getContext("2d", { alpha: false });
        if (!bctx) throw new Error("Unable to allocate a scene buffer.");
        const local: FrameInput = {
          ...input,
          width: screen.width,
          height: screen.height,
          screens: [{ ...screen, x: 0, y: 0 }],
        };
        o.source.draw(bctx, local, options);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(buffer, 0, 0, w, h, screen.x * s, screen.y * s, w, h);
        ctx.restore();
      }
    },
    subscribe(onChange) {
      const offs = [base, ...overrides.map((o) => o.source)].map((src) => src.subscribe?.(onChange));
      return () => offs.forEach((off) => off?.());
    },
  };
}

/**
 * `source` with black outside the mask. At scale 1 (exports, per-screen MP4s) it is exact: every pixel
 * outside is black and every pixel inside is untouched, decided by `rasterizeMask`. At other scales (the
 * Live preview) the same shape is drawn as vectors, smoothed at the edges.
 */
export function maskSource(source: FrameSource, masks: readonly ScreenMask[]): FrameSource {
  if (masks.length === 0) return source;
  const bits = new Map<ScreenMask, Uint8Array>();
  const shapes = new Map<ScreenMask, { scale: number; canvas: HTMLCanvasElement }>();
  return {
    id: `${source.id}+mask`,
    name: source.name,
    draw(ctx, input, options) {
      source.draw(ctx, input, options);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (options.scale === 1) {
        for (const m of masks) {
          let b = bits.get(m);
          if (!b) bits.set(m, (b = rasterizeMask(m)));
          const { x, y, width, height } = m.rect;
          const image = ctx.getImageData(x, y, width, height);
          const d = image.data;
          for (let i = 0; i < b.length; i++) {
            if (b[i]) continue;
            d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 0;
            d[i * 4 + 3] = 255;
          }
          ctx.putImageData(image, x, y);
        }
      } else {
        const s = options.scale;
        for (const m of masks) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(m.rect.x * s, m.rect.y * s, m.rect.width * s, m.rect.height * s);
          ctx.clip();
          // Keep what's inside the shape, then fill what was removed with black.
          ctx.globalCompositeOperation = "destination-in";
          ctx.drawImage(shapeCanvas(m, s, shapes), m.rect.x * s, m.rect.y * s);
          ctx.globalCompositeOperation = "destination-over";
          ctx.fillStyle = "#000";
          ctx.fillRect(m.rect.x * s, m.rect.y * s, m.rect.width * s, m.rect.height * s);
          ctx.restore();
        }
      }
      ctx.restore();
    },
    subscribe: source.subscribe?.bind(source),
  };
}

/** The mask's shape, white on transparent, over `m.rect` at `scale`: every polygon is added, never cut. */
function shapeCanvas(m: ScreenMask, scale: number, cache: Map<ScreenMask, { scale: number; canvas: HTMLCanvasElement }>): HTMLCanvasElement {
  const hit = cache.get(m);
  if (hit && hit.scale === scale) return hit.canvas;
  const c = canvas(Math.max(1, Math.ceil(m.rect.width * scale)), Math.max(1, Math.ceil(m.rect.height * scale)));
  const cctx = c.getContext("2d")!;
  cctx.setTransform(scale, 0, 0, scale, -m.rect.x * scale, -m.rect.y * scale);
  if (m.bitmap) {
    cctx.imageSmoothingEnabled = true;
    cctx.drawImage(bitmapCanvas(m.bitmap), m.bitmap.origin.x, m.bitmap.origin.y);
  } else {
    cctx.fillStyle = "#fff";
    for (const p of m.polygons) {
      cctx.beginPath();
      cctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) cctx.lineTo(p[i], p[i + 1]);
      cctx.closePath();
      cctx.fill("evenodd");
    }
  }
  cache.set(m, { scale, canvas: c });
  return c;
}

function bitmapCanvas(b: { width: number; height: number; bits: Uint8Array }): HTMLCanvasElement {
  const c = canvas(b.width, b.height);
  const cctx = c.getContext("2d")!;
  const image = cctx.createImageData(b.width, b.height);
  for (let i = 0; i < b.bits.length; i++) if (b.bits[i]) image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = image.data[i * 4 + 3] = 255;
  cctx.putImageData(image, 0, 0);
  return c;
}
