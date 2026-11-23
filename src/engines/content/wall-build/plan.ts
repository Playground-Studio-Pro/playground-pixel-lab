import type { ContentFps } from "@/domain/motion";
import type { ResolvedMapping } from "@/engines/mapping";
import { placeReach } from "./character";
import { clampBuildSeconds, type BuildOrder, type PlanOptions } from "./settings";

/**
 * Wall Build's schedule: when each cabinet of the mapped walls is placed, and by which worker.
 *
 * Pure and deterministic. Cabinet positions are the mapping's own grid (`masterRect`, `columns`, `rows`,
 * cabinet pixels) and nothing else. Time is counted in whole ticks, 600 a second, which every content
 * FPS divides exactly, so the same moment is the same state at any content FPS.
 */

export const TICKS_PER_SECOND = 600;

export function frameTick(frame: number, fps: ContentFps): number {
  return Math.max(0, frame) * (TICKS_PER_SECOND / fps);
}

/** Workers on every wall together, before each wall's guaranteed one. Bounds the cost of a frame. */
export const MAX_WORKERS = 32;
/** A worker's whole trip is never planned shorter than this while there is time for it. */
const MIN_TRIP = 960;
/** A trip's active part. A longer trip starts with a wait. */
export const ACTIVE_TRIP = 1800;
/** After its last cabinet and the end of its wall, a worker leaves in this time. */
export const EXIT_TICKS = 600;

export interface PlanCabinet {
  readonly column: number;
  readonly row: number;
  readonly x: number;
  readonly y: number;
  readonly placedAt: number;
}

/** One carried cabinet, from pick up to placed. */
export interface PlanTrip {
  readonly start: number;
  readonly end: number;
  /** Index in `PlanScreen.cabinets` of the cabinet that is carried. */
  readonly lead: number;
  /** Where the feet are while placing it, in master pixels. */
  readonly x: number;
  readonly y: number;
  readonly facing: 1 | -1;
  /** How far the feet are below the cabinet's bottom edge, so the worker fits in the wall. */
  readonly lift: number;
  /** Carried overhead when the wall has room for it, pushed along otherwise. */
  readonly overhead: boolean;
}

export interface PlanScreen {
  readonly screenId: string;
  readonly color: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly rows: number;
  readonly cabinetWidth: number;
  readonly cabinetHeight: number;
  /** In reading order: row by row from the top, left to right. */
  readonly cabinets: readonly PlanCabinet[];
  /** Indices into `cabinets`, in build order. */
  readonly sequence: readonly number[];
  readonly workerHeight: number;
  /** Each worker's trips, in time order. */
  readonly workers: readonly (readonly PlanTrip[])[];
  readonly start: number;
  readonly end: number;
}

export interface WallBuildPlan {
  readonly width: number;
  readonly height: number;
  readonly screens: readonly PlanScreen[];
  /** Tick at which every wall is complete. */
  readonly buildTicks: number;
  /** Tick from which nothing changes: every wall complete and every worker gone. */
  readonly settledTick: number;
}

/** Seeded generator (mulberry32): whole numbers from 0 to 2^32 - 1. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const list = [...items];
  const next = generator(seed);
  for (let i = list.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Splits a list into `parts` runs of nearly equal length. `parts` is at most the list's length. */
function runs<T>(list: readonly T[], parts: number): T[][] {
  return range(parts).map((i) => list.slice(Math.floor((i * list.length) / parts), Math.floor(((i + 1) * list.length) / parts)));
}

interface Wall {
  readonly columns: number;
  readonly rows: number;
  readonly cabinetWidth: number;
  readonly cabinetHeight: number;
}

/** Rows from the bottom, each in the opposite direction, so a worker never crosses back for the next cabinet. */
function bottomUp({ columns, rows }: Wall, from: number, to: number): number[] {
  return range(rows).flatMap((n) => {
    const row = rows - 1 - n;
    return range(to - from).map((c) => row * columns + (n % 2 === 0 ? from + c : to - 1 - c));
  });
}

/** Nearest the centre first. Doubled coordinates keep the squared distance a whole number. */
function fromCenter({ columns, rows, cabinetWidth, cabinetHeight }: Wall): number[] {
  const distance = (i: number) => {
    const dx = (2 * (i % columns) + 1 - columns) * cabinetWidth;
    const dy = (2 * Math.floor(i / columns) + 1 - rows) * cabinetHeight;
    return dx * dx + dy * dy;
  };
  return range(columns * rows).map((i) => [distance(i), i] as const).sort((a, b) => a[0] - b[0] || b[1] - a[1]).map(([, i]) => i);
}

/**
 * The groups of cabinets, in build order. Group g is placed by worker `g % crew`; every cabinet index is
 * in exactly one group. `crew` is at most the columns, and `groups` at most the cabinets.
 */
function buildGroups(wall: Wall, order: BuildOrder, seed: number, crew: number, groups: number): number[][] {
  const { columns } = wall;
  if (order === "bottom-up") {
    // Each worker has its own columns, so a cabinet is always placed after the one below it.
    const zones = range(crew).map((j) => bottomUp(wall, Math.floor((j * columns) / crew), Math.floor(((j + 1) * columns) / crew)));
    const rounds = Math.max(1, Math.min(Math.floor(groups / crew), ...zones.map((z) => z.length)));
    const split = zones.map((z) => runs(z, rounds));
    return range(rounds).flatMap((r) => split.map((z) => z[r]));
  }
  const sequence = order === "center" ? fromCenter(wall) : shuffled(range(columns * wall.rows), seed);
  const list = runs(sequence, groups);
  // Within a round, from left to right: each worker keeps to its side of the wall.
  return range(Math.ceil(list.length / crew)).flatMap((r) => list.slice(r * crew, (r + 1) * crew).sort((a, b) => (a[a.length - 1] % columns) - (b[b.length - 1] % columns) || a[0] - b[0]));
}

/** When each wall starts, in order: all at once, or in turns when there are more walls than workers. */
function windows(mapping: ResolvedMapping, options: PlanOptions, buildTicks: number): { start: number; end: number }[] {
  const { screens } = mapping;
  const result = screens.map(() => ({ start: 0, end: buildTicks }));
  if (screens.length <= MAX_WORKERS) return result;
  let order = screens.map((_, i) => i);
  if (options.order === "random") order = shuffled(order, options.seed);
  else {
    const key = screens.map(({ masterRect: r }) => {
      if (options.order === "bottom-up") return -(r.y + r.height);
      const dx = 2 * r.x + r.width - mapping.master.width;
      const dy = 2 * r.y + r.height - mapping.master.height;
      return dx * dx + dy * dy;
    });
    order.sort((a, b) => key[a] - key[b] || a - b);
  }
  const turns = Math.ceil(screens.length / MAX_WORKERS);
  order.forEach((screen, i) => {
    const turn = Math.floor(i / MAX_WORKERS);
    result[screen] = { start: Math.floor((buildTicks * turn) / turns), end: Math.floor((buildTicks * (turn + 1)) / turns) };
  });
  return result;
}

export function planWallBuild(mapping: ResolvedMapping, options: PlanOptions): WallBuildPlan {
  const buildTicks = clampBuildSeconds(options.buildSeconds) * TICKS_PER_SECOND;
  const seed = Math.trunc(options.seed) >>> 0;
  const spans = windows(mapping, { ...options, seed }, buildTicks);
  const total = mapping.screens.reduce((sum, s) => sum + s.columns * s.rows, 0);

  const screens = mapping.screens.map((screen, index): PlanScreen => {
    const { columns, rows } = screen;
    const { x, y, width, height } = screen.masterRect;
    const cabinetWidth = screen.cabinet.pixelsX;
    const cabinetHeight = screen.cabinet.pixelsY;
    const { start, end } = spans[index];
    const span = end - start;
    const count = columns * rows;

    // Workers share the wall by its size. Groups keep every trip long enough to see.
    const crowd = Math.ceil(columns / 4);
    const share = mapping.screens.length > MAX_WORKERS ? 1 : Math.floor((MAX_WORKERS * count) / total);
    const workerCount = Math.max(1, Math.min(count, crowd, share));
    const wanted = Math.max(1, Math.min(count, Math.floor((workerCount * span) / MIN_TRIP) - workerCount + 1));
    const crew = Math.min(workerCount, wanted);
    const list = buildGroups({ columns, rows, cabinetWidth, cabinetHeight }, options.order, (seed + Math.imul(index + 1, 0x9e3779b1)) >>> 0, crew, wanted);
    const groups = list.length;
    const sequence = list.flat();
    // Group g is carried from step g to step g + crew. The last one lands exactly on the end.
    const steps = groups + crew - 1;
    const tick = (step: number) => start + Math.floor((span * step) / steps);

    const placedAt = new Array<number>(count).fill(end);
    const workerHeight = Math.max(1, Math.min(Math.round((cabinetHeight * 3) / 2), height));
    const reach = placeReach(workerHeight);
    const workers: PlanTrip[][] = Array.from({ length: crew }, () => []);

    for (let g = 0; g < groups; g++) {
      const group = list[g];
      const before = tick(g + crew - 1);
      const landed = tick(g + crew);
      group.forEach((cabinet, i) => (placedAt[cabinet] = before + Math.floor(((landed - before) * (i + 1)) / group.length)));

      const lead = group[group.length - 1];
      const slotX = x + (lead % columns) * cabinetWidth;
      const slotY = y + Math.floor(lead / columns) * cabinetHeight;
      const bottom = slotY + cabinetHeight;
      const lift = Math.max(0, workerHeight - (bottom - y));
      const trips = workers[g % crew];
      const last = trips[trips.length - 1];
      // Comes from the side it's already on, unless it would stand outside the wall.
      let facing: 1 | -1 = last ? (last.x <= slotX + Math.floor(cabinetWidth / 2) ? 1 : -1) : 2 * (lead % columns) + 1 >= columns ? 1 : -1;
      const standing = (f: 1 | -1) => (f === 1 ? slotX - reach : slotX + cabinetWidth + reach);
      const inside = (f: 1 | -1) => standing(f) >= x && standing(f) <= x + width;
      if (!inside(facing) && inside(facing === 1 ? -1 : 1)) facing = facing === 1 ? -1 : 1;
      trips.push({
        start: tick(g),
        end: landed,
        lead,
        x: standing(facing),
        y: bottom + lift,
        facing,
        lift,
        overhead: bottom + lift - workerHeight - cabinetHeight >= y,
      });
    }

    const cabinets = placedAt.map((placed, i): PlanCabinet => {
      const column = i % columns;
      const row = Math.floor(i / columns);
      return { column, row, x: x + column * cabinetWidth, y: y + row * cabinetHeight, placedAt: placed };
    });
    return { screenId: screen.screenId, color: screen.color, x, y, width, height, columns, rows, cabinetWidth, cabinetHeight, cabinets, sequence, workerHeight, workers, start, end };
  });

  return { width: mapping.master.width, height: mapping.master.height, screens, buildTicks, settledTick: buildTicks + EXIT_TICKS };
}

/** Seconds left to show: whole seconds, rounded up, 0 once complete. */
export function secondsLeft(plan: WallBuildPlan, tick: number): number {
  return Math.max(0, Math.ceil((plan.buildTicks - tick) / TICKS_PER_SECOND));
}
