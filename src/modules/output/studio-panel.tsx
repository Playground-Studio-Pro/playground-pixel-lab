"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Readout, Section, SelectField } from "@/components/workspace/fields";
import { CONTENT_FPS, type ContentFps } from "@/domain/motion";
import { OUTPUT_SOURCE_IDS } from "@/domain/physical-output";
import { videoTargets, type VideoTarget } from "@/engines/video-targets";
import { assertExportable, slugify } from "@/exports/gate";
import { MODULE_SOURCES } from "@/modules/catalog";
import { WallBuildControls } from "@/modules/content/wall-build-controls";
import { WALL_BUILD_SOURCE_ID } from "@/modules/content/wall-build-source";
import { useWallBuild } from "@/modules/content/wall-build-store";
import { useDepth } from "@/modules/depth-studio/depth-store";
import type { FrameInput } from "@/preview/contract";
import { useApp } from "@/state/store";
import { useMotion } from "@/state/motion-store";
import { exportScreenBatch, planScreenBatch, type BatchProgress } from "./batch-export";
import { CalibrationSourceControls } from "./calibration-controls";
import { useCalibrationSource } from "./calibration-store";
import { BUILD_TIME, buildCutWarning, DEFAULT_HOLD_SECONDS, durationProblem, EXPORT_SECONDS, exportSeconds, HOLD_SECONDS } from "./export-duration";
import { createExportSource, EXPORT_SOURCE_IDS, exportSourceId, exportSourceLabel } from "./export-sources";
import { OutputControls } from "./output-controls";
import { PIXEL_GRID_SOURCE_ID } from "./pixel-grid-source";
import { MAX_ZIP_BYTES } from "./stored-zip";
import { targetSource } from "./target-source";
import { exportMp4 } from "./video-export";

const CALIBRATION = "calibration-test-card";
const DEPTH = "depth-scene";
/** The "For" choice that exports every screen at once. Target ids are "master", output ids and `screen:<id>`. */
const EVERY_SCREEN = "every-screen";
const exportSources = MODULE_SOURCES.filter((s) => (EXPORT_SOURCE_IDS as readonly string[]).includes(s.id));
const sourceItems = exportSources.map((s) => ({ value: s.id, label: s.name }));
const fpsItems = CONTENT_FPS.map((f) => ({ value: String(f), label: `${f} fps` }));
const secondItems = EXPORT_SECONDS.map((s) => ({ value: String(s), label: `${s} s` }));
const holdItems = HOLD_SECONDS.map((s) => ({ value: String(s), label: `${s} s` }));
const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

type Status =
  | { kind: "idle" }
  | { kind: "exporting"; done: number; total: number; batch: BatchProgress | null }
  | { kind: "done"; filename: string; bytes: number; frames: number; width: number; height: number; fps: number }
  | { kind: "done-batch"; filename: string; bytes: number; files: number; frames: number; fps: number; skipped: readonly string[] }
  | { kind: "cancelled" }
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

/** Output Studio: export the current content as an H.264 MP4, for the master canvas, an output, a screen or every screen. */
export default function OutputStudioPanel() {
  const project = useApp((s) => s.project);
  const mapping = useApp((s) => s.mapping);
  const issues = useApp((s) => s.issues);
  const liveSource = useMotion((s) => s.sourceId);
  const liveFps = useMotion((s) => s.fps);
  const calibrationMode = useCalibrationSource((s) => s.mode);
  const calibrationLogo = useCalibrationSource((s) => s.logoByMode[s.mode]);
  const depthConfig = useDepth((s) => s.config);
  const wallBuild = useWallBuild((s) => s.settings);

  const targets = useMemo(() => (mapping ? videoTargets(mapping) : []), [mapping]);
  const exportable = targets.filter((t) => !t.problem);
  const blocked = targets.filter((t) => t.problem);
  const [sourceId, setSourceId] = useState(liveSource && exportSources.some((s) => s.id === liveSource) ? liveSource : CALIBRATION);
  const [targetId, setTargetId] = useState<string | null>(null);
  const hasScreens = targets.some((t) => t.kind === "screen");
  const everyScreen = targetId === EVERY_SCREEN && hasScreens;
  const target: VideoTarget | undefined = everyScreen ? undefined : exportable.find((t) => t.id === targetId) ?? exportable[0];
  const [fps, setFps] = useState<ContentFps>(liveFps);
  const [plainDuration, setPlainDuration] = useState("10");
  const [buildDuration, setBuildDuration] = useState<string>(BUILD_TIME);
  const [holdSeconds, setHoldSeconds] = useState<number>(DEFAULT_HOLD_SECONDS);
  const isWallBuild = sourceId === WALL_BUILD_SOURCE_ID;
  const durationKey = isWallBuild ? buildDuration : plainDuration;
  const buildSeconds = wallBuild.buildSeconds;
  const seconds = exportSeconds({ key: durationKey, holdSeconds }, isWallBuild ? buildSeconds : null);
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

  const projectName = project?.meta.name ?? "";
  const batch = useMemo(() => {
    const id = exportSourceId(sourceId);
    return everyScreen && mapping && id ? planScreenBatch(mapping, { projectName, sourceLabel: exportSourceLabel(id), fps, seconds }) : null;
  }, [everyScreen, mapping, projectName, sourceId, fps, seconds]);

  // Frame 0 exactly as the export draws it: the same frozen source and the same 1:1 copy, shown scaled by CSS only.
  // For every screen at once it's the whole master frame that each file is cut from.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !master || (!target && !everyScreen)) return;
    let live = true;
    createExportSource(sourceId, master)
      .then((source) => {
        if (!live) return;
        const { width, height } = target ?? master;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return;
        (target ? targetSource(source, target, master) : source).draw(ctx, { ...master, width, height, frame: 0, fps }, { scale: 1, fontFamily: "sans-serif" });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [sourceId, target, everyScreen, master, fps, calibrationMode, calibrationLogo, depthConfig, wallBuild]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!project || !mapping || !master) return null;
  const frames = fps * seconds;
  const exporting = status.kind === "exporting";
  const tooLong = durationProblem(seconds);
  const cut = isWallBuild ? buildCutWarning(seconds, buildSeconds) : null;
  const canExport = !tooLong && (batch ? batch.files.length > 0 : !!target);
  const previewSize = target ?? (everyScreen ? master : null);
  const loopNote =
    isWallBuild
      ? "The wall builds from empty and the finished wall holds to the end, so the file doesn't loop seamlessly."
      : sourceId === DEPTH
      ? seconds % depthConfig.durationSeconds === 0
        ? `Loops seamlessly: the scene repeats every ${depthConfig.durationSeconds} s.`
        : `The scene loops every ${depthConfig.durationSeconds} s, so a ${seconds} s file won't loop seamlessly.`
      : sourceId === PIXEL_GRID_SOURCE_ID
        ? "The motion marker steps 4 px per frame across each screen, so the file loops seamlessly only when the frame count fits every screen's width."
        : "A bar sweeps across the master canvas and a marker runs around each screen's edge every 5 s, so the picture loops seamlessly. The frame counter and timecode count up and restart at 0 when the file loops.";

  async function start() {
    const id = exportSourceId(sourceId);
    if (!master || !project || !id || !canExport) return;
    const controller = new AbortController();
    abortRef.current = controller;
    // At most a hundred updates per file: progress, not per-frame state.
    const step = Math.max(1, Math.floor(frames / 100));
    const due = (done: number) => done === 0 || done === frames || done % step === 0;
    setStatus({ kind: "exporting", done: 0, total: frames * (batch?.files.length ?? 1), batch: null });
    try {
      assertExportable(issues);
      const source = await createExportSource(id, master);
      if (batch) {
        const blob = await exportScreenBatch({
          batch,
          source,
          master,
          modified: new Date(),
          signal: controller.signal,
          onProgress: (p) => due(p.done) && setStatus({ kind: "exporting", done: p.totalDone, total: p.totalFrames, batch: p }),
        });
        download(blob, batch.zipName);
        setStatus({ kind: "done-batch", filename: batch.zipName, bytes: blob.size, files: batch.files.length, frames, fps, skipped: batch.skipped.map((s) => s.name) });
      } else if (target) {
        const blob = await exportMp4({
          source: targetSource(source, target, master),
          input: { screens: master.screens, context: master.context },
          width: target.width,
          height: target.height,
          fps,
          frames,
          signal: controller.signal,
          onProgress: (done, total) => due(done) && setStatus({ kind: "exporting", done, total, batch: null }),
        });
        const filename = `${slugify(project.meta.name)}-${exportSourceLabel(id)}-${slugify(target.label)}-${target.width}x${target.height}-${fps}fps-${seconds}s.mp4`;
        download(blob, filename);
        setStatus({ kind: "done", filename, bytes: blob.size, frames, width: target.width, height: target.height, fps });
      }
    } catch (error) {
      setStatus(controller.signal.aborted ? { kind: "cancelled" } : { kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      abortRef.current = null;
    }
  }

  return (
    <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_288px]" data-testid="output-studio">
      <main className="flex min-h-0 min-w-0 flex-col bg-stage">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-panel px-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Export preview</span>
          <span>{everyScreen ? "Frame 0 of the master canvas. Each file is its screen's part of it, 1:1. Shown scaled to fit." : "Frame 0 of the file, drawn by the export itself. Shown scaled to fit; the file is 1:1."}</span>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          {previewSize ? (
            <canvas ref={canvasRef} className="max-h-full max-w-full border border-border object-contain [image-rendering:auto]" style={{ aspectRatio: `${previewSize.width} / ${previewSize.height}` }} data-testid="export-preview" />
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
          {isWallBuild && (
            <div className="flex flex-wrap gap-2">
              <WallBuildControls />
            </div>
          )}
          <SelectField
            label="For"
            value={everyScreen ? EVERY_SCREEN : target?.id ?? ""}
            items={[...exportable.map((t) => ({ value: t.id, label: `${t.label} · ${t.width} × ${t.height}` })), ...(hasScreens ? [{ value: EVERY_SCREEN, label: "Every screen (one MP4 each)" }] : [])]}
            onChange={setTargetId}
            disabled={exporting || (exportable.length === 0 && !hasScreens)}
          />
          <SelectField label="Frame rate" value={String(fps)} items={fpsItems} onChange={(v) => setFps(Number(v) as ContentFps)} disabled={exporting} />
          <SelectField
            label="Duration"
            value={durationKey}
            items={isWallBuild ? [{ value: BUILD_TIME, label: `Build time (${buildSeconds} s) and hold` }, ...secondItems] : secondItems}
            onChange={isWallBuild ? setBuildDuration : setPlainDuration}
            disabled={exporting}
          />
          {isWallBuild && buildDuration === BUILD_TIME && <SelectField label="Hold the finished wall" value={String(holdSeconds)} items={holdItems} onChange={(v) => setHoldSeconds(Number(v))} disabled={exporting} />}
          {cut && <p className="text-xs text-amber-400" data-testid="export-build-cut">{cut}</p>}
          {tooLong && <p className="text-xs text-destructive" data-testid="export-too-long">{tooLong}</p>}
        </Section>
        {(target || batch) && (
          <Section title={batch ? "Files" : "File"}>
            {target && <Readout label="Size" value={`${target.width} × ${target.height} px, 1:1`} strong />}
            {batch && <Readout label="Screens" value={batch.skipped.length ? `${batch.files.length} of ${batch.files.length + batch.skipped.length}` : String(batch.files.length)} strong />}
            <Readout label={batch ? "Frames each" : "Frames"} value={`${frames.toLocaleString("en-US")} at ${fps} fps`} />
            <Readout label="Duration" value={`${seconds} s`} />
            <Readout label="Format" value={batch ? "H.264 MP4s in one ZIP" : "H.264 MP4, no audio"} />
            {batch && batch.skipped.length > 0 && (
              <div className="flex flex-col gap-1 text-xs text-amber-400" data-testid="batch-skipped">
                <div className="font-medium">Left out of the ZIP</div>
                {batch.skipped.map((s) => (
                  <div key={s.id}>{s.name}{s.size ? ` · ${s.size.width} × ${s.size.height}` : ""}: {s.reason}</div>
                ))}
              </div>
            )}
            {batch && batch.targetBytes > MAX_ZIP_BYTES && <p className="text-xs text-amber-400">These files could pass 4 GB, the limit of one ZIP. If they do, the export stops and saves nothing.</p>}
            <p className="text-xs text-muted-foreground">{loopNote}</p>
            {exporting ? (
              <div className="flex flex-col gap-2">
                <div className="h-1.5 overflow-hidden rounded bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={status.total} aria-valuenow={status.done}>
                  <div className="h-full bg-signal" style={{ width: `${(100 * status.done) / status.total}%` }} />
                </div>
                <div className="flex items-center justify-between text-xs tabular-nums">
                  <span data-testid="export-progress">
                    {status.batch ? `Screen ${status.batch.screen} of ${status.batch.screens}: ${status.batch.name}, ${status.batch.done} / ${status.batch.frames}. Total ` : "Encoding "}
                    {status.done} / {status.total}
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => abortRef.current?.abort()}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button onClick={start} disabled={!canExport} data-testid="export-mp4">{batch ? `Export ${batch.files.length} ${batch.files.length === 1 ? "MP4" : "MP4s"}` : "Export MP4"}</Button>
            )}
            {status.kind === "done" && (
              <p className="text-xs text-muted-foreground" data-testid="export-done">
                Saved {status.filename}: {status.width} × {status.height}, {status.frames} frames at {status.fps} fps, {megabytes(status.bytes)}.
              </p>
            )}
            {status.kind === "done-batch" && (
              <p className="text-xs text-muted-foreground" data-testid="export-done">
                Saved {status.filename}: {status.files} {status.files === 1 ? "file" : "files"}, {status.frames} frames each at {status.fps} fps, {megabytes(status.bytes)}.
                {status.skipped.length > 0 && ` Left out: ${status.skipped.join(", ")}.`}
              </p>
            )}
            {status.kind === "cancelled" && <p className="text-xs text-muted-foreground" data-testid="export-cancelled">Cancelled. Nothing was saved.</p>}
            {status.kind === "error" && <p className="text-xs text-destructive" data-testid="export-error">{status.message}</p>}
            {batch && (
              <div className="flex flex-col gap-1" data-testid="batch-files">
                {batch.files.map((f) => (
                  <div key={f.target.id} className="text-xs">
                    <div className="tabular-nums">{f.target.label} · {f.target.width} × {f.target.height}</div>
                    <div className="break-all text-muted-foreground">{f.filename}</div>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">Each file is 1:1. Frame N of every file is the same instant, so play them together.</p>
              </div>
            )}
          </Section>
        )}
        <OutputControls sourceId={OUTPUT_SOURCE_IDS.find((id) => id === sourceId) ?? null} fps={fps} />
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
