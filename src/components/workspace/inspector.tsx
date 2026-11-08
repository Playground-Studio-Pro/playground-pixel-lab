"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CabinetProfile, CanvasSizing, Id } from "@/domain/model";
import { formatMm, parseMm, px, um, type Um } from "@/domain/units";
import { computeScreenSpec, pitchDeviation } from "@/engines/physical";
import * as ops from "@/engines/project-ops";
import { deleteSelection, duplicateSelection, groupSelection, tryEdit } from "@/state/actions";
import { useCabinetLibrary } from "@/modules/engineering/library-store";
import { opContext, selectedScreenIds, useApp, type AppState } from "@/state/store";
import { CommitField, Readout, Section, SelectField, intStep, requireWhole } from "./fields";

const edit: AppState["edit"] = (change) => useApp.getState().edit(change);

function mmStep(current: string, delta: number): string | null {
  const value = parseMm(current);
  return value === null ? null : formatMm(value + delta * 1000);
}

function requireMm(text: string, what: string): Um {
  const value = parseMm(text);
  if (value === null) throw new Error(`${what} must be a number in millimetres, with up to 3 decimals.`);
  return value;
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) {
  return (
    <Label className="flex items-center gap-2 text-xs font-normal">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      {label}
    </Label>
  );
}

function SizingFields({ sizing, autoWidth, autoHeight, onChange }: { sizing: CanvasSizing; autoWidth: number; autoHeight: number; onChange(next: CanvasSizing): void }) {
  return (
    <>
      <SelectField
        label="Size"
        value={sizing.mode}
        items={[
          { value: "auto", label: "Automatic, fits content" },
          { value: "fixed", label: "Fixed" },
        ]}
        onChange={(mode) =>
          onChange(mode === "auto" ? { mode: "auto" } : { mode: "fixed", width: px(Math.max(1, autoWidth)), height: px(Math.max(1, autoHeight)) })
        }
      />
      {sizing.mode === "fixed" && (
        <div className="grid grid-cols-2 gap-2">
          <CommitField label="Width" suffix="px" value={String(sizing.width)} step={intStep} onCommit={(t) => onChange({ ...sizing, width: px(requireWhole(t, "Width")) })} />
          <CommitField label="Height" suffix="px" value={String(sizing.height)} step={intStep} onCommit={(t) => onChange({ ...sizing, height: px(requireWhole(t, "Height")) })} />
        </div>
      )}
    </>
  );
}

function ProjectPanel() {
  const project = useApp((s) => s.project)!;
  const mapping = useApp((s) => s.mapping)!;
  const totalCabinets = mapping.screens.reduce((n, s) => n + s.spec.cabinetCount, 0);
  const box = mapping.master.contentBounds;
  return (
    <>
      <Section title="Project">
        <CommitField label="Name" value={project.meta.name} onCommit={(t) => edit((p) => ops.updateMeta(p, { name: t.trim() }))} />
        <CommitField label="Client" value={project.meta.client} onCommit={(t) => edit((p) => ops.updateMeta(p, { client: t.trim() }))} />
        <CommitField label="Venue" value={project.meta.venue} onCommit={(t) => edit((p) => ops.updateMeta(p, { venue: t.trim() }))} />
      </Section>
      <Section title="Master canvas">
        <Readout strong label="Resolution" value={`${mapping.master.width} × ${mapping.master.height} px`} />
        {box && <Readout label="Content area" value={`${box.width} × ${box.height} px at ${box.x}, ${box.y}`} />}
        <SizingFields
          sizing={project.content.master}
          autoWidth={mapping.master.width}
          autoHeight={mapping.master.height}
          onChange={(next) => edit((p) => ops.setMasterSizing(p, next))}
        />
        <Button variant="outline" size="sm" className="rounded" disabled={!box} onClick={() => tryEdit(ops.trimContent)}>Trim to content</Button>
      </Section>
      <Section title="Totals">
        <Readout label="Screens" value={mapping.screens.length} />
        <Readout label="Cabinets" value={totalCabinets} />
        <Readout label="LED pixels" value={mapping.screens.reduce((n, s) => n + s.spec.totalPixels, 0).toLocaleString()} />
      </Section>
    </>
  );
}

function ScreenPanel({ id }: { id: Id }) {
  const project = useApp((s) => s.project)!;
  const mapping = useApp((s) => s.mapping)!;
  const select = useApp((s) => s.select);
  const screen = project.physical.screens.find((s) => s.id === id);
  const resolved = mapping.screens.find((s) => s.screenId === id);
  if (!screen) return null;
  const NEW_CANVAS = "__new__";

  return (
    <>
      <Section title="Screen">
        <CommitField label="Name" value={screen.name} onCommit={(t) => edit((p) => ops.updateScreen(p, id, { name: t }))} />
        <SelectField
          label="Cabinet"
          value={screen.cabinetId}
          items={project.cabinets.map((c) => ({ value: c.id, label: c.name }))}
          onChange={(cabinetId) => tryEdit((p) => ops.updateScreen(p, id, { cabinetId }))}
        />
        <div className="grid grid-cols-2 gap-2">
          <CommitField label="Columns" value={String(screen.columns)} step={intStep} onCommit={(t) => edit((p) => ops.updateScreen(p, id, { columns: requireWhole(t, "Columns") }))} />
          <CommitField label="Rows" value={String(screen.rows)} step={intStep} onCommit={(t) => edit((p) => ops.updateScreen(p, id, { rows: requireWhole(t, "Rows") }))} />
        </div>
        {resolved && (
          <div className="mt-1 flex flex-col gap-1">
            <Readout strong label="Resolution" value={`${resolved.spec.pixelWidth} × ${resolved.spec.pixelHeight} px`} />
            <Readout label="Physical size" value={`${formatMm(resolved.spec.widthUm)} × ${formatMm(resolved.spec.heightUm)} mm`} />
            <Readout label="Cabinets" value={resolved.spec.cabinetCount} />
          </div>
        )}
      </Section>

      <Section title="Stage position">
        <div className="grid grid-cols-2 gap-2">
          <CommitField label="X" suffix="mm" value={formatMm(screen.stageX)} step={mmStep} onCommit={(t) => { const x = requireMm(t, "X"); edit((p) => ops.setStagePositions(p, [{ id, x, y: screen.stageY }])); }} />
          <CommitField label="Y" suffix="mm" value={formatMm(screen.stageY)} step={mmStep} onCommit={(t) => { const y = requireMm(t, "Y"); edit((p) => ops.setStagePositions(p, [{ id, x: screen.stageX, y }])); }} />
        </div>
      </Section>

      {resolved && (
        <Section title="Content position">
          <SelectField
            label="Canvas"
            value={resolved.canvasId}
            items={[...project.content.canvases.map((c) => ({ value: c.id, label: c.name })), { value: NEW_CANVAS, label: "New independent canvas" }]}
            onChange={(value) =>
              tryEdit((p) => (value === NEW_CANVAS ? ops.makeScreenIndependent(p, id, opContext).project : ops.assignCanvas(p, id, value)))
            }
          />
          <div className="grid grid-cols-2 gap-2">
            <CommitField label="X in canvas" suffix="px" value={String(resolved.canvasRect.x)} step={intStep} onCommit={(t) => edit((p) => ops.setRegionPosition(p, id, px(requireWhole(t, "X")), resolved.canvasRect.y))} />
            <CommitField label="Y in canvas" suffix="px" value={String(resolved.canvasRect.y)} step={intStep} onCommit={(t) => edit((p) => ops.setRegionPosition(p, id, resolved.canvasRect.x, px(requireWhole(t, "Y"))))} />
          </div>
          <Readout label="On master canvas" value={`${resolved.masterRect.x}, ${resolved.masterRect.y}`} />
          <CheckRow label="Can share pixels with other marked screens" checked={resolved.allowOverlap} onChange={(value) => tryEdit((p) => ops.setRegionShared(p, id, value))} />
        </Section>
      )}

      {resolved && (
        <Section title="Output position">
          <SelectField
            label="Output"
            value={resolved.outputId}
            items={project.output.outputs.map((o) => ({ value: o.id, label: o.name }))}
            onChange={(value) => tryEdit((p) => ops.assignOutput(p, id, value))}
          />
          <CheckRow label="Same as content position" checked={resolved.followsContent} onChange={(value) => tryEdit((p) => ops.setSliceFollowsContent(p, id, value))} />
          <div className="grid grid-cols-2 gap-2">
            <CommitField label="X" suffix="px" disabled={resolved.followsContent} value={String(resolved.outputRect.x)} step={intStep} onCommit={(t) => edit((p) => ops.setSlicePositions(p, [{ id, x: px(requireWhole(t, "X")), y: resolved.outputRect.y }]))} />
            <CommitField label="Y" suffix="px" disabled={resolved.followsContent} value={String(resolved.outputRect.y)} step={intStep} onCommit={(t) => edit((p) => ops.setSlicePositions(p, [{ id, x: resolved.outputRect.x, y: px(requireWhole(t, "Y")) }]))} />
          </div>
        </Section>
      )}

      <div className="flex gap-2 p-3">
        <Button variant="outline" size="sm" className="flex-1 rounded" onClick={duplicateSelection}>Duplicate</Button>
        <Button variant="destructive" size="sm" className="flex-1 rounded" onClick={deleteSelection}>Delete</Button>
      </div>
      {screen.groupId && (
        <div className="px-3 pb-3">
          <Button variant="ghost" size="sm" className="w-full rounded" onClick={() => select({ kind: "group", id: screen.groupId! })}>Select its group</Button>
        </div>
      )}
    </>
  );
}

function MultiPanel({ ids }: { ids: readonly Id[] }) {
  const mapping = useApp((s) => s.mapping)!;
  const members = mapping.screens.filter((s) => ids.includes(s.screenId));
  return (
    <>
      <Section title={`${ids.length} screens selected`}>
        <Readout label="Cabinets" value={members.reduce((n, s) => n + s.spec.cabinetCount, 0)} />
        <Readout label="LED pixels" value={members.reduce((n, s) => n + s.spec.totalPixels, 0).toLocaleString()} />
      </Section>
      <div className="flex flex-col gap-2 p-3">
        <Button variant="outline" size="sm" className="rounded" onClick={groupSelection}>Group screens</Button>
        <Button variant="outline" size="sm" className="rounded" onClick={duplicateSelection}>Duplicate</Button>
        <Button variant="destructive" size="sm" className="rounded" onClick={deleteSelection}>Delete</Button>
      </div>
    </>
  );
}

function GroupPanel({ id }: { id: Id }) {
  const project = useApp((s) => s.project)!;
  const select = useApp((s) => s.select);
  const group = project.physical.groups.find((g) => g.id === id);
  if (!group) return null;
  const count = selectedScreenIds({ kind: "group", id }, project).length;
  return (
    <>
      <Section title="Group">
        <CommitField label="Name" value={group.name} onCommit={(t) => edit((p) => ops.renameGroup(p, id, t))} />
        <Readout label="Screens" value={count} />
      </Section>
      <div className="flex flex-col gap-2 p-3">
        <Button variant="outline" size="sm" className="rounded" onClick={() => { tryEdit((p) => ops.ungroup(p, id)); select({ kind: "none" }); }}>Ungroup</Button>
        <Button variant="outline" size="sm" className="rounded" onClick={duplicateSelection}>Duplicate screens</Button>
        <Button variant="destructive" size="sm" className="rounded" onClick={deleteSelection}>Delete screens</Button>
      </div>
    </>
  );
}

function CabinetPanel({ cabinet }: { cabinet: CabinetProfile }) {
  const select = useApp((s) => s.select);
  const saveToLibrary = useCabinetLibrary((s) => s.saveFromProject);
  const readOnly = cabinet.source === "builtin";

  const update = (patch: Partial<CabinetProfile>) => {
    edit((p) => ops.updateCabinet(p, cabinet.id, patch));
    const next = useApp.getState().project?.cabinets.find((c) => c.id === cabinet.id);
    if (next) void saveToLibrary(next);
  };
  const deviation = pitchDeviation(cabinet);
  const spec = computeScreenSpec({ columns: 1, rows: 1 }, cabinet);

  return (
    <>
      <Section title="Cabinet">
        <CommitField label="Name" disabled={readOnly} value={cabinet.name} onCommit={(t) => update({ name: t.trim() })} />
        <div className="grid grid-cols-2 gap-2">
          <CommitField label="Width" suffix="mm" disabled={readOnly} value={formatMm(cabinet.widthUm)} onCommit={(t) => update({ widthUm: requireMm(t, "Width") })} />
          <CommitField label="Height" suffix="mm" disabled={readOnly} value={formatMm(cabinet.heightUm)} onCommit={(t) => update({ heightUm: requireMm(t, "Height") })} />
          <CommitField label="Pixels across" suffix="px" disabled={readOnly} value={String(cabinet.pixelsX)} step={intStep} onCommit={(t) => update({ pixelsX: px(requireWhole(t, "Pixels across")) })} />
          <CommitField label="Pixels down" suffix="px" disabled={readOnly} value={String(cabinet.pixelsY)} step={intStep} onCommit={(t) => update({ pixelsY: px(requireWhole(t, "Pixels down")) })} />
        </div>
        <CommitField label="Nominal pitch" suffix="mm" disabled={readOnly} value={formatMm(cabinet.nominalPitchUm)} onCommit={(t) => update({ nominalPitchUm: requireMm(t, "Pitch") })} />
        <Readout label="Measured pitch" value={`${formatMm(um(Math.round(cabinet.widthUm / spec.pixelWidth)))} mm (${(deviation * 100).toFixed(1)}% off nominal)`} />
      </Section>
      {readOnly && <p className="px-3 pt-3 text-xs text-muted-foreground">Generic profiles can’t be edited. Duplicate this one to set values from your supplier’s data sheet.</p>}
      <div className="flex flex-col gap-2 p-3">
        <Button
          variant="outline"
          size="sm"
          className="rounded"
          onClick={() => {
            const copy: CabinetProfile = { ...cabinet, id: opContext.newId(), name: `${cabinet.name} copy`, source: "custom" };
            tryEdit((p) => ops.addCabinet(p, copy));
            void saveToLibrary(copy);
            select({ kind: "cabinet", id: copy.id });
          }}
        >
          Duplicate as custom
        </Button>
        <Button
          variant="destructive"
          size="sm"
          className="rounded"
          onClick={() => {
            tryEdit((p) => ops.removeCabinet(p, cabinet.id));
            if (!useApp.getState().project?.cabinets.some((c) => c.id === cabinet.id)) select({ kind: "none" });
          }}
        >
          Remove from project
        </Button>
      </div>
    </>
  );
}

function CanvasPanel({ id }: { id: Id }) {
  const mapping = useApp((s) => s.mapping)!;
  const select = useApp((s) => s.select);
  const canvas = mapping.canvases.find((c) => c.canvasId === id);
  if (!canvas) return null;
  return (
    <>
      <Section title="Content canvas">
        <CommitField label="Name" value={canvas.name} onCommit={(t) => edit((p) => ops.updateCanvas(p, id, { name: t }))} />
        <div className="grid grid-cols-2 gap-2">
          <CommitField label="Origin X" suffix="px" value={String(canvas.originX)} step={intStep} onCommit={(t) => edit((p) => ops.updateCanvas(p, id, { originX: px(requireWhole(t, "Origin X")) }))} />
          <CommitField label="Origin Y" suffix="px" value={String(canvas.originY)} step={intStep} onCommit={(t) => edit((p) => ops.updateCanvas(p, id, { originY: px(requireWhole(t, "Origin Y")) }))} />
        </div>
        <Readout label="Screens" value={canvas.screenIds.length} />
        <Readout strong label="Content area" value={canvas.bounds ? `${canvas.bounds.width} × ${canvas.bounds.height} px` : "Empty"} />
        {canvas.bounds && <Readout label="On master canvas" value={`${canvas.bounds.x}, ${canvas.bounds.y}`} />}
        <p className="text-xs text-muted-foreground">Screens on the same canvas show one continuous image. Move a screen to its own canvas to give it independent content.</p>
      </Section>
      <div className="p-3">
        <Button variant="destructive" size="sm" className="w-full rounded" onClick={() => { tryEdit((p) => ops.removeCanvas(p, id)); if (!useApp.getState().project?.content.canvases.some((c) => c.id === id)) select({ kind: "none" }); }}>Remove canvas</Button>
      </div>
    </>
  );
}

function OutputPanel({ id }: { id: Id }) {
  const project = useApp((s) => s.project)!;
  const mapping = useApp((s) => s.mapping)!;
  const select = useApp((s) => s.select);
  const output = project.output.outputs.find((o) => o.id === id);
  const resolved = mapping.outputs.find((o) => o.outputId === id);
  if (!output || !resolved) return null;
  return (
    <>
      <Section title="Output">
        <CommitField label="Name" value={output.name} onCommit={(t) => edit((p) => ops.updateOutput(p, id, { name: t }))} />
        <Readout strong label="Resolution" value={`${resolved.width} × ${resolved.height} px`} />
        <SizingFields sizing={output.sizing} autoWidth={resolved.width} autoHeight={resolved.height} onChange={(next) => edit((p) => ops.updateOutput(p, id, { sizing: next }))} />
        <Readout label="Screens" value={resolved.screenIds.length} />
      </Section>
      <div className="p-3">
        <Button variant="destructive" size="sm" className="w-full rounded" onClick={() => { tryEdit((p) => ops.removeOutput(p, id)); if (!useApp.getState().project?.output.outputs.some((o) => o.id === id)) select({ kind: "none" }); }}>Remove output</Button>
      </div>
    </>
  );
}

export function Inspector() {
  const selection = useApp((s) => s.selection);
  const project = useApp((s) => s.project)!;
  let content;
  switch (selection.kind) {
    case "screens":
      content = selection.ids.length === 1 ? <ScreenPanel key={selection.ids[0]} id={selection.ids[0]} /> : <MultiPanel ids={selection.ids} />;
      break;
    case "group":
      content = <GroupPanel key={selection.id} id={selection.id} />;
      break;
    case "cabinet": {
      const cabinet = project.cabinets.find((c) => c.id === selection.id);
      content = cabinet ? <CabinetPanel key={cabinet.id} cabinet={cabinet} /> : <ProjectPanel />;
      break;
    }
    case "canvas":
      content = <CanvasPanel key={selection.id} id={selection.id} />;
      break;
    case "output":
      content = <OutputPanel key={selection.id} id={selection.id} />;
      break;
    default:
      content = <ProjectPanel />;
  }
  return (
    <aside className="min-h-0 border-l border-border bg-panel" aria-label="Properties inspector">
      <ScrollArea className="h-full">{content}</ScrollArea>
    </aside>
  );
}
