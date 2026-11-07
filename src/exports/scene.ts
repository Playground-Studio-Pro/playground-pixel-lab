import type { Rect } from "@/domain/units";
import type { ResolvedMapping, ResolvedScreen } from "@/engines/mapping";

/**
 * A renderer-neutral description of a pixel map, in exact integer pixels.
 * The SVG and PNG renderers draw this same scene, so they cannot disagree.
 */
export type SceneNode =
  | { readonly kind: "rect"; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly fill: string }
  | { readonly kind: "line"; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly stroke: string }
  | { readonly kind: "text"; readonly x: number; readonly y: number; readonly text: string; readonly size: number; readonly fill: string };

export interface PixelMapScene {
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly SceneNode[];
}

export const SCENE_BACKGROUND = "#05060C";
export const SCENE_BORDER = "#FFFFFF";
const TEXT_FILL = "#FFFFFF";
const DIAGONAL = "rgba(255,255,255,0.35)";

export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (value: number) => Math.round(value * amount).toString(16).padStart(2, "0");
  return `#${channel((n >> 16) & 255)}${channel((n >> 8) & 255)}${channel(n & 255)}`.toUpperCase();
}

export interface SceneItem {
  readonly name: string;
  readonly rect: Rect<number>;
  readonly color: string;
  readonly cabinetPixelsX: number;
  readonly cabinetPixelsY: number;
  readonly columns: number;
  readonly rows: number;
}

function itemNodes(item: SceneItem): SceneNode[] {
  const { x, y, width, height } = item.rect;
  const nodes: SceneNode[] = [];

  // Checkerboard one cell per cabinet, so a misplaced cabinet is visible on the wall.
  const light = item.color;
  const dark = shade(item.color, 0.62);
  for (let row = 0; row < item.rows; row++) {
    for (let col = 0; col < item.columns; col++) {
      nodes.push({
        kind: "rect",
        x: x + col * item.cabinetPixelsX,
        y: y + row * item.cabinetPixelsY,
        width: item.cabinetPixelsX,
        height: item.cabinetPixelsY,
        fill: (row + col) % 2 === 0 ? light : dark,
      });
    }
  }

  // Corner-to-corner diagonals expose scaling and cropping.
  nodes.push({ kind: "line", x1: x, y1: y, x2: x + width, y2: y + height, stroke: DIAGONAL });
  nodes.push({ kind: "line", x1: x + width, y1: y, x2: x, y2: y + height, stroke: DIAGONAL });

  // A 1 px border drawn inside the region: the outermost pixels of every edge are white.
  nodes.push(
    { kind: "rect", x, y, width, height: 1, fill: SCENE_BORDER },
    { kind: "rect", x, y: y + height - 1, width, height: 1, fill: SCENE_BORDER },
    { kind: "rect", x, y, width: 1, height, fill: SCENE_BORDER },
    { kind: "rect", x: x + width - 1, y, width: 1, height, fill: SCENE_BORDER },
  );

  const lines = [item.name, `${width} × ${height} px`, `x ${x}  y ${y}`];
  const longest = Math.max(...lines.map((line) => line.length));
  const size = Math.max(9, Math.floor(Math.min(height / (lines.length * 2.2), (width * 0.85) / (longest * 0.6))));
  const centerX = x + Math.floor(width / 2);
  const firstY = y + Math.floor(height / 2) - Math.floor(((lines.length - 1) * size * 1.3) / 2);
  lines.forEach((text, index) => {
    nodes.push({
      kind: "text",
      x: centerX,
      y: firstY + Math.floor(index * size * 1.3),
      text,
      size: index === 0 ? size : Math.max(9, Math.floor(size * 0.8)),
      fill: TEXT_FILL,
    });
  });
  return nodes;
}

function toItem(screen: ResolvedScreen, rect: Rect<number>): SceneItem {
  return {
    name: screen.name,
    rect,
    color: screen.color,
    cabinetPixelsX: screen.cabinet.pixelsX,
    cabinetPixelsY: screen.cabinet.pixelsY,
    columns: screen.columns,
    rows: screen.rows,
  };
}

function buildScene(title: string, width: number, height: number, items: readonly SceneItem[]): PixelMapScene {
  return {
    title,
    width,
    height,
    nodes: [{ kind: "rect", x: 0, y: 0, width, height, fill: SCENE_BACKGROUND }, ...items.flatMap(itemNodes)],
  };
}

export function masterScene(mapping: ResolvedMapping, title: string): PixelMapScene {
  return buildScene(title, mapping.master.width, mapping.master.height, mapping.screens.map((s) => toItem(s, s.masterRect)));
}

export function outputScene(mapping: ResolvedMapping, outputId: string, title: string): PixelMapScene {
  const output = mapping.outputs.find((o) => o.outputId === outputId);
  if (!output) throw new Error("That output no longer exists.");
  const screens = mapping.screens.filter((s) => s.outputId === outputId);
  return buildScene(title, output.width, output.height, screens.map((s) => toItem(s, s.outputRect)));
}

export function screenScene(screen: ResolvedScreen): PixelMapScene {
  return buildScene(screen.name, screen.spec.pixelWidth, screen.spec.pixelHeight, [
    toItem(screen, { x: 0, y: 0, width: screen.spec.pixelWidth, height: screen.spec.pixelHeight }),
  ]);
}
