import { DEFAULT_BACKGROUND, isHexColor } from "./contrast";

/** Wall Build's settings and their limits. Pure, and small: controls use it without loading the engine. */

export const BUILD_ORDERS = ["bottom-up", "center", "random"] as const;
export type BuildOrder = (typeof BUILD_ORDERS)[number];

export const MIN_BUILD_SECONDS = 5;
export const MAX_BUILD_SECONDS = 600;
export const MAX_SEED = 9999;

export interface WorkerColors {
  /** `#RRGGBB` */
  readonly helmet: string;
  /** `#RRGGBB` */
  readonly vest: string;
}

export const DEFAULT_WORKER_COLORS: WorkerColors = { helmet: "#FFC53D", vest: "#FF6A1A" };

export interface PlanOptions {
  readonly order: BuildOrder;
  /** Whole number. Only the random order uses it. */
  readonly seed: number;
  /** Total build time: the last cabinet of the last wall is placed at this second. */
  readonly buildSeconds: number;
}

export interface WallBuildLook extends WorkerColors {
  readonly background: string;
  readonly grid: boolean;
  readonly countdown: boolean;
}

export type WallBuildSettings = PlanOptions & WallBuildLook;

export const DEFAULT_WALL_BUILD: WallBuildSettings = {
  order: "bottom-up",
  seed: 1,
  buildSeconds: 20,
  ...DEFAULT_WORKER_COLORS,
  background: DEFAULT_BACKGROUND,
  grid: true,
  countdown: false,
};

/** Whole seconds within the limits. */
export function clampBuildSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_WALL_BUILD.buildSeconds;
  return Math.min(MAX_BUILD_SECONDS, Math.max(MIN_BUILD_SECONDS, Math.round(seconds)));
}

/** Valid settings only: anything else keeps the current value. */
export function applyWallBuild(current: WallBuildSettings, change: Partial<WallBuildSettings>): WallBuildSettings {
  const color = (key: "helmet" | "vest" | "background") => {
    const value = change[key];
    return isHexColor(value) ? value.toUpperCase() : current[key];
  };
  const { order, seed, buildSeconds } = change;
  return {
    order: order !== undefined && BUILD_ORDERS.includes(order) ? order : current.order,
    seed: seed !== undefined && Number.isFinite(seed) ? Math.min(MAX_SEED, Math.max(0, Math.round(seed))) : current.seed,
    buildSeconds: buildSeconds !== undefined && Number.isFinite(buildSeconds) ? clampBuildSeconds(buildSeconds) : current.buildSeconds,
    helmet: color("helmet"),
    vest: color("vest"),
    background: color("background"),
    grid: change.grid ?? current.grid,
    countdown: change.countdown ?? current.countdown,
  };
}
