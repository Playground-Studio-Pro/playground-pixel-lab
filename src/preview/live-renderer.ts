import type { ContentFps, MotionScreen, PatternId } from "@/domain/motion";
import type { Rect } from "@/domain/units";
import { renderPattern } from "@/engines/motion/patterns";
import type { OverlapKind, OverlapMark, PreviewRegion } from "@/engines/motion/regions";
import type { Viewport } from "@/engines/viewport";
import { drawPattern } from "./draw-pattern";
import { LABEL_HEIGHT, placeLabels, type LabelRequest } from "./label-layout";

interface Chip extends LabelRequest {
  readonly text: string;
  readonly background: string;
  readonly color: string;
}

/** Everything the preview draws that only changes when the project, view or selection changes. */
export interface LiveScene {
  readonly regions: readonly PreviewRegion[];
  /** Master or output bounds, drawn behind the screens. World units. */
  readonly frames: readonly { readonly name: string; readonly rect: Rect<number> }[];
  readonly overlaps: readonly OverlapMark[];
  readonly masterWidth: number;
  readonly masterHeight: number;
  readonly screens: readonly MotionScreen[];
  readonly unit: "px" | "mm";
  readonly selectedIds: ReadonlySet<string>;
}

export interface LiveFrame {
  readonly pattern: PatternId;
  readonly frame: number;
  readonly fps: ContentFps;
  readonly guides: boolean;
  readonly overlaps: boolean;
}

/** Largest side of the off-screen master image. Beyond it the preview is upscaled, never the export. */
export const MAX_SOURCE_SIDE = 4096;

const STAGE = "#07080F";
const FRAME_FILL = "#10121E";
const FRAME_LINE = "#2A2D42";
const SIGNAL = "#3EC1E3";
const OVERLAP_COLORS: Record<OverlapKind, string> = { shared: "#9B87FF", conflict: "#F0695E", stage: "#E8B04A" };

/**
 * Off-screen resolution for the master image: just enough device pixels for the most magnified
 * screen, capped at full master resolution and at MAX_SOURCE_SIDE. Pure, so it can be tested.
 */
export function sourceScale(regions: readonly PreviewRegion[], viewportScale: number, dpr: number, masterWidth: number, masterHeight: number): number {
  let need = 0;
  for (const r of regions) need = Math.max(need, (r.dest.width * viewportScale * dpr) / r.source.width, (r.dest.height * viewportScale * dpr) / r.source.height);
  const cap = Math.min(1, MAX_SOURCE_SIDE / Math.max(1, masterWidth), MAX_SOURCE_SIDE / Math.max(1, masterHeight));
  return Math.max(1 / 256, Math.min(need, cap));
}

/** Draws Motion Lab's live preview onto one canvas. Holds its own off-screen buffer; call dispose(). */
export class LiveRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly source = document.createElement("canvas");
  private readonly sourceCtx: CanvasRenderingContext2D;
  private readonly hatches = new Map<OverlapKind, CanvasPattern>();
  private dpr = 1;
  private cssWidth = 0;
  private cssHeight = 0;
  /** Laid-out labels, reused until the scene, view or toggles change. Labels don't move with the content. */
  private labelCache: { key: readonly unknown[]; chips: { chip: Chip; box: Rect<number> }[] } | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, private fontFamily = "sans-serif") {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.sourceCtx = this.source.getContext("2d", { alpha: false })!;
  }

  setFont(fontFamily: string) {
    this.fontFamily = fontFamily;
  }

  resize(cssWidth: number, cssHeight: number, dpr: number) {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.dpr = dpr;
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  render(scene: LiveScene, vp: Viewport, frame: LiveFrame) {
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = STAGE;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    if (scene.regions.length === 0 || scene.masterWidth < 1 || scene.masterHeight < 1) return;

    const toX = (x: number) => x * vp.scale + vp.offsetX;
    const toY = (y: number) => y * vp.scale + vp.offsetY;

    for (const f of scene.frames) {
      ctx.fillStyle = FRAME_FILL;
      ctx.fillRect(toX(f.rect.x), toY(f.rect.y), f.rect.width * vp.scale, f.rect.height * vp.scale);
    }

    // One master image per frame, shared by every screen: shared regions read identical pixels.
    const s = sourceScale(scene.regions, vp.scale, dpr, scene.masterWidth, scene.masterHeight);
    const sw = Math.max(1, Math.ceil(scene.masterWidth * s));
    const sh = Math.max(1, Math.ceil(scene.masterHeight * s));
    if (this.source.width !== sw) this.source.width = sw;
    if (this.source.height !== sh) this.source.height = sh;
    const pattern = renderPattern(frame.pattern, { frame: frame.frame, fps: frame.fps, width: scene.masterWidth, height: scene.masterHeight, screens: scene.screens });
    drawPattern(this.sourceCtx, pattern, s, this.fontFamily);

    for (const r of scene.regions) {
      const dw = r.dest.width * vp.scale;
      const dh = r.dest.height * vp.scale;
      // Enlarged LED pixels stay square and sharp. Reduced ones are smoothed.
      ctx.imageSmoothingEnabled = (dw * dpr) / r.source.width < 1;
      ctx.drawImage(this.source, r.source.x * s, r.source.y * s, r.source.width * s, r.source.height * s, toX(r.dest.x), toY(r.dest.y), dw, dh);
    }

    ctx.font = `600 11px ${this.fontFamily}`;
    ctx.textBaseline = "middle";
    for (const f of scene.frames) {
      ctx.strokeStyle = FRAME_LINE;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(toX(f.rect.x)) + 0.5, Math.round(toY(f.rect.y)) + 0.5, Math.round(f.rect.width * vp.scale), Math.round(f.rect.height * vp.scale));
      ctx.fillStyle = "#A5A8BA";
      ctx.textAlign = "left";
      ctx.fillText(f.name, toX(f.rect.x), toY(f.rect.y) - 10);
    }

    // Outlines first, labels last, laid out together so no label covers another.
    // Screen names are placed first, so they win over overlap labels.
    const key = [scene, vp.scale, vp.offsetX, vp.offsetY, this.cssWidth, this.cssHeight, frame.guides, frame.overlaps, this.fontFamily];
    const cached = this.labelCache && this.labelCache.key.every((v, i) => v === key[i]) ? this.labelCache : null;
    const overlapLabels: Chip[] | null = cached ? null : [];
    const guideLabels: Chip[] | null = cached ? null : [];
    if (frame.overlaps) this.drawOverlaps(scene.overlaps, toX, toY, vp.scale, overlapLabels);
    if (frame.guides) this.drawGuides(scene, toX, toY, vp.scale, guideLabels);
    if (!cached) {
      const labels = [...guideLabels!, ...overlapLabels!];
      const boxes = placeLabels(labels, { x: 0, y: 0, width: this.cssWidth, height: this.cssHeight });
      const chips = labels.flatMap((chip, i) => (boxes[i] ? [{ chip, box: boxes[i] }] : []));
      this.labelCache = { key, chips };
    }
    for (const { chip, box } of this.labelCache!.chips) this.chip(chip, box);
  }

  private hatch(kind: OverlapKind): CanvasPattern | null {
    const cached = this.hatches.get(kind);
    if (cached) return cached;
    const tile = document.createElement("canvas");
    tile.width = tile.height = 10;
    const t = tile.getContext("2d")!;
    t.strokeStyle = OVERLAP_COLORS[kind];
    t.globalAlpha = 0.55;
    t.lineWidth = 2;
    t.beginPath();
    t.moveTo(-2, 12);
    t.lineTo(12, -2);
    t.stroke();
    const pattern = this.ctx.createPattern(tile, "repeat");
    if (pattern) this.hatches.set(kind, pattern);
    return pattern;
  }

  private drawOverlaps(marks: readonly OverlapMark[], toX: (x: number) => number, toY: (y: number) => number, scale: number, labels: Chip[] | null) {
    const { ctx } = this;
    for (const mark of marks) {
      const color = OVERLAP_COLORS[mark.kind];
      for (const rect of mark.rects) {
        const x = toX(rect.x);
        const y = toY(rect.y);
        const w = rect.width * scale;
        const h = rect.height * scale;
        const hatch = this.hatch(mark.kind);
        if (hatch) {
          ctx.fillStyle = hatch;
          ctx.fillRect(x, y, w, h);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = mark.kind === "conflict" ? 2 : 1.5;
        ctx.setLineDash(mark.kind === "shared" ? [6, 4] : []);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        const chip = labels && this.fit(mark.label, { x, y, width: w, height: h }, "bottom", color, "#0C0C14");
        if (chip) labels!.push(chip);
      }
    }
  }

  private drawGuides(scene: LiveScene, toX: (x: number) => number, toY: (y: number) => number, scale: number, labels: Chip[] | null) {
    const { ctx } = this;
    for (const r of scene.regions) {
      const x = Math.round(toX(r.dest.x)) + 0.5;
      const y = Math.round(toY(r.dest.y)) + 0.5;
      const w = Math.round(r.dest.width * scale);
      const h = Math.round(r.dest.height * scale);
      const selected = scene.selectedIds.has(r.screenId);
      ctx.strokeStyle = selected ? SIGNAL : "rgba(255,255,255,0.7)";
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeRect(x, y, w, h);
      // Pixel size always; master position too where the view is in pixels.
      if (!labels) continue;
      const at = scene.unit === "px" ? `  at ${r.source.x}, ${r.source.y}` : "";
      const chip = this.fit(`${r.name}  ${r.source.width} × ${r.source.height} px${at}`, { x, y, width: w, height: h }, "top", "rgba(7,8,15,0.78)", "#FFFFFF");
      if (chip) labels.push(chip);
    }
  }

  /** Truncates a label to its area. Null when even a short label wouldn't fit. */
  private fit(text: string, area: Rect<number>, anchor: Chip["anchor"], background: string, color: string): Chip | null {
    if (area.width < 60 || area.height < LABEL_HEIGHT + 8) return null;
    if (area.x > this.cssWidth || area.y > this.cssHeight || area.x + area.width < 0 || area.y + area.height < 0) return null;
    const { ctx } = this;
    ctx.font = `600 11px ${this.fontFamily}`;
    const maxWidth = area.width - 8;
    let label = text;
    while (label.length > 1 && ctx.measureText(label).width + 10 > maxWidth) label = label.slice(0, -2) + "…";
    const width = Math.ceil(ctx.measureText(label).width + 10);
    if (width > maxWidth) return null;
    return { text: label, width, area, anchor, background, color };
  }

  /** A small label on a solid backing, so it reads over bright content. */
  private chip(chip: Chip, box: Rect<number>) {
    const { ctx } = this;
    ctx.font = `600 11px ${this.fontFamily}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = chip.background;
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.fillStyle = chip.color;
    ctx.fillText(chip.text, box.x + 5, box.y + box.height / 2 + 0.5);
  }

  dispose() {
    this.source.width = 0;
    this.source.height = 0;
    this.hatches.clear();
    this.labelCache = null;
  }
}
