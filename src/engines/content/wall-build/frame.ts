import { carriedCabinet } from "./cabinet";
import { heldRect, shade, WALK_STEP_UNITS, WORKER_UNITS, workerShapes, type WorkerInput, type WorkerShape } from "./character";
import { contrastRatio, DEFAULT_BACKGROUND, isHexColor, OUTLINE_DARK, OUTLINE_LIGHT, outlineFor } from "./contrast";
import type { WorkerFit } from "./fit";
import { ACTIVE_TRIP, EXIT_TICKS, secondsLeft, type PlanScreen, type PlanTrip, type WallBuildPlan } from "./plan";
import type { WallBuildLook } from "./settings";

/**
 * What Wall Build draws at one tick, as flat operations in whole master pixels, in paint order. Pure.
 * Master pixels no screen covers stay black, as on the wall.
 */

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type WallBuildOp =
  | ({ readonly kind: "fill"; readonly color: string } & Box)
  /** A 1 px line just inside the box. */
  | ({ readonly kind: "edge"; readonly color: string } & Box)
  /** A worker: shapes offset by `x`, `y`, cut to `clip`. Painted in this order: `under`, `behind`, `boxes`, `front`. */
  | { readonly kind: "worker"; readonly x: number; readonly y: number; readonly clip: Box; readonly under?: readonly ({ readonly color: string } & Box)[]; readonly behind: readonly WorkerShape[]; readonly boxes: readonly ({ readonly color: string } & Box)[]; readonly front: readonly WorkerShape[] };

/** A cabinet is brighter for this long after it's placed. */
const FLASH_TICKS = 180;

/** Parts of a trip's active time, in percent: the cabinet comes down, the walk, the placing. */
const PICKUP_END = 22;
const WALK_END = 72;

/** A placed cabinet's colour: neighbours always differ, so the cabinet grid shows with the grid off. */
export function placedColor(screen: Pick<PlanScreen, "color">, column: number, row: number): string {
  const base = isHexColor(screen.color) ? screen.color : "#2F6FE4";
  return shade(base, (column + row) % 2 === 0 ? -30 : -44);
}

/** The 1 px line on a placed cabinet's own edge, when the grid is on. */
export function placedEdge(screen: Pick<PlanScreen, "color">): string {
  return shade(isHexColor(screen.color) ? screen.color : "#2F6FE4", 45);
}

/** The line on an empty cabinet position: visible on any background, and quiet. */
export function emptyEdge(background: string): string {
  return contrastRatio(background, OUTLINE_LIGHT) >= contrastRatio(background, OUTLINE_DARK) ? shade(background, 18) : shade(background, -18);
}

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** Starts and stops gently. */
const ease = (t: number) => t * t * (3 - 2 * t);

interface WorkerState {
  readonly x: number;
  readonly y: number;
  readonly input: WorkerInput;
  /** The cabinet, in master pixels, when one is carried. */
  readonly cabinet: Box | null;
  /** The hoist's cable, above the cabinet while it comes down. */
  readonly cable: Box | null;
  /** False while it hops between levels. */
  readonly grounded: boolean;
  /** The cabinet is behind the worker. */
  readonly guided?: boolean;
}

/** The last tick a worker can be seen at on this wall. */
function leaves(screen: PlanScreen): number {
  return screen.end + EXIT_TICKS;
}

function workerAt(screen: PlanScreen, trips: readonly PlanTrip[], tick: number, look: WallBuildLook, seat: number): WorkerState | null {
  const first = trips[0];
  const begin = Math.max(first.start, first.end - ACTIVE_TRIP);
  if (tick < begin || tick >= leaves(screen)) return null;
  const { workerHeight: height, cabinetWidth: w, cabinetHeight: h } = screen;
  const size = { width: w, height: h };
  const base = { height, colors: look, background: look.background, blink: (tick + seat * 251) % 1500 < 70 } as const;
  const floor = screen.y + screen.height;

  const index = trips.findIndex((t) => tick < t.end);
  const trip = index < 0 ? null : trips[index];
  const previous = index < 0 ? trips[trips.length - 1] : index > 0 ? trips[index - 1] : null;

  if (!trip) {
    // Everything placed: waits for the wall, then hops down and out of the wall.
    const from = previous!;
    const out = clamp01((tick - screen.end) / EXIT_TICKS);
    const hop = Math.round(height * 2 * out * (1 - out));
    const y = lerp(from.y, floor + 2 * height, out * out) - hop;
    return { x: from.x, y, input: { ...base, pose: "stand", facing: from.facing }, cabinet: null, cable: null, grounded: out === 0 };
  }

  const active = Math.min(ACTIVE_TRIP, trip.end - trip.start);
  const p = ((tick - (trip.end - active)) * 100) / active;
  // The first trip starts near its position: the worker hops in from below the wall and takes its cabinet there.
  const from = previous ?? { x: Math.min(screen.x + screen.width, Math.max(screen.x, trip.x - trip.facing * 3 * w)), y: trip.y, facing: trip.facing };
  const pickup = clamp01(p / PICKUP_END);
  const walking = ease(clamp01((p - PICKUP_END) / (WALK_END - PICKUP_END)));
  const placing = ease(clamp01((p - WALK_END) / (100 - WALK_END)));
  if (p < 0) return { x: from.x, y: from.y, input: { ...base, pose: "stand", facing: from.facing }, cabinet: null, cable: null, grounded: true };

  if (!previous && pickup < 1) {
    const hop = Math.round(height * 2 * pickup * (1 - pickup));
    const y = lerp(floor + 2 * height, from.y, pickup) - hop;
    return { x: from.x, y, input: { ...base, pose: "stand", facing: from.facing }, cabinet: null, cable: null, grounded: false };
  }

  const x = lerp(from.x, trip.x, walking);
  const arc = from.y === trip.y ? 0 : Math.round(height * 2 * walking * (1 - walking));
  const y = lerp(from.y, trip.y, walking) - arc;
  const moving = walking > 0 && walking < 1;
  const grounded = from.y === trip.y || !moving;
  const step = moving ? Math.floor((Math.abs(x - from.x) * WORKER_UNITS) / (WALK_STEP_UNITS * height)) : undefined;
  // Overhead, the body turns to where it walks. Pushing, it always faces the cabinet.
  const travel: 1 | -1 = trip.x === from.x ? trip.facing : trip.x > from.x ? 1 : -1;
  const slot = screen.cabinets[trip.lead];

  if (trip.overhead && p < WALK_END) {
    const facing = travel;
    const held = heldRect({ pose: "carry-head", height, facing, cabinet: size })!;
    const top = y + held.y;
    // Comes down from above the wall on the hoist.
    const drop = Math.round((top + h - screen.y) * (1 - pickup) * (1 - pickup));
    const cabinet = { x: x + held.x, y: top - Math.max(0, drop), w, h };
    const cable = pickup < 1 && cabinet.y > screen.y ? { x: cabinet.x + Math.floor(w / 2) - 1, y: screen.y, w: 2, h: cabinet.y - screen.y } : null;
    return { x, y, input: { ...base, pose: "carry-head", facing, cabinet: size, step }, cabinet, cable, grounded };
  }

  const place = heldRect({ pose: "place", height, facing: trip.facing, cabinet: size, lift: trip.lift })!;
  const input: WorkerInput = { ...base, pose: "place", facing: trip.facing, cabinet: size, lift: trip.lift, step };
  if (trip.overhead) {
    const held = heldRect({ pose: "carry-head", height, facing: trip.facing, cabinet: size })!;
    return { x, y, input, cabinet: { x: lerp(x + held.x, slot.x, placing), y: lerp(y + held.y, slot.y, placing), w, h }, cable: null, grounded };
  }
  const drop = Math.round((y + place.y + h - screen.y) * (1 - pickup) * (1 - pickup));
  // In the last part it waits at its position, already exact.
  return { x, y, input, cabinet: { x: x + place.x, y: y + place.y - Math.max(0, drop), w, h }, cable: null, grounded };
}

/**
 * A worker on a wall too low for the normal size. It appears and leaves by growing and shrinking where it
 * stands, and never hops past the top, so it's whole inside the wall on every frame. The timing is the same
 * as everywhere else.
 */
function lowWorkerAt(screen: PlanScreen, low: WorkerFit, trips: readonly PlanTrip[], tick: number, look: WallBuildLook, seat: number): WorkerState | null {
  const first = trips[0];
  if (tick < Math.max(first.start, first.end - ACTIVE_TRIP) || tick >= leaves(screen)) return null;
  const { cabinetWidth: w, cabinetHeight: h } = screen;
  const height = low.height;
  const size = { width: w, height: h };
  const base = { height, colors: look, background: look.background, blink: (tick + seat * 251) % 1500 < 70 } as const;
  const stand = (at: { readonly x: number; readonly y: number; readonly facing: 1 | -1 }, share = 1): WorkerState => ({
    x: at.x, y: at.y, input: { ...base, height: Math.max(1, Math.round(height * share)), pose: "stand", facing: at.facing }, cabinet: null, cable: null, grounded: true,
  });

  const index = trips.findIndex((t) => tick < t.end);
  if (index < 0) return stand(trips[trips.length - 1], 1 - clamp01((tick - screen.end) / EXIT_TICKS));
  const trip = trips[index];
  const previous = index > 0 ? trips[index - 1] : null;
  const active = Math.min(ACTIVE_TRIP, trip.end - trip.start);
  const p = ((tick - (trip.end - active)) * 100) / active;
  const near = Math.min(screen.x + screen.width - low.side, Math.max(screen.x + low.side, trip.x - trip.facing * 3 * w));
  const from = previous ?? { x: near, y: trip.y, facing: trip.facing };
  if (p < 0) return stand(from);

  const pickup = clamp01(p / PICKUP_END);
  const walking = ease(clamp01((p - PICKUP_END) / (WALK_END - PICKUP_END)));
  const placing = ease(clamp01((p - WALK_END) / (100 - WALK_END)));
  const moving = walking > 0 && walking < 1;
  const x = lerp(from.x, trip.x, walking);
  const arc = from.y === trip.y ? 0 : Math.round(height * 2 * walking * (1 - walking));
  const y = Math.max(screen.y + low.above, lerp(from.y, trip.y, walking) - arc);
  const step = moving ? Math.floor((Math.abs(x - from.x) * WORKER_UNITS) / (WALK_STEP_UNITS * height)) : undefined;
  const grounded = from.y === trip.y || !moving;
  const slot = screen.cabinets[trip.lead];

  if (trip.guided) {
    if (!previous && pickup < 1) return stand(from, ease(pickup));
    const travel: 1 | -1 = trip.x === from.x ? trip.facing : trip.x > from.x ? 1 : -1;
    if (p < WALK_END) return { x, y, input: { ...base, pose: "stand", facing: travel, step }, cabinet: null, cable: null, grounded };
    return { x, y, input: { ...base, pose: "carry-head", facing: travel }, cabinet: { x: slot.x, y: lerp(screen.y - h, slot.y, placing), w, h }, cable: null, grounded, guided: true };
  }
  const place = heldRect({ pose: "place", height, facing: trip.facing, cabinet: size, lift: trip.lift })!;
  const drop = Math.round((y + place.y + h - screen.y) * (1 - pickup) * (1 - pickup));
  const cabinet = { x: x + place.x, y: y + place.y - Math.max(0, drop), w, h };
  // The first cabinet comes down while the worker is still appearing.
  if (!previous && pickup < 1) return { ...stand(from, ease(pickup)), cabinet };
  return { x, y, input: { ...base, pose: "place", facing: trip.facing, cabinet: size, lift: trip.lift, step }, cabinet, cable: null, grounded };
}

/** A narrow step under a worker's feet, where nothing is built below them yet. */
function ledgeUnder(screen: PlanScreen, state: WorkerState, tick: number): Box | null {
  if (!state.grounded || state.y >= screen.y + screen.height - (screen.low?.below ?? 0)) return null;
  const column = Math.min(screen.columns - 1, Math.max(0, Math.floor((state.x - screen.x) / screen.cabinetWidth)));
  const row = Math.floor((state.y - screen.y) / screen.cabinetHeight);
  if (row < 0 || row >= screen.rows || tick >= screen.cabinets[row * screen.columns + column].placedAt) return null;
  const half = Math.round(screen.workerHeight / 4);
  return { x: state.x - half, y: state.y, w: 2 * half, h: Math.max(1, Math.round(screen.workerHeight / 40)) };
}

/** 3 × 5 digits, so the countdown is the same on every machine. Bit 2 is the left column. */
const GLYPHS: Readonly<Record<string, readonly number[]>> = {
  "0": [7, 5, 5, 5, 7], "1": [2, 6, 2, 2, 7], "2": [7, 1, 7, 4, 7], "3": [7, 1, 7, 1, 7], "4": [5, 5, 7, 1, 1],
  "5": [7, 4, 7, 1, 7], "6": [7, 4, 7, 5, 7], "7": [7, 1, 2, 2, 2], "8": [7, 5, 7, 5, 7], "9": [7, 5, 7, 1, 7], ":": [0, 2, 0, 2, 0],
};

export function countdownText(seconds: number): string {
  return seconds < 60 ? String(seconds) : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The countdown on one wall, near its top. Nothing when the wall is too small for it. */
function countdownOps(screen: PlanScreen, text: string, longest: number): WallBuildOp[] {
  const columns = text.length * 4 + 1;
  // Sized for the longest text of the build, so it doesn't grow as digits drop off.
  const cell = Math.min(Math.floor(screen.width / (4 * (longest * 4 + 1))), Math.floor(screen.height / (screen.rows <= 2 ? 10 : 32)));
  if (cell < 1) return [];
  const w = columns * cell;
  const h = 7 * cell;
  const x = screen.x + Math.floor((screen.width - w) / 2);
  const y = screen.y + cell;
  const ops: WallBuildOp[] = [{ kind: "fill", x, y, w, h, color: OUTLINE_DARK }];
  [...text].forEach((char, i) => {
    GLYPHS[char].forEach((bits, row) => {
      for (let column = 0; column < 3; column++) {
        if (bits & (4 >> column)) ops.push({ kind: "fill", x: x + (i * 4 + 1 + column) * cell, y: y + (row + 1) * cell, w: cell, h: cell, color: OUTLINE_LIGHT });
      }
    });
  });
  return ops;
}

export function wallBuildOps(plan: WallBuildPlan, tick: number, look: WallBuildLook): WallBuildOp[] {
  const background = isHexColor(look.background) ? look.background : DEFAULT_BACKGROUND;
  const ops: WallBuildOp[] = [{ kind: "fill", x: 0, y: 0, w: plan.width, h: plan.height, color: "#000000" }];
  const edges: WallBuildOp[] = [];
  const front: WallBuildOp[] = [];
  const text = countdownText(secondsLeft(plan, tick));
  const empty = emptyEdge(background);

  // Every wall's fills first, then every edge: where walls share pixels, both grids show.
  for (const screen of plan.screens) ops.push({ kind: "fill", x: screen.x, y: screen.y, w: screen.width, h: screen.height, color: background });
  for (const screen of plan.screens) {
    const colors = [placedColor(screen, 0, 0), placedColor(screen, 1, 0)];
    const flash = colors.map((c) => shade(c, 55));
    const edge = placedEdge(screen);
    for (const c of screen.cabinets) {
      const placed = tick >= c.placedAt;
      const box = { x: c.x, y: c.y, w: screen.cabinetWidth, h: screen.cabinetHeight };
      if (placed) ops.push({ kind: "fill", ...box, color: (tick - c.placedAt < FLASH_TICKS ? flash : colors)[(c.column + c.row) % 2] });
      if (look.grid) edges.push({ kind: "edge", ...box, color: placed ? edge : empty });
    }
  }

  const rim = outlineFor(background);
  for (const screen of plan.screens) {
    if (tick < screen.start || tick >= leaves(screen)) continue;
    const clip = { x: screen.x, y: screen.y, w: screen.width, h: screen.height };
    screen.workers.forEach((trips, seat) => {
      const seen = { ...look, background };
      if (screen.workerHeight === 0) return;
      const state = screen.low ? lowWorkerAt(screen, screen.low, trips, tick, seen, seat) : workerAt(screen, trips, tick, seen, seat);
      if (!state) return;
      const drawing = workerShapes(state.input);
      const cabinet = state.cabinet ? carriedCabinet({ width: state.cabinet.w, height: state.cabinet.h }, background).map((q) => ({ x: state.cabinet!.x + q.x, y: state.cabinet!.y + q.y, w: q.w, h: q.h, color: q.fill })) : [];
      const boxes = state.guided ? [] : cabinet;
      if (state.cable) boxes.push({ ...state.cable, color: rim });
      const ledge = ledgeUnder(screen, state, tick);
      if (ledge) boxes.push({ ...ledge, color: rim });
      front.push({ kind: "worker", x: state.x, y: state.y, clip, ...(state.guided ? { under: cabinet } : {}), behind: drawing.behind, boxes, front: drawing.front });
    });
  }
  // The countdown stays readable over the workers. Walls that share pixels show it once.
  if (look.countdown && tick < plan.buildTicks) {
    const longest = countdownText(secondsLeft(plan, 0)).length;
    const shown: Box[] = [];
    for (const screen of plan.screens) {
      const [panel, ...digits] = countdownOps(screen, text, longest);
      if (!panel || panel.kind !== "fill" || shown.some((s) => s.x < panel.x + panel.w && panel.x < s.x + s.w && s.y < panel.y + panel.h && panel.y < s.y + s.h)) continue;
      shown.push(panel);
      front.push(panel, ...digits);
    }
  }
  return [...ops, ...edges, ...front];
}
