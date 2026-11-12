"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pause, Play, SkipBack } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CONTENT_FPS, type ContentFps } from "@/domain/motion";
import type { ResolvedMapping } from "@/engines/mapping";
import * as clock from "@/engines/motion/clock";
import { slugify } from "@/exports/gate";
import { cn } from "@/lib/utils";
import { Segmented, ToggleChip, ToolLabel } from "./controls";
import { drawCalibration } from "./draw";
import { buildCalibrationFrame, counterText, DEFAULT_ELEMENTS, type CalibrationElements, type CalibrationMode, type LogoMode } from "./frame";
import { calibrationTargets } from "./from-mapping";
import { CAL_LOGO_ASSET } from "./tokens";

const MODES: readonly { value: CalibrationMode; label: string }[] = [
  { value: "identification", label: "Identification" },
  { value: "calibration", label: "Calibration" },
];
const LOGO_MODES: readonly { value: LogoMode; label: string }[] = [
  { value: "center", label: "Center" },
  { value: "watermark", label: "Watermark" },
  { value: "off", label: "Off" },
];
const ZOOMS: readonly { value: "fit" | "actual"; label: string }[] = [
  { value: "fit", label: "Fit" },
  { value: "actual", label: "100%" },
];
const ELEMENTS: readonly { key: keyof CalibrationElements; label: string }[] = [
  { key: "grid", label: "Grid" },
  { key: "crosshair", label: "Crosshair" },
  { key: "references", label: "References" },
  { key: "frameCounter", label: "Frame counter" },
  { key: "metadata", label: "Metadata" },
];
const SPACE_NAMES = { master: "master canvas", output: "output", screen: "screen" } as const;
/** Largest preview canvas, in device pixels. The exported frame is not limited by this. */
const MAX_BACKING_PIXELS = 34_000_000;
const FALLBACK_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function useLogo(): HTMLImageElement | null {
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const image = new Image();
    image.onload = () => setLogo(image);
    image.src = CAL_LOGO_ASSET.src;
    return () => {
      image.onload = null;
    };
  }, []);
  return logo;
}

/** The calibration face, once the browser has it. Canvas text drawn earlier would use a fallback. */
function useCalibrationFont(): string {
  const [family, setFamily] = useState(FALLBACK_FONT);
  useEffect(() => {
    const declared = getComputedStyle(document.documentElement).getPropertyValue("--font-cal-mono").trim();
    if (!declared) return;
    const full = `${declared}, ${FALLBACK_FONT}`;
    let live = true;
    Promise.all([500, 600, 700].map((weight) => document.fonts.load(`${weight} 24px ${declared}`, "SCR-01 ×·…")))
      .catch(() => undefined)
      .then(() => live && setFamily(full));
    return () => {
      live = false;
    };
  }, []);
  return family;
}

export interface CalibrationViewProps {
  readonly mapping: ResolvedMapping;
  readonly projectName: string;
  /** Target shown first: "master", an output id, or `screen:<id>`. */
  readonly initialTargetId?: string;
  /** Extra actions for the footer, left of the frame export. */
  readonly actions?: ReactNode;
}

/**
 * Screen identification and calibration, previewed from the resolved mapping.
 * Identification answers "which screen is this"; calibration checks pixel accuracy.
 */
export function CalibrationView({ mapping, projectName, initialTargetId, actions }: CalibrationViewProps) {
  const targets = useMemo(() => calibrationTargets(mapping), [mapping]);
  const [targetId, setTargetId] = useState(initialTargetId ?? "master");
  const target = targets.find((t) => t.id === targetId) ?? targets[0];
  const [mode, setMode] = useState<CalibrationMode>("identification");
  // Each mode remembers its own logo setting: a centered logo would cover the calibration crosshair.
  const [logoByMode, setLogoByMode] = useState<Record<CalibrationMode, LogoMode>>({ identification: "center", calibration: "off" });
  const [elements, setElements] = useState<CalibrationElements>(DEFAULT_ELEMENTS);
  const [zoom, setZoom] = useState<"fit" | "actual">("fit");
  const [fps, setFps] = useState<ContentFps>(30);
  const [playing, setPlaying] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const logo = useLogo();
  const fontFamily = useCalibrationFont();
  const logoMode = logoByMode[mode];
  const empty = target.width < 1 || target.height < 1 || target.screens.length === 0;

  const frame = useMemo(
    () =>
      buildCalibrationFrame({
        width: target.width,
        height: target.height,
        screens: target.screens,
        mode,
        logo: { mode: logoMode, aspect: CAL_LOGO_ASSET.width / CAL_LOGO_ASSET.height },
        elements,
        fps,
      }),
    [target, mode, logoMode, elements, fps],
  );

  const viewportRef = useRef<HTMLDivElement>(null);
  const staticRef = useRef<HTMLCanvasElement>(null);
  const counterRef = useRef<HTMLCanvasElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const clockRef = useRef(clock.initialClock);
  const frameNumber = useRef(0);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setViewport({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // CSS pixels per frame pixel. Fit never enlarges by a fraction: small frames grow in whole steps.
  const fit = Math.min((viewport.width - 32) / target.width, (viewport.height - 32) / target.height);
  const scale = zoom === "actual" ? 1 : fit >= 1 ? Math.floor(fit) : Math.max(fit, 0.01);
  const cssWidth = Math.max(1, Math.round(target.width * scale));
  const cssHeight = Math.max(1, Math.round(target.height * scale));

  const paintCounters = useCallback(() => {
    const canvas = counterRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawCalibration(ctx, frame, { scale: canvas.width / frame.width, fontFamily, logo, frame: frameNumber.current, fps }, "counters");
    if (readoutRef.current) readoutRef.current.textContent = `${counterText("frame", frameNumber.current, fps)}  ${counterText("timecode", frameNumber.current, fps)}`;
  }, [frame, fontFamily, logo, fps]);

  useEffect(() => {
    const canvas = staticRef.current;
    const overlay = counterRef.current;
    if (!canvas || !overlay || empty || viewport.width === 0) return;
    // Whole device pixels per CSS pixel when the display allows, within a backing-store budget.
    const budget = Math.sqrt(MAX_BACKING_PIXELS / (cssWidth * cssHeight));
    const native = window.devicePixelRatio || 1;
    const dpr = Math.max(1, native <= budget ? native : Math.floor(Math.min(native, budget)));
    for (const c of [canvas, overlay]) {
      c.width = Math.max(1, Math.round(cssWidth * dpr));
      c.height = Math.max(1, Math.round(cssHeight * dpr));
    }
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    drawCalibration(ctx, frame, { scale: canvas.width / frame.width, fontFamily, logo, frame: 0, fps }, "static");
    paintCounters();
  }, [frame, fontFamily, logo, fps, cssWidth, cssHeight, empty, viewport.width, paintCounters]);

  // Playback advances a ref and repaints the counter layer only. No React state changes per frame.
  useEffect(() => {
    if (!playing) return;
    clockRef.current = clock.play(clockRef.current, performance.now());
    let raf = requestAnimationFrame(function tick(now) {
      const next = clock.frameAt(clock.contentTime(clockRef.current, now), fps);
      if (next !== frameNumber.current) {
        frameNumber.current = next;
        paintCounters();
      }
      raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(raf);
      clockRef.current = clock.pause(clockRef.current, performance.now());
    };
  }, [playing, fps, paintCounters]);

  const restart = () => {
    clockRef.current = clock.restart(clockRef.current, performance.now());
    frameNumber.current = 0;
    paintCounters();
  };

  const exportFrame = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = frame.width;
      canvas.height = frame.height;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error(`The browser couldn't allocate a ${frame.width}×${frame.height} image. Choose a single output or screen and try again.`);
      const options = { scale: 1, fontFamily, logo, frame: frameNumber.current, fps };
      drawCalibration(ctx, frame, options, "static");
      drawCalibration(ctx, frame, options, "counters");
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error(`The browser couldn't encode a ${frame.width}×${frame.height} PNG. Choose a single output or screen and try again.`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slugify(projectName)}_${mode}_${slugify(target.label)}_${frame.width}x${frame.height}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  };

  const showCounter = mode === "calibration" && elements.frameCounter;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="calibration-view">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-3 py-2">
        <Segmented label="Mode" value={mode} options={MODES} onChange={(value) => setMode(value)} />
        <select
          aria-label="Show"
          value={target.id}
          onChange={(e) => setTargetId(e.target.value)}
          className="h-7 w-48 min-w-0 rounded border border-border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {targets.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <ToolLabel>Logo</ToolLabel>
          <Segmented label="Logo" value={logoMode} options={LOGO_MODES} onChange={(value) => setLogoByMode((all) => ({ ...all, [mode]: value }))} />
        </div>
        {mode === "calibration" && (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Calibration elements">
            {ELEMENTS.map(({ key, label }) => (
              <ToggleChip key={key} label={label} pressed={elements[key]} onChange={(pressed) => setElements((all) => ({ ...all, [key]: pressed }))} />
            ))}
          </div>
        )}
        <div className="ml-auto">
          <Segmented label="Zoom" value={zoom} options={ZOOMS} onChange={(value) => setZoom(value)} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div ref={viewportRef} className="relative min-w-0 flex-1 overflow-auto bg-stage" data-testid="calibration-viewport">
          {empty ? (
            <p className="flex h-full items-center justify-center text-muted-foreground">Add a screen to see its identification frame.</p>
          ) : (
            <div className="flex min-h-full min-w-full items-center justify-center p-4" style={{ width: "max-content", height: "max-content" }}>
              <div className="relative shrink-0 outline outline-1 outline-white/10" style={{ width: cssWidth, height: cssHeight }}>
                <canvas ref={staticRef} className="absolute inset-0 size-full" style={{ imageRendering: scale >= 1 ? "pixelated" : "auto" }} role="img" aria-label={`${mode === "identification" ? "Identification" : "Calibration"} frame for ${target.label}, ${target.width} by ${target.height} pixels`} />
                <canvas ref={counterRef} className="pointer-events-none absolute inset-0 size-full" aria-hidden />
              </div>
            </div>
          )}
        </div>

        <aside className="hidden w-72 shrink-0 flex-col border-l border-border bg-panel lg:flex" aria-label="Screens">
          <div className="flex items-baseline justify-between border-b border-border px-3 py-2">
            <h3 className="text-xs font-medium">Screens</h3>
            <span className="text-xs text-muted-foreground tabular-nums">{targets[0].screens.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <button
              type="button"
              aria-pressed={target.id === "master"}
              onClick={() => setTargetId("master")}
              className={cn("flex w-full items-baseline justify-between border-b border-border px-3 py-2 text-left text-xs outline-none hover:bg-accent/60 focus-visible:bg-accent", target.id === "master" && "bg-accent")}
            >
              <span>Master canvas</span>
              <span className="font-mono text-[11px] text-muted-foreground">{mapping.master.width} × {mapping.master.height}</span>
            </button>
            {targets[0].screens.map((screen, index) => {
              const id = `screen:${mapping.screens[index].screenId}`;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={target.id === id}
                  onClick={() => setTargetId(id)}
                  className={cn("grid w-full grid-cols-[3px_minmax(0,1fr)] gap-x-2.5 border-b border-border py-2 pr-3 pl-0 text-left outline-none hover:bg-accent/60 focus-visible:bg-accent", target.id === id && "bg-accent")}
                >
                  <span className="row-span-3 self-stretch" style={{ background: screen.accent }} aria-hidden />
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-xs font-semibold">{screen.label}</span>
                    {screen.output && <span className="font-mono text-[11px] text-muted-foreground">{screen.output.label}</span>}
                  </span>
                  <span className="truncate text-xs">{screen.name}</span>
                  <span className="flex justify-between gap-2 font-mono text-[11px] text-muted-foreground">
                    <span>{screen.rect.width} × {screen.rect.height}</span>
                    <span>X {screen.canvasX} Y {screen.canvasY}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-3 py-2">
        <p className="font-mono text-xs tabular-nums" data-testid="preview-size">
          {target.width} × {target.height} px
          <span className="text-muted-foreground"> · {SPACE_NAMES[target.space]} · {zoom === "actual" ? "1 LED px = 1 px" : `${(scale * 100).toFixed(scale < 0.1 ? 1 : 0)}%`}</span>
        </p>
        {showCounter && (
          <div className="flex items-center gap-1.5" role="group" aria-label="Frame counter">
            <Button variant="ghost" size="icon-xs" aria-label={playing ? "Pause frame counter" : "Play frame counter"} onClick={() => setPlaying((p) => !p)}>
              {playing ? <Pause /> : <Play />}
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label="Back to frame 0" onClick={restart}><SkipBack /></Button>
            <span ref={readoutRef} className="w-44 font-mono text-xs whitespace-pre tabular-nums" />
            <label className="flex items-center gap-1.5">
              <ToolLabel>Content FPS</ToolLabel>
              <select
                value={fps}
                onChange={(e) => {
                  // Keep the same moment in the content when the rate changes.
                  const next = Number(e.target.value) as ContentFps;
                  const now = performance.now();
                  const at = clock.contentTime(clockRef.current, now);
                  frameNumber.current = clock.frameAt(at, next);
                  setFps(next);
                }}
                className="h-6 rounded border border-border bg-background px-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                {CONTENT_FPS.map((rate) => (
                  <option key={rate} value={rate}>{rate}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {exportError && <p className="text-xs text-destructive" role="alert">{exportError}</p>}
          {actions}
          <Button size="sm" className="rounded" disabled={empty || exporting} onClick={exportFrame}>Export frame (PNG)</Button>
        </div>
      </div>
    </div>
  );
}
