"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Readout, SelectField } from "@/components/workspace/fields";
import { BUILTIN_CABINETS, EMPTY_LIBRARY_FIELDS, toProjectCabinet, type LibraryCabinet } from "@/domain/cabinets";
import type { CabinetProfile } from "@/domain/model";
import { formatMm, um } from "@/domain/units";
import { cabinetFormText, EMPTY_CABINET_FORM, parseCabinetForm, type CabinetFormErrors, type CabinetFormText } from "@/engines/led/cabinet-form";
import { pitchDeviation } from "@/engines/physical";
import * as ops from "@/engines/project-ops";
import { opContext, useApp } from "@/state/store";
import { useUi } from "@/state/ui-store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useCabinetLibrary } from "./library-store";

type Choice =
  | { kind: "new"; from?: CabinetFormText }
  | { kind: "entry"; id: string }
  | { kind: "builtin"; id: string };

function TextField({ label, value, onChange, error, suffix, autoFocus, placeholder }: { label: string; value: string; onChange(v: string): void; error?: string; suffix?: string; autoFocus?: boolean; placeholder?: string }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">{label}{suffix && ` (${suffix})`}</Label>
      <Input id={id} value={value} autoFocus={autoFocus} placeholder={placeholder} aria-invalid={error ? true : undefined} onChange={(e) => onChange(e.target.value)} className="h-8 tabular-nums" />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ProfileFacts({ cabinet }: { cabinet: Pick<CabinetProfile, "widthUm" | "heightUm" | "pixelsX" | "pixelsY" | "nominalPitchUm"> }) {
  const deviation = pitchDeviation(cabinet);
  return (
    <div className="flex flex-col gap-1 rounded bg-muted p-2.5" aria-live="polite">
      <Readout strong label="One cabinet" value={`${cabinet.pixelsX} × ${cabinet.pixelsY} px, ${formatMm(cabinet.widthUm)} × ${formatMm(cabinet.heightUm)} mm`} />
      <Readout label="Size ÷ pixels" value={`${formatMm(um(Math.round(cabinet.widthUm / cabinet.pixelsX)))} × ${formatMm(um(Math.round(cabinet.heightUm / cabinet.pixelsY)))} mm`} />
      <Readout label="Nominal pitch" value={`${formatMm(cabinet.nominalPitchUm)} mm`} />
      {deviation > 0.02 && (
        <p className="text-xs text-warn">Size ÷ pixels is {(deviation * 100).toFixed(1)}% off the nominal pitch. Check the data sheet. Resolution always comes from the pixel count.</p>
      )}
    </div>
  );
}

function ListButton({ active, onClick, title, detail, testId }: { active: boolean; onClick(): void; title: string; detail: string; testId?: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-current={active ? "true" : undefined}
      onClick={onClick}
      className={cn("flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-accent", active && "bg-accent")}
    >
      <span className="w-full truncate text-[13px] font-medium">{title}</span>
      <span className="w-full truncate text-xs text-muted-foreground tabular-nums">{detail}</span>
    </button>
  );
}

const describe = (c: CabinetProfile) => `${c.pixelsX}×${c.pixelsY} px · ${formatMm(c.widthUm)}×${formatMm(c.heightUm)} mm`;

/** Adds the profile to the open project, or hands it back to Add screen. */
function useTakeProfile() {
  const edit = useApp((s) => s.edit);
  const select = useApp((s) => s.select);
  const finishCabinet = useUi((s) => s.finishCabinet);
  const returning = useUi((s) => s.returnToAddScreen);
  return {
    returning,
    take(profile: CabinetProfile) {
      if (returning) {
        finishCabinet(profile.id);
        return;
      }
      if (!useApp.getState().project) return;
      edit((p) => ops.addCabinet(p, profile));
      select({ kind: "cabinet", id: profile.id });
      finishCabinet(profile.id);
    },
  };
}

function EntryForm({ entry, initial, onSaved, onDeleted, onDuplicate }: { entry: LibraryCabinet | null; initial: CabinetFormText; onSaved(id: string): void; onDeleted(): void; onDuplicate(text: CabinetFormText): void }) {
  const save = useCabinetLibrary((s) => s.save);
  const remove = useCabinetLibrary((s) => s.remove);
  const inProject = useApp((s) => (entry ? s.project?.cabinets.some((c) => c.id === entry.id) : false));
  const hasProject = useApp((s) => s.project !== null);
  const { returning, take } = useTakeProfile();
  const [text, setText] = useState(initial);
  const [errors, setErrors] = useState<CabinetFormErrors>({});
  const [failure, setFailure] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savedAt, setSavedAt] = useState<string>();

  const parsed = parseCabinetForm(text);
  const dirty = JSON.stringify(text) !== JSON.stringify(initial);
  const set = (key: keyof CabinetFormText) => (value: string) => {
    setText((t) => ({ ...t, [key]: value }) as CabinetFormText);
    setSavedAt(undefined);
  };

  const persist = async (): Promise<LibraryCabinet | null> => {
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return null;
    }
    setErrors({});
    const next: LibraryCabinet = { ...parsed.value, id: entry?.id ?? opContext.newId() };
    try {
      ops.validateCabinet(next);
      await save(next);
      setFailure(undefined);
      return next;
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
      return null;
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const saved = await persist();
    if (!saved) return;
    setSavedAt("Saved to the library.");
    if (!entry) toast.success(`Saved “${saved.name}” to the library.`);
    onSaved(saved.id);
  };

  const saveAndUse = async () => {
    const saved = entry && !dirty ? entry : await persist();
    if (saved) take(toProjectCabinet(saved));
  };

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-3" data-testid="cabinet-form">
      <TextField label="Name" value={text.name} onChange={set("name")} error={errors.name} autoFocus={!entry} placeholder="Supplier, model and pitch" />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Supplier" value={text.supplier} onChange={set("supplier")} error={errors.supplier} placeholder="Not stated" />
        <TextField label="Model" value={text.model} onChange={set("model")} error={errors.model} placeholder="Not stated" />
        <TextField label="Width" suffix="mm" value={text.width} onChange={set("width")} error={errors.width} />
        <TextField label="Height" suffix="mm" value={text.height} onChange={set("height")} error={errors.height} />
        <TextField label="Pixels across" suffix="px" value={text.pixelsX} onChange={set("pixelsX")} error={errors.pixelsX} />
        <TextField label="Pixels down" suffix="px" value={text.pixelsY} onChange={set("pixelsY")} error={errors.pixelsY} />
        <TextField label="Nominal pitch" suffix="mm" value={text.pitch} onChange={set("pitch")} error={errors.pitch} />
      </div>
      <fieldset className="flex flex-col gap-2 rounded border border-border p-3" data-testid="cabinet-specs">
        <legend className="px-1 text-xs font-semibold">Data-sheet specs <span className="font-normal text-muted-foreground">optional, per cabinet</span></legend>
        <p className="text-xs text-muted-foreground">Leave a value empty when the data sheet doesn’t state it. Nothing is calculated from these yet.</p>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Maximum power" suffix="W" value={text.maxPower} onChange={set("maxPower")} error={errors.maxPower} placeholder="Not stated" />
          <TextField label="Typical power" suffix="W" value={text.typicalPower} onChange={set("typicalPower")} error={errors.typicalPower} placeholder="Not stated" />
          <TextField label="Weight" suffix="kg" value={text.weight} onChange={set("weight")} error={errors.weight} placeholder="Not stated" />
          <TextField label="LED refresh rate" suffix="Hz" value={text.refreshRate} onChange={set("refreshRate")} error={errors.refreshRate} placeholder="Not stated" />
          <SelectField
            label="Environment"
            value={text.environment || "unknown"}
            items={[
              { value: "unknown", label: "Not stated" },
              { value: "indoor", label: "Indoor" },
              { value: "outdoor", label: "Outdoor" },
            ]}
            onChange={(v) => set("environment")(v === "unknown" ? "" : v)}
          />
        </div>
      </fieldset>
      <div className="flex flex-col gap-1">
        <Label htmlFor="cabinet-note" className="text-xs font-normal text-muted-foreground">Data-sheet note</Label>
        <textarea
          id="cabinet-note"
          value={text.datasheetNote}
          onChange={(e) => set("datasheetNote")(e.target.value)}
          rows={3}
          placeholder="Variant, revision, values to check. Leave unknown values out."
          aria-invalid={errors.datasheetNote ? true : undefined}
          className="w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
        {errors.datasheetNote && <p className="text-xs text-destructive">{errors.datasheetNote}</p>}
      </div>
      {parsed.ok && <ProfileFacts cabinet={parsed.value} />}
      {entry && <p className="text-xs text-muted-foreground">Changes apply the next time this profile is added. Projects that already use it keep their own copy{inProject ? ", including this one" : ""}.</p>}
      {failure && <p className="text-xs text-destructive">{failure}</p>}
      {savedAt && !dirty && <p className="text-xs text-muted-foreground" role="status">{savedAt}</p>}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {entry && !confirmDelete && <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>}
        {entry && confirmDelete && (
          <>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={async () => {
                try {
                  await remove(entry.id);
                  onDeleted();
                } catch (err) {
                  setFailure(err instanceof Error ? err.message : String(err));
                }
              }}
            >
              Delete from library
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Keep</Button>
          </>
        )}
        {entry && <Button type="button" variant="outline" size="sm" onClick={() => onDuplicate({ ...text, name: `${text.name} copy` })}>Duplicate</Button>}
        <span className="flex-1" />
        {(returning || (hasProject && !inProject)) && (
          <Button type="button" variant="outline" size="sm" onClick={saveAndUse}>{returning ? (dirty || !entry ? "Save and use" : "Use for screen") : dirty || !entry ? "Save and add to project" : "Add to project"}</Button>
        )}
        <Button type="submit" size="sm" disabled={!!entry && !dirty}>{entry ? "Save changes" : "Save to library"}</Button>
      </div>
    </form>
  );
}

function BuiltinView({ cabinet, onDuplicate }: { cabinet: CabinetProfile; onDuplicate(text: CabinetFormText): void }) {
  const inProject = useApp((s) => s.project?.cabinets.some((c) => c.id === cabinet.id) ?? false);
  const hasProject = useApp((s) => s.project !== null);
  const { returning, take } = useTakeProfile();
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div>
        <p className="font-medium">{cabinet.name}</p>
        <p className="text-xs text-muted-foreground">Generic starting point. It can’t be edited: duplicate it into your library and set the values from the supplier’s data sheet.</p>
      </div>
      <ProfileFacts cabinet={cabinet} />
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" size="sm" onClick={() => onDuplicate({ ...cabinetFormText({ ...cabinet, ...EMPTY_LIBRARY_FIELDS, source: "custom" }), name: `${cabinet.name} copy` })}>Duplicate to library</Button>
        <span className="flex-1" />
        {(returning || (hasProject && !inProject)) && <Button type="button" size="sm" onClick={() => take(cabinet)}>{returning ? "Use for screen" : "Add to project"}</Button>}
      </div>
    </div>
  );
}

/** The cabinet library: profiles kept in this browser, outside any project. Shown in the New cabinet dialog until E4. */
export function CabinetLibraryDialog() {
  const init = useCabinetLibrary((s) => s.init);
  const status = useCabinetLibrary((s) => s.status);
  const loadError = useCabinetLibrary((s) => s.error);
  const entries = useCabinetLibrary((s) => s.entries);
  const [pick, setPick] = useState<Choice>({ kind: "new" });
  // Remounts the form whenever the picked profile changes, so its text starts fresh.
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    void init();
  }, [init]);

  const choose = (next: Choice) => {
    setPick(next);
    setFormKey((k) => k + 1);
  };

  const entry = pick.kind === "entry" ? (entries.find((e) => e.id === pick.id) ?? null) : null;
  const builtin = pick.kind === "builtin" ? BUILTIN_CABINETS.find((c) => c.id === pick.id) : undefined;

  return (
    <div className="flex flex-col gap-3">
      <DialogHeader>
        <DialogTitle>Cabinet library</DialogTitle>
        <DialogDescription>Profiles saved in this browser, available in every project. A project keeps its own copy of each profile it uses. Take every value from the supplier’s data sheet.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 md:grid-cols-[13rem_1fr]">
        <nav aria-label="Cabinet profiles" className="flex flex-col gap-3 md:border-r md:border-border md:pr-3">
          <Button type="button" variant={pick.kind === "new" ? "secondary" : "outline"} size="sm" onClick={() => choose({ kind: "new" })}>New profile</Button>
          <div className="flex flex-col gap-0.5">
            <h3 className="px-2 text-xs font-semibold">Your library</h3>
            {status === "loading" && <p className="px-2 text-xs text-muted-foreground">Loading…</p>}
            {status === "failed" && <p className="px-2 text-xs text-destructive">The library couldn’t open: {loadError}</p>}
            {status === "ready" && entries.length === 0 && <p className="px-2 text-xs text-muted-foreground">No saved profiles yet.</p>}
            {entries.map((e) => (
              <ListButton key={e.id} testId="library-entry" active={pick.kind === "entry" && pick.id === e.id} onClick={() => choose({ kind: "entry", id: e.id })} title={e.name} detail={describe(e)} />
            ))}
          </div>
          <div className="flex flex-col gap-0.5">
            <h3 className="px-2 text-xs font-semibold">Generic</h3>
            {BUILTIN_CABINETS.map((c) => (
              <ListButton key={c.id} active={pick.kind === "builtin" && pick.id === c.id} onClick={() => choose({ kind: "builtin", id: c.id })} title={c.name} detail={describe(c)} />
            ))}
          </div>
        </nav>
        <div className="min-w-0">
          {pick.kind === "new" && (
            <EntryForm key={formKey} entry={null} initial={pick.from ?? EMPTY_CABINET_FORM} onSaved={(id) => choose({ kind: "entry", id })} onDeleted={() => undefined} onDuplicate={() => undefined} />
          )}
          {pick.kind === "entry" && entry && (
            <EntryForm key={formKey} entry={entry} initial={cabinetFormText(entry)} onSaved={() => undefined} onDeleted={() => choose({ kind: "new" })} onDuplicate={(from) => choose({ kind: "new", from })} />
          )}
          {pick.kind === "entry" && !entry && <p className="text-sm text-muted-foreground">That profile is no longer in the library.</p>}
          {builtin && <BuiltinView cabinet={builtin} onDuplicate={(from) => choose({ kind: "new", from })} />}
        </div>
      </div>
    </div>
  );
}
