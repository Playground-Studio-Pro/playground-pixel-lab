import type { PixelLabModule } from "../contract";
import type { FrameSource } from "@/preview/contract";

/**
 * The Output Studio module. Owned by Output Engineering: replace the placeholder test card, and add the
 * panel and export entries, here. The source id must stay `calibration-test-card`, which `catalog.ts`
 * lists for the Live preview menu.
 */
const testCardPlaceholder: FrameSource = {
  id: "calibration-test-card",
  name: "Calibration test card",
  draw(ctx, input, { scale, fontFamily }) {
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = "#101010";
    ctx.fillRect(0, 0, input.width, input.height);
    ctx.fillStyle = "#9a9a9a";
    for (const s of input.screens) {
      const size = Math.max(10, Math.min(48, Math.floor(s.height / 8)));
      ctx.font = `${size}px ${fontFamily}`;
      ctx.fillText("Test card not built yet", s.x + size, s.y + size * 1.5, Math.max(1, s.width - size * 2));
    }
    ctx.restore();
  },
};

export const outputModule: PixelLabModule = {
  id: "output",
  name: "Output",
  studio: "output",
  sources: [testCardPlaceholder],
};
