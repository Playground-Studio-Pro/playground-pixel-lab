import type { WorkerShape } from "@/engines/content/wall-build/character";
import { wallBuildOps, type Box, type WallBuildOp } from "@/engines/content/wall-build/frame";
import { frameTick, planWallBuild, type WallBuildPlan } from "@/engines/content/wall-build/plan";
import type { WallBuildSettings } from "@/engines/content/wall-build/settings";
import type { ResolvedMapping } from "@/engines/mapping";
import type { FrameInput } from "@/preview/contract";

/** Paints Wall Build's operations. Loaded on first use. Geometry comes from `engines/content/wall-build`. */

/** Both edges are rounded, so reduced previews have no seams. At scale 1 it changes nothing. */
function fill(ctx: CanvasRenderingContext2D, b: Box, scale: number) {
  const x = Math.round(b.x * scale);
  const y = Math.round(b.y * scale);
  ctx.fillRect(x, y, Math.round((b.x + b.w) * scale) - x, Math.round((b.y + b.h) * scale) - y);
}

function edge(ctx: CanvasRenderingContext2D, b: Box, scale: number) {
  const x0 = Math.round(b.x * scale);
  const y0 = Math.round(b.y * scale);
  const x1 = Math.round((b.x + b.w) * scale);
  const y1 = Math.round((b.y + b.h) * scale);
  const line = Math.max(1, Math.round(scale));
  ctx.fillRect(x0, y0, x1 - x0, line);
  ctx.fillRect(x0, y1 - line, x1 - x0, line);
  ctx.fillRect(x0, y0 + line, line, y1 - y0 - 2 * line);
  ctx.fillRect(x1 - line, y0 + line, line, y1 - y0 - 2 * line);
}

function shape(ctx: CanvasRenderingContext2D, s: WorkerShape) {
  ctx.beginPath();
  if (s.kind === "line") {
    s.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.strokeStyle = s.fill;
    ctx.lineWidth = s.width;
    ctx.stroke();
    return;
  }
  ctx.fillStyle = s.fill;
  if (s.kind === "rect") {
    if (s.r === 0) {
      ctx.fillRect(s.x, s.y, s.w, s.h);
      return;
    }
    ctx.roundRect(s.x, s.y, s.w, s.h, s.r);
  } else if (s.kind === "disc") ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
  else if (s.kind === "poly") s.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  else {
    ctx.moveTo(s.from[0], s.from[1]);
    for (const [c, b] of s.curves) ctx.quadraticCurveTo(c[0], c[1], b[0], b[1]);
  }
  ctx.fill();
}

export function paintWallBuild(ctx: CanvasRenderingContext2D, ops: readonly WallBuildOp[], scale: number) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const op of ops) {
    if (op.kind === "fill") {
      ctx.fillStyle = op.color;
      fill(ctx, op, scale);
    } else if (op.kind === "edge") {
      ctx.fillStyle = op.color;
      edge(ctx, op, scale);
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.rect(op.clip.x * scale, op.clip.y * scale, op.clip.w * scale, op.clip.h * scale);
      ctx.clip();
      for (const b of op.under ?? []) {
        ctx.fillStyle = b.color;
        fill(ctx, b, scale);
      }
      const worker = new DOMMatrix([scale, 0, 0, scale, op.x * scale, op.y * scale]);
      ctx.setTransform(worker);
      for (const s of op.behind) shape(ctx, s);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (const b of op.boxes) {
        ctx.fillStyle = b.color;
        fill(ctx, b, scale);
      }
      ctx.setTransform(worker);
      for (const s of op.front) shape(ctx, s);
      ctx.restore();
    }
  }
  ctx.restore();
}

/** One plan per mapping and schedule. Colours and toggles don't change it. */
let cache: { mapping: ResolvedMapping; key: string; plan: WallBuildPlan } | null = null;

export function wallBuildPlan(mapping: ResolvedMapping, settings: WallBuildSettings): WallBuildPlan {
  const key = `${settings.order}/${settings.seed}/${settings.buildSeconds}`;
  if (!cache || cache.mapping !== mapping || cache.key !== key) cache = { mapping, key, plan: planWallBuild(mapping, settings) };
  return cache.plan;
}

export function drawWallBuild(ctx: CanvasRenderingContext2D, input: FrameInput, scale: number, settings: WallBuildSettings) {
  const mapping = input.context?.mapping;
  if (!mapping) return;
  paintWallBuild(ctx, wallBuildOps(wallBuildPlan(mapping, settings), frameTick(input.frame, input.fps), settings), scale);
}
