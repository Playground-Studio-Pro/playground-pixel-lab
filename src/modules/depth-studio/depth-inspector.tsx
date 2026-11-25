"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Readout, Section, SelectField } from "@/components/workspace/fields";
import { CONTENT_FPS, type ContentFps } from "@/domain/motion";
import { depthWindow } from "@/engines/depth/camera";
import { DEPTH_LIMITS, DEPTH_PRESETS, loopFrameCount } from "@/engines/depth/config";
import { depthTargets, pickDepthTarget } from "@/engines/depth/targets";
import { ColorField, RangeField } from "@/modules/content/value-fields";
import { useApp } from "@/state/store";
import { useDepth } from "./depth-store";

const fpsItems = CONTENT_FPS.map((f) => ({ value: String(f), label: `${f} fps` }));
const presetItems = DEPTH_PRESETS.map((p) => ({ value: p.id, label: p.name }));

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) {
  return (
    <Label className="flex items-center gap-2 text-xs font-normal">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      {label}
    </Label>
  );
}

/** Depth Studio's controls. Shown in place of the mapping inspector while the studio is open. */
export default function DepthInspector() {
  const mapping = useApp((s) => s.mapping)!;
  const config = useDepth((s) => s.config);
  const presetId = useDepth((s) => s.presetId);
  const targetId = useDepth((s) => s.targetId);
  const showGuides = useDepth((s) => s.showGuides);
  const { patch, applyPreset, setTarget, setShowGuides } = useDepth.getState();

  const targets = useMemo(() => depthTargets(mapping), [mapping]);
  const target = pickDepthTarget(targets, targetId);
  const window_ = target ? depthWindow(target) : null;
  const targetItems = targets.map((t) => ({ value: t.id, label: `${t.name} · ${t.widthPx} × ${t.heightPx}` }));
  const L = DEPTH_LIMITS;

  return (
    <aside className="min-h-0 border-l border-border bg-panel" aria-label="Depth Studio controls">
      <ScrollArea className="h-full">
        <Section title="Scene" action={<Button variant="ghost" size="sm" className="h-6 rounded px-2 text-xs" onClick={() => applyPreset(presetId)}>Reset</Button>}>
          <SelectField label="Preset" value={presetId} items={presetItems} onChange={applyPreset} />
          {target ? (
            <>
              <SelectField label="Framed for" value={target.id} items={targetItems} onChange={setTarget} />
              <Readout strong label="Resolution" value={`${target.widthPx} × ${target.heightPx} px`} />
              <Readout label="Wall size" value={window_?.calibration === "physical" ? `${window_.widthM.toFixed(2)} × ${window_.heightM.toFixed(2)} m` : "Not known: proportional"} />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Add a screen in Mapping to frame the scene.</p>
          )}
        </Section>

        <Section title="Depth">
          <RangeField label="Virtual depth" unit="m" value={config.room.depthM} limit={L.depthM} onChange={(depthM) => patch({ room: { depthM } })} />
          <CheckRow label="Depth grid" checked={config.room.showGrid} onChange={(showGrid) => patch({ room: { showGrid } })} />
          <CheckRow label="Perspective guides (editor only)" checked={showGuides} onChange={setShowGuides} />
        </Section>

        <Section title="Viewer">
          <RangeField label="Distance" unit="m" value={config.viewer.distanceM} limit={L.distanceM} onChange={(distanceM) => patch({ viewer: { distanceM } })} />
          <RangeField label="Left / right" unit="m" value={config.viewer.offsetXM} limit={L.offsetXM} onChange={(offsetXM) => patch({ viewer: { offsetXM } })} />
          <RangeField label="Down / up from centre" unit="m" value={config.viewer.offsetYM} limit={L.offsetYM} onChange={(offsetYM) => patch({ viewer: { offsetYM } })} />
        </Section>

        <Section title="Particles">
          <CheckRow label="Show particles" checked={config.particles.enabled} onChange={(enabled) => patch({ particles: { enabled } })} />
          <RangeField whole label="Density" value={config.particles.count} limit={L.count} onChange={(count) => patch({ particles: { count } })} />
          <RangeField label="Motion speed" unit="×" value={config.particles.speed} limit={L.speed} onChange={(speed) => patch({ particles: { speed } })} />
        </Section>

        <Section title="Light">
          <RangeField label="Intensity" value={config.lighting.intensity} limit={L.intensity} onChange={(intensity) => patch({ lighting: { intensity } })} />
          <RangeField label="Sweep direction" unit="°" value={config.lighting.directionDeg} limit={L.directionDeg} onChange={(directionDeg) => patch({ lighting: { directionDeg } })} />
          <RangeField label="Fog" value={config.atmosphere.fogDensity} limit={L.fogDensity} onChange={(fogDensity) => patch({ atmosphere: { fogDensity } })} />
        </Section>

        <Section title="Palette">
          <div className="flex gap-2">
            <ColorField stacked label="Deep" value={config.palette.background} onChange={(background) => patch({ palette: { background } })} />
            <ColorField stacked label="Leaf" value={config.palette.particle} onChange={(particle) => patch({ palette: { particle } })} />
            <ColorField stacked label="Highlight" value={config.palette.accent} onChange={(accent) => patch({ palette: { accent } })} />
          </div>
        </Section>

        <Section title="Loop">
          <RangeField whole label="Length" unit="s" value={config.durationSeconds} limit={L.durationSeconds} onChange={(durationSeconds) => patch({ durationSeconds })} />
          <SelectField label="Content rate" value={String(config.fps)} items={fpsItems} onChange={(v) => patch({ fps: Number(v) as ContentFps })} />
          <RangeField whole label="Seed" value={config.seed} limit={L.seed} slider={{ ...L.seed, max: 9999 }} onChange={(seed) => patch({ seed })} />
          <Readout label="Frames in the loop" value={loopFrameCount(config)} />
        </Section>
      </ScrollArea>
    </aside>
  );
}
