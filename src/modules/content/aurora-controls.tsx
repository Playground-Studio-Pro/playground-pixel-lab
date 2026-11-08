"use client";

import { useEffect, useRef, useState } from "react";
import { SelectField } from "@/components/workspace/fields";
import { AURORA_DIRECTIONS, AURORA_PRESETS, AURORA_SPEEDS, type AuroraDirection, type AuroraSpeed } from "@/engines/content/aurora";
import { cn } from "@/lib/utils";
import { useAurora } from "./aurora-store";

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
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const preset = AURORA_PRESETS.find((p) => p.colors.length === settings.colors.length && p.colors.every((c, i) => c === settings.colors[i]))?.id ?? CUSTOM;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    // Select lists open in a portal: clicks in them stay inside the settings.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t && !root.current?.contains(t) && !t.closest('[role="listbox"],[role="option"]')) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0" data-testid="aurora-controls">
      <button
        type="button"
        aria-label="Aurora settings: colors, flow speed and direction"
        aria-expanded={open}
        title="Aurora settings"
        onClick={() => setOpen((v) => !v)}
        className={cn("flex h-7 items-center gap-1.5 rounded border border-border px-1.5 text-xs text-foreground hover:bg-accent", open && "bg-accent")}
        data-testid="aurora-settings"
      >
        <span aria-hidden className="flex">
          {settings.colors.map((c, i) => (
            <span key={i} className="-ml-0.5 size-3 rounded-full border border-panel first:ml-0" style={{ background: c }} />
          ))}
        </span>
        <span aria-hidden className="tabular-nums text-muted-foreground">{ARROWS[settings.direction]} {settings.speed}×</span>
      </button>
      {open && (
        <div role="group" aria-label="Aurora settings" className="absolute top-full left-0 z-50 mt-1 flex w-60 flex-col gap-3 rounded-md border border-border bg-panel p-3 shadow-lg">
          <SelectField label="Palette" value={preset} items={presetItems} onChange={(v) => {
            const p = AURORA_PRESETS.find((x) => x.id === v);
            if (p) aurora.setColors(p.colors);
          }} />
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Colors</span>
            <div className="flex gap-1.5">
              {settings.colors.map((color, i) => (
                <input
                  key={i}
                  type="color"
                  aria-label={`Aurora color ${i + 1}`}
                  title={color}
                  value={color.toLowerCase()}
                  onChange={(e) => aurora.setColor(i, e.target.value)}
                  className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5"
                  data-testid={`aurora-color-${i}`}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <SelectField label="Flow speed" className="w-20" value={String(settings.speed)} items={speedItems} onChange={(v) => aurora.setSpeed(Number(v) as AuroraSpeed)} />
            <SelectField label="Direction" className="flex-1" value={String(settings.direction)} items={directionItems} onChange={(v) => aurora.setDirection(Number(v) as AuroraDirection)} />
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">Flow speed is the content&apos;s own motion. Playback speed and content FPS stay in the header.</p>
        </div>
      )}
    </div>
  );
}
