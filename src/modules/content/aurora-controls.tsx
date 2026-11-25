"use client";

import { SelectField } from "@/components/workspace/fields";
import { AURORA_DIRECTIONS, AURORA_PRESETS, AURORA_SPEEDS, type AuroraDirection, type AuroraSpeed } from "@/engines/content/aurora";
import { useAurora } from "./aurora-store";
import { SettingsPopover } from "./settings-popover";
import { ColorField } from "./value-fields";

const ARROWS: Record<AuroraDirection, string> = { 0: "→", 45: "↘", 90: "↓", 135: "↙", 180: "←", 225: "↖", 270: "↑", 315: "↗" };
const NAMES: Record<AuroraDirection, string> = { 0: "Right", 45: "Down right", 90: "Down", 135: "Down left", 180: "Left", 225: "Up left", 270: "Up", 315: "Up right" };
const CUSTOM = "custom";

const presetItems = [...AURORA_PRESETS.map((p) => ({ value: p.id, label: p.name })), { value: CUSTOM, label: "Custom" }];
const speedItems = AURORA_SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }));
const directionItems = AURORA_DIRECTIONS.map((d) => ({ value: String(d), label: `${ARROWS[d]} ${NAMES[d]}` }));

/**
 * Aurora Gradient settings, shown in the Live preview header while the pattern is selected.
 * One compact button (the palette and direction at a glance) opens the settings below it,
 * so the header keeps its width.
 */
export function AuroraControls() {
  const settings = useAurora((s) => s.settings);
  const aurora = useAurora.getState();
  const preset = AURORA_PRESETS.find((p) => p.colors.length === settings.colors.length && p.colors.every((c, i) => c === settings.colors[i]))?.id ?? CUSTOM;

  return (
    <SettingsPopover
      title="Aurora settings"
      label="Aurora settings: colors, flow speed and direction"
      width={240}
      testId="aurora"
      button={
        <>
          <span aria-hidden className="flex">
            {settings.colors.map((c, i) => (
              <span key={i} className="-ml-0.5 size-3 rounded-full border border-panel first:ml-0" style={{ background: c }} />
            ))}
          </span>
          <span aria-hidden className="tabular-nums text-muted-foreground">{ARROWS[settings.direction]} {settings.speed}×</span>
        </>
      }
    >
      <SelectField label="Palette" value={preset} items={presetItems} onChange={(v) => {
        const p = AURORA_PRESETS.find((x) => x.id === v);
        if (p) aurora.setColors(p.colors);
      }} />
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Colors</span>
        {settings.colors.map((color, i) => (
          <ColorField key={i} hideLabel label={`Aurora color ${i + 1}`} value={color} testId={`aurora-color-${i}`} onChange={(c) => aurora.setColor(i, c)} />
        ))}
      </div>
      <div className="flex gap-2">
        <SelectField label="Flow speed" className="w-20" value={String(settings.speed)} items={speedItems} onChange={(v) => aurora.setSpeed(Number(v) as AuroraSpeed)} />
        <SelectField label="Direction" className="flex-1" value={String(settings.direction)} items={directionItems} onChange={(v) => aurora.setDirection(Number(v) as AuroraDirection)} />
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">Flow speed is the content&apos;s own motion. Playback speed and content FPS stay in the header.</p>
    </SettingsPopover>
  );
}
