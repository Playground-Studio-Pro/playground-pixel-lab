"use client";

import { Layers, Pause, Play, RotateCcw, SquareDashed } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CONTENT_FPS, PATTERNS, PLAYBACK_SPEEDS, type ContentFps, type PatternId, type PlaybackSpeed } from "@/domain/motion";
import { cn } from "@/lib/utils";
import { useMotion, type CanvasMode } from "@/state/motion-store";
import { AuroraControls } from "@/modules/content/aurora-controls";
import { SelectField } from "./fields";
import { IconButton } from "./top-bar";

const patternItems = PATTERNS.map((p) => ({ value: p.id, label: p.name }));
const fpsItems = CONTENT_FPS.map((f) => ({ value: String(f), label: `${f} fps` }));
const speedItems = PLAYBACK_SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }));

function Divider() {
  return <span aria-hidden className="mx-1 h-4 w-px bg-border" />;
}

/** Above the canvas: Mapping or Live preview, and in Live preview the playback controls. */
export function CanvasHeader() {
  const mode = useMotion((s) => s.mode);
  const playing = useMotion((s) => s.clock.playing);
  const pattern = useMotion((s) => s.pattern);
  const fps = useMotion((s) => s.fps);
  const speed = useMotion((s) => s.speed);
  const showGuides = useMotion((s) => s.showGuides);
  const showOverlaps = useMotion((s) => s.showOverlaps);
  const motion = useMotion.getState();
  const live = mode === "live";

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-panel px-2" data-testid="canvas-header">
      <Tabs value={mode} onValueChange={(value) => motion.setMode(value as CanvasMode)}>
        <TabsList className="h-7 rounded p-0.5">
          <TabsTrigger value="mapping" className="rounded-sm px-2.5 text-xs">Mapping</TabsTrigger>
          <TabsTrigger value="live" className="gap-1.5 rounded-sm px-2.5 text-xs data-active:text-motion">
            <span aria-hidden className={cn("size-1.5 rounded-full", live && playing ? "bg-motion motion-safe:animate-pulse" : live ? "bg-motion" : "bg-muted-foreground/60")} />
            Live preview
          </TabsTrigger>
          <TabsTrigger value="depth" className="rounded-sm px-2.5 text-xs" data-testid="depth-tab">Depth Studio</TabsTrigger>
        </TabsList>
      </Tabs>

      {live && (
        <>
          <Divider />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  aria-label={playing ? "Pause (Space)" : "Play (Space)"}
                  onClick={() => motion.togglePlay()}
                  className={cn("rounded", playing ? "bg-motion-strong text-white hover:bg-motion-strong/85" : "bg-secondary text-foreground hover:bg-accent")}
                >
                  {playing ? <Pause /> : <Play />}
                </Button>
              }
            />
            <TooltipContent side="bottom">{playing ? "Pause (Space)" : "Play (Space)"}</TooltipContent>
          </Tooltip>
          <IconButton label="Restart from frame 0" onClick={() => motion.restart()}><RotateCcw /></IconButton>
          <Divider />
          <SelectField ariaLabel="Pattern" className="w-36" value={pattern} items={patternItems} onChange={(v) => motion.setPattern(v as PatternId)} />
          {pattern === "aurora" && <AuroraControls />}
          <SelectField ariaLabel="Target content rate" className="w-[5.5rem]" value={String(fps)} items={fpsItems} onChange={(v) => motion.setFps(Number(v) as ContentFps)} />
          <SelectField ariaLabel="Playback speed" className="w-[4.5rem]" value={String(speed)} items={speedItems} onChange={(v) => motion.setSpeed(Number(v) as PlaybackSpeed)} />
          <Divider />
          <IconButton label="Screen guides" active={showGuides} onClick={() => motion.setShowGuides(!showGuides)}><SquareDashed /></IconButton>
          <IconButton label="Overlaps: shared, conflicting and stage" active={showOverlaps} onClick={() => motion.setShowOverlaps(!showOverlaps)}><Layers /></IconButton>
        </>
      )}
    </div>
  );
}
