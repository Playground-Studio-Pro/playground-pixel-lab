import type { PatternFrame } from "@/engines/motion/patterns";

/**
 * Draws a pattern description onto a 2D context at `scale` device pixels per master pixel.
 * Lines and strokes keep at least one device pixel, so thin content stays visible when zoomed out.
 * That only affects the preview; the pattern itself is unchanged.
 */
export function drawPattern(ctx: CanvasRenderingContext2D, frame: PatternFrame, scale: number, fontFamily: string) {
  const minWidth = 1 / scale;
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = frame.background;
  ctx.fillRect(0, 0, frame.width, frame.height);

  for (const p of frame.primitives) {
    switch (p.kind) {
      case "rect":
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.w, p.h);
        break;
      case "linear": {
        const gradient = ctx.createLinearGradient(p.from[0], p.from[1], p.to[0], p.to[1]);
        for (const [offset, color] of p.stops) gradient.addColorStop(Math.min(1, Math.max(0, offset)), color);
        ctx.fillStyle = gradient;
        ctx.fillRect(p.x, p.y, p.w, p.h);
        break;
      }
      case "glow": {
        const gradient = ctx.createRadialGradient(p.cx, p.cy, 0, p.cx, p.cy, p.r);
        for (const [offset, color] of p.stops) gradient.addColorStop(offset, color);
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        break;
      }
      case "lines": {
        const w = Math.max(p.width, minWidth);
        ctx.fillStyle = p.color;
        for (const at of p.at) {
          if (p.axis === "x") ctx.fillRect(at, 0, w, frame.height);
          else ctx.fillRect(0, at, frame.width, w);
        }
        break;
      }
      case "path": {
        if (p.points.length < 4) break;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(p.width, minWidth);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p.points[0], p.points[1]);
        for (let i = 2; i < p.points.length; i += 2) ctx.lineTo(p.points[i], p.points[i + 1]);
        ctx.stroke();
        break;
      }
      case "text":
        ctx.fillStyle = p.color;
        ctx.font = `${p.weight} ${p.size}px ${fontFamily}`;
        ctx.textAlign = p.align;
        ctx.textBaseline = "alphabetic";
        ctx.fillText(p.text, p.x, p.y);
        break;
    }
  }
  ctx.restore();
}
