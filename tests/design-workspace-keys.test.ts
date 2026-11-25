import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it } from "vitest";
import { runWorkspaceAction, workspaceAction, type WorkspaceKeyContext } from "@/components/workspace/workspace-keys";
import * as ops from "@/engines/project-ops";
import type { StudioId } from "@/modules/contract";
import type { KeyPress } from "@/state/shortcuts";
import { opContext, useApp } from "@/state/store";
import { useUi } from "@/state/ui-store";
import { CAB } from "./helpers";

const key = (k: string, extra: Partial<KeyPress> = {}): KeyPress => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...extra });
const ctx = (extra: Partial<WorkspaceKeyContext> = {}): WorkspaceKeyContext => ({ studio: "mapping", hasProject: true, fastMapOpen: false, typing: false, dialogOpen: false, inMappingScope: true, ...extra });
const MAPPING_KEYS = [key("Delete"), key("Backspace"), key("ArrowLeft"), key("ArrowUp", { shiftKey: true }), key("Escape"), key("d", { metaKey: true }), key("d", { ctrlKey: true })];

describe("workspace shortcuts: where they act", () => {
  it("mapping keys act in the Mapping studio, on the canvas or its lists", () => {
    expect(workspaceAction(key("Delete"), ctx())).toEqual({ kind: "delete" });
    expect(workspaceAction(key("ArrowRight", { shiftKey: true }), ctx())).toEqual({ kind: "nudge", dx: 10, dy: 0 });
    expect(workspaceAction(key("d", { metaKey: true }), ctx())).toEqual({ kind: "duplicate" });
  });

  it.each<StudioId>(["content", "engineering", "output"])("no mapping key acts in the %s studio", (studio) => {
    for (const k of MAPPING_KEYS) expect(workspaceAction(k, ctx({ studio }))).toBeNull();
  });

  it("no mapping key acts with focus outside the canvas and its lists, while typing, over a dialog, or in Fast map", () => {
    for (const extra of [{ inMappingScope: false }, { typing: true }, { dialogOpen: true }, { fastMapOpen: true }, { hasProject: false }]) {
      for (const k of MAPPING_KEYS) expect(workspaceAction(k, ctx(extra))).toBeNull();
    }
  });

  it("undo and redo act in every studio, but not while typing or over a dialog", () => {
    expect(workspaceAction(key("z", { metaKey: true }), ctx({ studio: "content" }))).toEqual({ kind: "undo" });
    expect(workspaceAction(key("y", { ctrlKey: true }), ctx({ studio: "output", inMappingScope: false }))).toEqual({ kind: "redo" });
    expect(workspaceAction(key("z", { metaKey: true }), ctx({ typing: true }))).toBeNull();
    expect(workspaceAction(key("z", { metaKey: true }), ctx({ dialogOpen: true }))).toBeNull();
  });

  it("⌘S saves everywhere, as before", () => {
    expect(workspaceAction(key("s", { metaKey: true }), ctx({ typing: true, studio: "content" }))).toEqual({ kind: "save" });
  });
});

describe("workspace shortcuts: Delete in another studio leaves the project unchanged", () => {
  const app = () => useApp.getState();

  beforeAll(async () => {
    await app().init();
  });

  it.each<StudioId>(["content", "output"])("%s studio", async (studio) => {
    await app().newProject({ name: `Keys in ${studio}` });
    app().edit((p) => ops.addScreen(ops.addCabinet(p, CAB), { name: "Wall", cabinetId: CAB.id, columns: 2, rows: 2 }, opContext));
    const id = app().project!.physical.screens[0].id;
    app().select({ kind: "screens", ids: [id] });
    useUi.getState().setStudio(studio);
    const before = app().project;

    for (const k of [key("Delete"), key("Backspace"), key("ArrowLeft"), key("ArrowDown", { shiftKey: true }), key("d", { metaKey: true })]) {
      const action = workspaceAction(k, ctx({ studio }));
      if (action) runWorkspaceAction(action);
    }
    expect(useUi.getState().confirm).toBeNull();
    expect(app().project).toBe(before);
    expect(app().selection).toEqual({ kind: "screens", ids: [id] });

    // The same Delete in Mapping asks to delete, as before.
    useUi.getState().setStudio("mapping");
    runWorkspaceAction(workspaceAction(key("Delete"), ctx())!);
    expect(useUi.getState().confirm?.action).toBe("Delete screen");
    useUi.getState().askConfirm(null);
  });
});
