import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Project } from "@/domain/model";
import { mmToUm, px } from "@/domain/units";
import * as ops from "@/engines/project-ops";
import { opContext, useApp } from "@/state/store";
import { CAB } from "./helpers";

const app = () => useApp.getState();
const current = () => app().project!;

/** A project's content, without the save bookkeeping that undo deliberately leaves alone. */
function content(project: Project) {
  return { ...project, meta: { ...project.meta, revision: 0, updatedAt: "" } };
}

function screenId(name: string) {
  return current().physical.screens.find((s) => s.name === name)!.id;
}

beforeAll(async () => {
  await app().init();
  expect(app().status).toBe("ready");
});

beforeEach(async () => {
  await app().newProject({ name: "Undo test" });
});

describe("undo and redo in the store", () => {
  it("undoes and redoes every kind of edit exactly, in order", () => {
    const CAB2 = { ...CAB, id: "cab-2", name: "Second cabinet", pixelsX: px(192), pixelsY: px(192) };
    const steps: [string, (p: Project) => Project][] = [
      ["add cabinet", (p) => ops.addCabinet(p, CAB)],
      ["create Left", (p) => ops.addScreen(p, { name: "Left", cabinetId: CAB.id, columns: 4, rows: 6 }, opContext)],
      ["create Center", (p) => ops.addScreen(p, { name: "Center", cabinetId: CAB.id, columns: 12, rows: 6 }, opContext)],
      ["create Right", (p) => ops.addScreen(p, { name: "Right", cabinetId: CAB.id, columns: 3, rows: 5 }, opContext)],
      ["move in content", (p) => ops.setMasterPositions(p, [{ id: screenId("Right"), x: px(2100), y: px(16) }])],
      ["move on stage", (p) => ops.setStagePositions(p, [{ id: screenId("Left"), x: mmToUm(-500), y: mmToUm(250) }])],
      ["resize", (p) => ops.updateScreen(p, screenId("Center"), { columns: 10, rows: 5 })],
      ["add second cabinet", (p) => ops.addCabinet(p, CAB2)],
      ["change screen cabinet", (p) => ops.updateScreen(p, screenId("Right"), { cabinetId: CAB2.id })],
      ["edit cabinet", (p) => ops.updateCabinet(p, CAB.id, { pixelsX: px(160), pixelsY: px(160) })],
      ["own canvas", (p) => ops.makeScreenIndependent(p, screenId("Right"), opContext).project],
      ["position in canvas", (p) => ops.setRegionPosition(p, screenId("Right"), px(32), px(8))],
      ["share pixels", (p) => ops.setRegionShared(p, screenId("Left"), true)],
      ["add output", (p) => ops.addOutput(p, "Output 2", opContext).project],
      ["assign output", (p) => ops.assignOutput(p, screenId("Center"), p.output.outputs[1].id)],
      ["detach slice", (p) => ops.setSliceFollowsContent(p, screenId("Left"), false)],
      ["move slice", (p) => ops.setSlicePositions(p, [{ id: screenId("Left"), x: px(64), y: px(0) }])],
      ["fix master size", (p) => ops.setMasterSizing(p, { mode: "fixed", width: px(3840), height: px(2160) })],
      ["group", (p) => ops.groupScreens(p, [screenId("Left"), screenId("Center")], "Main", opContext).project],
      ["rename project", (p) => ops.updateMeta(p, { name: "Renamed show" })],
      ["delete screens", (p) => ops.deleteScreens(p, [screenId("Center")])],
    ];

    const states = [content(current())];
    for (const [label, change] of steps) {
      app().edit(change);
      const after = content(current());
      expect(after, `${label} changed the project`).not.toEqual(states.at(-1));
      states.push(after);
    }
    expect(app().history.past).toHaveLength(steps.length);

    for (let i = steps.length - 1; i >= 0; i--) {
      app().undo();
      expect(content(current()), `undo of ${steps[i][0]}`).toEqual(states[i]);
    }
    expect(app().canUndo).toBe(false);
    expect(app().canRedo).toBe(true);
    // Mapping and validation are derived again, not left from the later state.
    expect(app().mapping!.screens).toHaveLength(0);

    for (let i = 1; i <= steps.length; i++) {
      app().redo();
      expect(content(current()), `redo of ${steps[i - 1][0]}`).toEqual(states[i]);
    }
    expect(app().canRedo).toBe(false);
  });

  it("clears redo when a new edit is made", () => {
    app().edit((p) => ops.addCabinet(p, CAB));
    app().edit((p) => ops.updateMeta(p, { name: "One" }));
    app().undo();
    expect(app().canRedo).toBe(true);
    app().edit((p) => ops.updateMeta(p, { name: "Two" }));
    expect(app().canRedo).toBe(false);
    app().redo();
    expect(current().meta.name).toBe("Two");
  });

  it("ignores edits that change nothing and edits that throw", () => {
    app().edit((p) => ops.addScreen(ops.addCabinet(p, CAB), { name: "A", cabinetId: CAB.id, columns: 1, rows: 1 }, opContext));
    const steps = app().history.past.length;
    app().edit((p) => p);
    expect(() => app().edit((p) => ops.updateScreen(p, screenId("A"), { columns: 0 }))).toThrow(ops.DomainError);
    expect(app().history.past).toHaveLength(steps);
    expect(current().physical.screens[0].columns).toBe(1);
  });

  it("merges a held arrow key into one step", () => {
    app().edit((p) => ops.addScreen(ops.addCabinet(p, CAB), { name: "A", cabinetId: CAB.id, columns: 1, rows: 1 }, opContext));
    const id = screenId("A");
    const before = content(current());
    for (let x = 1; x <= 5; x++) app().edit((p) => ops.setMasterPositions(p, [{ id, x: px(x), y: px(0) }]), { coalesce: `nudge:${id}` });
    expect(current().content.regions[0].x).toBe(5);
    app().undo();
    expect(content(current())).toEqual(before);
  });

  it("saves after undo without a revision conflict, and the saved project matches", async () => {
    app().edit((p) => ops.addCabinet(p, CAB));
    await app().save();
    app().edit((p) => ops.addScreen(p, { name: "Kept", cabinetId: CAB.id, columns: 2, rows: 2 }, opContext));
    app().edit((p) => ops.addScreen(p, { name: "Undone", cabinetId: CAB.id, columns: 2, rows: 2 }, opContext));
    await app().save();
    const revision = current().meta.revision;

    app().undo();
    expect(current().meta.revision).toBe(revision);
    expect(app().saveStatus).toBe("unsaved");
    await app().save();
    expect(app().saveStatus).toBe("saved");

    const id = current().id;
    const expected = content(current());
    await app().openProject(id);
    expect(content(current())).toEqual(expected);
    expect(current().physical.screens.map((s) => s.name)).toEqual(["Kept"]);
  });

  it("starts each opened project with an empty history", async () => {
    app().edit((p) => ops.addCabinet(p, CAB));
    expect(app().canUndo).toBe(true);
    await app().openProject(current().id);
    expect(app().canUndo).toBe(false);
    expect(app().canRedo).toBe(false);
  });

  it("drops undone screens from the selection and keeps the rest", () => {
    app().edit((p) => ops.addScreen(ops.addCabinet(p, CAB), { name: "Stays", cabinetId: CAB.id, columns: 1, rows: 1 }, opContext));
    app().edit((p) => ops.addScreen(p, { name: "Goes", cabinetId: CAB.id, columns: 1, rows: 1 }, opContext));
    const stays = screenId("Stays");
    const goes = screenId("Goes");
    app().select({ kind: "screens", ids: [stays, goes] });
    app().undo();
    expect(app().selection).toEqual({ kind: "screens", ids: [stays] });
    app().select({ kind: "screens", ids: [stays] });
    app().undo();
    expect(app().selection).toEqual({ kind: "none" });
  });

  it("moves the active output off one that an undo removed", () => {
    app().edit((p) => ops.addOutput(p, "Output 2", opContext).project);
    const added = current().output.outputs[1].id;
    app().select({ kind: "output", id: added });
    app().undo();
    expect(app().selection).toEqual({ kind: "none" });
    expect(app().activeOutputId).toBe(current().output.outputs[0].id);
  });

  it("does nothing while the project has a save conflict", () => {
    app().edit((p) => ops.addCabinet(p, CAB));
    useApp.setState({ saveStatus: "conflict" });
    const before = current();
    app().undo();
    expect(current()).toBe(before);
    useApp.setState({ saveStatus: "unsaved" });
  });
});
