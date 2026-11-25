import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/domain/model";
import type { OutputClock, OutputSession, OutputStatus } from "@/domain/physical-output";
import { px } from "@/domain/units";
import { resolveMapping } from "@/engines/mapping";
import * as ops from "@/engines/project-ops";
import { validateProject } from "@/engines/validation";
import { attachLiveOutput, liveOutputState, noteStatus, onLiveSent, recordSent, resetLiveOutput, startLive, stopLive, type LiveSent } from "@/modules/output/live-output-store";
import { createLiveSender, LIVE_INTERVAL_MS, type LiveSnapshot } from "@/modules/output/output-control";
import { parseProjectFile } from "@/persistence/schema";
import { useApp } from "@/state/store";
import { threeScreenProject } from "./helpers";

const status = (state: OutputStatus["state"], patch: Partial<OutputStatus> = {}): OutputStatus => ({
  outputId: "out-1", state, display: null, sessionRevision: null, sizeMatch: "exact", croppedPx: null, blackPx: null, reconnected: false, render: null, error: null, ...patch,
});

/** A sender with a fake clock and timers; `send` resolves when the test says so. */
function rig(base = 1) {
  let now = 1000;
  const timers: { at: number; run: () => void }[] = [];
  const sent: { payload: number; revision: number }[] = [];
  const pending: { resolve: () => void; reject: (e: unknown) => void }[] = [];
  let auto = true;
  const sender = createLiveSender<number>({
    send: (payload, revision) =>
      new Promise((resolve, reject) => {
        sent.push({ payload, revision });
        const done = { resolve: () => resolve(status("live", { sessionRevision: revision })), reject };
        if (auto) done.resolve();
        else pending.push(done);
      }),
    baseRevision: () => base,
    now: () => now,
    setTimer(run, ms) {
      const t = { at: now + ms, run };
      timers.push(t);
      return () => void timers.splice(timers.indexOf(t), 1);
    },
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  /** Moves the clock, firing timers that fall due. */
  async function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      await flush();
      const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      timers.splice(timers.indexOf(due), 1);
      due.run();
    }
    now = end;
    await flush();
  }
  const ok = (payload: number): LiveSnapshot<number> => ({ payload, blocked: null });
  return { sender, sent, pending, timers, advance, flush, ok, manual: () => (auto = false), base: (b: number) => (base = b) };
}

describe("Live sender", () => {
  it("sends nothing while off, and the current state at once when turned on", async () => {
    const r = rig();
    r.sender.offer(r.ok(1));
    r.sender.status(status("live"));
    await r.advance(500);
    expect(r.sent).toEqual([]);
    r.sender.start(r.ok(2), "live");
    await r.flush();
    expect(r.sent).toEqual([{ payload: 2, revision: 2 }]);
    expect(r.sender.state()).toMatchObject({ on: true, sentRevision: 2, sends: 1 });
  });

  it("turns on only while the output is live", async () => {
    const r = rig();
    for (const s of ["opening", "waiting-display", "held", "failed"] as const) r.sender.start(r.ok(1), s);
    await r.flush();
    expect(r.sender.state().on).toBe(false);
    expect(r.sent).toEqual([]);
  });

  it("coalesces a held arrow key at 30 a second to at most one send every 50 ms, latest wins, last one lands", async () => {
    const r = rig();
    r.sender.start(r.ok(0), "live");
    await r.flush();
    // 3 s of key repeat at 30 a second: 90 moves.
    for (let i = 1; i <= 90; i++) {
      r.sender.offer(r.ok(i));
      await r.advance(1000 / 30);
    }
    await r.advance(200);
    const times = r.sent.length;
    expect(times).toBeLessThanOrEqual(1 + Math.ceil(3000 / LIVE_INTERVAL_MS) + 1);
    expect(times).toBeGreaterThan(30);
    expect(r.sent.at(-1)!.payload).toBe(90);
    // Each payload sent is newer than the one before, and revisions go up by one.
    for (let i = 1; i < r.sent.length; i++) {
      expect(r.sent[i].payload).toBeGreaterThan(r.sent[i - 1].payload);
      expect(r.sent[i].revision).toBe(r.sent[i - 1].revision + 1);
    }
    await r.advance(1000);
    expect(r.sent.length).toBe(times);
  });

  it("keeps one update in flight, and sends only the newest after it", async () => {
    const r = rig();
    r.manual();
    r.sender.start(r.ok(0), "live");
    await r.flush();
    for (let i = 1; i <= 10; i++) r.sender.offer(r.ok(i));
    await r.advance(500);
    expect(r.sent.map((s) => s.payload)).toEqual([0]);
    r.pending.shift()!.resolve();
    await r.advance(10);
    expect(r.sent.map((s) => s.payload)).toEqual([0, 10]);
    expect(r.sent.map((s) => s.revision)).toEqual([2, 3]);
  });

  it("takes the next revision from the highest known: sent, Update output, or reported", async () => {
    const r = rig(7);
    r.sender.start(r.ok(0), "live");
    await r.flush();
    expect(r.sent[0].revision).toBe(8);
    r.base(20);
    r.sender.offer(r.ok(1));
    await r.advance(100);
    expect(r.sent[1].revision).toBe(21);
  });

  it("pauses while the mapping has errors, then sends exactly one valid state", async () => {
    const r = rig();
    r.sender.start(r.ok(0), "live");
    await r.flush();
    for (let i = 1; i <= 5; i++) {
      r.sender.offer({ payload: i, blocked: "“Left” overlaps “Center”." });
      await r.advance(100);
    }
    expect(r.sent.length).toBe(1);
    expect(r.sender.state()).toMatchObject({ on: true, paused: "“Left” overlaps “Center”." });
    r.sender.offer(r.ok(6));
    await r.advance(500);
    expect(r.sent.map((s) => s.payload)).toEqual([0, 6]);
    expect(r.sender.state().paused).toBeNull();
  });

  it("holds while the output waits or is held, then sends the newest once after Resume, only if it changed", async () => {
    const r = rig();
    r.sender.start(r.ok(0), "live");
    await r.flush();
    for (const s of ["waiting-display", "held"] as const) {
      r.sender.status(status(s));
      for (let i = 1; i <= 3; i++) r.sender.offer(r.ok(i));
      await r.advance(300);
      expect(r.sent.length).toBe(1);
      expect(r.sender.state()).toMatchObject({ on: true, holding: true });
    }
    r.sender.status(status("live"));
    await r.advance(100);
    expect(r.sent.map((s) => s.payload)).toEqual([0, 3]);
    r.sender.status(status("held"));
    r.sender.status(status("live"));
    await r.advance(300);
    expect(r.sent.length).toBe(2);
  });

  it("turns off on failure and close (Close and Esc both close), and sends nothing after", async () => {
    for (const [s, reason] of [["failed", "The output failed."], ["closed", null]] as const) {
      const r = rig();
      r.sender.start(r.ok(0), "live");
      await r.flush();
      r.sender.status(status(s));
      expect(r.sender.state()).toMatchObject({ on: false, stopped: reason });
      r.sender.offer(r.ok(1));
      await r.advance(500);
      expect(r.sent.length).toBe(1);
    }
  });

  it("drops a pending trailing send and a late reply when turned off", async () => {
    const r = rig();
    r.manual();
    r.sender.start(r.ok(0), "live");
    await r.flush();
    r.sender.offer(r.ok(1));
    r.sender.stop("Another project opened.");
    r.pending.shift()!.resolve();
    await r.advance(500);
    expect(r.sent.length).toBe(1);
    expect(r.sender.state()).toMatchObject({ on: false, sentRevision: null, stopped: "Another project opened." });
    expect(r.timers).toEqual([]);
  });

  it("shows a refused update, and turns off when main no longer has the output", async () => {
    const r = rig();
    r.manual();
    r.sender.start(r.ok(0), "live");
    await r.flush();
    r.pending.shift()!.reject(Object.assign(new Error("x"), { code: "SESSION_TOO_LARGE" }));
    await r.flush();
    expect(r.sender.state()).toMatchObject({ on: true, error: expect.any(String) });
    r.sender.offer(r.ok(1));
    await r.advance(100);
    r.pending.shift()!.reject(new Error("UNKNOWN_OUTPUT: gone"));
    await r.flush();
    expect(r.sender.state().on).toBe(false);
  });
});

// ── The store, with the app's own store and a fake desktop API ───────────────────────────────────────────────────

function fakeApi() {
  const updates: OutputSession[] = [];
  const listeners = new Set<(s: OutputStatus) => void>();
  const api = {
    update: vi.fn(async (_id: string, session: OutputSession) => {
      updates.push(session);
      return status("live", { sessionRevision: session.revision });
    }),
    onStatus: (cb: (s: OutputStatus) => void) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
  return { api, updates, emit: (s: OutputStatus) => listeners.forEach((l) => l(s)) };
}

function load(project: Project) {
  const mapping = resolveMapping(project);
  useApp.setState({ project, mapping, issues: validateProject(project, mapping) });
}

const edit = (change: (p: Project) => Project) => load(change(useApp.getState().project!));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Live in the control window", () => {
  const clock: OutputClock = { state: "playing", fps: 30, startFrame: 0, epochMs: 123_456 };
  let project: Project;
  let ids: ReturnType<typeof threeScreenProject>["ids"];

  beforeEach(() => {
    resetLiveOutput();
    ({ project, ids } = threeScreenProject());
    load(project);
  });
  afterEach(() => resetLiveOutput());

  function open() {
    const f = fakeApi();
    attachLiveOutput(f.api);
    const outputId = project.output.outputs[0].id;
    recordSent(outputId, { clock, revision: 1, source: { id: "pixel-grid", settings: { space: "master", motion: false } } });
    const live = status("live", { outputId, sessionRevision: 1 });
    f.emit(live);
    return { ...f, outputId, live };
  }

  it("sends nothing with Live off, however much the map changes", async () => {
    const f = open();
    for (let x = 0; x < 5; x++) edit((p) => ops.setMasterPositions(p, [{ id: ids.right, x: px(2048 + x), y: px(0) }]));
    await wait(120);
    expect(f.updates).toEqual([]);
  });

  it("sends each move with the same clock, the same source and the moved screen", async () => {
    const f = open();
    const seen: LiveSent[] = [];
    onLiveSent((e) => seen.push(e));
    startLive(f.outputId, f.live);
    await wait(10);
    edit((p) => ops.setMasterPositions(p, [{ id: ids.right, x: px(2100), y: px(10) }]));
    await wait(120);
    expect(f.updates.map((u) => u.revision)).toEqual([2, 3]);
    for (const u of f.updates) {
      expect(u.clock).toEqual(clock);
      expect(u.source).toEqual({ id: "pixel-grid", settings: { space: "master", motion: false } });
    }
    const moved = parseProjectFile(f.updates[1].projectText);
    expect(moved.content.regions.find((r) => r.screenId === ids.right)).toMatchObject({ x: 2100, y: 10 });
    expect(seen.map((e) => e.revision)).toEqual([2, 3]);
    expect(liveOutputState(f.outputId)).toMatchObject({ on: true, sends: 2, sentRevision: 3, paused: null });
  });

  it("doesn't send when only the project's save bookkeeping changes", async () => {
    const f = open();
    startLive(f.outputId, f.live);
    await wait(10);
    const p = useApp.getState().project!;
    useApp.setState({ project: { ...p, meta: { ...p.meta, revision: p.meta.revision + 1 } } });
    await wait(120);
    expect(f.updates.length).toBe(1);
  });

  it("pauses on an overlap, keeps the last good map, and sends once when fixed", async () => {
    const f = open();
    startLive(f.outputId, f.live);
    await wait(10);
    edit((p) => ops.setRegionPosition(p, ids.right, px(0), px(0)));
    await wait(120);
    expect(f.updates.length).toBe(1);
    expect(liveOutputState(f.outputId)!.paused).toMatch(/overlap/i);
    edit((p) => ops.setRegionPosition(p, ids.right, px(2048), px(0)));
    await wait(120);
    expect(f.updates.length).toBe(2);
    expect(liveOutputState(f.outputId)!.paused).toBeNull();
  });

  it("re-anchors the clock after a reconnect and Resume, never at frame 0", async () => {
    const f = open();
    startLive(f.outputId, f.live);
    await wait(10);
    f.emit(status("held", { outputId: f.outputId, reconnected: true }));
    edit((p) => ops.setMasterPositions(p, [{ id: ids.right, x: px(2060), y: px(0) }]));
    await wait(120);
    expect(f.updates.length).toBe(1);
    f.emit(status("live", { outputId: f.outputId, sessionRevision: 2, render: { frame: 412 } as OutputStatus["render"] }));
    await wait(20);
    expect(f.updates.length).toBe(2);
    const after = f.updates[1].clock;
    expect(after).toMatchObject({ state: "playing", fps: 30, startFrame: 412 });
    expect(f.updates[1].revision).toBe(3);
  });

  it("turns off on Esc or Close, on failure, and when another project opens, but not on an edit", async () => {
    for (const end of ["closed", "failed", "project"] as const) {
      resetLiveOutput();
      load(project);
      const f = open();
      startLive(f.outputId, f.live);
      await wait(10);
      edit((p) => ops.setMasterPositions(p, [{ id: ids.right, x: px(2050), y: px(0) }]));
      await wait(80);
      expect(liveOutputState(f.outputId)!.on).toBe(true);
      if (end === "project") load(threeScreenProject().project.id === project.id ? { ...project, id: "other" } : threeScreenProject().project);
      else f.emit(status(end, { outputId: f.outputId }));
      expect(liveOutputState(f.outputId)!.on).toBe(false);
      const count = f.updates.length;
      edit((p) => ops.setMasterPositions(p, [{ id: p.physical.screens[2].id, x: px(2049), y: px(0) }]));
      await wait(120);
      expect(f.updates.length).toBe(count);
    }
  });

  it("runs one sender per output, each with its own revisions", async () => {
    edit((p) => ops.addOutput(p, "Output 2", { newId: () => "out-2", now: () => "2026-11-25T00:00:00.000Z" }).project);
    edit((p) => ops.assignOutput(p, ids.right, "out-2"));
    project = useApp.getState().project!;
    const f = open();
    const second = "out-2";
    recordSent(second, { clock, revision: 5, source: { id: "pixel-grid", settings: { space: "master", motion: false } } });
    noteStatus(status("live", { outputId: second, sessionRevision: 5 }));
    startLive(f.outputId, f.live);
    startLive(second, status("live", { outputId: second, sessionRevision: 5 }));
    await wait(10);
    stopLive(f.outputId);
    edit((p) => ops.setMasterPositions(p, [{ id: ids.left, x: px(0), y: px(20) }]));
    await wait(120);
    const calls = f.api.update.mock.calls.map(([id, s]) => [id, s.revision]);
    expect(calls).toEqual([[f.outputId, 2], [second, 6], [second, 7]]);
  });
});
