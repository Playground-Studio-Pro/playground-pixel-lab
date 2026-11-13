"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Readout, Section, SelectField } from "@/components/workspace/fields";
import { CONTENT_FPS, type ContentFps } from "@/domain/motion";
import { videoTargets, type VideoTarget } from "@/engines/video-targets";
import { assertExportable, slugify } from "@/exports/gate";
import { MODULE_SOURCES } from "@/modules/catalog";
import { createDepthSource, depthMaxSize } from "@/modules/depth-studio/source";
import { useDepth } from "@/modules/depth-studio/depth-store";
import type { FrameInput, FrameSource } from "@/preview/contract";
import { useApp } from "@/state/store";
import { useMotion } from "@/state/motion-store";
import { CalibrationSourceControls } from "./calibration-controls";
import { createCalibrationSource, currentCalibrationSettings, prepareCalibrationSource } from "./calibration-source";
import { useCalibrationSource } from "./calibration-store";
import { targetSource } from "./target-source";
import { exportMp4 } from "./video-export";

const CALIBRATION = "calibration-test-card";
const DEPTH = "depth-scene";
const sourceItems = MODULE_SOURCES.map((s) => ({ value: s.id, label: s.name }));
const fpsItems = CONTENT_FPS.map((f) => ({ value: String(f), label: `${f} fps` }));
const SECONDS = [5, 10, 15, 20, 30, 60] as const;
const secondItems = SECONDS.map((s) => ({ value: String(s), label: `${s} s` }));

type Status =
  | { kind: "idle" }
  | { kind: "exporting"; done: number; total: number }
  | { kind: "done"; filename: string; bytes: number; frames: number; width: number; height: number; fps: number }
  | { kind: "error"; message: string };

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The source as it will be exported: settings fixed now. Throws with a message a person can act on. */
async function frozenSource(sourceId: string, master: { width: number; height: number }): Promise<FrameSource> {
  if (sourceId === DEPTH) {
    const max = depthMaxSize();
    if (max === null) throw new Error("Depth Studio needs WebGL 2, which this browser doesn't provide.");
    if (Math.max(master.width, master.height) > max) throw new Error(`The master canvas is larger than this GPU renders without scaling (${max} px a side). It is never scaled down.`);
    return createDepthSource(useDepth.getState().config);
  }
  const settings = currentCalibrationSettings();
  const assets = await prepareCalibrationSource();
  if (settings.logo !== "off" && !assets.logo) throw new Error("The Playground Studio logo didn't load, so the test card can't be exported with it. Reload, or set the logo to Off.");
  return createCalibrationSource(settings);
}

/** Output Studio: export the current content as an H.264 MP4, for the master canvas, an output or a screen. */
export default function OutputStudioPanel() {
  const project = useApp((s) => s.project);
  const mapping = useApp((s) => s.mapping);
  const issues = useApp((s) => s.issues);
  const liveSource = useMotion((s) => s.sourceId);
  const liveFps = useMotion((s) => s.fps);
  const calibrationMode = useCalibrationSource((s) => s.mode);
  const calibrationLogo = useCalibrationSource((s) => s.logoByMode[s.mode]);
  const depthConfig = useDepth((s) => s.config);

  const targets = useMemo(() => (mapping ? videoTargets(mapping) : []), [mapping]);
  const exportable = targets.filter((t) => !t.problem);
  const blocked = targets.filter((t) => t.problem);
  const [sourceId, setSourceId] = useState(liveSource && MODULE_SOURCES.some((s) => s.id === liveSource) ? liveSource : CALIBRATION);
  const [targetId, setTargetId] = useState<string | null>(null);
  const target: VideoTarget | undefined = exportable.find((t) => t.id === targetId) ?? exportable[0];
  const [fps, setFps] = useState<ContentFps>(liveFps);
  const [seconds, setSeconds] = useState(10);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const master = useMemo<Omit<FrameInput, "frame" | "fps"> | null>(
    () =>
      mapping && project
        ? {
            width: mapping.master.width,
            height: mapping.master.height,
            screens: mapping.screens.map((s) => ({ id: s.screenId, name: s.name, x: s.masterRect.x, y: s.masterRect.y, width: s.masterRect.width, height: s.masterRect.height })),
            context: { project, mapping },
          }
        : null,
    [mapping, project],
  );

  // Frame 0 exactly as the export draws it: the same frozen source and the same 1:1 copy, shown scaled by CSS only.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !target || !master) return;
    let live = true;
    frozenSource(sourceId, master)
      .then((source) => {
        if (!live) return;
        canvas.width = target.width;
        canvas.height = target.height;
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return;
        targetSource(source, target, master).draw(ctx, { ...master, width: target.width, height: target.height, frame: 0, fps }, { scale: 1, fontFamily: "sans-serif" });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [sourceId, target, master, fps, calibrationMode, calibrationLogo, depthConfig]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!project || !mapping || !master) return null;
  const frames = fps * seconds;
  const exporting = status.kind === "exporting";
  const loopNote =
    sourceId === DEPTH
      ? seconds % depthConfig.durationSeconds === 0
        ? `Loops seamlessly: the scene repeats every ${depthConfig.durationSeconds} s.`
        : `The scene loops every ${depthConfig.durationSeconds} s, so a ${seconds} s file won't loop seamlessly.`
      : calibrationMode === "calibration"
        ? "The frame counter and timecode count up, so the file doesn't loop seamlessly."
        : "Identification is a still frame, so the file loops seamlessly.";

  async function start() {
    if (!target || !master || !project) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus({ kind: "exporting", done: 0, total: frames });
    try {
      assertExportable(issues);
      const source = targetSource(await frozenSource(sourceId, master), target, master);
      let shown = 0;
      const blob = await exportMp4({
        source,
        input: { screens: master.screens, context: master.context },
        width: target.width,
        height: target.height,
        fps,
        frames,
        signal: controller.signal,
        onProgress: (done, total) => {
          // At most a hundred updates per export: progress, not per-frame state.
          if (done === total || done - shown >= Math.max(1, Math.floor(total / 100))) {
            shown = done;
            setStatus({ kind: "exporting", done, total });
          }
        },
      });
      const filename = `${slugify(project.meta.name)}-${slugify(sourceId === DEPTH ? "depth" : "calibration")}-${slugify(target.label)}-${target.width}x${target.height}-${fps}fps-${seconds}s.mp4`;
      download(blob, filename);
      setStatus({ kind: "done", filename, bytes: blob.size, frames, width: target.width, height: target.height, fps });
    } catch (error) {
      setStatus(controller.signal.aborted ? { kind: "idle" } : { kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      abortRef.current = null;
    }
  }

  return (
    <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_288px]" data-testid="output-studio">
      <main className="flex min-h-0 min-w-0 flex-col bg-stage">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-panel px-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Export preview</span>
          <span>Frame 0 of the file, drawn by the export itself. Shown scaled to fit; the file is 1:1.</span>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          {target ? (
            <canvas ref={canvasRef} className="max-h-full max-w-full border border-border object-contain [image-rendering:auto]" style={{ aspectRatio: `${target.width} / ${target.height}` }} data-testid="export-preview" />
          ) : (
            <p className="text-xs text-muted-foreground">No output or screen fits H.264 at its own size.</p>
          )}
        </div>
      </main>
      <ScrollArea className="min-h-0 border-l border-border bg-panel">
        <Section title="Export MP4">
          <SelectField label="Content" value={sourceId} items={sourceItems} onChange={setSourceId} disabled={exporting} />
          {sourceId === CALIBRATION && (
            <div className="flex flex-wrap gap-2">
              <CalibrationSourceControls />
            </div>
          )}
          <SelectField
            label="For"
            value={target?.id ?? ""}
            items={exportable.map((t) => ({ value: t.id, label: `${t.label} · ${t.width} × ${t.height}` }))}
            onChange={setTargetId}
            disabled={exporting || exportable.length === 0}
          />
          <SelectField label="Frame rate" value={String(fps)} items={fpsItems} onChange={(v) => setFps(Number(v) as ContentFps)} disabled={exporting} />
          <SelectField label="Duration" value={String(seconds)} items={secondItems} onChange={(v) => setSeconds(Number(v))} disabled={exporting} />
        </Section>
        {target && (
          <Section title="File">
            <Readout label="Size" value={`${target.width} × ${target.height} px, 1:1`} strong />
            <Readout label="Frames" value={`${frames.toLocaleString("en-US")} at ${fps} fps`} />
            <Readout label="Duration" value={`${seconds} s`} />
            <Readout label="Format" value="H.264 MP4, no audio" />
            <p className="text-xs text-muted-foreground">{loopNote}</p>
            {exporting ? (
              <div className="flex flex-col gap-2">
                <div className="h-1.5 overflow-hidden rounded bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={status.total} aria-valuenow={status.done}>
                  <div className="h-full bg-signal" style={{ width: `${(100 * status.done) / status.total}%` }} />
                </div>
                <div className="flex items-center justify-between text-xs tabular-nums">
                  <span data-testid="export-progress">Encoding {status.done} / {status.total}</span>
                  <Button size="sm" variant="secondary" onClick={() => abortRef.current?.abort()}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button onClick={start} data-testid="export-mp4">Export MP4</Button>
            )}
            {status.kind === "done" && (
              <p className="text-xs text-muted-foreground" data-testid="export-done">
                Saved {status.filename}: {status.width} × {status.height}, {status.frames} frames at {status.fps} fps, {(status.bytes / 1_000_000).toFixed(1)} MB.
              </p>
            )}
            {status.kind === "error" && <p className="text-xs text-destructive" data-testid="export-error">{status.message}</p>}
          </Section>
        )}
        {blocked.length > 0 && (
          <Section title="Not available as H.264">
            {blocked.map((t) => (
              <div key={t.id} className="text-xs">
                <div className="tabular-nums">{t.label} · {t.width} × {t.height}</div>
                <div className="text-muted-foreground">{t.problem}</div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Never scaled down. A native-size ProRes or PNG master is planned for the desktop app.</p>
          </Section>
        )}
      </ScrollArea>
    </div>
  );
}
