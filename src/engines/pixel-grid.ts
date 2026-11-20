/**
 * The pixel-grid test card, pure geometry (PHYSICAL_OUTPUT 8.7). It makes any scaling, offset, crop or
 * resampling visible: on a canvas capture, in a decoded MP4 and in a close-up photo of the display.
 *
 * Everything is in whole pixels relative to one rectangle's top-left corner: a screen's `masterRect` when the
 * card is drawn on the master canvas, or the whole framebuffer on the output window. `pixelGridOps` lists what
 * to paint, in order; `gridPixelAt` evaluates the same list at one pixel, so tests compare a capture against
 * it. No DOM, no clock. Owned by Output Engineering.
 */

export type Rgb = readonly [number, number, number];

export const GRID_COLORS = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  minor: [0x40, 0x40, 0x40],
  major: [0xa0, 0xa0, 0xa0],
  red: [255, 0, 0],
  green: [0, 255, 0],
  blue: [0, 0, 255],
} as const satisfies Record<string, Rgb>;

export type GridPattern = "checker-1" | "checker-2" | "stripes-v" | "stripes-h";

export type GridOp =
  | { readonly kind: "rect"; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly color: Rgb }
  /** A black/white pattern whose phase starts at the op's own top-left pixel (white there). */
  | { readonly kind: "pattern"; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly pattern: GridPattern }
  /** A black box with white text inside. The text is anti-aliased and clipped to the box. */
  | { readonly kind: "text"; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly text: string };

export interface GridSize {
  readonly w: number;
  readonly h: number;
}

export interface GridLabel {
  /** Coordinates printed at pixel (0, 0) of the rectangle: its master position, or 0, 0 on a display. */
  readonly originX: number;
  readonly originY: number;
  /** Centre label, e.g. `Wall A · 768 × 512 · master 101,37 · out 13,7`. Null for none. */
  readonly title: string | null;
}

export interface GridOptions {
  /** Content frame for the motion marker; null hides it. */
  readonly motionFrame: number | null;
}

/** Sizes of the card's elements, in px. */
export const GRID = {
  markerInset: 4,
  markerSize: 16,
  patch: 64,
  /** Four patches, 2 × 2: 1 × 1 checker, 2 × 2 checker, vertical stripes, horizontal stripes. */
  block: 128,
  blockInset: 28,
  motionRow: 24,
  motionSize: 4,
  motionStep: 4,
  minorEvery: 10,
  majorEvery: 100,
  /** Text box: monospace 11 px. A character is at most 7 px wide in the faces used. */
  charWidth: 7,
  textHeight: 14,
  textPad: 2,
} as const;

/** True where a pattern is white, at (u, v) from its top-left pixel. */
export function patternWhite(pattern: GridPattern, u: number, v: number): boolean {
  switch (pattern) {
    case "checker-1":
      return (u + v) % 2 === 0;
    case "checker-2":
      return ((u >> 1) + (v >> 1)) % 2 === 0;
    case "stripes-v":
      return u % 2 === 0;
    case "stripes-h":
      return v % 2 === 0;
  }
}

const even = (n: number) => n - (n % 2);

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function frame(x: number, y: number, w: number, h: number, color: Rgb): GridOp[] {
  if (w < 1 || h < 1) return [];
  return [
    { kind: "rect", x, y, w, h: 1, color },
    { kind: "rect", x, y: y + h - 1, w, h: 1, color },
    { kind: "rect", x, y, w: 1, h, color },
    { kind: "rect", x: x + w - 1, y, w: 1, h, color },
  ];
}

function block(x: number, y: number): GridOp[] {
  const p = GRID.patch;
  return [
    { kind: "pattern", x, y, w: p, h: p, pattern: "checker-1" },
    { kind: "pattern", x: x + p, y, w: p, h: p, pattern: "checker-2" },
    { kind: "pattern", x, y: y + p, w: p, h: p, pattern: "stripes-v" },
    { kind: "pattern", x: x + p, y: y + p, w: p, h: p, pattern: "stripes-h" },
  ];
}

function textBox(x: number, y: number, text: string): Box & { text: string } {
  return { x, y, w: text.length * GRID.charWidth + 2 * GRID.textPad, h: GRID.textHeight, text };
}

/**
 * What to paint for one rectangle, in order: later ops cover earlier ones. Elements that don't fit a small
 * rectangle are left out, never shrunk. Same input, same ops.
 */
export function pixelGridOps(size: GridSize, label: GridLabel, options: GridOptions): GridOp[] {
  const { w, h } = size;
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1) throw new RangeError(`A grid needs whole pixels, got ${w} × ${h}.`);
  const ops: GridOp[] = [{ kind: "rect", x: 0, y: 0, w, h, color: GRID_COLORS.black }];

  // Grid lines from the origin. Majors last, so a crossing is light.
  for (const major of [false, true]) {
    const every = major ? GRID.majorEvery : GRID.minorEvery;
    const color = major ? GRID_COLORS.major : GRID_COLORS.minor;
    for (let x = 0; x < w; x += every) if (major || x % GRID.majorEvery) ops.push({ kind: "rect", x, y: 0, w: 1, h, color });
    for (let y = 0; y < h; y += every) if (major || y % GRID.majorEvery) ops.push({ kind: "rect", x: 0, y, w, h: 1, color });
  }

  // Checker blocks: one in the centre, and one next to each corner marker when they all fit apart.
  const protectedBoxes: Box[] = [];
  const B = GRID.block;
  const blocks: Box[] = [];
  if (w >= B + 32 && h >= B + 32) blocks.push({ x: even(Math.floor((w - B) / 2)), y: even(Math.floor((h - B) / 2)), w: B, h: B });
  const cornersFit = (n: number) => n >= 2 * (GRID.blockInset + B) + B + 16;
  if (cornersFit(w) && cornersFit(h)) {
    const right = even(w - GRID.blockInset - B);
    const bottom = even(h - GRID.blockInset - B);
    blocks.push(
      { x: GRID.blockInset, y: GRID.blockInset, w: B, h: B },
      { x: right, y: GRID.blockInset, w: B, h: B },
      { x: GRID.blockInset, y: bottom, w: B, h: B },
      { x: right, y: bottom, w: B, h: B },
    );
  }
  for (const b of blocks) {
    ops.push(...block(b.x, b.y));
    protectedBoxes.push(b);
  }

  // Edges: a 1-px black gap at inset 1, a white line at inset 2, the white edge line on the outermost pixels.
  if (w >= 5 && h >= 5) {
    ops.push(...frame(1, 1, w - 2, h - 2, GRID_COLORS.black));
    ops.push(...frame(2, 2, w - 4, h - 4, GRID_COLORS.white));
  }
  ops.push(...frame(0, 0, w, h, GRID_COLORS.white));
  protectedBoxes.push({ x: 0, y: 0, w, h: 4 }, { x: 0, y: h - 4, w, h: 4 }, { x: 0, y: 0, w: 4, h }, { x: w - 4, y: 0, w: 4, h });

  // Corner markers, each with a black notch on its own outer corner pixel.
  const M = GRID.markerSize;
  const I = GRID.markerInset;
  if (w >= 2 * (I + M) + 8 && h >= 2 * (I + M) + 8) {
    const markers: [number, number, Rgb, number, number][] = [
      [I, I, GRID_COLORS.red, I, I],
      [w - I - M, I, GRID_COLORS.green, w - I - 1, I],
      [I, h - I - M, GRID_COLORS.blue, I, h - I - 1],
      [w - I - M, h - I - M, GRID_COLORS.white, w - I - 1, h - I - 1],
    ];
    for (const [x, y, color, nx, ny] of markers) {
      ops.push({ kind: "rect", x, y, w: M, h: M, color }, { kind: "rect", x: nx, y: ny, w: 1, h: 1, color: GRID_COLORS.black });
      protectedBoxes.push({ x, y, w: M, h: M });
    }
  }
  if (h >= GRID.motionRow + GRID.motionSize) protectedBoxes.push({ x: 0, y: GRID.motionRow, w, h: GRID.motionSize });

  // Centre label under the centre block, or centred when there is no block.
  const texts: (Box & { text: string })[] = [];
  if (label.title) {
    const box = textBox(0, 0, label.title);
    const centre = blocks[0];
    box.x = Math.floor((w - box.w) / 2);
    box.y = centre ? centre.y + centre.h + 6 : Math.floor((h - box.h) / 2);
    const inside = box.x >= 4 && box.y >= 4 && box.x + box.w <= w - 4 && box.y + box.h <= h - 4;
    if (inside && !protectedBoxes.some((p) => overlaps(p, box))) {
      texts.push(box);
      protectedBoxes.push(box);
    }
  }

  // Coordinates at every 100-px crossing, printed in the rectangle's own space.
  for (let y = GRID.majorEvery; y < h; y += GRID.majorEvery) {
    for (let x = GRID.majorEvery; x < w; x += GRID.majorEvery) {
      const box = textBox(x + 2, y + 2, `${label.originX + x},${label.originY + y}`);
      if (box.x + box.w > w - 4 || box.y + box.h > h - 4) continue;
      if (protectedBoxes.some((p) => overlaps(p, box))) continue;
      texts.push(box);
    }
  }
  for (const t of texts) ops.push({ kind: "text", x: t.x, y: t.y, w: t.w, h: t.h, text: t.text });

  const motion = options.motionFrame === null ? null : motionMarkerOp(size, options.motionFrame);
  if (motion) ops.push(motion);
  return ops;
}

/**
 * The motion marker alone: steps 4 px right per content frame along row 24, between x = 4 and w − 4, so it
 * never covers the edge lines. Null when the rectangle is too small to hold it there.
 */
export function motionMarkerOp(size: GridSize, frame: number): GridOp | null {
  const steps = Math.floor((size.w - 8) / GRID.motionStep);
  if (size.h < GRID.motionRow + GRID.motionSize + 4 || steps < 1) return null;
  const n = ((Math.floor(frame) % steps) + steps) % steps;
  return { kind: "rect", x: 4 + n * GRID.motionStep, y: GRID.motionRow, w: GRID.motionSize, h: GRID.motionSize, color: GRID_COLORS.white };
}

/** The colour the ops put at (x, y), or "text" inside a text box (anti-aliased, not compared exactly). */
export function gridPixelAt(ops: readonly GridOp[], x: number, y: number): Rgb | "text" {
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    if (x < op.x || y < op.y || x >= op.x + op.w || y >= op.y + op.h) continue;
    if (op.kind === "rect") return op.color;
    if (op.kind === "text") return "text";
    return patternWhite(op.pattern, x - op.x, y - op.y) ? GRID_COLORS.white : GRID_COLORS.black;
  }
  return GRID_COLORS.black;
}

/** The oracle the pixel tests compare a capture against. */
export function expectedGridPixel(size: GridSize, label: GridLabel, options: GridOptions, x: number, y: number): Rgb | "text" {
  return gridPixelAt(pixelGridOps(size, label, options), x, y);
}

/** One screen's grid rectangle on the master canvas, labelled with where it is on the master and the output. */
export interface GridRegion {
  readonly x: number;
  readonly y: number;
  readonly size: GridSize;
  readonly label: GridLabel;
}

/** The master canvas's grid rectangles, one per screen, in mapping order (later ones draw over earlier ones). */
export function masterGridRegions(screens: readonly { readonly name: string; readonly masterRect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }; readonly outputRect: { readonly x: number; readonly y: number } }[]): GridRegion[] {
  return screens.map((s) => {
    const r = s.masterRect;
    const title = `${s.name} · ${r.width} × ${r.height} · master ${r.x},${r.y} · out ${s.outputRect.x},${s.outputRect.y}`;
    return { x: r.x, y: r.y, size: { w: r.width, h: r.height }, label: { originX: r.x, originY: r.y, title } };
  });
}
