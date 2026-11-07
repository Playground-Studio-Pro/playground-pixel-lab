import { describe, expect, it } from "vitest";
import * as ops from "@/engines/project-ops";
import * as history from "@/state/history";
import { historyShortcut } from "@/state/shortcuts";
import { CAB, testContext, threeScreenProject } from "./helpers";

function chain(count: number) {
  const ctx = testContext();
  const projects = [ops.createProject({ name: "History" }, ctx)];
  for (let i = 0; i < count; i++) projects.push(ops.updateMeta(projects[i], { name: `Edit ${i + 1}` }));
  return projects;
}

describe("history core", () => {
  it("undoes and redoes in order, and returns null at either end", () => {
    const [a, b, c] = chain(2);
    let h = history.record(history.emptyHistory, a, { now: 0 });
    h = history.record(h, b, { now: 10 });

    const u1 = history.undo(h, c)!;
    expect(u1.project.meta.name).toBe(b.meta.name);
    const u2 = history.undo(u1.history, u1.project)!;
    expect(u2.project.meta.name).toBe(a.meta.name);
    expect(history.undo(u2.history, u2.project)).toBeNull();

    const r1 = history.redo(u2.history, u2.project)!;
    expect(r1.project.meta.name).toBe(b.meta.name);
    const r2 = history.redo(r1.history, r1.project)!;
    expect(r2.project.meta.name).toBe(c.meta.name);
    expect(history.redo(r2.history, r2.project)).toBeNull();
  });

  it("clears redo when a new edit is recorded", () => {
    const [a, b] = chain(1);
    const h = history.record(history.emptyHistory, a, { now: 0 });
    const undone = history.undo(h, b)!;
    expect(history.canRedo(undone.history)).toBe(true);
    const after = history.record(undone.history, undone.project, { now: 5 });
    expect(history.canRedo(after)).toBe(false);
  });

  it("merges repeats with the same key inside the window, and only those", () => {
    const [a, b, c, d] = chain(3);
    let h = history.record(history.emptyHistory, a, { key: "nudge:x", now: 0 });
    h = history.record(h, b, { key: "nudge:x", now: 400 });
    h = history.record(h, c, { key: "nudge:x", now: 400 + history.COALESCE_MS });
    expect(h.past).toEqual([a]);
    // Past the window, or with another key, it is a new step.
    h = history.record(h, d, { key: "nudge:x", now: 401 + 2 * history.COALESCE_MS });
    expect(h.past).toHaveLength(2);
    h = history.record(h, d, { key: "nudge:y", now: 402 + 2 * history.COALESCE_MS });
    h = history.record(h, d, { now: 403 + 2 * history.COALESCE_MS });
    h = history.record(h, d, { now: 404 + 2 * history.COALESCE_MS });
    expect(h.past).toHaveLength(5);
  });

  it("does not merge across an undo", () => {
    const [a, b, c] = chain(2);
    let h = history.record(history.emptyHistory, a, { key: "x", now: 0 });
    h = history.record(h, b, { key: "k", now: 1 });
    const undone = history.undo(h, c)!;
    // The same key right after an undo is a new step, not part of the undone one.
    const again = history.record(undone.history, undone.project, { key: "k", now: 2 });
    expect(again.past).toEqual([a, undone.project]);
  });

  it("keeps the newest steps up to the limit", () => {
    const projects = chain(history.HISTORY_LIMIT + 5);
    let h = history.emptyHistory;
    projects.slice(0, -1).forEach((p, i) => (h = history.record(h, p, { now: i * 10_000 })));
    expect(h.past).toHaveLength(history.HISTORY_LIMIT);
    expect(h.past[0]).toBe(projects[5]);
  });

  it("restores content but keeps the current save revision and time", () => {
    const { project } = threeScreenProject();
    const saved = { ...project, meta: { ...project.meta, revision: 7, updatedAt: "2026-11-07T10:00:00.000Z" } };
    const older = ops.updateMeta(ops.addCabinet(project, { ...CAB, id: "cab-2" }), { name: "Older" });
    const restored = history.restore(older, saved);
    expect(restored.meta.revision).toBe(7);
    expect(restored.meta.updatedAt).toBe(saved.meta.updatedAt);
    expect(restored.meta.name).toBe("Older");
    expect(restored.cabinets).toBe(older.cabinets);
  });
});

describe("history shortcuts", () => {
  const press = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
    historyShortcut({ key, metaKey: false, ctrlKey: false, shiftKey: false, ...mods });

  it("maps ⌘Z and Ctrl+Z to undo", () => {
    expect(press("z", { metaKey: true })).toBe("undo");
    expect(press("z", { ctrlKey: true })).toBe("undo");
  });

  it("maps ⌘⇧Z, Ctrl+Shift+Z and Ctrl+Y to redo", () => {
    expect(press("Z", { metaKey: true, shiftKey: true })).toBe("redo");
    expect(press("z", { ctrlKey: true, shiftKey: true })).toBe("redo");
    expect(press("y", { ctrlKey: true })).toBe("redo");
  });

  it("ignores plain keys, ⌘Y and Alt combinations", () => {
    expect(press("z")).toBeNull();
    expect(press("y", { metaKey: true })).toBeNull();
    expect(press("z", { metaKey: true, altKey: true })).toBeNull();
    expect(press("s", { metaKey: true })).toBeNull();
  });
});
