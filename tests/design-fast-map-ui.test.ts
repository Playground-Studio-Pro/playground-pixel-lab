import { describe, expect, it } from "vitest";
import { fixAction, type FixKey } from "@/components/shell/fast-map/keys";
import { registerWallLink, sendToWall, wallLink } from "@/components/shell/fast-map/wall-link";
import { resolveMapping } from "@/engines/mapping";
import * as ops from "@/engines/project-ops";
import { validateProject } from "@/engines/validation";
import { px } from "@/domain/units";
import { threeScreenProject } from "./helpers";

const key = (k: string, extra: Partial<FixKey> = {}): FixKey => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, typing: false, dialogOpen: false, ...extra });

describe("Fix step keys", () => {
  it.each([
    ["1", { kind: "pick", number: 1 }],
    ["9", { kind: "pick", number: 9 }],
    ["x", { kind: "swap" }],
    ["X", { kind: "swap" }],
    ["t", { kind: "same" }],
    ["Escape", { kind: "escape" }],
    ["ArrowLeft", { kind: "nudge", dx: -1, dy: 0 }],
    ["ArrowDown", { kind: "nudge", dx: 0, dy: 1 }],
  ])("%s", (k, expected) => {
    expect(fixAction(key(k))).toEqual(expected);
  });

  it("Shift moves 10 px", () => {
    expect(fixAction(key("ArrowRight", { shiftKey: true }))).toEqual({ kind: "nudge", dx: 10, dy: 0 });
    expect(fixAction(key("ArrowUp", { shiftKey: true }))).toEqual({ kind: "nudge", dx: 0, dy: -10 });
  });

  it("Cmd or Ctrl+Z undoes, with Shift redoes, Ctrl+Y redoes", () => {
    expect(fixAction(key("z", { metaKey: true }))).toEqual({ kind: "undo" });
    expect(fixAction(key("z", { ctrlKey: true }))).toEqual({ kind: "undo" });
    expect(fixAction(key("Z", { metaKey: true, shiftKey: true }))).toEqual({ kind: "redo" });
    expect(fixAction(key("y", { ctrlKey: true }))).toEqual({ kind: "redo" });
  });

  it("never fires while typing or over a dialog", () => {
    for (const k of ["1", "x", "t", "ArrowLeft", "Escape"]) {
      expect(fixAction(key(k, { typing: true }))).toBeNull();
      expect(fixAction(key(k, { dialogOpen: true }))).toBeNull();
    }
    expect(fixAction(key("z", { metaKey: true, typing: true }))).toBeNull();
    expect(fixAction(key("z", { metaKey: true, dialogOpen: true }))).toBeNull();
  });

  it("ignores 0, other letters and modified keys", () => {
    for (const k of ["0", "a", "Enter", " "]) expect(fixAction(key(k))).toBeNull();
    expect(fixAction(key("x", { metaKey: true }))).toBeNull();
    expect(fixAction(key("x", { altKey: true }))).toBeNull();
    expect(fixAction(key("1", { ctrlKey: true }))).toBeNull();
    expect(fixAction(key("z", { metaKey: true, altKey: true }))).toBeNull();
  });
});

describe("send to the wall hook", () => {
  const setup = () => {
    const { project, ids } = threeScreenProject();
    const placed = ops.setSlicePositions(project, [{ id: ids.left, x: px(0), y: px(0) }, { id: ids.center, x: px(512), y: px(0) }, { id: ids.right, x: px(2048), y: px(0) }]);
    return { project: placed, ids };
  };
  const send = (p: ReturnType<typeof setup>["project"]) => {
    const mapping = resolveMapping(p);
    return sendToWall(p, mapping, validateProject(p, mapping));
  };

  it("does nothing until a link is registered", async () => {
    expect(wallLink()).toBeNull();
    expect(await send(setup().project)).toEqual({ state: "off" });
  });

  it("sends a good map, holds a map with errors, and stops after unregistering", async () => {
    const sent: unknown[] = [];
    const off = registerWallLink({ label: "Test output", send: (u) => void sent.push(u.mapping.screens.length) });
    const { project, ids } = setup();
    expect(await send(project)).toEqual({ state: "sent", label: "Test output" });
    expect(sent).toEqual([3]);
    const overlapping = ops.setSlicePositions(project, [{ id: ids.right, x: px(0), y: px(0) }]);
    const held = await send(overlapping);
    expect(held.state).toBe("held");
    expect(held.state === "held" && held.reason).toMatch(/overlap.*The wall keeps the last good map\.$/);
    expect(sent).toEqual([3]);
    off();
    expect(await send(project)).toEqual({ state: "off" });
  });

  it("reports a failed send instead of throwing", async () => {
    const off = registerWallLink({ label: "Broken", send: () => Promise.reject(new Error("Output window closed.")) });
    const result = await send(setup().project);
    off();
    expect(result).toEqual({ state: "held", reason: "Sending failed: Output window closed. The wall keeps the last good map." });
  });
});
