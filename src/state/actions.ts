"use client";

import { toast } from "sonner";
import type { Id } from "@/domain/model";
import { px, um, type Rect } from "@/domain/units";
import { alignItems, type AlignMode } from "@/engines/align";
import * as ops from "@/engines/project-ops";
import { opContext, selectedScreenIds, useApp } from "./store";
import { useUi } from "./ui-store";
import { buildViewModel } from "./view-model";

export function reportError(error: unknown) {
  toast.error(error instanceof Error ? error.message : String(error));
}

/** Runs an edit, turning domain errors into a visible message. */
export function tryEdit(change: Parameters<ReturnType<typeof useApp.getState>["edit"]>[0]) {
  try {
    useApp.getState().edit(change);
  } catch (error) {
    reportError(error);
  }
}

/** Applies positions expressed in the current view's world units. */
export function moveInCurrentView(positions: readonly { id: Id; x: number; y: number }[]) {
  const { view } = useApp.getState();
  tryEdit((project) => {
    switch (view) {
      case "physical":
        return ops.setStagePositions(project, positions.map((p) => ({ id: p.id, x: um(p.x), y: um(p.y) })));
      case "content":
        return ops.setMasterPositions(project, positions.map((p) => ({ id: p.id, x: px(p.x), y: px(p.y) })));
      case "output":
        return ops.setSlicePositions(project, positions.map((p) => ({ id: p.id, x: px(p.x), y: px(p.y) })));
    }
  });
}

function selectedViewItems() {
  const { project, mapping, view, activeOutputId, selection } = useApp.getState();
  if (!project || !mapping) return { items: [], quantum: 1 };
  const model = buildViewModel(project, mapping, view, activeOutputId);
  const ids = new Set(selectedScreenIds(selection, project));
  return { items: model.items.filter((i) => ids.has(i.id)), quantum: model.quantum };
}

export function nudgeSelection(dx: number, dy: number) {
  const { items, quantum } = selectedViewItems();
  if (items.length === 0) return;
  moveInCurrentView(items.map((i) => ({ id: i.id, x: i.rect.x + dx * quantum, y: i.rect.y + dy * quantum })));
}

export function alignSelection(mode: AlignMode) {
  const { items } = selectedViewItems();
  if (items.length < 2) return;
  moveInCurrentView(alignItems(items.map((i) => ({ id: i.id, rect: i.rect as Rect<number> })), mode));
}

export function duplicateSelection() {
  const { project, selection, select } = useApp.getState();
  const ids = selectedScreenIds(selection, project);
  if (ids.length === 0) return;
  const created: Id[] = [];
  tryEdit((current) => {
    let next = current;
    for (const id of ids) {
      const result = ops.duplicateScreen(next, id, opContext);
      next = result.project;
      created.push(result.newId);
    }
    return next;
  });
  if (created.length > 0) select({ kind: "screens", ids: created });
}

export function deleteSelection() {
  const { project, selection, select } = useApp.getState();
  const ids = selectedScreenIds(selection, project);
  if (!project || ids.length === 0) return;
  const names = project.physical.screens.filter((s) => ids.includes(s.id)).map((s) => s.name);
  useUi.getState().askConfirm({
    title: names.length === 1 ? `Delete “${names[0]}”?` : `Delete ${names.length} screens?`,
    body: "This removes the screen and its content and output mapping. It can't be undone.",
    action: names.length === 1 ? "Delete screen" : "Delete screens",
    onConfirm: () => {
      tryEdit((current) => ops.deleteScreens(current, ids));
      select({ kind: "none" });
    },
  });
}

export function groupSelection() {
  const { project, selection, select } = useApp.getState();
  if (!project || selection.kind !== "screens") return;
  let groupId: Id | null = null;
  tryEdit((current) => {
    const result = ops.groupScreens(current, selection.ids, `Group ${current.physical.groups.length + 1}`, opContext);
    groupId = result.groupId;
    return result.project;
  });
  if (groupId) select({ kind: "group", id: groupId });
}
