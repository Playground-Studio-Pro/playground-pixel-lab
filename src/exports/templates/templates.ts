import type { Rect } from "@/domain/units";
import type { ResolvedMapping, ResolvedScreen } from "@/engines/mapping";
import { slugify } from "../gate";
import type { ExportEntry, ExportFile, ExportInput } from "../contract";
import type { PixelMapScene, SceneNode } from "../scene";
import { renderSvg } from "../svg";

/**
 * Content templates: an image at the exact pixel size of a screen, a content canvas or an output, for a
 * designer to put content on. Pure scene builders: every value comes from `resolveMapping`.
 *
 * What a template shows, in its own pixels:
 * - each screen's area, with its cabinet grid as 1 px lines on the first pixel of every cabinet after the first;
 * - the screen's edge as a 1 px line in its colour, on its outermost pixels, so seams between screens show;
 * - two safe areas, 5 % and 10 % in from each edge;
 * - the name, resolution, position and cabinets, in the middle.
 * Pixels no screen covers are black.
 */

const OUTSIDE = "#000000";
const AREA = "#1E2029";
const GRID = "#3A3E50";
const ACTION_SAFE = "#3EC1E3";
const TITLE_SAFE = "#9B87FF";
const TEXT = "#FFFFFF";
const TEXT_DIM = "#B9BED0";

/** Safe areas, in percent of the screen's width and height in from each edge. */
export const SAFE_AREAS = [
  { percent: 5, color: ACTION_SAFE, label: "action safe 90%" },
  { percent: 10, color: TITLE_SAFE, label: "title safe 80%" },
] as const;

export interface TemplateScreen {
  readonly name: string;
  /** In the template's own pixels. */
  readonly rect: Rect<number>;
  readonly color: string;
  readonly columns: number;
  readonly rows: number;
  readonly cabinetWidth: number;
  readonly cabinetHeight: number;
  /** The position shown on the template, in the space that names it. */
  readonly position: string;
}

function outline(x: number, y: number, w: number, h: number, fill: string): SceneNode[] {
  if (w < 1 || h < 1) return [];
  return [
    { kind: "rect", x, y, width: w, height: 1, fill },
    { kind: "rect", x, y: y + h - 1, width: w, height: 1, fill },
    { kind: "rect", x, y, width: 1, height: h, fill },
    { kind: "rect", x: x + w - 1, y, width: 1, height: h, fill },
  ];
}

function screenNodes(s: TemplateScreen): SceneNode[] {
  const { x, y, width: w, height: h } = s.rect;
  const nodes: SceneNode[] = [{ kind: "rect", x, y, width: w, height: h, fill: AREA }];
  for (let c = 1; c < s.columns; c++) nodes.push({ kind: "rect", x: x + c * s.cabinetWidth, y, width: 1, height: h, fill: GRID });
  for (let r = 1; r < s.rows; r++) nodes.push({ kind: "rect", x, y: y + r * s.cabinetHeight, width: w, height: 1, fill: GRID });
  for (const safe of SAFE_AREAS) {
    const dx = Math.round((w * safe.percent) / 100);
    const dy = Math.round((h * safe.percent) / 100);
    nodes.push(...outline(x + dx, y + dy, w - 2 * dx, h - 2 * dy, safe.color));
  }
  nodes.push(...outline(x, y, w, h, s.color));

  const lines = [s.name, `${w} × ${h} px`, s.position, `${s.columns} × ${s.rows} cabinets of ${s.cabinetWidth} × ${s.cabinetHeight} px`];
  const longest = Math.max(...lines.map((l) => l.length));
  // Inside the title-safe area, or as large as fits.
  const size = Math.max(6, Math.floor(Math.min((h * 0.8) / (lines.length * 1.6), (w * 0.8) / (longest * 0.6))));
  const step = Math.ceil(size * 1.4);
  const top = y + Math.floor(h / 2) - Math.floor(((lines.length - 1) * step) / 2);
  lines.forEach((text, i) => {
    nodes.push({ kind: "text", x: x + Math.floor(w / 2), y: top + i * step, text, size: i === 0 ? size : Math.max(6, Math.floor(size * 0.75)), fill: i === 0 ? TEXT : TEXT_DIM });
  });
  return nodes;
}

export function templateScene(title: string, width: number, height: number, screens: readonly TemplateScreen[]): PixelMapScene {
  return { title, width, height, nodes: [{ kind: "rect", x: 0, y: 0, width, height, fill: OUTSIDE }, ...screens.flatMap(screenNodes)] };
}

function item(s: ResolvedScreen, rect: Rect<number>, position: string): TemplateScreen {
  return { name: s.name, rect, color: s.color, columns: s.columns, rows: s.rows, cabinetWidth: s.cabinet.pixelsX, cabinetHeight: s.cabinet.pixelsY, position };
}

export function screenTemplate(s: ResolvedScreen): PixelMapScene {
  const { width, height } = s.masterRect;
  return templateScene(`${s.name} template`, width, height, [item(s, { x: 0, y: 0, width, height }, `master ${s.masterRect.x}, ${s.masterRect.y}`)]);
}

/** A content canvas from its origin to its furthest screen edge, in canvas pixels. Null when it has no screens. */
export function canvasTemplate(mapping: ResolvedMapping, canvasId: string): PixelMapScene | null {
  const canvas = mapping.canvases.find((c) => c.canvasId === canvasId);
  const screens = mapping.screens.filter((s) => s.canvasId === canvasId);
  if (!canvas || screens.length === 0) return null;
  const width = Math.max(...screens.map((s) => s.canvasRect.x + s.canvasRect.width));
  const height = Math.max(...screens.map((s) => s.canvasRect.y + s.canvasRect.height));
  return templateScene(`${canvas.name} template`, width, height, screens.map((s) => item(s, s.canvasRect, `canvas ${s.canvasRect.x}, ${s.canvasRect.y}`)));
}

/** An output at its full size, in output pixels. Null when nothing is sent to it. */
export function outputTemplate(mapping: ResolvedMapping, outputId: string): PixelMapScene | null {
  const output = mapping.outputs.find((o) => o.outputId === outputId);
  const screens = mapping.screens.filter((s) => s.outputId === outputId);
  if (!output || screens.length === 0) return null;
  return templateScene(`${output.name} template`, output.width, output.height, screens.map((s) => item(s, s.outputRect, `output ${s.outputRect.x}, ${s.outputRect.y}`)));
}

export interface TemplateSet {
  readonly path: string;
  readonly scene: PixelMapScene;
}

/** Every template of a project, with distinct file paths, without extension. */
export function allTemplates(mapping: ResolvedMapping): TemplateSet[] {
  const seen = new Set<string>();
  const unique = (base: string) => {
    let path = base;
    for (let n = 2; seen.has(path); n++) path = `${base}-${n}`;
    seen.add(path);
    return path;
  };
  const sets: TemplateSet[] = [];
  const add = (folder: string, name: string, scene: PixelMapScene | null) => {
    if (scene) sets.push({ path: unique(`${folder}/${slugify(name)}_${scene.width}x${scene.height}`), scene });
  };
  for (const s of mapping.screens) add("screens", s.name, screenTemplate(s));
  for (const c of mapping.canvases) add("canvases", c.name, canvasTemplate(mapping, c.canvasId));
  for (const o of mapping.outputs) add("outputs", o.name, outputTemplate(mapping, o.outputId));
  return sets;
}

/** Every template as PNG and SVG. Not processor-facing, so it's allowed while the mapping has errors. */
export const contentTemplatesExport: ExportEntry = {
  id: "content-templates",
  label: "Content templates, PNG and SVG (.zip)",
  requiresValidMapping: false,
  async build({ mapping, rasterize }: ExportInput): Promise<readonly ExportFile[]> {
    const sets = allTemplates(mapping);
    if (sets.length === 0) throw new Error("There are no screens to make templates for. Add a screen first.");
    const files: ExportFile[] = [];
    for (const { path, scene } of sets) {
      files.push({ path: `${path}.svg`, content: renderSvg(scene) });
      files.push({ path: `${path}.png`, content: await rasterize(scene) });
    }
    return files;
  },
};
