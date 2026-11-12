"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BUILTIN_CABINETS, toProjectCabinet } from "@/domain/cabinets";
import { formatMm, parsePx } from "@/domain/units";
import { computeScreenSpec } from "@/engines/physical";
import { CabinetLibraryDialog } from "@/modules/engineering/cabinet-library-dialog";
import { useCabinetLibrary } from "@/modules/engineering/library-store";
import * as ops from "@/engines/project-ops";
import { reportError } from "@/state/actions";
import { exportPng, exportSvg, type MapSource } from "@/state/export-actions";
import { opContext, useApp } from "@/state/store";
import { useUi } from "@/state/ui-store";
import { Readout, SelectField } from "./fields";
import { formatDate } from "./start-screen";

// Loaded when the dialog first opens, so calibration frames cost nothing until they're used.
const CalibrationView = dynamic(() => import("@/components/shell/calibration/calibration-view").then((m) => m.CalibrationView), {
  ssr: false,
  loading: () => <div className="flex-1 bg-stage" />,
});

function Field({ label, value, onChange, autoFocus, suffix, error }: { label: string; value: string; onChange(v: string): void; autoFocus?: boolean; suffix?: string; error?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs font-normal text-muted-foreground">
        {label}
        {suffix && ` (${suffix})`}
      </Label>
      <Input value={value} autoFocus={autoFocus} aria-invalid={error ? true : undefined} onChange={(e) => onChange(e.target.value)} onFocus={(e) => e.target.select()} className="tabular-nums" />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function NewProjectDialog() {
  const newProject = useApp((s) => s.newProject);
  const openDialog = useUi((s) => s.openDialog);
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [venue, setVenue] = useState("");
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Enter a project name.");
      return;
    }
    try {
      await newProject({ name, client, venue });
      openDialog(null);
    } catch (err) {
      reportError(err);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <DialogHeader><DialogTitle>New project</DialogTitle></DialogHeader>
      <Field label="Project name" value={name} onChange={setName} autoFocus error={error} />
      <Field label="Client" value={client} onChange={setClient} />
      <Field label="Venue" value={venue} onChange={setVenue} />
      <DialogFooter><Button type="submit">Create project</Button></DialogFooter>
    </form>
  );
}

function OpenProjectDialog() {
  const projects = useApp((s) => s.projects);
  const current = useApp((s) => s.project?.id);
  const openProject = useApp((s) => s.openProject);
  const openDialog = useUi((s) => s.openDialog);
  return (
    <>
      <DialogHeader><DialogTitle>Open project</DialogTitle></DialogHeader>
      <ul className="max-h-[50vh] divide-y divide-border overflow-auto border-y border-border">
        {projects.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className="flex w-full items-baseline justify-between gap-4 px-2 py-2 text-left hover:bg-accent"
              onClick={() => openProject(p.id).then(() => openDialog(null)).catch(reportError)}
            >
              <span className="min-w-0 truncate font-medium">{p.name}{p.id === current && " (open)"}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{p.screenCount} {p.screenCount === 1 ? "screen" : "screens"}, {formatDate(p.updatedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function useCabinetOptions() {
  const project = useApp((s) => s.project);
  const entries = useCabinetLibrary((s) => s.entries);
  const initLibrary = useCabinetLibrary((s) => s.init);
  useEffect(() => void initLibrary(), [initLibrary]);
  return useMemo(() => {
    const inProject = project?.cabinets ?? [];
    const ids = new Set(inProject.map((c) => c.id));
    // The project's own copies first, then generic profiles, then the cabinet library.
    return [...inProject, ...[...BUILTIN_CABINETS, ...entries.map(toProjectCabinet)].filter((c) => !ids.has(c.id))];
  }, [project, entries]);
}

function AddScreenDialog() {
  const project = useApp((s) => s.project)!;
  const edit = useApp((s) => s.edit);
  const select = useApp((s) => s.select);
  const openDialog = useUi((s) => s.openDialog);
  const startCabinet = useUi((s) => s.startCabinetFromAddScreen);
  const preferred = useUi((s) => s.addScreenCabinetId);
  const draft = useUi((s) => s.addScreenDraft);
  const options = useCabinetOptions();
  const lastUsed = project.physical.screens.at(-1)?.cabinetId;
  const [cabinetId, setCabinetId] = useState(preferred ?? lastUsed ?? options[0]?.id ?? BUILTIN_CABINETS[0].id);
  const [name, setName] = useState(draft?.name ?? `Screen ${project.physical.screens.length + 1}`);
  const [columns, setColumns] = useState(draft?.columns ?? "4");
  const [rows, setRows] = useState(draft?.rows ?? "3");
  const [error, setError] = useState<string>();

  const cabinet = options.find((c) => c.id === cabinetId);
  const cols = parsePx(columns);
  const rowCount = parsePx(rows);
  const valid = cabinet && cols !== null && rowCount !== null && cols >= 1 && rowCount >= 1;
  const spec = valid ? computeScreenSpec({ columns: cols, rows: rowCount }, cabinet) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!cabinet || cols === null || rowCount === null) {
      setError("Columns and rows must be whole numbers of at least 1.");
      return;
    }
    try {
      edit((p) => ops.addScreen(ops.addCabinet(p, cabinet), { name, cabinetId: cabinet.id, columns: cols, rows: rowCount }, opContext));
      const added = useApp.getState().project!.physical.screens.at(-1)!;
      select({ kind: "screens", ids: [added.id] });
      openDialog(null);
      // Keep the new screen in view.
      requestAnimationFrame(() => useApp.getState().fit());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <DialogHeader><DialogTitle>Add screen</DialogTitle></DialogHeader>
      <Field label="Name" value={name} onChange={setName} autoFocus />
      <div className="flex items-end gap-2">
        <SelectField
          className="flex-1"
          label="Cabinet"
          value={cabinetId}
          items={options.map((c) => ({ value: c.id, label: c.name }))}
          onChange={setCabinetId}
        />
        <Button type="button" variant="outline" size="sm" className="h-7 rounded" onClick={() => startCabinet({ name, columns, rows })}>Library</Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Columns" value={columns} onChange={setColumns} />
        <Field label="Rows" value={rows} onChange={setRows} />
      </div>
      <div className="flex flex-col gap-1 rounded bg-muted p-2.5" aria-live="polite">
        {spec ? (
          <>
            <Readout strong label="Resolution" value={`${spec.pixelWidth} × ${spec.pixelHeight} px`} />
            <Readout label="Physical size" value={`${formatMm(spec.widthUm)} × ${formatMm(spec.heightUm)} mm`} />
            <Readout label="Cabinets" value={spec.cabinetCount} />
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Enter whole numbers of columns and rows to see the size.</p>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <DialogFooter><Button type="submit">Add screen</Button></DialogFooter>
    </form>
  );
}

function PreviewDialog() {
  const project = useApp((s) => s.project)!;
  const mapping = useApp((s) => s.mapping)!;
  const view = useApp((s) => s.view);
  const activeOutputId = useApp((s) => s.activeOutputId);
  const issues = useApp((s) => s.issues);
  const initial = view === "output" && activeOutputId ? activeOutputId : "master";
  const source: MapSource = initial === "master" ? { kind: "master" } : { kind: "output", id: initial };
  const blocked = issues.some((i) => i.severity === "error");
  const empty = mapping.screens.length === 0;

  return (
    <>
      <DialogHeader className="border-b border-border py-2.5 pr-12 pl-3">
        <DialogTitle className="text-sm">Screen identification and calibration</DialogTitle>
        <DialogDescription className="sr-only">Identification and calibration frames for the master canvas, each output and each screen.</DialogDescription>
      </DialogHeader>
      <CalibrationView
        mapping={mapping}
        projectName={project.meta.name}
        initialTargetId={initial}
        actions={
          <>
            {blocked && <p className="text-xs text-destructive">Fix the errors listed under Checks before exporting pixel maps.</p>}
            <Button variant="outline" size="sm" className="rounded" disabled={blocked || empty} onClick={() => exportSvg(source)}>Pixel map SVG</Button>
            <Button variant="outline" size="sm" className="rounded" disabled={blocked || empty} onClick={() => exportPng(source)}>Pixel map PNG</Button>
          </>
        }
      />
    </>
  );
}

function ConfirmDialog() {
  const confirm = useUi((s) => s.confirm);
  const askConfirm = useUi((s) => s.askConfirm);
  return (
    <Dialog open={confirm !== null} onOpenChange={(open) => !open && askConfirm(null)}>
      <DialogContent className="sm:max-w-md">
        {confirm && (
          <>
            <DialogHeader>
              <DialogTitle>{confirm.title}</DialogTitle>
              <DialogDescription>{confirm.body}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => askConfirm(null)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  try {
                    await confirm.onConfirm();
                  } catch (error) {
                    reportError(error);
                  }
                  askConfirm(null);
                }}
              >
                {confirm.action}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function Dialogs() {
  const dialog = useUi((s) => s.dialog);
  const openDialog = useUi((s) => s.openDialog);
  const hasProject = useApp((s) => s.project !== null);
  return (
    <>
      <Dialog open={dialog !== null} onOpenChange={(open) => !open && openDialog(null)}>
        <DialogContent className={dialog === "preview" ? "flex h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1760px,calc(100%-2rem))]" : dialog === "new-cabinet" ? "max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl" : "sm:max-w-md"}>
          {dialog === "new-project" && <NewProjectDialog />}
          {dialog === "open-project" && <OpenProjectDialog />}
          {dialog === "add-screen" && hasProject && <AddScreenDialog />}
          {dialog === "new-cabinet" && <CabinetLibraryDialog />}
          {dialog === "preview" && hasProject && <PreviewDialog />}
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </>
  );
}
