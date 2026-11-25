import { describe, expect, it } from "vitest";
import { cadencePattern, contentFrame, type OutputClockInput } from "@/engines/output-layout";
import { CadenceCounter, RefreshTracker } from "@/engines/output/refresh-grid";
import type { ContentFps } from "@/domain/motion";

// A display's refreshes as the output window sees them: rAF timestamps rounded to 0.1 ms, on the real clock's scale
// (about 1.7e12 ms, where a double is only good to 2e-4 ms).
const ORIGIN = 1_763_000_000_123.4;
const WARM = 60;
const PHASES = Array.from({ length: 20 }, (_, i) => i / 20);

const rounded = (x: number) => ORIGIN + Math.round(x * 10) / 10;

function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
}

function* refreshes(hz: number, minutes: number, o: { drop?: (k: number) => boolean; jitter?: number } = {}) {
  const rnd = noise(7);
  const count = WARM + Math.round(minutes * 60 * hz);
  for (let k = 0; k < count; k++) if (!o.drop?.(k)) yield 37.1 + (k * 1000) / hz + (o.jitter ?? 0) * rnd();
}

/** An epoch `phase` of a refresh after the last warm-up refresh. */
const epoch = (hz: number, phase: number) => ORIGIN + 37.1 + ((WARM + phase) * 1000) / hz;

/** Plays the timestamps as the runtime does. `steps` holds how far the content frame moved at each callback. */
function play(times: Iterable<number>, fps: ContentFps, epochMs: number, hintHz: number) {
  const tracker = new RefreshTracker();
  const counter = new CadenceCounter();
  const clock: OutputClockInput = { state: "playing", fps, startFrame: 0, epochMs };
  const frames: number[] = [];
  let last: number | null = null;
  let k = 0;
  for (const x of times) {
    const t = rounded(x);
    tracker.push(t, hintHz);
    if (k++ < WARM || t < epochMs) continue;
    const frame = contentFrame(clock, t, tracker.grid);
    if (frame !== last) counter.draw(frame, tracker.refresh, fps, tracker.gridHz);
    last = frame;
    frames.push(frame);
  }
  return { frames, tracker, skipped: counter.skipped, repeated: counter.repeated };
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

describe("steady display, timestamps rounded to 0.1 ms, 10 minutes, every start phase in steps of 1/20", () => {
  for (const [fps, hz] of [[60, 60], [30, 60], [24, 60], [25, 60], [50, 60], [60, 120], [30, 50], [60, 50], [60, 144]] as const) {
    it(`${fps} fps on ${hz} Hz repeats its pattern exactly: no skip, no repeat`, { timeout: 60_000 }, () => {
      const refreshesPerCycle = hz / gcd(fps, hz);
      const framesPerCycle = fps / gcd(fps, hz);
      for (const phase of PHASES) {
        const { frames, skipped, repeated, tracker } = play(refreshes(hz, 10), fps, epoch(hz, phase), hz);
        expect(frames.length).toBeGreaterThan(10 * 60 * hz - 3);
        // Independent of the counter: every cycle of refreshes advances exactly one cycle of frames.
        let wrong = 0;
        for (let k = refreshesPerCycle + 1; k < frames.length; k++) if (frames[k] - frames[k - refreshesPerCycle] !== framesPerCycle) wrong++;
        expect({ phase, wrong, skipped, repeated }).toEqual({ phase, wrong: 0, skipped: 0, repeated: 0 });
        expect(tracker.gridHz).toBe(hz);
        expect(tracker.measuredHz).toBeCloseTo(hz, 1);
      }
    });
  }

  it("60 fps on 59.94 Hz: only the skips the rates make unavoidable, one every 16.7 s, never a repeat", { timeout: 60_000 }, () => {
    // The same whether the display reports 59.94 or, as macOS may, 60.
    for (const [phase, reported] of PHASES.flatMap((p) => [[p, 59.94], [p, 60]])) {
      const { frames, skipped, repeated, tracker } = play(refreshes(59.94, 10), 60, epoch(59.94, phase), reported);
      const steps = frames.slice(1).map((f, i) => f - frames[i]);
      expect(Math.min(...steps.slice(1))).toBe(1);
      expect(Math.max(...steps)).toBe(2);
      expect(steps.filter((s) => s === 2).length).toBe(skipped);
      expect([35, 36, 37]).toContain(skipped); // 600 s × 0.06 Hz
      expect(repeated).toBe(0);
      expect(tracker.measuredHz).toBeCloseTo(59.94, 2);
    }
  });

  it("a real clock 50 ppm off whole-rate drifts one way: a skip or a repeat per frame of drift, never back and forth", { timeout: 60_000 }, () => {
    for (const [ppm, allowed] of [[50, "repeated"], [-50, "skipped"]] as const) {
      for (const phase of PHASES) {
        const r = play(refreshes(60 * (1 + ppm * 1e-6), 10), 60, epoch(60, phase), 60);
        // 10 minutes at 50 ppm are 1.8 refreshes.
        expect(r[allowed]).toBeLessThanOrEqual(2);
        expect(r[allowed === "repeated" ? "skipped" : "repeated"]).toBe(0);
      }
    }
  });

  it("±1 ms of jitter on top changes nothing", { timeout: 60_000 }, () => {
    for (const [fps, hz] of [[60, 60], [30, 60], [60, 120]] as const) {
      for (const phase of PHASES) {
        const { skipped, repeated } = play(refreshes(hz, 2, { jitter: 2 }), fps, epoch(hz, phase), hz);
        expect({ fps, hz, phase, skipped, repeated }).toEqual({ fps, hz, phase, skipped: 0, repeated: 0 });
      }
    }
  });
});

describe("what really goes wrong is still counted", () => {
  it("60 fps on 60 Hz: a dropped callback is one frame never shown and one held twice; three are three and one", () => {
    for (const phase of PHASES) {
      for (const dropped of [1, 2, 3]) {
        const { skipped, repeated } = play(refreshes(60, 0.5, { drop: (k) => k >= 1000 && k < 1000 + dropped }), 60, epoch(60, phase), 60);
        expect({ phase, dropped, skipped, repeated }).toEqual({ phase, dropped, skipped: dropped, repeated: 1 });
      }
    }
  });

  it("random dropped callbacks are counted one by one, and the period and phase hold", () => {
    const rnd = noise(11);
    let drops = 0;
    let previous = false;
    const drop = (k: number) => {
      const d: boolean = k > 200 && !previous && rnd() + 0.5 < 0.02;
      previous = d;
      if (d) drops++;
      return d;
    };
    const { frames, skipped, repeated, tracker } = play(refreshes(60, 5, { drop }), 60, epoch(60, 0), 60);
    expect(drops).toBeGreaterThan(200);
    expect([skipped, repeated]).toEqual([drops, drops]);
    expect(tracker.measuredHz).toBeCloseTo(60, 2);
    expect(frames.length).toBe(5 * 60 * 60 - drops);
  });

  it("CadenceCounter sees a wrong choice of frame: a two-frame jump at 60 on 60, and a 3, 3 where 24 on 60 says 3, 2", () => {
    const jump = new CadenceCounter();
    for (const [frame, refresh] of [[0, 0], [1, 1], [2, 2], [4, 3], [5, 4]]) jump.draw(frame, refresh, 60, 60);
    expect([jump.skipped, jump.repeated]).toEqual([1, 0]);

    const pulldown = new CadenceCounter();
    [0, 3, 5, 8, 10, 13, 16, 18, 21, 23].forEach((refresh, frame) => pulldown.draw(frame, refresh, 24, 60));
    expect([pulldown.skipped, pulldown.repeated]).toEqual([0, 1]);

    const clean = new CadenceCounter();
    [0, 3, 5, 8, 10, 13, 15, 18, 20].forEach((refresh, frame) => clean.draw(frame, refresh, 24, 60));
    expect([clean.skipped, clean.repeated]).toEqual([0, 0]);
  });

  it("CadenceCounter accepts every cycle of every content rate on 50, 60 and 120 Hz, from any frame", () => {
    for (const hz of [50, 60, 120]) {
      for (const fps of [24, 25, 30, 50, 60]) {
        const { pattern } = cadencePattern(fps, hz);
        for (let start = 0; start < pattern.length; start++) {
          const c = new CadenceCounter();
          let refresh = 0;
          for (let f = start; f < start + 5 * pattern.length; f++) {
            const hold = pattern[f % pattern.length];
            if (hold > 0) c.draw(f, refresh, fps, hz);
            refresh += hold;
          }
          expect({ hz, fps, start, skipped: c.skipped, repeated: c.repeated }).toEqual({ hz, fps, start, skipped: 0, repeated: 0 });
        }
      }
    }
  });

  it("after reset nothing is compared with what came before", () => {
    const c = new CadenceCounter();
    c.draw(10, 0, 60, 60);
    c.reset();
    c.draw(500, 90, 60, 60);
    c.draw(501, 91, 60, 60);
    expect([c.skipped, c.repeated]).toEqual([0, 0]);
  });
});

describe("the display's rate changes", () => {
  function* change(a: number, b: number) {
    let x = 37.1;
    for (let k = 0; k < a * 10; k++) yield (x += 1000 / a);
    for (let k = 0; k < b * 20; k++) yield (x += 1000 / b);
  }
  // 60 → 61 stands for a change too small to show in the intervals: only the fit sees it, which takes longer.
  for (const [a, b, within] of [[60, 50, 4], [50, 60, 4], [60, 120, 4], [120, 60, 4], [60, 48, 4], [144, 60, 4], [60, 61, 6]] as const) {
    it(`${a} → ${b} Hz: the grid is the new rate's within ${within} s, and then steady`, () => {
      const tracker = new RefreshTracker();
      let k = 0;
      for (const x of change(a, b)) {
        tracker.push(rounded(x), a); // the reported rate may lag behind
        if (++k > a * 10 + b * within) expect(tracker.gridHz).toBe(b);
      }
      expect(tracker.measuredHz).toBeCloseTo(b, 1);
    });
  }

  it("60 → 59.94 Hz keeps the whole-rate grid and measures 59.94", () => {
    const tracker = new RefreshTracker();
    for (const x of change(60, 59.94)) tracker.push(rounded(x), 60);
    expect(tracker.gridHz).toBe(60);
    expect(tracker.measuredHz).toBeCloseTo(59.94, 2);
  });

  it("a reported rate that arrives late, or is wrong, or missing, doesn't decide against the timestamps", () => {
    for (const [hz, hint] of [[60, 0], [50, 60], [120, 0], [144, 0], [240, 0], [60, 59.94]] as const) {
      const tracker = new RefreshTracker();
      let k = 0;
      for (const x of refreshes(hz, 0.1)) tracker.push(rounded(x), k++ < 10 ? 0 : hint);
      expect(tracker.gridHz).toBe(hz);
    }
  });

  it("a long gap (occluded window, sleep) is picked up again", () => {
    const { tracker, frames } = play(refreshes(60, 1, { drop: (k) => k > 1000 && k < 2500 }), 60, epoch(60, 0.3), 60);
    expect(tracker.measuredHz).toBeCloseTo(60, 2);
    expect(frames.at(-1)! - frames.at(-601)!).toBe(600);
  });
});

describe("clock changes", () => {
  it("a paused clock holds its frame whatever the grid, and resuming starts at the frame it is given", () => {
    const tracker = new RefreshTracker();
    const times = [...refreshes(60, 0.2)].map(rounded);
    for (const t of times) {
      tracker.push(t, 60);
      expect(contentFrame({ state: "paused", frame: 42 }, t, tracker.grid)).toBe(42);
    }
    const now = times.at(-1)!;
    const resumed: OutputClockInput = { state: "playing", fps: 30, startFrame: 42, epochMs: now };
    const P = 1000 / 60;
    expect(contentFrame(resumed, now, tracker.grid)).toBe(42);
    expect(contentFrame(resumed, now + 60 * P, tracker.grid) - 42).toBeGreaterThanOrEqual(29);
    expect(contentFrame(resumed, now + 60 * P, tracker.grid) - 42).toBeLessThanOrEqual(30);
  });
});
