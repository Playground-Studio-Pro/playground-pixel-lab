"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { PATTERNS } from "@/domain/motion";
import { contentTime, frameAt, timecode } from "@/engines/motion/clock";
import { emptyStats, previewFps, recordFrame, type PreviewStats } from "@/engines/motion/metrics";
import { overlapMarks, previewRegions } from "@/engines/motion/regions";
import { screenToWorld } from "@/engines/viewport";
import { LiveRenderer, type LiveScene } from "@/preview/live-renderer";
import { useMotion } from "@/state/motion-store";
import { useAurora } from "@/modules/content/aurora-store";
import { MODULE_SOURCES } from "@/modules/catalog";
import { findSource } from "@/modules/registry";
import { selectedScreenIds, useApp } from "@/state/store";
import { useUi } from "@/state/ui-store";
import { buildViewModel } from "@/state/view-model";
import { useCanvasViewport } from "@/components/workspace/use-canvas-viewport";

const READOUT_MS = 250;

/** True when Space belongs to the focused control: a field, a button or a list. */
function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "BUTTON" || target.isContentEditable || target.getAttribute("role") === "combobox";
}

/**
 * Motion Lab live preview. Animated content, drawn once per content frame on the master canvas and
 * composited into each screen where the current view places it. Playback runs outside React:
 * the animation loop reads stores directly and writes readouts straight to the DOM.
 */
export default function LivePreviewPanel() {
  const project = useApp((s) => s.project)!;
  const mapping = useApp((s) => s.mapping)!;
  const issues = useApp((s) => s.issues);
  const view = useApp((s) => s.view);
  const activeOutputId = useApp((s) => s.activeOutputId);
  const selection = useApp((s) => s.selection);
  const viewport = useApp((s) => s.viewports[s.view]);
  const size = useApp((s) => s.canvasSize);
  const pattern = useMotion((s) => s.pattern);
  const sourceId = useMotion((s) => s.sourceId);
  const fps = useMotion((s) => s.fps);
  const playClock = useMotion((s) => s.clock);
  const playing = playClock.playing;
  const showGuides = useMotion((s) => s.showGuides);
  const showOverlaps = useMotion((s) => s.showOverlaps);
  const statsEpoch = useMotion((s) => s.statsEpoch);
  const aurora = useAurora((s) => s.settings);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<LiveRenderer | null>(null);
  const frameText = useRef<HTMLSpanElement>(null);
  const timecodeText = useRef<HTMLSpanElement>(null);
  const fpsText = useRef<HTMLSpanElement>(null);
  const lateText = useRef<HTMLSpanElement>(null);
  const skippedText = useRef<HTMLSpanElement>(null);

  useCanvasViewport(containerRef);

  const scene = useMemo<LiveScene>(() => {
    const model = buildViewModel(project, mapping, view, activeOutputId);
    const regions = previewRegions(model.items, mapping);
    return {
      regions,
      frames: model.frames.filter((f) => f.kind !== "canvas"),
      overlaps: overlapMarks(regions, issues, mapping, view),
      masterWidth: mapping.master.width,
      masterHeight: mapping.master.height,
      screens: mapping.screens.map((s) => ({ id: s.screenId, name: s.name, x: s.masterRect.x, y: s.masterRect.y, width: s.masterRect.width, height: s.masterRect.height })),
      unit: model.unit,
      selectedIds: new Set(selectedScreenIds(selection, project)),
    };
  }, [project, mapping, issues, view, activeOutputId, selection]);

  // The latest values, for the animation loop, which must not restart on every change.
  // `resync` is set when the preview becomes visible again, so time spent hidden isn't counted as late or skipped.
  const context = useMemo(() => ({ project, mapping }), [project, mapping]);
  const live = useRef({ scene, viewport, context, dirty: true, visible: true, resync: false, lastFrame: -1 });
  useEffect(() => {
    live.current.scene = scene;
    live.current.viewport = viewport;
    live.current.context = context;
    live.current.dirty = true;
  }, [scene, viewport, context, size, pattern, sourceId, fps, showGuides, showOverlaps, aurora]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new LiveRenderer(canvas, getComputedStyle(document.body).fontFamily);
    rendererRef.current = renderer;
    useMotion.getState().startPendingPlayback();
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.resize(size.width, size.height, window.devicePixelRatio || 1);
    live.current.dirty = true;
  }, [size]);

  // Draws the current frame if anything changed. Returns the content frame shown.
  // Reads only refs and store snapshots, so it never needs to change.
  const draw = useCallback((now: number) => {
    const motion = useMotion.getState();
    const frame = frameAt(contentTime(motion.clock, now), motion.fps);
    const state = live.current;
    const renderer = rendererRef.current;
    if (renderer && state.viewport && (state.dirty || frame !== state.lastFrame)) {
      renderer.render(state.scene, state.viewport, {
        pattern: motion.pattern,
        source: motion.sourceId ? findSource(motion.sourceId) : null,
        context: state.context,
        frame,
        fps: motion.fps,
        guides: motion.showGuides,
        overlaps: motion.showOverlaps,
        options: { aurora: useAurora.getState().settings },
      });
      state.dirty = false;
      if (frame !== state.lastFrame) {
        if (frameText.current) frameText.current.textContent = String(frame).padStart(6, "0");
        if (timecodeText.current) timecodeText.current.textContent = timecode(frame, motion.fps);
      }
      state.lastFrame = frame;
    }
    return frame;
  }, []);

  // Still frame whenever something changes while paused, including Restart.
  useEffect(() => {
    if (!playClock.playing) {
      live.current.dirty = true;
      draw(performance.now());
    }
  }, [draw, playClock, scene, viewport, size, pattern, sourceId, fps, showGuides, showOverlaps, aurora]);

  // A source can change without a new input (settings, a logo that just loaded): redraw when it says so.
  useEffect(() => {
    const source = sourceId ? findSource(sourceId) : null;
    return source?.subscribe?.(() => {
      live.current.dirty = true;
      if (!useMotion.getState().clock.playing) draw(performance.now());
    });
  }, [sourceId, draw]);

  // Animation loop: only while playing and visible.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last: number | null = null;
    let stats: PreviewStats = emptyStats;
    let lastReadout = 0;
    const writeStats = () => {
      const measured = previewFps(stats);
      if (fpsText.current) fpsText.current.textContent = measured === null ? "measuring" : `${measured.toFixed(1)} fps`;
      if (lateText.current) lateText.current.textContent = String(stats.late);
      if (skippedText.current) skippedText.current.textContent = String(stats.skipped);
    };
    writeStats();
    const tick = (now: number) => {
      if (!live.current.visible || document.hidden) {
        // Nothing is drawn while hidden.
        live.current.resync = true;
        raf = requestAnimationFrame(tick);
        return;
      }
      if (live.current.resync) {
        live.current.resync = false;
        last = null;
        stats = { ...stats, lastContentFrame: null };
      }
      const frame = draw(now);
      stats = recordFrame(stats, last === null ? null : now - last, frame);
      last = now;
      if (now - lastReadout > READOUT_MS) {
        lastReadout = now;
        writeStats();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [draw, playing, statsEpoch]);

  // Stop drawing when the preview is scrolled away or its tab is hidden. Browsers also stop
  // animation frames in hidden tabs; either way the measurement restarts cleanly on return.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      live.current.visible = entry.isIntersecting;
      live.current.dirty = true;
      live.current.resync = true;
    });
    const onVisibility = () => {
      live.current.dirty = true;
      live.current.resync = true;
    };
    observer.observe(el);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Space plays and pauses, unless typing or a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const ui = useUi.getState();
      if (ui.dialog || ui.confirm) return;
      e.preventDefault();
      useMotion.getState().togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Drag pans. A click selects the screen under the pointer, so the inspector follows.
  const press = useRef<{ x: number; y: number; moved: boolean; origin: NonNullable<typeof viewport> } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    const vp = useApp.getState().viewports[view];
    if (!vp) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { x: e.clientX, y: e.clientY, moved: false, origin: vp };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < 3) return;
    p.moved = true;
    useApp.getState().setViewport(view, { ...p.origin, offsetX: p.origin.offsetX + dx, offsetY: p.origin.offsetY + dy });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    press.current = null;
    if (!p || p.moved) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const world = screenToWorld(p.origin, e.clientX - rect.left, e.clientY - rect.top);
    // Topmost first: later screens draw over earlier ones.
    const hit = [...scene.regions].reverse().find((r) => world.x >= r.dest.x && world.x < r.dest.x + r.dest.width && world.y >= r.dest.y && world.y < r.dest.y + r.dest.height);
    useApp.getState().select(hit ? { kind: "screens", ids: [hit.screenId] } : { kind: "none" });
  };

  const info = (sourceId && MODULE_SOURCES.find((s) => s.id === sourceId)) || PATTERNS.find((p) => p.id === pattern)!;
  const empty = mapping.screens.length === 0;

  return (
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-stage" aria-label="Live preview">
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
        data-testid="live-preview"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (press.current = null)}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label={`${info.name} on ${mapping.screens.length} screens`} role="img" />
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center text-center">
            <p className="text-muted-foreground">Add a screen in Mapping to preview content on it.</p>
          </div>
        )}
      </div>
      <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-panel px-3 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        <span className="flex items-baseline gap-1.5">
          Frame <span ref={frameText} className="font-semibold text-foreground" data-testid="motion-frame">000000</span>
          <span ref={timecodeText} className="text-foreground" data-testid="motion-timecode">00:00:00:00</span>
        </span>
        <span>
          Target <span className="text-foreground" data-testid="motion-target">{fps} fps</span>
        </span>
        <span title="How fast this browser is drawing the preview. It says nothing about the LED panel's refresh rate.">
          Preview <span ref={fpsText} className="text-foreground" data-testid="motion-preview-fps">{playing ? "measuring" : "paused"}</span>
        </span>
        <span title="Browser frames that arrived well after the usual interval.">
          Late <span ref={lateText} className="text-foreground" data-testid="motion-late">0</span>
        </span>
        <span title="Content frames that were due but never drawn: the browser fell behind, or the speed asks for more frames than the display shows.">
          Skipped <span ref={skippedText} className="text-foreground" data-testid="motion-skipped">0</span>
        </span>
        <span className="ml-auto truncate" title={info.checks}>{info.checks}</span>
      </footer>
    </main>
  );
}
