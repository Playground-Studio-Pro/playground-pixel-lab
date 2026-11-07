"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BUILTIN_CABINETS } from "@/domain/cabinets";
import type { CabinetProfile } from "@/domain/model";
import { formatMm, parseMm, parsePx, type Um } from "@/domain/units";
import { computeScreenSpec, pitchDeviation } from "@/engines/physical";
import * as ops from "@/engines/project-ops";
import { renderSvg } from "@/exports/svg";
import { reportError } from "@/state/actions";
import { exportPng, exportSvg, sourceScene, type MapSource } from "@/state/export-actions";
import { opContext, useApp } from "@/state/store";
import { useUi } from "@/state/ui-store";
import { Readout, SelectField } from "./fields";
import { formatDate } from "./start-screen";

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
  const library = useApp((s) => s.library);
  return useMemo(() => {
    const inProject = project?.cabinets ?? [];
    const ids = new Set(inProject.map((c) => c.id));
    return [...inProject, ...library.filter((c) => !ids.has(c.id))];
  }, [project, library]);
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
        <Button type="button" variant="outline" size="sm" className="h-7 rounded" onClick={() => startCabinet({ name, columns, rows })}>New cabinet</Button>
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

function NewCabinetDialog() {
  const edit = useApp((s) => s.edit);
  const project = useApp((s) => s.project);
  const select = useApp((s) => s.select);
  const saveToLibrary = useApp((s) => s.saveToLibrary);
  const finishCabinet = useUi((s) => s.finishCabinet);
  const returning = useUi((s) => s.returnToAddScreen);
  const [name, setName] = useState("");
  const [width, setWidth] = useState("500");
  const [height, setHeight] = useState("500");
  const [pixelsX, setPixelsX] = useState("128");
  const [pixelsY, setPixelsY] = useState("128");
  const [pitch, setPitch] = useState("3.91");
  const [error, setError] = useState<string>();

  const parsed = {
    widthUm: parseMm(width),
    heightUm: parseMm(height),
    pixelsX: parsePx(pixelsX),
    pixelsY: parsePx(pixelsY),
    nominalPitchUm: parseMm(pitch),
  };
  const complete = Object.values(parsed).every((v) => v !== null && v > 0);
  const deviation = complete ? pitchDeviation(parsed as Parameters<typeof pitchDeviation>[0]) : 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Enter a cabinet name.");
      return;
    }
    if (!complete) {
      setError("Size and pitch must be millimetres above 0 with up to 3 decimals. Pixels must be whole numbers above 0.");
      return;
    }
    const cabinet: CabinetProfile = {
      id: opContext.newId(),
      name: name.trim(),
      widthUm: parsed.widthUm as Um,
      heightUm: parsed.heightUm as Um,
      pixelsX: parsed.pixelsX!,
      pixelsY: parsed.pixelsY!,
      nominalPitchUm: parsed.nominalPitchUm as Um,
      source: "custom",
    };
    try {
      ops.validateCabinet(cabinet);
      await saveToLibrary(cabinet);
      if (project) {
        edit((p) => ops.addCabinet(p, cabinet));
        if (!returning) select({ kind: "cabinet", id: cabinet.id });
      }
      finishCabinet(cabinet.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <DialogHeader>
        <DialogTitle>New cabinet</DialogTitle>
        <DialogDescription>Saved to your library, so it’s available in every project. Use the values from the supplier’s data sheet.</DialogDescription>
      </DialogHeader>
      <Field label="Name" value={name} onChange={setName} autoFocus />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Width" suffix="mm" value={width} onChange={setWidth} />
        <Field label="Height" suffix="mm" value={height} onChange={setHeight} />
        <Field label="Pixels across" value={pixelsX} onChange={setPixelsX} />
        <Field label="Pixels down" value={pixelsY} onChange={setPixelsY} />
        <Field label="Nominal pitch" suffix="mm" value={pitch} onChange={setPitch} />
      </div>
      {deviation > 0.02 && (
        <p className="text-xs text-warn">
          Width ÷ pixels gives {formatMm(Math.round(parsed.widthUm! / parsed.pixelsX!))} mm, which differs from the {pitch} mm pitch. Check the data sheet.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <DialogFooter><Button type="submit">Save cabinet</Button></DialogFooter>
    </form>
  );
}

function PreviewDialog() {
  const mapping = useApp((s) => s.mapping)!;
  const view = useApp((s) => s.view);
  const activeOutputId = useApp((s) => s.activeOutputId);
  const issues = useApp((s) => s.issues);
  const [choice, setChoice] = useState(view === "output" && activeOutputId ? activeOutputId : "master");
  const [url, setUrl] = useState<string | null>(null);

  const source: MapSource = choice === "master" ? { kind: "master" } : { kind: "output", id: choice };
  const { scene } = sourceScene(source);
  const blocked = issues.some((i) => i.severity === "error");
  const empty = scene.width < 1 || scene.height < 1;

  useEffect(() => {
    const objectUrl = URL.createObjectURL(new Blob([renderSvg(scene)], { type: "image/svg+xml" }));
    const frame = requestAnimationFrame(() => setUrl(objectUrl));
    return () => {
      cancelAnimationFrame(frame);
      URL.revokeObjectURL(objectUrl);
    };
    // The scene is rebuilt each render; its content only changes with these inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping, choice]);

  return (
    <>
      <DialogHeader><DialogTitle>Pixel map preview</DialogTitle></DialogHeader>
      <div className="flex items-end justify-between gap-3">
        <SelectField
          className="w-56"
          label="Show"
          value={choice}
          items={[{ value: "master", label: "Master canvas" }, ...mapping.outputs.map((o) => ({ value: o.outputId, label: o.name }))]}
          onChange={setChoice}
        />
        <p className="text-sm font-semibold tabular-nums" data-testid="preview-size">{scene.width} × {scene.height} px</p>
      </div>
      <div className="flex h-[58vh] items-center justify-center rounded bg-stage p-3">
        {empty ? (
          <p className="text-muted-foreground">Add a screen to see its pixel map.</p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          url && <img src={url} alt={`Pixel map, ${scene.width} by ${scene.height} pixels`} className="max-h-full max-w-full object-contain" />
        )}
      </div>
      <DialogFooter>
        {blocked && <p className="mr-auto self-center text-xs text-destructive">Fix the errors listed under Checks before exporting.</p>}
        <Button variant="outline" disabled={blocked || empty} onClick={() => exportSvg(source)}>Export SVG</Button>
        <Button disabled={blocked || empty} onClick={() => exportPng(source)}>Export PNG</Button>
      </DialogFooter>
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
        <DialogContent className={dialog === "preview" ? "sm:max-w-5xl" : "sm:max-w-md"}>
          {dialog === "new-project" && <NewProjectDialog />}
          {dialog === "open-project" && <OpenProjectDialog />}
          {dialog === "add-screen" && hasProject && <AddScreenDialog />}
          {dialog === "new-cabinet" && <NewCabinetDialog />}
          {dialog === "preview" && hasProject && <PreviewDialog />}
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </>
  );
}
