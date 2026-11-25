import { cadencePattern, median, type RefreshGrid } from "../output-layout";

/**
 * Playback timing on a display (PHYSICAL_OUTPUT 8.6): the refresh grid a window draws on, found from its rAF
 * timestamps, and the count of content frames skipped or held too long. Pure: no DOM, no clock.
 */

/** Timestamps in the phase and rate fit: 2 s at 60 Hz. */
const FIT_SAMPLES = 120;
/** Timestamps needed before the fit may move the grid. */
const MIN_FIT_SAMPLES = 30;
/** Timestamps between one look at the rate and phase and the next. */
const FIT_EVERY = 10;
/** Intervals in the median that notices the display's rate changing. */
const MEDIAN_SAMPLES = 60;
/** The grid moves only when the display's phase is further than this from it, in periods. */
const DEADBAND = 1 / 8;
/** Chromium rounds rAF timestamps to this many ms unless the page is cross-origin isolated. */
const STAMP_STEP_MS = 0.1;
/** Without a callback for this long (an occluded window, sleep) the phase is measured afresh. */
const GAP_MS = 500;

/**
 * Follows the display's refreshes from rAF timestamps.
 *
 * The timestamps carry rounding (0.1 ms) and jitter, so neither the period nor the phase is read off a few of them:
 *
 * - **Period:** `1000 / N`, with N the display's rate as a whole number. It is a ruler, not a measurement: content
 *   rates are whole numbers too, so a steady display keeps every frame at one phase forever. A display that isn't at
 *   a whole rate (59.94 Hz) drifts against the ruler, slowly and in one direction.
 * - **Phase:** a least-squares line through the last 120 timestamps. The grid stays where it is until the line is
 *   more than 1/8 period away, then moves onto it. Noise far smaller than that can't move it at all, and a drift
 *   moves it one way only, so a content frame boundary is crossed once and never back.
 *
 * Refreshes are counted, so a dropped callback takes two steps and leaves the period and the phase as they were.
 */
export class RefreshTracker {
  private hz = 0;
  private anchorMs = 0;
  private lastT: number | null = null;
  /** The last timestamp's refresh, counted from the anchor. */
  private lastN = 0;
  /** Refreshes since the first timestamp, through every grid move. */
  private count = 0;
  /** `n` counts from the anchor; `r` is the timestamp's distance from its refresh, in ms. */
  private samples: { n: number; r: number }[] = [];
  private intervals: number[] = [];
  private fittedPeriod: number | null = null;
  private sinceFit = 0;
  private lastHint = 0;

  /** Takes a rAF timestamp. `hintHz` is the display's reported rate (0 when unknown). */
  push(t: number, hintHz = 0): void {
    const previous = this.lastT;
    this.lastT = t;
    if (previous === null) return void (this.anchorMs = t);
    const interval = t - previous;
    if (interval <= 0) return;
    this.intervals.push(interval);
    if (this.intervals.length > MEDIAN_SAMPLES) this.intervals.shift();
    if (this.hz === 0) {
      // One interval says little: the reported rate if it is near it at all. `fit` corrects either.
      this.lastHint = Math.round(hintHz);
      return this.restart(t, wholeHz(interval, hintHz, interval / 4));
    }
    const period = 1000 / this.hz;
    const n = Math.round((t - this.anchorMs) / period);
    this.count += Math.max(0, n - this.lastN);
    this.lastN = n;
    if (interval > GAP_MS) this.samples = [];
    this.samples.push({ n, r: t - (this.anchorMs + n * period) });
    if (this.samples.length > FIT_SAMPLES) this.samples.shift();
    if (Math.round(hintHz) !== this.lastHint) {
      // The reported rate arrives with the first session, after the first timestamps: take it if they agree.
      this.lastHint = Math.round(hintHz);
      const { typical, tolerance } = typicalInterval(this.intervals);
      const hz = wholeHz(typical, hintHz, tolerance);
      if (hz === this.lastHint && hz !== this.hz) return this.restart(this.anchorMs + n * period, hz);
    }
    if (++this.sinceFit >= FIT_EVERY) {
      this.sinceFit = 0;
      this.fit(t, hintHz);
    }
  }

  private fit(t: number, hintHz: number): void {
    const period = 1000 / this.hz;
    const n = this.lastN;
    const { typical, tolerance } = typicalInterval(this.intervals);
    if (Math.abs(typical - period) > tolerance) {
      // The display now runs at another rate: start again from here.
      this.intervals = [];
      return this.restart(t, wholeHz(typical, hintHz, tolerance));
    }
    const line = fitLine(this.samples);
    if (!line) return;
    this.fittedPeriod = period + line.slope;
    if (this.samples.length < MIN_FIT_SAMPLES) return;
    const measured = 1000 / this.fittedPeriod;
    const span = (n - this.samples[0].n) * period;
    if (Math.abs(measured - this.hz) > 0.6 + (measured * 2 * STAMP_STEP_MS) / span) {
      // The whole number was wrong (its first reading is coarse): change it, keeping this refresh where it is.
      return this.restart(this.anchorMs + n * period, Math.max(1, Math.round(measured)));
    }
    const phase = line.at(n);
    if (Math.abs(phase) > DEADBAND * period) {
      this.anchorMs += phase;
      for (const sample of this.samples) sample.r -= phase;
    }
  }

  private restart(anchorMs: number, hz = this.hz): void {
    this.hz = hz;
    this.sinceFit = 0;
    this.anchorMs = anchorMs;
    this.lastN = 0;
    this.samples = [{ n: 0, r: 0 }];
    this.fittedPeriod = null;
  }

  /** The grid to draw on, or null before two timestamps. */
  get grid(): RefreshGrid | null {
    return this.hz > 0 ? { periodMs: 1000 / this.hz, anchorMs: this.anchorMs } : null;
  }

  /** The grid's whole rate, or 0. */
  get gridHz(): number {
    return this.hz;
  }

  /** The measured rate, free of the timestamps' rounding, or 0 before two timestamps. */
  get measuredHz(): number {
    return this.fittedPeriod !== null ? 1000 / this.fittedPeriod : this.hz;
  }

  /** Refreshes counted so far, including those whose callback never came. */
  get refresh(): number {
    return this.count;
  }
}

/**
 * The median interval, and how far it may be from a period and still stand for that period: 3 %, the timestamps'
 * rounding, or six standard errors of the median as the intervals' own spread (their MAD) gives it.
 */
function typicalInterval(intervals: readonly number[]): { typical: number; tolerance: number } {
  const typical = median(intervals);
  const spread = median(intervals.map((i) => Math.abs(i - typical)));
  return { typical, tolerance: Math.max(0.03 * typical, 1.5 * STAMP_STEP_MS, (11 * spread) / Math.sqrt(intervals.length)) };
}

/** The whole rate an interval stands for: the display's own when they agree, since the interval is coarse. */
function wholeHz(intervalMs: number, hintHz: number, toleranceMs: number): number {
  const hint = Math.round(hintHz);
  if (hint >= 1 && Math.abs(intervalMs - 1000 / hint) <= toleranceMs) return hint;
  return Math.max(1, Math.round(1000 / intervalMs));
}

function fitLine(samples: readonly { n: number; r: number }[]): { slope: number; at: (n: number) => number } | null {
  if (samples.length < 2) return null;
  let sn = 0;
  let sr = 0;
  for (const s of samples) {
    sn += s.n;
    sr += s.r;
  }
  const mn = sn / samples.length;
  const mr = sr / samples.length;
  let nn = 0;
  let nr = 0;
  for (const s of samples) {
    nn += (s.n - mn) ** 2;
    nr += (s.n - mn) * (s.r - mr);
  }
  if (nn === 0) return null;
  const slope = nr / nn;
  return { slope, at: (n) => mr + slope * (n - mn) };
}

/**
 * Counts content frames that should have appeared and didn't, and frames held longer than the pattern says, against
 * `cadencePattern` for the grid's whole rate. It looks only at which frame was shown at which refresh, not at how the
 * frame was chosen, so it also sees a wrong choice.
 */
export class CadenceCounter {
  private last: { frame: number; refresh: number } | null = null;
  private first = true;
  private holds: number[] = [];
  private key = "";
  private pattern: number[] = [];
  private cycle = 0;
  private longest = 0;
  private maxStep = 1;
  skipped = 0;
  repeated = 0;

  /** A new clock (play, pause, seek): nothing is compared with what came before it. */
  reset(): void {
    this.last = null;
    this.first = true;
    this.holds = [];
  }

  /** `frame` is drawn at refresh number `refresh`, with content at `fps` on a grid of `hz`. */
  draw(frame: number, refresh: number, fps: number, hz: number): void {
    const key = `${fps}/${hz}`;
    if (key !== this.key) {
      this.key = key;
      this.pattern = cadencePattern(fps, hz).pattern;
      this.cycle = this.pattern.reduce((a, b) => a + b, 0);
      this.longest = Math.max(...this.pattern);
      this.maxStep = Math.max(1, Math.ceil(fps / hz - 1e-6));
      this.reset();
    }
    const last = this.last;
    this.last = { frame, refresh };
    if (!last) return;
    const step = frame - last.frame;
    if (step > this.maxStep) this.skipped += step - this.maxStep;
    // The first frame after a reset was met part-way through, or held until the clock's epoch.
    if (this.first) return void (this.first = false);
    const hold = refresh - last.refresh;
    const length = this.pattern.length;
    const others = this.holds.slice(Math.max(0, this.holds.length - (length - 1)));
    const cycle = others.length === length - 1 ? others.reduce((a, b) => a + b, hold) - this.cycle : 0;
    const over = Math.max(hold - this.longest, cycle, 0);
    if (over > 0) this.repeated++;
    // Once counted, a long hold is compared as if it had been what the pattern allows, so it counts once. Frames never
    // shown were held for 0 refreshes, as the pattern says of content faster than the display.
    this.holds = [...others, hold - over, ...Array<number>(Math.min(length, Math.max(0, step - 1))).fill(0)].slice(-length);
  }
}
