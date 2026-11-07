/**
 * Browser preview metrics. These describe how this browser is drawing the preview, never the LED
 * wall: physical refresh rate is a property of the panel and can't be measured from here. Pure.
 */
export interface PreviewStats {
  /** Recent intervals between drawn frames, in ms, newest last. */
  readonly intervals: readonly number[];
  readonly drawn: number;
  /** Drawn frames that arrived well after the usual interval. */
  readonly late: number;
  /** Content frames that were due but never drawn. */
  readonly skipped: number;
  readonly lastContentFrame: number | null;
}

export const STATS_WINDOW = 60;
/** An interval this many times the median counts as late. */
export const LATE_FACTOR = 1.5;
const MIN_SAMPLES = 10;

export const emptyStats: PreviewStats = { intervals: [], drawn: 0, late: 0, skipped: 0, lastContentFrame: null };

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Records one drawn browser frame. `intervalMs` is the time since the previous one, or null for the
 * first. `contentFrame` is the content frame it showed.
 */
export function recordFrame(stats: PreviewStats, intervalMs: number | null, contentFrame: number): PreviewStats {
  let { late, skipped } = stats;
  let intervals = stats.intervals;
  if (intervalMs !== null) {
    if (intervals.length >= MIN_SAMPLES && intervalMs > median(intervals) * LATE_FACTOR) late++;
    intervals = [...intervals, intervalMs].slice(-STATS_WINDOW);
  }
  const last = stats.lastContentFrame;
  // A jump forward means frames were never shown. A jump back is a restart, not a skip.
  if (last !== null && contentFrame > last + 1) skipped += contentFrame - last - 1;
  return { intervals, drawn: stats.drawn + 1, late, skipped, lastContentFrame: contentFrame };
}

/** Measured preview frames per second over the recent window, or null until there are enough samples. */
export function previewFps(stats: PreviewStats): number | null {
  if (stats.intervals.length < MIN_SAMPLES) return null;
  const mean = stats.intervals.reduce((sum, v) => sum + v, 0) / stats.intervals.length;
  return mean > 0 ? 1000 / mean : null;
}
