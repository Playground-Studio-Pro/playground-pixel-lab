"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { depthCamera, depthWindow, projectPoint, vanishingPoint } from "@/engines/depth/camera";
import { loopFrameCount } from "@/engines/depth/config";
import { depthTargets, pickDepthTarget } from "@/engines/depth/targets";
import { timecode } from "@/engines/motion/clock";
import { emptyStats, previewFps, recordFrame, type PreviewStats } from "@/engines/motion/metrics";
import { cn } from "@/lib/utils";
import { useApp } from "@/state/store";
import { useUi } from "@/state/ui-store";
import { depthFrameAt, useDepth } from "./depth-store";
import { DepthRenderer } from "./renderer";

const READOUT_MS = 250;
/** The preview never renders more than this many device pixels per CSS pixel. */
const MAX_PREVIEW_DPR = 2;
const FRAME_MARGIN = 24;

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "BUTTON" || target.isContentEditable || target.getAttribute("role") === "combobox";
}

/**
 * Depth Studio viewport: the scene, framed for the chosen canvas or screen at its exact aspect ratio.
 * Playback runs outside React: the animation loop reads the store and writes readouts straight to the DOM.
 */
export default function DepthPanel() {
  const mapping = useApp((s) => s.mapping)!;
  const config = useDepth((s) => s.config);
  const targetId = useDepth((s) => s.targetId);
  const playing = useDepth((s) => s.clock.playing);
  const playClock = useDepth((s) => s.clock);
  const showGuides = useDepth((s) => s.showGuides);
  const statsEpoch = useDepth((s) => s.statsEpoch);

  const target = useMemo(() => pickDepthTarget(depthTargets(mapping), targetId), [mapping, targetId]);
  const window_ = useMemo(() => (target ? depthWindow(target) : null), [target]);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<DepthRenderer | null>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const frameText = useRef<HTMLSpanElement>(null);
  const timecodeText = useRef<HTMLSpanElement>(null);
  const fpsText = useRef<HTMLSpanElement>(null);

  const [box, setBox] = useState({ width: 0, height: 0 });
  const [problem, setProblem] = useState<string | null>(null);
  const [contextLost, setContextLost] = useState(false);

  // The space available for the image.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The image, fitted inside that space at the target's aspect ratio.
  const fitted = useMemo(() => {
    if (!target || box.width <= 2 * FRAME_MARGIN || box.height <= 2 * FRAME_MARGIN) return null;
    const scale = Math.min((box.width - 2 * FRAME_MARGIN) / target.widthPx, (box.height - 2 * FRAME_MARGIN) / target.heightPx);
    return { width: target.widthPx * scale, height: target.heightPx * scale, scale };
  }, [target, box]);

  const live = useRef({ dirty: true, lastFrame: -1 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: DepthRenderer;
    try {
      renderer = new DepthRenderer(canvas, (lost) => {
        setContextLost(lost);
        live.current.dirty = true;
      });
    } catch (e) {
      // Runs once on mount, to report that this browser can't draw the scene.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProblem(e instanceof Error ? e.message : String(e));
      return;
    }
    rendererRef.current = renderer;
    // Opening the studio starts the loop, as a response to the click. Reduced motion leaves it paused.
    if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) useDepth.getState().play();
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  // Scene and size reach the renderer here. Neither restarts the animation loop.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !window_ || !fitted || !target) return;
    renderer.setScene(config, window_);
    // Never more pixels than the wall has, nor more than the GPU can draw.
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_PREVIEW_DPR);
    const scale = Math.min(1, (fitted.width * dpr) / target.widthPx, renderer.maxSize / target.widthPx, renderer.maxSize / target.heightPx);
    renderer.resize(Math.max(1, Math.round(target.widthPx * scale)), Math.max(1, Math.round(target.heightPx * scale)));
    live.current.dirty = true;
  }, [config, window_, fitted, target]);

  const draw = useCallback((now: number) => {
    const state = useDepth.getState();
    const frame = depthFrameAt(state, now);
    const renderer = rendererRef.current;
    if (renderer && (live.current.dirty || frame !== live.current.lastFrame)) {
      renderer.renderFrame(frame);
      live.current.dirty = false;
      if (frame !== live.current.lastFrame) {
        if (frameText.current) frameText.current.textContent = String(frame).padStart(4, "0");
        if (timecodeText.current) timecodeText.current.textContent = timecode(frame, state.config.fps);
        if (scrubRef.current && document.activeElement !== scrubRef.current) scrubRef.current.value = String(frame);
      }
      live.current.lastFrame = frame;
    }
    return frame;
  }, []);

  // Still frame whenever something changes while paused, including a scrub.
  useEffect(() => {
    if (!playClock.playing) {
      live.current.dirty = true;
      draw(performance.now());
    }
  }, [draw, playClock, config, window_, fitted, contextLost]);

  // Animation loop: only while playing and visible.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last: number | null = null;
    let stats: PreviewStats = emptyStats;
    let lastReadout = 0;
    const tick = (now: number) => {
      if (document.hidden) {
        last = null;
        raf = requestAnimationFrame(tick);
        return;
      }
      const frame = draw(now);
      stats = recordFrame(stats, last === null ? null : now - last, frame);
      last = now;
      if (now - lastReadout > READOUT_MS) {
        lastReadout = now;
        const measured = previewFps(stats);
        if (fpsText.current) fpsText.current.textContent = measured === null ? "measuring" : `${measured.toFixed(1)} fps`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [draw, playing, statsEpoch]);

  // Space plays and pauses, unless typing or a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const ui = useUi.getState();
      if (ui.dialog || ui.confirm) return;
      e.preventDefault();
      useDepth.getState().togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Perspective guides: editor only, drawn over the image and never part of it.
  const guides = useMemo(() => {
    if (!showGuides || !window_) return null;
    const camera = depthCamera(window_, config.viewer, config.room.depthM);
    const hw = window_.widthM / 2;
    const hh = window_.heightM / 2;
    const corners = [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]] as const;
    return {
      vanishing: vanishingPoint(window_, config.viewer),
      back: corners.map(([x, y]) => projectPoint(camera, [x, y, -config.room.depthM])),
    };
  }, [showGuides, window_, config.viewer, config.room.depthM]);

  const frames = loopFrameCount(config);
  const preset = "Emerald Chamber";

  return (
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-stage" aria-label="Depth Studio">
      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden" data-testid="depth-viewport">
        <div
          className={cn("absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_24px_80px_rgba(0,0,0,0.6)]", !fitted && "invisible")}
          style={fitted ? { width: fitted.width, height: fitted.height } : undefined}
        >
          <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label={target ? `${preset} on ${target.name}, ${target.widthPx} by ${target.heightPx} pixels` : preset} data-testid="depth-canvas" />
          {guides && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden data-testid="depth-guides">
              <g stroke="var(--signal)" strokeWidth="1" vectorEffect="non-scaling-stroke" fill="none" opacity="0.85">
                {[[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y], i) => (
                  <line key={i} x1={x} y1={y} x2={guides.vanishing.x} y2={guides.vanishing.y} vectorEffect="non-scaling-stroke" strokeDasharray="4 4" />
                ))}
                <polygon points={guides.back.map((p) => `${p.x},${p.y}`).join(" ")} vectorEffect="non-scaling-stroke" />
              </g>
            </svg>
          )}
        </div>
        {target && fitted && (
          <p className="absolute top-2 left-3 text-xs text-muted-foreground tabular-nums" data-testid="depth-target">
            {target.name} · <span className="text-foreground">{target.widthPx} × {target.heightPx} px</span>
            {window_ && <> · {window_.calibration === "physical" ? `${window_.widthM.toFixed(2)} × ${window_.heightM.toFixed(2)} m` : "proportional framing"}</>}
          </p>
        )}
        {(problem || contextLost || !target) && (
          <div className="absolute inset-0 flex items-center justify-center bg-stage/90 p-6 text-center" role="status">
            <p className="max-w-sm text-muted-foreground">
              {problem ?? (contextLost ? "The graphics driver reset. The scene returns as soon as the browser restores it." : "Add a screen in Mapping to give the scene a canvas.")}
            </p>
          </div>
        )}
      </div>

      <div className="flex h-9 shrink-0 items-center gap-2 border-t border-border bg-panel px-2">
        <Button
          size="icon-sm"
          aria-label={playing ? "Pause (Space)" : "Play (Space)"}
          onClick={() => useDepth.getState().togglePlay()}
          className={cn("rounded", playing ? "bg-motion-strong text-white hover:bg-motion-strong/85" : "bg-secondary text-foreground hover:bg-accent")}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button variant="ghost" size="icon-sm" className="rounded" aria-label="Back to the first frame" onClick={() => useDepth.getState().restart()}>
          <RotateCcw />
        </Button>
        <input
          ref={scrubRef}
          type="range"
          min={0}
          max={frames - 1}
          step={1}
          defaultValue={0}
          aria-label="Loop position, in frames"
          className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--motion)]"
          onInput={(e) => useDepth.getState().seek(Number(e.currentTarget.value))}
          onPointerUp={(e) => e.currentTarget.blur()}
          data-testid="depth-scrub"
        />
        <span className="flex items-baseline gap-1.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          Frame <span ref={frameText} className="font-semibold text-foreground" data-testid="depth-frame">0000</span>
          <span>of {frames}</span>
          <span ref={timecodeText} className="text-foreground" data-testid="depth-timecode">00:00:00:00</span>
        </span>
      </div>
      <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-panel px-3 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        <span>
          Loop <span className="text-foreground">{config.durationSeconds} s</span>
        </span>
        <span title="The rate the loop is designed to play and export at.">
          Content <span className="text-foreground">{config.fps} fps</span>
        </span>
        <span title="How fast this browser is drawing the preview. It says nothing about the LED panel's refresh rate.">
          Preview <span ref={fpsText} className="text-foreground" data-testid="depth-preview-fps">{playing ? "measuring" : "paused"}</span>
        </span>
        <span className="ml-auto truncate">Frontal depth, tuned for one viewing position. Not anamorphic calibration.</span>
      </footer>
    </main>
  );
}
