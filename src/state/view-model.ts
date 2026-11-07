import type { Id, Project } from "@/domain/model";
import { UM_PER_MM, formatMm, type Rect } from "@/domain/units";
import { boundingBox } from "@/engines/geometry";
import type { ResolvedMapping } from "@/engines/mapping";

export type WorkspaceView = "physical" | "content" | "output";

export interface ViewItem {
  readonly id: Id;
  readonly name: string;
  readonly color: string;
  /** In world units: micrometres on the physical view, pixels otherwise. */
  readonly rect: Rect<number>;
  readonly detail: string;
  readonly position: string;
  readonly cellWidth: number;
  readonly cellHeight: number;
}

export interface ViewFrame {
  readonly id: Id;
  readonly kind: "master" | "canvas" | "output";
  readonly name: string;
  readonly rect: Rect<number>;
}

export interface ViewModel {
  readonly view: WorkspaceView;
  readonly items: readonly ViewItem[];
  readonly frames: readonly ViewFrame[];
  /** Whole world units a drag position rounds to: 1 px, or 1 mm on the physical view. */
  readonly quantum: number;
  readonly unit: "px" | "mm";
  readonly bounds: Rect<number> | null;
}

/** Projects the mapping into what one workspace view draws, in that view's own coordinate system. */
export function buildViewModel(project: Project, mapping: ResolvedMapping, view: WorkspaceView, activeOutputId: Id | null): ViewModel {
  if (view === "physical") {
    const items = mapping.screens.map((s) => ({
      id: s.screenId,
      name: s.name,
      color: s.color,
      rect: s.stage,
      detail: `${formatMm(s.spec.widthUm)} × ${formatMm(s.spec.heightUm)} mm`,
      position: `${formatMm(s.stage.x)}, ${formatMm(s.stage.y)} mm`,
      cellWidth: s.cabinet.widthUm,
      cellHeight: s.cabinet.heightUm,
    }));
    return { view, items, frames: [], quantum: UM_PER_MM, unit: "mm", bounds: boundingBox(items.map((i) => i.rect)) };
  }

  if (view === "content") {
    const items = mapping.screens.map((s) => ({
      id: s.screenId,
      name: s.name,
      color: s.color,
      rect: s.masterRect,
      detail: `${s.spec.pixelWidth} × ${s.spec.pixelHeight} px`,
      position: `${s.masterRect.x}, ${s.masterRect.y}`,
      cellWidth: s.cabinet.pixelsX,
      cellHeight: s.cabinet.pixelsY,
    }));
    const master: ViewFrame = {
      id: "master",
      kind: "master",
      name: `Master ${mapping.master.width} × ${mapping.master.height}`,
      rect: { x: 0, y: 0, width: mapping.master.width, height: mapping.master.height },
    };
    const canvases: ViewFrame[] = mapping.canvases.flatMap((c) =>
      c.bounds ? [{ id: c.canvasId, kind: "canvas" as const, name: c.name, rect: c.bounds }] : [],
    );
    // Only label canvases when there's more than one: a single canvas equals the master.
    const frames = project.content.canvases.length > 1 ? [master, ...canvases] : [master];
    return { view, items, frames, quantum: 1, unit: "px", bounds: boundingBox([master.rect, ...items.map((i) => i.rect)]) };
  }

  const output = mapping.outputs.find((o) => o.outputId === activeOutputId) ?? mapping.outputs[0];
  const items = mapping.screens
    .filter((s) => s.outputId === output?.outputId)
    .map((s) => ({
      id: s.screenId,
      name: s.name,
      color: s.color,
      rect: s.outputRect,
      detail: `${s.spec.pixelWidth} × ${s.spec.pixelHeight} px`,
      position: `${s.outputRect.x}, ${s.outputRect.y}`,
      cellWidth: s.cabinet.pixelsX,
      cellHeight: s.cabinet.pixelsY,
    }));
  const frame: ViewFrame | null = output
    ? { id: output.outputId, kind: "output", name: `${output.name} ${output.width} × ${output.height}`, rect: { x: 0, y: 0, width: output.width, height: output.height } }
    : null;
  return {
    view,
    items,
    frames: frame ? [frame] : [],
    quantum: 1,
    unit: "px",
    bounds: boundingBox([...(frame ? [frame.rect] : []), ...items.map((i) => i.rect)]),
  };
}
