"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Redo2, Undo2, X } from "lucide-react";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCabinetOptions } from "@/components/workspace/cabinet-options";
import { SelectField } from "@/components/workspace/fields";
import type { Id, Project } from "@/domain/model";
import { formatMm, parseMm, px } from "@/domain/units";
import { buildFastMap, MAX_GAP_PX, MAX_NEW_OUTPUTS, parseScreenList, sameContent, sizeLabel, swapOutputs, type ArrangeSettings, type FastMapBuild, type SizeChoice } from "@/engines/fast-map";
import * as ops from "@/engines/project-ops";
import { cn } from "@/lib/utils";
import { opContext, useApp } from "@/state/store";
import { useUi } from "@/state/ui-store";
import { fixAction, isTypingTarget } from "./keys";
import { useFastMapOpen } from "./open-store";
import { ContentPreview, OutputPreviews, StagePreview, type PreviewOptions } from "./previews";
import { sendToWall, wallLink, type WallResult } from "./wall-link";

const STEPS = ["Paste", "Arrange", "Fix"] as const;
type Step = 0 | 1 | 2;
type Tone = "ok" | "bad" | "warn" | "info";

const OUTPUT_SIZES = ["1280x720", "1920x1080", "2560x1440", "3840x2160"];
const EXAMPLE = "Centro 5x3 P2.6 500x500";

interface Session {
  step: Step;
  name: string;
  text: string;
  /** One size per written pitch, for lines that write none. */
  sizesIfMissing: readonly SizeChoice[];
  mode: "add" | "replace";
  gapPx: string;
  stageGapMm: string;
  output: string;
  outputs: string;
  selected: Id | null;
  command: "swap" | "same" | null;
  first: Id | null;
  note: { tone: Tone; text: string } | null;
  wall: WallResult | null;
  set(patch: Partial<Session>): void;
}

/** Fast map's own state: never saved, never undone. The project changes only through `edit()`. */
const useSession = create<Session>((set) => ({
  step: 0,
  name: "New show",
  text: "",
  sizesIfMissing: [],
  mode: "add",
  gapPx: "32",
  stageGapMm: "0",
  output: "1920x1080",
  outputs: "1",
  selected: null,
  command: null,
  first: null,
  note: null,
  wall: null,
  set: (patch) => set(patch),
}));

/** Fixed ids for previews, so a preview never touches the project's ids. */
function previewContext(prefix: string): ops.OpContext {
  let n = 0;
  return { newId: () => `${prefix}-${++n}`, now: () => "1970-01-01T00:00:00.000Z" };
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-secondary px-1.5 py-px font-mono text-[11px] text-foreground">{children}</kbd>;
}

function Note({ tone, children, live }: { tone: Tone; children: ReactNode; live?: boolean }) {
  return (
    <div
      role={live ? "status" : undefined}
      className={cn(
        "rounded border-l-[3px] bg-stage px-2.5 py-1.5 text-xs leading-snug",
        tone === "ok" && "border-l-signal",
        tone === "bad" && "border-l-destructive",
        tone === "warn" && "border-l-warn",
        tone === "info" && "border-l-muted-foreground",
      )}
    >
      {tone === "bad" && <span className="sr-only">Error: </span>}
      {children}
    </div>
  );
}

function NumberField({ label, value, onChange, min, max, suffix }: { label: string; value: string; onChange(v: string): void; min: number; max: number; suffix?: string }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5">
        <Input type="number" inputMode="numeric" min={min} max={max} value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-24 rounded px-2 text-[13px] tabular-nums md:text-[13px]" />
        {suffix && <span className="w-5 text-muted-foreground">{suffix}</span>}
      </span>
    </label>
  );
}

function readSettings(s: Session, mode: "add" | "replace"): ArrangeSettings | string {
  const gap = /^\d+$/.test(s.gapPx.trim()) ? Number(s.gapPx) : NaN;
  if (!Number.isSafeInteger(gap) || gap > MAX_GAP_PX) return `Space between screens must be a whole number of pixels from 0 to ${MAX_GAP_PX}.`;
  const stage = parseMm(s.stageGapMm);
  if (stage === null || stage < 0) return "Space on stage must be millimetres of 0 or more, with up to 3 decimals.";
  const count = /^\d+$/.test(s.outputs.trim()) ? Number(s.outputs) : NaN;
  const min = mode === "replace" ? 1 : 0;
  if (!Number.isSafeInteger(count) || count < min || count > MAX_NEW_OUTPUTS) return `Outputs must be a whole number from ${min} to ${MAX_NEW_OUTPUTS}.`;
  const [width, height] = s.output.split("x").map(Number);
  return { mode, gapPx: gap, stageGapUm: stage, output: { width, height }, newOutputs: count };
}

function numbersOf(project: Project | null): Map<Id, number> {
  return new Map((project?.physical.screens ?? []).map((s, i) => [s.id, i + 1]));
}

export default function FastMap() {
  const project = useApp((s) => s.project);
  const mapping = useApp((s) => s.mapping);
  const issues = useApp((s) => s.issues);
  const canUndo = useApp((s) => s.canUndo);
  const canRedo = useApp((s) => s.canRedo);
  const session = useSession();
  const cabinets = useCabinetOptions();
  const hide = useFastMapOpen((s) => s.hide);
  const hasScreens = (project?.physical.screens.length ?? 0) > 0;
  const mode: "add" | "replace" = hasScreens ? session.mode : "replace";

  // Opening on a project that already has screens starts at Fix; an empty one at Paste.
  useEffect(() => {
    useSession.getState().set({ step: hasScreens ? 2 : 0, selected: null, command: null, first: null, note: null, wall: null });
    // Only when Fast map opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Undo and redo on every step; the Fix step adds its own keys.
  useEffect(() => {
    if (session.step === 2) return;
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      const dialogOpen = !!ui.dialog || !!ui.confirm || !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');
      const action = fixAction({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, typing: isTypingTarget(e.target as Element | null), dialogOpen });
      if (action?.kind === "undo" || action?.kind === "redo") {
        e.preventDefault();
        history(action.kind);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session.step]);

  const parsed = useMemo(
    () => parseScreenList(session.text, { cabinets, sizesIfMissing: session.sizesIfMissing, takenNames: mode === "add" ? project?.physical.screens.map((s) => s.name) : [] }),
    [session.text, cabinets, session.sizesIfMissing, mode, project],
  );
  const settings = readSettings(session, mode);
  const preview: FastMapBuild | null = useMemo(() => {
    if (!parsed.ok || typeof settings === "string") return null;
    const base = project ?? ops.createProject({ name: session.name.trim() || "New show" }, previewContext("preview-project"));
    try {
      return buildFastMap(base, parsed.screens, settings, previewContext("preview-screen"));
    } catch {
      return null;
    }
  }, [parsed, settings, project, session.name]);

  const go = (step: Step) => session.set({ step, command: null, first: null, note: null });
  const close = () => {
    hide();
    if (useApp.getState().project) {
      useUi.getState().setStudio("mapping");
      // No saved viewport: the canvas fits the screens itself once it has measured its size.
      useApp.setState({ viewports: {} });
    }
  };

  const canArrange = parsed.ok;
  const canFix = hasScreens;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="fast-map">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-panel px-3">
        <h1 className="text-sm font-semibold whitespace-nowrap">Fast map</h1>
        <nav aria-label="Fast map steps" className="flex items-center gap-1">
          {STEPS.map((label, i) => {
            const enabled = i === 0 || (i === 1 && canArrange) || (i === 2 && canFix);
            return (
              <button
                key={label}
                type="button"
                disabled={!enabled}
                aria-current={session.step === i ? "step" : undefined}
                onClick={() => go(i as Step)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs whitespace-nowrap text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring enabled:hover:bg-accent disabled:opacity-45",
                  session.step === i && "bg-secondary text-foreground",
                )}
              >
                {i + 1} {label}
              </button>
            );
          })}
        </nav>
        <span className="min-w-0 truncate text-xs text-muted-foreground">{project ? project.meta.name : "No project yet"}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label={`Undo (${MOD}Z)`} title={`Undo (${MOD}Z)`} disabled={!canUndo} onClick={() => useApp.getState().undo()}><Undo2 /></Button>
          <Button variant="ghost" size="icon-sm" aria-label="Redo" title="Redo" disabled={!canRedo} onClick={() => useApp.getState().redo()}><Redo2 /></Button>
          <Button variant="outline" size="sm" className="ml-1 rounded" onClick={close}><X />{project ? "Back to Mapping" : "Close"}</Button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-r border-border bg-panel p-4 *:shrink-0" aria-label={`Step ${session.step + 1}: ${STEPS[session.step]}`}>
          {session.step === 0 && <PastePanel parsed={parsed} hasProject={!!project} screenCount={project?.physical.screens.length ?? 0} mode={mode} onNext={() => go(1)} />}
          {session.step === 1 && <ArrangePanel parsed={parsed} build={preview} settingsError={typeof settings === "string" ? settings : null} mode={mode} />}
          {session.step === 2 && project && mapping && <FixPanel project={project} />}
        </aside>
        <main className="min-h-0 overflow-y-auto bg-stage p-4" aria-label="Preview">
          <Previews step={session.step} build={preview} project={project} mapping={mapping} issuesCount={issues.filter((i) => i.severity === "error").length} />
        </main>
      </div>
    </div>
  );
}

function Previews({ step, build, project, mapping, issuesCount }: { step: Step; build: FastMapBuild | null; project: Project | null; mapping: ReturnType<typeof useApp.getState>["mapping"]; issuesCount: number }) {
  const session = useSession();
  if (step === 2 && project && mapping) {
    const options: PreviewOptions = { numbers: numbersOf(project), selected: new Set([session.selected, session.first].filter(Boolean) as Id[]) };
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        <ContentPreview mapping={mapping} options={options} />
        <OutputPreviews mapping={mapping} options={options} />
        <p className="text-xs text-muted-foreground xl:col-span-2">
          The numbers here are the screen order: SCR-01, SCR-02 and so on on the test card. {issuesCount > 0 ? `${issuesCount} ${issuesCount === 1 ? "error" : "errors"} in Checks.` : "No errors."}
        </p>
      </div>
    );
  }
  if (!build) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="max-w-sm text-center text-xs text-muted-foreground">Paste a screen list to see the stage, the content canvas and the outputs. Nothing is created until every line is valid and you choose to.</p>
      </div>
    );
  }
  const newIds = new Set(build.screenIds);
  const numbers = numbersOf(build.project);
  const hidden = new Set(build.mapping.screens.filter((s) => build.unplaced.includes(s.name) && newIds.has(s.screenId)).map((s) => s.screenId));
  const options: PreviewOptions = { numbers, selected: new Set(), hidden };
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="xl:col-span-2">
        <StagePreview mapping={build.mapping} options={options} />
      </div>
      <ContentPreview mapping={build.mapping} options={options} />
      <OutputPreviews mapping={build.mapping} options={options} />
      <p className="text-xs text-muted-foreground xl:col-span-2">Preview only. The project changes when you choose Create screens.</p>
    </div>
  );
}

function PastePanel({ parsed, hasProject, screenCount, mode, onNext }: { parsed: ReturnType<typeof parseScreenList>; hasProject: boolean; screenCount: number; mode: "add" | "replace"; onNext(): void }) {
  const session = useSession();
  const cabinetCount = parsed.screens.reduce((n, s) => n + s.columns * s.rows, 0);
  return (
    <>
      <div>
        <h2 className="text-sm font-semibold">Paste the screen list</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          One line is one row on stage, top to bottom. <Kbd>|</Kbd> separates screens side by side. Without any <Kbd>|</Kbd>, every line goes side by side. Write the name, columns x rows, the pitch, and the cabinet size in mm when it could be more than one: <span className="font-mono text-foreground">Cuchilla 1x2 500x1000 P3.9</span>
        </p>
      </div>
      {!hasProject && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Project name</span>
          <Input value={session.name} onChange={(e) => session.set({ name: e.target.value })} className="h-7 rounded px-2 text-[13px] md:text-[13px]" />
        </label>
      )}
      <textarea
        aria-label="Screen list"
        aria-describedby="fast-map-result"
        spellCheck={false}
        placeholder={EXAMPLE}
        value={session.text}
        onChange={(e) => session.set({ text: e.target.value })}
        className="min-h-44 w-full resize-y rounded border border-input bg-stage p-2.5 font-mono text-[13px] leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      {hasProject && screenCount > 0 && (
        <fieldset className="flex flex-col gap-1.5 text-xs">
          <legend className="mb-1 text-muted-foreground">This project already has {screenCount} {screenCount === 1 ? "screen" : "screens"}</legend>
          <label className="flex items-center gap-2"><input type="radio" name="fast-map-mode" checked={mode === "add"} onChange={() => session.set({ mode: "add" })} className="accent-[var(--primary)]" />Add these screens next to them</label>
          <label className="flex items-center gap-2"><input type="radio" name="fast-map-mode" checked={mode === "replace"} onChange={() => session.set({ mode: "replace" })} className="accent-[var(--primary)]" />Replace them (asks first, can be undone)</label>
        </fieldset>
      )}
      <div id="fast-map-result" className="flex flex-col gap-2" aria-live="polite">
        {parsed.missingSizes.map((m) => {
          const pitch = `P${formatMm(m.pitchUm)}`;
          const lines = `${m.lines} ${m.lines === 1 ? "line" : "lines"}`;
          const others = session.sizesIfMissing.filter((c) => c.pitchUm !== m.pitchUm);
          return m.chosen ? (
            <Note key={m.pitchUm} tone="info">
              {pitch}: {sizeLabel(m.chosen)}, applied to {lines} without a size.{" "}
              <button type="button" className="underline underline-offset-2 focus-visible:outline-2" onClick={() => session.set({ sizesIfMissing: others })}>Clear</button>
            </Note>
          ) : (
            <Note key={m.pitchUm} tone="warn">
              <p className="mb-1.5">{pitch} on {lines} has no cabinet size and fits more than one. Choose the size for all of them, or write it on each line:</p>
              <div className="flex flex-wrap gap-1.5">
                {m.sizes.map((size) => (
                  <Button key={`${size.widthUm}x${size.heightUm}`} variant="outline" size="xs" className="rounded" onClick={() => session.set({ sizesIfMissing: [...others, { pitchUm: m.pitchUm, size }] })}>
                    {sizeLabel(size)}
                  </Button>
                ))}
              </div>
            </Note>
          );
        })}
        {parsed.errors.length > 0 && (
          <ul className="flex flex-col gap-1.5" aria-label="Lines to fix">
            {parsed.errors.map((e, i) => (
              <li key={`${e.line}-${i}`}>
                <Note tone="bad"><span className="font-semibold">Line {e.line}.</span> {e.message}</Note>
              </li>
            ))}
          </ul>
        )}
        {parsed.screens.length > 0 && (
          <Note tone={parsed.ok ? "ok" : "info"}>
            {parsed.screens.length} {parsed.screens.length === 1 ? "screen" : "screens"} read, {cabinetCount} cabinets.{parsed.ok ? "" : " Fix every line before arranging."}
          </Note>
        )}
      </div>
      {parsed.screens.length > 0 && (
        <ol className="divide-y divide-border rounded border border-border text-xs">
          {parsed.screens.map((s, i) => (
            <li key={`${s.line}-${s.name}`} className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] gap-x-2 px-2 py-1.5">
              <span className="font-semibold text-signal tabular-nums">{i + 1}</span>
              <span className="truncate font-medium">{s.name}</span>
              <span className="text-muted-foreground tabular-nums">{s.widthPx}×{s.heightPx}</span>
              <span className="col-start-2 col-end-4 text-[11px] leading-snug text-muted-foreground">Line {s.line}: {s.columns}×{s.rows}, {s.cabinetNote}</span>
            </li>
          ))}
        </ol>
      )}
      <Button className="mt-auto rounded" disabled={!parsed.ok} onClick={onNext}>Arrange</Button>
    </>
  );
}

function ArrangePanel({ parsed, build, settingsError, mode }: { parsed: ReturnType<typeof parseScreenList>; build: FastMapBuild | null; settingsError: string | null; mode: "add" | "replace" }) {
  const session = useSession();
  const project = useApp((s) => s.project);
  const existing = project?.physical.screens.length ?? 0;
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const settings = readSettings(useSession.getState(), mode);
    if (typeof settings === "string") return;
    const run = async () => {
      setBusy(true);
      try {
        const app = useApp.getState();
        if (!app.project) await app.newProject({ name: useSession.getState().name.trim() || "New show" });
        let made: FastMapBuild | null = null;
        useApp.getState().edit((p) => {
          made = buildFastMap(p, parsed.screens, settings, opContext);
          if (!made.ready) throw new Error(made.blocking[0]);
          return made.project;
        });
        const result = made as FastMapBuild | null;
        const outputs = new Set(result?.mapping.screens.filter((s) => result.screenIds.includes(s.screenId)).map((s) => s.outputId)).size;
        useSession.getState().set({
          step: 2,
          mode: "replace",
          selected: null,
          command: null,
          first: null,
          note: { tone: "ok", text: `Created ${parsed.screens.length} screens in ${outputs} ${outputs === 1 ? "output" : "outputs"}, 1:1. Look at the wall: press a screen's number to choose it. ${MOD}Z undoes all of it.` },
        });
      } catch (error) {
        useSession.getState().set({ note: { tone: "bad", text: error instanceof Error ? error.message : String(error) } });
      } finally {
        setBusy(false);
      }
    };
    if (mode === "replace" && existing > 0) {
      useUi.getState().askConfirm({
        title: `Replace ${existing} ${existing === 1 ? "screen" : "screens"}?`,
        body: `This removes every screen, group, extra canvas and extra output in “${project!.meta.name}”, then creates the ${parsed.screens.length} screens from the list. Cabinets stay. One ${MOD}Z brings everything back.`,
        action: "Replace screens",
        onConfirm: run,
      });
    } else await run();
  };

  return (
    <>
      <div>
        <h2 className="text-sm font-semibold">Arrange</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Content keeps the stage shape. The outputs are packed 1:1, with no overlaps and nothing scaled. {mode === "add" ? "Screens already in the project stay exactly where they are." : ""}</p>
      </div>
      <SelectField label="Output size" value={session.output} items={OUTPUT_SIZES.map((v) => ({ value: v, label: v.replace("x", " × ") }))} onChange={(v) => session.set({ output: v })} />
      <NumberField label={mode === "add" ? "New outputs it may add" : "Outputs it may use"} value={session.outputs} onChange={(v) => session.set({ outputs: v })} min={mode === "add" ? 0 : 1} max={MAX_NEW_OUTPUTS} />
      <NumberField label="Space between screens, content" value={session.gapPx} onChange={(v) => session.set({ gapPx: v })} min={0} max={MAX_GAP_PX} suffix="px" />
      <NumberField label="Space between screens, stage" value={session.stageGapMm} onChange={(v) => session.set({ stageGapMm: v })} min={0} max={100000} suffix="mm" />
      <div className="flex flex-col gap-1.5" aria-live="polite">
        {settingsError && <Note tone="bad">{settingsError}</Note>}
        {!settingsError && build && build.ready && (
          <Note tone="ok">
            Everything fits: {build.mapping.screens.filter((s) => build.screenIds.includes(s.screenId)).length} screens in{" "}
            {new Set(build.mapping.screens.filter((s) => build.screenIds.includes(s.screenId)).map((s) => s.outputId)).size} of {build.mapping.outputs.length} {build.mapping.outputs.length === 1 ? "output" : "outputs"}, 1:1.
          </Note>
        )}
        {!settingsError && build && !build.ready && build.blocking.map((b, i) => <Note key={i} tone="bad">{b}</Note>)}
        {!settingsError && build && build.outputsNeeded !== null && build.outputsNeeded > 1 && !build.ready && build.unplaced.length > 0 && (
          <Button variant="outline" size="sm" className="self-start rounded" onClick={() => session.set({ outputs: String(build.outputsNeeded) })}>Use {build.outputsNeeded} outputs</Button>
        )}
        {session.note && session.step === 1 && <Note tone={session.note.tone} live>{session.note.text}</Note>}
      </div>
      <Button className="mt-auto rounded" disabled={!build?.ready || busy} onClick={() => void create()}>
        {mode === "replace" && existing > 0 ? "Replace screens…" : "Create screens"}
      </Button>
    </>
  );
}

function FixPanel({ project }: { project: Project }) {
  const session = useSession();
  const mapping = useApp((s) => s.mapping)!;
  const issues = useApp((s) => s.issues);
  const order = project.physical.screens.map((s) => s.id);
  const byId = new Map(mapping.screens.map((s) => [s.screenId, s]));
  const numbers = numbersOf(project);
  const errors = issues.filter((i) => i.severity === "error");
  const link = wallLink();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      const dialogOpen = !!ui.dialog || !!ui.confirm || !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');
      const action = fixAction({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, typing: isTypingTarget(e.target as Element | null), dialogOpen });
      if (!action) return;
      e.preventDefault();
      if (action.kind === "pick") pick(action.number);
      else if (action.kind === "swap") start("swap");
      else if (action.kind === "same") start("same");
      else if (action.kind === "nudge") nudge(action.dx, action.dy);
      else if (action.kind === "undo") history("undo");
      else if (action.kind === "redo") history("redo");
      else if (action.kind === "escape") {
        const s = useSession.getState();
        if (s.command) s.set({ command: null, first: null, note: null });
        else s.set({ selected: null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div>
        <h2 className="text-sm font-semibold">Fix on the wall</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Look at the wall: each screen shows its number on the test card. Choose a screen with its number, then fix it here.</p>
      </div>
      {session.command && (
        <Note tone="warn" live>
          {session.command === "swap" ? "Swap outputs" : "Same content"}: {session.first ? `${numbers.get(session.first)} ${byId.get(session.first)?.name} chosen. Now choose the second screen.` : session.command === "swap" ? "choose the first screen." : "choose the screen to copy from."} <Kbd>Esc</Kbd> cancels.
        </Note>
      )}
      {session.note && <Note tone={session.note.tone} live>{session.note.text}</Note>}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Fix actions">
        <Button variant="outline" size="sm" className="rounded" aria-pressed={session.command === "swap"} onClick={() => start("swap")}><Kbd>X</Kbd> Swap outputs</Button>
        <Button variant="outline" size="sm" className="rounded" aria-pressed={session.command === "same"} onClick={() => start("same")}><Kbd>T</Kbd> Same content</Button>
      </div>
      <ol className="divide-y divide-border overflow-hidden rounded border border-border" aria-label="Screens">
        {order.map((id, i) => {
          const s = byId.get(id);
          const pressed = session.selected === id || session.first === id;
          const output = s && mapping.outputs.find((o) => o.outputId === s.outputId);
          return (
            <li key={id}>
              <button
                type="button"
                aria-pressed={pressed}
                onClick={() => pick(i + 1)}
                className={cn("grid w-full grid-cols-[1.75rem_minmax(0,1fr)_auto] items-baseline gap-x-2 px-2 py-1.5 text-left text-xs hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring", pressed && "bg-primary/25 hover:bg-primary/30")}
              >
                <span className="font-semibold text-signal tabular-nums">{i + 1}</span>
                <span className="truncate font-medium">{s?.name ?? project.physical.screens[i].name}</span>
                <span className="text-muted-foreground tabular-nums">{s ? `${s.outputRect.width}×${s.outputRect.height}` : "unmapped"}</span>
                {s && <span className="col-start-2 col-end-4 text-[11px] text-muted-foreground tabular-nums">{output?.name}: {s.outputRect.x}, {s.outputRect.y}{s.followsContent ? ", follows content" : ""}</span>}
              </button>
            </li>
          );
        })}
      </ol>
      {errors.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold">{errors.length} {errors.length === 1 ? "error" : "errors"}</h3>
          {errors.slice(0, 4).map((e, i) => <Note key={i} tone="bad">{e.message}</Note>)}
        </div>
      )}
      <Note tone="info">
        {link ? `Sending each change to ${link.label}. ` : "Not connected to the wall: changes stay in this project. Update output in the Output studio sends them. "}
        {session.wall?.state === "held" ? session.wall.reason : session.wall?.state === "sent" ? "Last change sent." : ""}
      </Note>
      <p className="mt-auto text-[11px] leading-relaxed text-muted-foreground">
        <Kbd>1</Kbd>–<Kbd>9</Kbd> choose a screen. Arrows move its output 1 px, <Kbd>Shift</Kbd> 10 px. <Kbd>X</Kbd> swap, <Kbd>T</Kbd> same content, <Kbd>{MOD}Z</Kbd> undo, <Kbd>Esc</Kbd> cancel. Keys do nothing while you type in a field.
      </p>
    </>
  );
}

// ── Fix actions. Each change is one `edit()`, so one undo step, and is offered to the wall afterwards. ──────────────

function order(): Id[] {
  return useApp.getState().project?.physical.screens.map((s) => s.id) ?? [];
}

function nameOf(id: Id) {
  return useApp.getState().project?.physical.screens.find((s) => s.id === id)?.name ?? "That screen";
}

async function afterChange(touched: readonly Id[], ok: string) {
  const { project, mapping, issues } = useApp.getState();
  if (!project || !mapping) return;
  const problem = issues.find((i) => i.severity === "error" && i.screenIds.some((id) => touched.includes(id)));
  useSession.getState().set({ note: problem ? { tone: "bad", text: `${problem.message} It stays in the project until fixed; undo with ${MOD}Z.` } : { tone: "ok", text: ok } });
  const wall = await sendToWall(project, mapping, issues);
  useSession.getState().set({ wall });
}

function change(touched: readonly Id[], ok: string, edit: (p: Project) => Project, coalesce?: string) {
  try {
    const before = useApp.getState().project;
    useApp.getState().edit(edit, coalesce ? { coalesce } : undefined);
    if (useApp.getState().project === before) return;
    void afterChange(touched, ok);
  } catch (error) {
    useSession.getState().set({ note: { tone: "bad", text: error instanceof Error ? error.message : String(error) } });
  }
}

function start(command: "swap" | "same") {
  const s = useSession.getState();
  s.set({ command: s.command === command ? null : command, first: null, note: null });
}

function pick(n: number) {
  const id = order()[n - 1];
  if (!id) return;
  const s = useSession.getState();
  if (!s.command) {
    s.set({ selected: id, note: null });
    return;
  }
  if (!s.first) {
    s.set({ first: id });
    return;
  }
  const a = s.first;
  const command = s.command;
  s.set({ command: null, first: null, selected: id });
  if (command === "swap") change([a, id], `Swapped the outputs of ${nameOf(a)} and ${nameOf(id)}. Their content didn't move.`, (p) => swapOutputs(p, a, id));
  else change([a, id], `${nameOf(id)} now shows the same content as ${nameOf(a)}. Its output didn't move.`, (p) => sameContent(p, a, id));
}

function nudge(dx: number, dy: number) {
  const id = useSession.getState().selected;
  const screen = useApp.getState().mapping?.screens.find((s) => s.screenId === id);
  if (!id || !screen) {
    useSession.getState().set({ note: { tone: "info", text: "Choose a screen with its number first." } });
    return;
  }
  const x = screen.outputRect.x + dx;
  const y = screen.outputRect.y + dy;
  if (x < 0 || y < 0) {
    useSession.getState().set({ note: { tone: "warn", text: `${screen.name} is already at the ${x < 0 ? "left" : "top"} edge of its output.` } });
    return;
  }
  change([id], `${screen.name}: output at ${x}, ${y}.`, (p) => ops.setSlicePositions(p, [{ id, x: px(x), y: px(y) }]), `fast-map-nudge:${id}`);
}

function history(step: "undo" | "redo") {
  const app = useApp.getState();
  if (step === "undo" ? !app.canUndo : !app.canRedo) return;
  if (step === "undo") app.undo();
  else app.redo();
  useSession.getState().set({ command: null, first: null, note: { tone: "info", text: step === "undo" ? "Undone." : "Redone." } });
  void afterChange([], step === "undo" ? "Undone." : "Redone.");
}
