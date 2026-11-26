"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Download, FileUp, PenLine, Plus, Trash2, X } from "lucide-react";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCabinetOptions } from "@/components/workspace/cabinet-options";
import { SelectField } from "@/components/workspace/fields";
import type { CabinetProfile, Id } from "@/domain/model";
import { mmToUm, px, um } from "@/domain/units";
import {
  buildGuidedProject,
  drawnScreen,
  EMPTY_GUIDED_RECORD,
  formatUm,
  GUIDED_MODULE_ID,
  GUIDED_MODULE_VERSION,
  guidedOutputsNeeded,
  layoutFromProposal,
  MAX_OUTPUTS,
  OUTPUT_CHOICES,
  outputChoice,
  parseDimension,
  parseGuidedRecord,
  readDrawing,
  reconcileGaps,
  sizeScreens,
  typed,
  type DrawingBox,
  type DrawingPage,
  type GuidedBuild,
  type GuidedRecord,
  type ProposedScreen,
  type Rounding,
  type Sourced,
  type ScreenSizing,
} from "@/engines/guided-led";
import * as ops from "@/engines/project-ops";
import { cn } from "@/lib/utils";
import { readModuleData } from "@/modules/module-data";
import { opContext, useApp } from "@/state/store";
import { useUi } from "@/state/ui-store";
import { useCalibrationFont } from "../calibration/calibration-view";
import { screenLetter } from "../calibration/from-mapping";
import { OutputPreviews, StagePreview } from "../fast-map/previews";
import { guidedCards } from "./cards";
import { DrawingView } from "./drawing-view";
import { cardPng, download, pixelMapPngs, zipFiles, type PngFile } from "./export";
import { loadMedia, saveMedia } from "./media-store";
import { useGuidedLedOpen } from "./open-store";

const STEPS = ["Drawing", "Screens", "Questions", "Review", "Export"] as const;
type Step = 0 | 1 | 2 | 3 | 4;
type Tone = "ok" | "bad" | "warn" | "info";

interface Session extends GuidedRecord {
  step: Step;
  projectName: string;
  fileUrl: string | null;
  page: DrawingPage | null;
  notes: readonly string[];
  renderUrl: string | null;
  renderName: string | null;
  showRender: boolean;
  selected: string | null;
  drawMode: boolean;
  fileName: string | null;
  only: Id | null;
  busy: string | null;
  error: string | null;
  custom: { name: string; widthMm: string; heightMm: string; pixelsX: string; pixelsY: string } | null;
  set(patch: Partial<Session>): void;
}

const START: Omit<Session, "set"> = {
  ...EMPTY_GUIDED_RECORD,
  step: 0,
  projectName: "",
  fileUrl: null,
  page: null,
  notes: [],
  renderUrl: null,
  renderName: null,
  showRender: false,
  selected: null,
  drawMode: false,
  fileName: null,
  only: null,
  busy: null,
  error: null,
  custom: null,
};

const useSession = create<Session>((set) => ({ ...START, set: (patch) => set(patch) }));

/** Fixed ids for previews, so a preview never touches the project's ids. */
function previewContext(prefix: string): ops.OpContext {
  let n = 0;
  return { newId: () => `${prefix}-${++n}`, now: () => "1970-01-01T00:00:00.000Z" };
}

const CUSTOM_ID = "guided-custom";

function recordOf(s: Session): GuidedRecord {
  return {
    drawing: s.page ? { fileName: s.fileName ?? "drawing", kind: s.page.kind, width: s.page.width, height: s.page.height } : s.drawing,
    screens: s.screens,
    gaps: s.gaps,
    accepted: s.accepted,
    sameCabinet: s.sameCabinet,
    cabinetIds: s.cabinetIds,
    rounding: s.rounding,
    outputChoice: s.outputChoice,
    outputSize: s.outputSize,
    outputCount: s.outputCount,
    assignment: s.assignment,
  };
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

const SOURCE_LABEL: Record<Sourced<unknown>["source"], string> = { read: "Read", typed: "Typed", guessed: "Guessed", missing: "Missing" };

function SourceBadge({ value, accepted }: { value: Sourced<unknown>; accepted?: boolean }) {
  const label = value.source === "guessed" && accepted ? "Accepted" : SOURCE_LABEL[value.source];
  return (
    <span
      title={value.note}
      className={cn(
        "rounded px-1.5 py-px text-[10px] font-semibold tracking-wide uppercase",
        value.source === "read" && "bg-signal/15 text-signal",
        value.source === "typed" && "bg-secondary text-foreground",
        value.source === "guessed" && (accepted ? "bg-secondary text-foreground" : "bg-warn/15 text-warn"),
        value.source === "missing" && "bg-destructive/15 text-destructive",
      )}
    >
      {label}
    </span>
  );
}

/** A size in metres or millimetres, as on a drawing: `3.5`, `3,50 m`, `6000`. */
function DimField({ label, value, onCommit, accepted, onAccept }: { label: string; value: Sourced<number>; onCommit(um: number): void; accepted?: boolean; onAccept?(): void }) {
  const shown = value.value === null ? "" : formatUm(value.value);
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  // A new value from outside (read, accepted, typed elsewhere) replaces what is in the field.
  const [prev, setPrev] = useState(shown);
  if (prev !== shown) {
    setPrev(shown);
    setText(shown);
  }
  const commit = () => {
    if (text.trim() === shown) return setError(null);
    const d = parseDimension(text);
    if (!d) return setError("Type a size such as 3.5, 3,50 m or 6000 mm.");
    setError(null);
    onCommit(d.um);
  };
  return (
    <div className="flex flex-col gap-0.5">
      <label className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {label} <SourceBadge value={value} accepted={accepted} />
        </span>
        <span className="flex items-center gap-1">
          {value.source === "guessed" && !accepted && onAccept && (
            <Button size="xs" variant="outline" className="h-6 rounded px-1.5 text-[11px]" onClick={onAccept} aria-label={`Accept ${label.toLowerCase()} ${shown}`}>
              <Check />Yes
            </Button>
          )}
          <Input
            value={text}
            placeholder="Missing"
            aria-label={label}
            aria-invalid={!!error || value.source === "missing"}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && commit()}
            className="h-7 w-24 rounded px-2 text-[13px] tabular-nums md:text-[13px]"
          />
        </span>
      </label>
      {value.note && value.source !== "typed" && <span className="text-[11px] text-muted-foreground">{value.note}</span>}
      {error && <span className="text-[11px] text-destructive" role="alert">{error}</span>}
    </div>
  );
}

function cabinetSummary(c: CabinetProfile): string {
  return `${formatUm(c.widthUm)} × ${formatUm(c.heightUm)}, ${c.pixelsX} × ${c.pixelsY} px per cabinet, pitch ${(c.nominalPitchUm / 1000).toFixed(2)} mm (nominal)`;
}

function customCabinet(c: Session["custom"]): CabinetProfile | string {
  if (!c) return "Fill in the custom cabinet.";
  const n = (v: string, what: string, max: number) => {
    const x = Number(v);
    if (!/^\d+$/.test(v.trim()) || x < 1 || x > max) throw new Error(`${what} must be a whole number from 1 to ${max}.`);
    return x;
  };
  try {
    const name = c.name.trim();
    if (!name) return "Name the custom cabinet.";
    const w = n(c.widthMm, "Width", 5000);
    const h = n(c.heightMm, "Height", 5000);
    const x = n(c.pixelsX, "Pixels across", 4096);
    const y = n(c.pixelsY, "Pixels down", 4096);
    return { id: `${CUSTOM_ID}-${w}x${h}-${x}x${y}`, name, widthUm: mmToUm(w), heightUm: mmToUm(h), pixelsX: px(x), pixelsY: px(y), nominalPitchUm: um(Math.round(mmToUm(w) / x)), source: "custom" };
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export default function GuidedLed() {
  const project = useApp((s) => s.project);
  const mapping = useApp((s) => s.mapping);
  const session = useSession();
  const fresh = useGuidedLedOpen((s) => s.fresh);
  const hide = useGuidedLedOpen((s) => s.hide);
  const options = useCabinetOptions();
  const fileInput = useRef<HTMLInputElement>(null);
  const renderInput = useRef<HTMLInputElement>(null);

  // On open: a fresh start, or the current project's saved answers and this computer's drawing.
  useEffect(() => {
    const s = useSession.getState();
    if (s.fileUrl) URL.revokeObjectURL(s.fileUrl);
    if (s.renderUrl) URL.revokeObjectURL(s.renderUrl);
    useSession.setState({ ...START });
    const p = useApp.getState().project;
    if (fresh || !p) return;
    const record = readModuleData(p, GUIDED_MODULE_ID, parseGuidedRecord);
    useSession.setState({ ...(record ?? EMPTY_GUIDED_RECORD), projectName: p.meta.name, step: record?.screens.length ? (p.physical.screens.length ? 4 : 1) : 0 });
    void (async () => {
      try {
        const media = await loadMedia(p.id, "drawing");
        if (media) await showDrawing(media.bytes, media.name, false);
        const render = await loadMedia(p.id, "render");
        if (render) useSession.setState({ renderUrl: URL.createObjectURL(render.bytes), renderName: render.name });
        if (!media && record?.drawing) useSession.setState({ notes: [`The drawing “${record.drawing.fileName}” is kept on the computer it was opened on, not in the project file, so it isn't shown here.`] });
      } catch (e) {
        useSession.setState({ error: `The drawing couldn't be loaded from this computer: ${e instanceof Error ? e.message : String(e)}` });
      }
    })();
    // Only when the flow opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accepted = useMemo(() => new Set(session.accepted), [session.accepted]);
  const layout = useMemo(() => layoutFromProposal(session.screens, session.gaps, accepted), [session.screens, session.gaps, accepted]);
  const cabinetFor = (id: string | undefined): CabinetProfile | null => {
    if (!id) return null;
    if (id.startsWith(CUSTOM_ID)) {
      const c = customCabinet(session.custom);
      return typeof c === "string" ? (options.find((o) => o.cabinet.id === id)?.cabinet ?? null) : c;
    }
    return options.find((o) => o.cabinet.id === id)?.cabinet ?? null;
  };
  const answers = layout.ok
    ? { cabinets: Object.fromEntries(layout.screens.flatMap((s) => { const c = cabinetFor(session.sameCabinet ? session.cabinetIds["*"] : session.cabinetIds[s.key]); return c ? [[s.key, c]] : []; })), rounding: session.rounding }
    : null;
  const sizing = layout.ok && answers ? sizeScreens(layout.screens, answers) : null;
  const choice = session.outputChoice ? outputChoice(session.outputChoice) : undefined;
  const outSize = choice?.size ?? session.outputSize;
  const sized: readonly ScreenSizing[] | null = sizing?.ok ? sizing.screens : null;
  const needed = sized && outSize ? guidedOutputsNeeded(sized, outSize) : null;
  const count = session.outputCount ?? needed ?? 1;
  const preview: GuidedBuild | null = useMemo(() => {
    if (!sized || !outSize) return null;
    const base = ops.createProject({ name: "Preview" }, previewContext("preview-project"));
    try {
      return buildGuidedProject(base, sized, { ...outSize, count, assignment: session.assignment }, previewContext("preview-screen"));
    } catch {
      return null;
    }
  }, [sized, outSize, count, session.assignment]);

  const questionsDone = layout.ok && !!sized && !!outSize;
  const built = !!project && project.physical.screens.length > 0 && !!readModuleData(project, GUIDED_MODULE_ID, parseGuidedRecord);
  const enabled = (i: number) => i === 0 || (i === 1 && !!session.page) || (i === 2 && session.screens.length > 0) || (i === 3 && questionsDone) || (i === 4 && built);

  const go = (step: Step) => session.set({ step, drawMode: false, error: null });
  const close = () => {
    const s = useSession.getState();
    const p = useApp.getState().project;
    // Answers given so far are kept with the project, as one undo step, unless nothing changed.
    if (p && s.screens.length) {
      const now = recordOf(s);
      const saved = readModuleData(p, GUIDED_MODULE_ID, parseGuidedRecord);
      if (JSON.stringify(saved) !== JSON.stringify(now)) useApp.getState().edit((q) => ops.setModuleData(q, GUIDED_MODULE_ID, GUIDED_MODULE_VERSION, now));
    }
    hide();
    if (p) {
      useUi.getState().setStudio("mapping");
      useApp.setState({ viewports: {} });
    }
  };

  async function showDrawing(bytes: Blob, name: string, read: boolean) {
    const isPdf = bytes.type === "application/pdf" || /\.pdf$/i.test(name);
    let page: DrawingPage;
    let url: string;
    const notes: string[] = [];
    if (isPdf) {
      const { readPdf } = await import("./pdf-reader");
      const pdf = await readPdf(new Uint8Array(await bytes.arrayBuffer()));
      try {
        const canvas = document.createElement("canvas");
        await pdf.render(canvas, Math.min(3, 3000 / pdf.page.width));
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
        if (!blob) throw new Error("The browser couldn't show the PDF.");
        url = URL.createObjectURL(blob);
        page = pdf.page;
        if (pdf.pageCount > 1) notes.push(`Only the first of ${pdf.pageCount} pages is read.`);
      } finally {
        await pdf.destroy();
      }
    } else {
      url = URL.createObjectURL(bytes);
      const img = new Image();
      img.src = url;
      await img.decode().catch(() => {
        throw new Error("This image can't be opened. Use a PNG or JPEG.");
      });
      page = { kind: "raster", width: img.naturalWidth, height: img.naturalHeight, texts: [], rects: [] };
    }
    const old = useSession.getState().fileUrl;
    if (old) URL.revokeObjectURL(old);
    if (read) {
      const proposal = readDrawing(page);
      useSession.setState({ fileUrl: url, page, screens: proposal.screens, gaps: proposal.gaps, accepted: [], assignment: {}, notes: [...notes, ...proposal.notes], selected: proposal.screens[0]?.key ?? null, drawMode: page.kind === "raster", fileName: name });
    } else {
      useSession.setState({ fileUrl: url, page, notes, fileName: name });
    }
  }

  const chooseDrawing = async (file: File) => {
    const ok = file.type === "application/pdf" || /\.pdf$/i.test(file.name) || /^image\/(png|jpeg)$/.test(file.type);
    if (!ok) return session.set({ error: "Choose a PDF, PNG or JPEG drawing." });
    session.set({ busy: "Reading the drawing…", error: null });
    try {
      const app = useApp.getState();
      if (useGuidedLedOpen.getState().fresh || !app.project) {
        await app.newProject({ name: useSession.getState().projectName.trim() || file.name.replace(/\.[^.]+$/, "") || "New LED project" });
        useGuidedLedOpen.setState({ fresh: false });
      }
      const id = useApp.getState().project!.id;
      await showDrawing(file, file.name, true);
      await saveMedia(id, "drawing", { name: file.name, type: file.type || "application/octet-stream", bytes: file, savedAt: new Date().toISOString() });
      useSession.setState({ projectName: useApp.getState().project!.meta.name, step: 1 });
    } catch (e) {
      session.set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      session.set({ busy: null });
    }
  };

  const chooseRender = async (file: File) => {
    const p = useApp.getState().project;
    if (!p) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return session.set({ error: "Choose a PNG, JPEG or WebP render." });
    try {
      await saveMedia(p.id, "render", { name: file.name, type: file.type, bytes: file, savedAt: new Date().toISOString() });
      const old = useSession.getState().renderUrl;
      if (old) URL.revokeObjectURL(old);
      session.set({ renderUrl: URL.createObjectURL(file), renderName: file.name, error: null });
    } catch (e) {
      session.set({ error: `The render couldn't be kept on this computer: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const highlight = session.step === 2 && !layout.ok ? (layout.questions[0]?.about ?? []) : [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="guided-led">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-panel px-3">
        <h1 className="text-sm font-semibold whitespace-nowrap">Guided LED setup</h1>
        <nav aria-label="Guided setup steps" className="flex items-center gap-1">
          {STEPS.map((label, i) => (
            <button
              key={label}
              type="button"
              disabled={!enabled(i)}
              aria-current={session.step === i ? "step" : undefined}
              onClick={() => go(i as Step)}
              className={cn(
                "rounded px-2.5 py-1 text-xs whitespace-nowrap text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring enabled:hover:bg-accent disabled:opacity-45",
                session.step === i && "bg-secondary text-foreground",
              )}
            >
              {i + 1} {label}
            </button>
          ))}
        </nav>
        <span className="min-w-0 truncate text-xs text-muted-foreground">{project && !fresh ? project.meta.name : "New LED project"}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" className="ml-1 rounded" onClick={close}><X />{project && !fresh ? "Back to Mapping" : "Close"}</Button>
        </div>
      </header>
      <input ref={fileInput} type="file" accept="application/pdf,.pdf,image/png,image/jpeg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void chooseDrawing(f); }} />
      <input ref={renderInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void chooseRender(f); }} />
      <div className="grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-r border-border bg-panel p-4 *:shrink-0" aria-label={`Step ${session.step + 1}: ${STEPS[session.step]}`}>
          {session.error && <Note tone="bad" live>{session.error}</Note>}
          {session.busy && <Note tone="info" live>{session.busy}</Note>}
          {session.step === 0 && <DrawingPanel fresh={fresh || !project} onChoose={() => fileInput.current?.click()} onRender={() => renderInput.current?.click()} />}
          {session.step === 1 && <ScreensPanel onNext={() => go(2)} />}
          {session.step === 2 && <QuestionsPanel layout={layout} sizing={sizing} needed={needed} count={count} onNext={() => go(3)} />}
          {session.step === 3 && <ReviewPanel preview={preview} sized={sized} count={count} onDone={() => go(4)} />}
          {session.step === 4 && project && mapping && <ExportPanel />}
        </aside>
        <main className="min-h-0 overflow-y-auto bg-stage p-4" aria-label="Preview">
          {(session.step === 1 || session.step === 2) && session.page && session.fileUrl && (
            <div className="flex flex-col gap-3">
              <DrawingView
                src={session.fileUrl}
                width={session.page.width}
                height={session.page.height}
                screens={session.screens}
                selected={session.selected}
                highlight={highlight}
                drawing={session.drawMode && session.step === 1}
                onSelect={(key) => session.set({ selected: key })}
                onDraw={(box) => addScreen(box)}
              />
              {session.showRender && session.renderUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- a local object URL
                <img src={session.renderUrl} alt={`Render: ${session.renderName ?? ""}`} className="w-full rounded" />
              )}
            </div>
          )}
          {session.step === 0 && <Intro />}
          {session.step === 3 && preview && <ReviewPreview build={preview} />}
          {session.step === 4 && mapping && <ExportPreview />}
        </main>
      </div>
    </div>
  );
}

function addScreen(box: DrawingBox) {
  const s = useSession.getState();
  const screen = drawnScreen(s.screens, box);
  const screens = [...s.screens, screen];
  s.set({ screens, gaps: reconcileGaps(screens, s.gaps, s.page?.width ?? box.width), selected: screen.key });
}

function updateScreen(key: string, patch: Partial<ProposedScreen>) {
  const s = useSession.getState();
  const screens = s.screens.map((x) => (x.key === key ? { ...x, ...patch } : x));
  s.set({ screens, gaps: reconcileGaps(screens, s.gaps, s.page?.width ?? 1) });
}

function accept(id: string) {
  const s = useSession.getState();
  if (!s.accepted.includes(id)) s.set({ accepted: [...s.accepted, id] });
}

function Intro() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3 pt-10 text-sm text-muted-foreground">
      <p className="text-base text-foreground">From the drawing to a test card, for LED screens.</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Open the constructivo: a PDF or an image.</li>
        <li>Check the screens found on it, and draw any that are missing.</li>
        <li>Answer what the drawing doesn&apos;t say: cabinet, rounding, processor.</li>
        <li>Review the layout and the processor pixel map.</li>
        <li>Export the pixel map and test cards as PNG.</li>
      </ol>
      <p>Every value comes from the drawing or from you. Nothing is filled in without saying so.</p>
    </div>
  );
}

function DrawingPanel({ fresh, onChoose, onRender }: { fresh: boolean; onChoose(): void; onRender(): void }) {
  const session = useSession();
  return (
    <>
      <h2 className="text-sm font-semibold">Open the drawing</h2>
      {fresh && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Project name</span>
          <Input value={session.projectName} placeholder="From the file name" onChange={(e) => session.set({ projectName: e.target.value })} className="h-8 rounded text-[13px] md:text-[13px]" />
        </label>
      )}
      <Button className="rounded" onClick={onChoose} disabled={!!session.busy}><FileUp />{session.page ? "Open another drawing" : "Open drawing (PDF or image)"}</Button>
      {fresh && <p className="text-xs text-muted-foreground">Opening a drawing creates a new, empty project.</p>}
      {session.page && (
        <Note tone={session.page.kind === "vector" ? "ok" : "warn"}>
          {session.page.kind === "vector"
            ? `Vector PDF: ${session.screens.length} ${session.screens.length === 1 ? "screen" : "screens"} found. Check them in the next step.`
            : "An image: nothing can be read from it automatically. Draw each screen on it and type its size."}
        </Note>
      )}
      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        <span className="text-xs font-semibold">Render (optional)</span>
        <p className="text-xs text-muted-foreground">A picture of the stage, shown next to the drawing as a reference. Nothing is read from it.</p>
        <Button variant="outline" size="sm" className="rounded" onClick={onRender} disabled={!session.page}>{session.renderName ? `Replace render (${session.renderName})` : "Add a render"}</Button>
      </div>
      <Note tone="info">The drawing and the render stay on this computer only, not in the project file. The project file keeps the screens and your answers.</Note>
      {session.page && <Button variant="outline" className="rounded" onClick={() => session.set({ step: 1 })}>Next: screens</Button>}
    </>
  );
}

function ScreensPanel({ onNext }: { onNext(): void }) {
  const session = useSession();
  const accepted = new Set(session.accepted);
  const ordered = [...session.screens].sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y);
  const name = (key: string) => {
    const s = ordered.find((x) => x.key === key);
    return s?.name.value?.trim() || `Screen ${ordered.indexOf(s!) + 1}`;
  };
  const addWithoutDrawing = () => {
    const last = ordered.at(-1);
    const w = session.page ? session.page.width / 12 : 100;
    addScreen(last ? { x: Math.min(last.rect.x + last.rect.width + w / 4, (session.page?.width ?? 1000) - w), y: last.rect.y, width: w, height: last.rect.height } : { x: w, y: w, width: w, height: w / 2 });
  };
  return (
    <>
      <h2 className="text-sm font-semibold">Screens on the drawing</h2>
      {session.notes.map((n) => <Note key={n} tone="info">{n}</Note>)}
      <p className="text-[11px] text-muted-foreground">Read: from a label on the drawing. Guessed: proposed from the drawing, needs your yes. Typed: by you. Missing: still needed.</p>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant={session.drawMode ? "default" : "outline"} className="rounded" aria-pressed={session.drawMode} onClick={() => session.set({ drawMode: !session.drawMode })}><PenLine />{session.drawMode ? "Drawing: drag on the drawing" : "Draw a screen"}</Button>
        <Button size="sm" variant="outline" className="rounded" onClick={addWithoutDrawing}><Plus />Add without drawing</Button>
      </div>
      {ordered.length === 0 && <Note tone="warn">No screens yet. Draw each screen on the drawing.</Note>}
      <ol className="flex flex-col gap-2" aria-label="Screens">
        {ordered.map((s, i) => (
          <li key={s.key} className={cn("flex flex-col gap-1.5 rounded border border-border p-2", session.selected === s.key && "border-signal")} onFocusCapture={() => session.set({ selected: s.key })}>
            <div className="flex items-center gap-2">
              <span className="w-5 text-xs font-semibold tabular-nums">{i + 1}</span>
              <Input
                aria-label={`Screen ${i + 1} name`}
                value={s.name.value ?? ""}
                placeholder="Name"
                onChange={(e) => updateScreen(s.key, { name: typed(e.target.value) })}
                className="h-7 flex-1 rounded px-2 text-[13px] md:text-[13px]"
              />
              <SourceBadge value={s.name} />
              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${s.name.value ?? `screen ${i + 1}`} from the proposal`} onClick={() => {
                const screens = session.screens.filter((x) => x.key !== s.key);
                session.set({ screens, gaps: reconcileGaps(screens, session.gaps, session.page?.width ?? 1), selected: null });
              }}><Trash2 /></Button>
            </div>
            <DimField label="Width" value={s.width} accepted={accepted.has(`width:${s.key}`)} onAccept={() => accept(`width:${s.key}`)} onCommit={(v) => updateScreen(s.key, { width: typed(v) })} />
            <DimField label="Height" value={s.height} accepted={accepted.has(`height:${s.key}`)} onAccept={() => accept(`height:${s.key}`)} onCommit={(v) => updateScreen(s.key, { height: typed(v) })} />
            <DimField label="Top below the highest" value={s.top} accepted={accepted.has(`top:${s.key}`)} onAccept={() => accept(`top:${s.key}`)} onCommit={(v) => updateScreen(s.key, { top: typed(v) })} />
          </li>
        ))}
      </ol>
      {session.gaps.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <span className="text-xs font-semibold">Gaps, left to right</span>
          {session.gaps.map((g) => {
            const id = `gap:${g.left}:${g.right}`;
            return (
              <DimField
                key={id}
                label={`${name(g.left)} → ${name(g.right)}`}
                value={g.um}
                accepted={accepted.has(id)}
                onAccept={() => accept(id)}
                onCommit={(v) => session.set({ gaps: session.gaps.map((x) => (x === g ? { ...x, um: typed(v) } : x)) })}
              />
            );
          })}
        </div>
      )}
      {session.renderUrl && (
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={session.showRender} onChange={(e) => session.set({ showRender: e.target.checked })} /> Show the render under the drawing
        </label>
      )}
      <Button className="rounded" onClick={onNext} disabled={ordered.length === 0}>Next: questions</Button>
    </>
  );
}

function QuestionsPanel({ layout, sizing, needed, count, onNext }: { layout: ReturnType<typeof layoutFromProposal>; sizing: ReturnType<typeof sizeScreens> | null; needed: number | null; count: number; onNext(): void }) {
  const session = useSession();
  const options = useCabinetOptions();
  const items = [...options.map((o) => ({ value: o.cabinet.id, label: o.cabinet.name, group: o.group })), { value: CUSTOM_ID, label: "Custom cabinet…", group: "Other" }];
  const n = session.screens.length;
  const choice = session.outputChoice ? outputChoice(session.outputChoice) : undefined;
  const pick = (id: string) => options.find((o) => o.cabinet.id === id)?.cabinet;
  const custom = customCabinet(session.custom);
  const setCabinet = (key: string, value: string) => {
    if (value === CUSTOM_ID) {
      const c = session.custom ?? { name: "Custom cabinet", widthMm: "", heightMm: "", pixelsX: "", pixelsY: "" };
      const made = customCabinet(c);
      session.set({ custom: c, cabinetIds: { ...session.cabinetIds, [key]: typeof made === "string" ? CUSTOM_ID : made.id } });
    } else session.set({ cabinetIds: { ...session.cabinetIds, [key]: value } });
  };
  const updateCustom = (patch: Partial<NonNullable<Session["custom"]>>) => {
    const c = { ...session.custom!, ...patch };
    const made = customCabinet(c);
    const id = typeof made === "string" ? CUSTOM_ID : made.id;
    session.set({ custom: c, cabinetIds: Object.fromEntries(Object.entries(session.cabinetIds).map(([k, v]) => [k, v.startsWith(CUSTOM_ID) ? id : v])) });
  };
  const usesCustom = Object.values(session.cabinetIds).some((v) => v.startsWith(CUSTOM_ID));
  const cabinetSelect = (key: string, label?: string) => {
    const value = session.cabinetIds[key];
    const cab = value?.startsWith(CUSTOM_ID) ? (typeof custom === "string" ? null : custom) : value ? pick(value) : null;
    return (
      <div key={key} className="flex flex-col gap-1">
        {!value && <span className="text-[11px] text-warn">Choose a cabinet.</span>}
        <SelectField label={label} ariaLabel={label ?? "Cabinet"} value={value?.startsWith(CUSTOM_ID) ? CUSTOM_ID : (value ?? "")} items={items} onChange={(v) => setCabinet(key, v)} />
        {cab && <span className="text-[11px] text-muted-foreground">{cabinetSummary(cab)}. Confirm against the supplier&apos;s sheet.</span>}
      </div>
    );
  };

  return (
    <>
      <h2 className="text-sm font-semibold">Questions</h2>
      <section className="flex flex-col gap-2" aria-label="Drawing questions">
        {layout.ok ? (
          <Note tone="ok">Every size and gap is known.</Note>
        ) : (
          layout.questions.map((q) => {
            const screen = session.screens.find((s) => s.key === q.about[0]);
            const gap = q.field === "gap" ? session.gaps.find((g) => g.left === q.about[0] && g.right === q.about[1]) : undefined;
            const value: Sourced<number> | null = gap ? gap.um : screen && (q.field === "width" || q.field === "height" || q.field === "top") ? screen[q.field] : null;
            return (
              <div key={q.id} className="flex flex-col gap-1 rounded border border-warn/50 p-2">
                <span className="text-xs">{q.text}</span>
                {value && (
                  <DimField
                    label="Answer"
                    value={value}
                    onAccept={() => accept(q.id)}
                    onCommit={(v) => {
                      if (gap) session.set({ gaps: session.gaps.map((g) => (g === gap ? { ...g, um: typed(v) } : g)) });
                      else if (screen) updateScreen(screen.key, { [q.field]: typed(v) });
                    }}
                  />
                )}
                {q.field === "name" && screen && <Input aria-label="Screen name" placeholder="Name" defaultValue={screen.name.value ?? ""} onBlur={(e) => updateScreen(screen.key, { name: typed(e.target.value) })} className="h-7 rounded text-[13px] md:text-[13px]" />}
              </div>
            );
          })
        )}
      </section>

      {layout.ok && (
        <section className="flex flex-col gap-2 border-t border-border pt-3" aria-label="Cabinet">
          <span className="text-xs font-semibold">{n === 1 ? "Which cabinet?" : `Do the ${n} screens use the same cabinet?`}</span>
          {n > 1 && (
            <div className="flex gap-1.5" role="radiogroup" aria-label="Same cabinet">
              {[true, false].map((v) => (
                <Button key={String(v)} size="sm" role="radio" aria-checked={session.sameCabinet === v} variant={session.sameCabinet === v ? "default" : "outline"} className="rounded" onClick={() => session.set({ sameCabinet: v })}>{v ? "Yes" : "No"}</Button>
              ))}
            </div>
          )}
          {session.sameCabinet || n === 1 ? cabinetSelect("*") : layout.screens.map((s) => cabinetSelect(s.key, s.name))}
          {usesCustom && session.custom && (
            <div className="grid grid-cols-2 gap-1.5 rounded border border-border p-2 text-xs">
              <label className="col-span-2 flex flex-col gap-0.5">Name<Input value={session.custom.name} onChange={(e) => updateCustom({ name: e.target.value })} className="h-7 rounded text-[13px] md:text-[13px]" /></label>
              <label className="flex flex-col gap-0.5">Width, mm<Input inputMode="numeric" value={session.custom.widthMm} onChange={(e) => updateCustom({ widthMm: e.target.value })} className="h-7 rounded text-[13px] md:text-[13px]" /></label>
              <label className="flex flex-col gap-0.5">Height, mm<Input inputMode="numeric" value={session.custom.heightMm} onChange={(e) => updateCustom({ heightMm: e.target.value })} className="h-7 rounded text-[13px] md:text-[13px]" /></label>
              <label className="flex flex-col gap-0.5">Pixels across<Input inputMode="numeric" value={session.custom.pixelsX} onChange={(e) => updateCustom({ pixelsX: e.target.value })} className="h-7 rounded text-[13px] md:text-[13px]" /></label>
              <label className="flex flex-col gap-0.5">Pixels down<Input inputMode="numeric" value={session.custom.pixelsY} onChange={(e) => updateCustom({ pixelsY: e.target.value })} className="h-7 rounded text-[13px] md:text-[13px]" /></label>
              {typeof custom === "string" && <span className="col-span-2 text-destructive" role="alert">{custom}</span>}
            </div>
          )}
        </section>
      )}

      {sizing && !sizing.ok && sizing.choices.length > 0 && (
        <section className="flex flex-col gap-2 border-t border-border pt-3" aria-label="Sizes that aren't whole cabinets">
          <span className="text-xs font-semibold">Sizes that aren&apos;t whole cabinets</span>
          {sizing.choices.map((c) => (
            <div key={c.id} className="flex flex-col gap-1.5 rounded border border-warn/50 p-2">
              <span className="text-xs">{c.text}</span>
              <div className="flex flex-wrap gap-1.5">
                {(["down", "up", "keep"] as Rounding[]).filter((r) => r !== "down" || c.fit.down >= 1).map((r) => (
                  <Button key={r} size="xs" variant="outline" className="rounded" onClick={() => session.set({ rounding: { ...session.rounding, [c.id]: r } })}>
                    {r === "down" ? `Round down (${c.fit.down})` : r === "up" ? `Round up (${c.fit.up})` : "Keep as a warning"}
                  </Button>
                ))}
              </div>
            </div>
          ))}
          {sizing.choices.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="w-full text-[11px] text-muted-foreground">Or the same for all {sizing.choices.length}:</span>
              {(["down", "up", "keep"] as Rounding[]).filter((r) => r !== "down" || sizing.choices.every((c) => c.fit.down >= 1)).map((r) => (
                <Button key={r} size="xs" variant="outline" className="rounded" onClick={() => session.set({ rounding: { ...session.rounding, ...Object.fromEntries(sizing.choices.map((c) => [c.id, r])) } })}>
                  {r === "down" ? "All down" : r === "up" ? "All up" : "Keep all as warnings"}
                </Button>
              ))}
            </div>
          )}
        </section>
      )}
      {Object.keys(session.rounding).length > 0 && (
        <div className="flex flex-col gap-1 text-xs">
          {Object.entries(session.rounding).map(([id, r]) => {
            const [axis, key] = id.split(":");
            const who = session.screens.find((x) => x.key === key)?.name.value ?? key;
            return <span key={id} className="text-muted-foreground">{who}, {axis}: {r === "down" ? "rounded down" : r === "up" ? "rounded up" : "kept as a warning"}</span>;
          })}
          <Button size="xs" variant="ghost" className="self-start rounded" onClick={() => session.set({ rounding: {} })}>Ask the rounding questions again</Button>
        </div>
      )}

      {sizing?.ok && (
        <section className="flex flex-col gap-2 border-t border-border pt-3" aria-label="Output">
          <span className="text-xs font-semibold">Which processor?</span>
          <SelectField ariaLabel="Processor or output size" value={session.outputChoice ?? ""} items={OUTPUT_CHOICES.map((c) => ({ value: c.id, label: c.label, group: c.kind === "generic" ? "Generic outputs" : "Processors (catalog)" }))} onChange={(v) => session.set({ outputChoice: v, outputCount: null, assignment: {} })} />
          {choice && (
            <Note tone={choice.checked ? "info" : "warn"}>
              {choice.size ? `${choice.size.width} × ${choice.size.height} px per output. ` : "The catalog states no single input size for it: pick an output size below. "}
              {choice.loadPx ? `Load ${choice.loadPx.toLocaleString("en")} px per unit. ` : ""}
              {choice.ports ? `${choice.ports.count} ports, ${choice.ports.perPortPx.toLocaleString("en")} px per port (${choice.ports.basis}). ` : ""}
              {choice.checked ? "" : "Not checked against the manufacturer's PDF. "}
              <span className="text-muted-foreground">{choice.source}.</span>
            </Note>
          )}
          {choice && !choice.size && (
            <SelectField ariaLabel="Output size" value={session.outputSize ? `${session.outputSize.width}x${session.outputSize.height}` : ""} items={[{ value: "1920x1080", label: "1920 × 1080" }, { value: "3840x2160", label: "3840 × 2160" }]} onChange={(v) => { const [w, h] = v.split("x").map(Number); session.set({ outputSize: { width: w, height: h }, outputCount: null }); }} />
          )}
          {needed === null && (choice?.size || session.outputSize) && <Note tone="bad">A screen is larger than one output of this size. Choose a larger output: nothing is scaled.</Note>}
          {needed !== null && (
            <label className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">Outputs (everything fits in {needed})</span>
              <Input type="number" min={1} max={MAX_OUTPUTS} value={count} onChange={(e) => { const v = Number(e.target.value); if (Number.isInteger(v) && v >= 1 && v <= MAX_OUTPUTS) session.set({ outputCount: v, assignment: {} }); }} className="h-7 w-20 rounded px-2 text-[13px] tabular-nums md:text-[13px]" />
            </label>
          )}
        </section>
      )}
      <Button className="rounded" onClick={onNext} disabled={!(sizing?.ok && needed !== null)}>Next: review</Button>
    </>
  );
}

function ReviewPanel({ preview, sized, count, onDone }: { preview: GuidedBuild | null; sized: readonly ScreenSizing[] | null; count: number; onDone(): void }) {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const project = useApp((s) => s.project);
  if (!preview || !sized) return <Note tone="warn">Answer the questions first.</Note>;
  const hasScreens = (project?.physical.screens.length ?? 0) > 0;
  const choice = session.outputChoice ? outputChoice(session.outputChoice) : undefined;
  const loads = preview.mapping.outputs.map((o) => preview.mapping.screens.filter((s) => s.outputId === o.outputId).reduce((n, s) => n + s.masterRect.width * s.masterRect.height, 0));
  const warnings = sized.flatMap((s) => s.warnings);
  const confirm = () => {
    const run = () => {
      setBusy(true);
      try {
        const out = { ...(choice?.size ?? session.outputSize!), count, assignment: session.assignment };
        useApp.getState().edit((p) => {
          const b = buildGuidedProject(p, sized, out, opContext);
          if (!b.ready) throw new Error(b.blocking[0]);
          return ops.setModuleData(b.project, GUIDED_MODULE_ID, GUIDED_MODULE_VERSION, recordOf(useSession.getState()));
        });
        onDone();
      } catch (e) {
        session.set({ error: e instanceof Error ? e.message : String(e) });
      } finally {
        setBusy(false);
      }
    };
    if (hasScreens) useUi.getState().askConfirm({ title: "Replace the project's screens?", body: `The project's ${project!.physical.screens.length} screens, their content regions and outputs are replaced by these ${sized.length}. You can undo this.`, action: "Replace screens", onConfirm: run });
    else run();
  };
  return (
    <>
      <h2 className="text-sm font-semibold">Review</h2>
      <p className="text-xs text-muted-foreground">Check where each screen lands on the canvas and in the outputs. Move a screen to another output if you need to.</p>
      <table className="w-full text-xs tabular-nums">
        <thead className="text-left text-muted-foreground">
          <tr><th className="font-normal">Screen</th><th className="font-normal">Cabinets</th><th className="font-normal">Canvas</th><th className="font-normal">Output</th></tr>
        </thead>
        <tbody>
          {sized.map((s, i) => {
            const r = preview.mapping.screens[i];
            const outIndex = preview.mapping.outputs.findIndex((o) => o.outputId === r?.outputId);
            return (
              <tr key={s.key} className="border-t border-border align-top">
                <td className="py-1 pr-1">{s.name}<div className="text-muted-foreground">{s.widthPx}×{s.heightPx} px</div></td>
                <td className="py-1 pr-1">{s.columns}×{s.rows}<div className="text-muted-foreground">{formatUm(s.widthUm)}×{formatUm(s.heightUm)}</div></td>
                <td className="py-1 pr-1">x {r?.masterRect.x}<div className="text-muted-foreground">y {r?.masterRect.y}</div></td>
                <td className="py-1">
                  <select
                    aria-label={`Output for ${s.name}`}
                    value={session.assignment[s.key] ?? "auto"}
                    onChange={(e) => session.set({ assignment: e.target.value === "auto" ? Object.fromEntries(Object.entries(session.assignment).filter(([k]) => k !== s.key)) : { ...session.assignment, [s.key]: Number(e.target.value) } })}
                    className="h-7 rounded border border-border bg-background px-1 text-xs"
                  >
                    <option value="auto">Auto (OUT {outIndex + 1})</option>
                    {Array.from({ length: count }, (_, o) => <option key={o} value={o}>OUT {o + 1}</option>)}
                  </select>
                  {r && <div className="text-muted-foreground">at {r.outputRect.x}, {r.outputRect.y}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Note tone="info">Canvas {preview.mapping.master.width} × {preview.mapping.master.height} px, in {preview.mapping.outputs.length} {preview.mapping.outputs.length === 1 ? "output" : "outputs"} of {preview.mapping.outputs[0]?.width} × {preview.mapping.outputs[0]?.height} px.</Note>
      {choice?.loadPx && loads.some((l) => l > choice.loadPx!) && <Note tone="warn">An output carries more than the {choice.label}&apos;s stated load of {choice.loadPx.toLocaleString("en")} px (not checked).</Note>}
      {warnings.map((w) => <Note key={w} tone="warn">{w}</Note>)}
      {preview.blocking.map((b) => <Note key={b} tone="bad">{b}</Note>)}
      <Button className="rounded" disabled={!preview.ready || busy} onClick={confirm}>{hasScreens ? "Confirm and replace screens" : "Confirm"}</Button>
    </>
  );
}

function ReviewPreview({ build }: { build: GuidedBuild }) {
  const numbers = new Map(build.mapping.screens.map((s, i) => [s.screenId, i + 1]));
  const options = { numbers, selected: new Set<string>() };
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Stage plan"><h3 className="mb-1 text-xs text-muted-foreground">Stage, whole cabinets</h3><StagePreview mapping={build.mapping} options={options} /></section>
      <section aria-label="Processor pixel map"><h3 className="mb-1 text-xs text-muted-foreground">Processor pixel map</h3><OutputPreviews mapping={build.mapping} options={options} /></section>
    </div>
  );
}

function ExportPanel() {
  const session = useSession();
  const mapping = useApp((s) => s.mapping)!;
  const project = useApp((s) => s.project)!;
  const font = useCalibrationFont();
  const [busy, setBusy] = useState<string | null>(null);
  const [doneFor, setDone] = useState<{ text: string; only: Id | null } | null>(null);
  const done = doneFor && doneFor.only === session.only ? doneFor.text : null;
  const cards = useMemo(() => guidedCards(mapping, { only: session.only }), [mapping, session.only]);
  const errors = useApp((s) => s.issues).filter((i) => i.severity === "error");
  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    setDone(null);
    session.set({ error: null });
    try {
      await work();
    } catch (e) {
      session.set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  const all = () =>
    run("Making the files…", async () => {
      const files: PngFile[] = [...(await pixelMapPngs(mapping, project.meta.name))];
      for (const c of cards) files.push(await cardPng(c, font));
      const readme = [
        `${project.meta.name}: pixel map and test cards`,
        "",
        "Every PNG is one image pixel per LED pixel. Send each output's files to that processor output at 1:1, no scaling.",
        "Cabinet ids read SCREEN·ROW·COLUMN from the top-left cabinet, for example C·R3·C12.",
        "",
        ...files.map((f) => `${f.name}  ${f.width}×${f.height}`),
      ].join("\n");
      download(await zipFiles(files, readme), `${project.meta.name.replace(/[^\w-]+/g, "-")}_test-cards.zip`);
      setDone({ text: `Saved ${files.length} PNG files in one ZIP.`, only: session.only });
    });
  return (
    <>
      <h2 className="text-sm font-semibold">Export</h2>
      {errors.length > 0 && <Note tone="bad">The project has {errors.length} {errors.length === 1 ? "error" : "errors"}: {errors[0].message}</Note>}
      <SelectField
        label="Test"
        value={session.only ?? "all"}
        items={[{ value: "all", label: `All ${mapping.screens.length} screens` }, ...mapping.screens.map((s, i) => ({ value: s.screenId, label: `Only ${screenLetter(i)} · ${s.name}` }))]}
        onChange={(v) => session.set({ only: v === "all" ? null : v })}
      />
      <Button className="rounded" disabled={!!busy || errors.length > 0} onClick={all}><Download />Download all (ZIP)</Button>
      <ul className="flex flex-col gap-1 text-xs" aria-label="Files">
        <li className="text-muted-foreground">Pixel maps: one per output</li>
        {mapping.outputs.map((o, i) => (
          <li key={o.outputId} className="flex items-center justify-between gap-2">
            <span className="truncate">pixel-map_out-{i + 1}_{o.width}x{o.height}.png</span>
            <Button size="xs" variant="outline" className="rounded" disabled={!!busy} onClick={() => run("Making the pixel map…", async () => { const f = (await pixelMapPngs(mapping, project.meta.name))[i]; download(f.blob, f.name); })}>PNG</Button>
          </li>
        ))}
        <li className="pt-1 text-muted-foreground">Test cards: per output, then per screen</li>
        {cards.map((c) => (
          <li key={c.fileName} className="flex items-center justify-between gap-2">
            <span className="truncate">{c.fileName}</span>
            <Button size="xs" variant="outline" className="rounded" disabled={!!busy} onClick={() => run("Making the test card…", async () => { const f = await cardPng(c, font); download(f.blob, f.name); })}>PNG</Button>
          </li>
        ))}
      </ul>
      {busy && <Note tone="info" live>{busy}</Note>}
      {done && <Note tone="ok" live>{done}</Note>}
      <p className="text-[11px] text-muted-foreground">Each cabinet shows its id, screen·row·column from the top-left, and each screen its name and a TOP mark, so the wall can be checked from the audience.</p>
    </>
  );
}

function ExportPreview() {
  const mapping = useApp((s) => s.mapping)!;
  const session = useSession();
  const font = useCalibrationFont();
  const cards = useMemo(() => guidedCards(mapping, { only: session.only }), [mapping, session.only]);
  const [index, setIndex] = useState(0);
  const card = cards[Math.min(index, cards.length - 1)];
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el || !card) return;
    const scale = Math.min(1, 1600 / card.frame.width);
    el.width = Math.max(1, Math.round(card.frame.width * scale));
    el.height = Math.max(1, Math.round(card.frame.height * scale));
    const ctx = el.getContext("2d");
    if (!ctx) return;
    void import("../calibration/draw").then(({ drawCalibration }) => {
      const options = { scale, fontFamily: font, logo: null, frame: 0, fps: 30 as const };
      drawCalibration(ctx, card.frame, options, "static");
      drawCalibration(ctx, card.frame, options, "counters");
    });
  }, [card, font]);
  if (!card) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Test card preview">
        {cards.map((c, i) => (
          <button key={c.fileName} type="button" role="tab" aria-selected={c === card} onClick={() => setIndex(i)} className={cn("rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent", c === card && "bg-secondary text-foreground")}>
            {c.target.label}
          </button>
        ))}
      </div>
      <canvas ref={canvas} className="h-auto w-full rounded bg-black" role="img" aria-label={`${card.target.label}, ${card.frame.width} × ${card.frame.height} px`} />
      <span className="text-xs text-muted-foreground">Preview, reduced. The PNG is {card.frame.width} × {card.frame.height} px, one pixel per LED pixel.</span>
    </div>
  );
}
