"use client";

import { useEffect, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { CommitField, intStep, requireWhole, SelectField } from "@/components/workspace/fields";
import { MAX_BUILD_SECONDS, MAX_SEED, MIN_BUILD_SECONDS, type BuildOrder } from "@/engines/content/wall-build/settings";
import { cn } from "@/lib/utils";
import { useWallBuild } from "./wall-build-store";

const ORDERS: readonly { value: BuildOrder; label: string }[] = [
  { value: "bottom-up", label: "Bottom up" },
  { value: "center", label: "From the center" },
  { value: "random", label: "Random" },
];
const COLORS = [
  { key: "helmet", label: "Helmet" },
  { key: "vest", label: "Vest" },
  { key: "background", label: "Background" },
] as const;
const PANEL_WIDTH = 256;

function wholeBetween(text: string, what: string, min: number, max: number): number {
  const value = requireWhole(text, what);
  if (value < min || value > max) throw new Error(`${what} must be between ${min} and ${max}.`);
  return value;
}

/** Wall Build settings, shown in the Live preview header while the source is selected. */
export function WallBuildControls() {
  const settings = useWallBuild((s) => s.settings);
  const { update } = useWallBuild.getState();
  // Fixed to the window: the header scrolls sideways, which would cut off anything below it.
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const open = at !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setAt(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    // Select lists open in a portal: clicks in them stay inside the settings.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t && !root.current?.contains(t) && !t.closest('[role="listbox"],[role="option"]')) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <div ref={root} className="shrink-0" data-testid="wall-build-controls">
      <button
        type="button"
        aria-label="Wall Build settings: order, time, colors, grid and countdown"
        aria-expanded={open}
        title="Wall Build settings"
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          setAt(open ? null : { left: Math.max(8, Math.min(box.left, window.innerWidth - PANEL_WIDTH - 8)), top: box.bottom + 4 });
        }}
        className={cn("flex h-7 items-center gap-1.5 rounded border border-border px-1.5 text-xs text-foreground hover:bg-accent", open && "bg-accent")}
        data-testid="wall-build-settings"
      >
        <span aria-hidden className="flex">
          {COLORS.map(({ key }) => (
            <span key={key} className="-ml-0.5 size-3 rounded-full border border-panel first:ml-0" style={{ background: settings[key] }} />
          ))}
        </span>
        <span aria-hidden className="tabular-nums text-muted-foreground">{ORDERS.find((o) => o.value === settings.order)?.label} {settings.buildSeconds} s</span>
      </button>
      {at && (
        <div role="group" aria-label="Wall Build settings" style={{ left: at.left, top: at.top, width: PANEL_WIDTH }} className="fixed z-50 flex flex-col gap-3 rounded-md border border-border bg-panel p-3 shadow-lg">
          <SelectField label="Build order" value={settings.order} items={ORDERS} onChange={(v) => update({ order: v as BuildOrder })} />
          <div className="flex gap-2">
            <CommitField label="Build time" suffix="s" className="flex-1" value={String(settings.buildSeconds)} step={intStep} onCommit={(t) => update({ buildSeconds: wholeBetween(t, "Build time", MIN_BUILD_SECONDS, MAX_BUILD_SECONDS) })} />
            {settings.order === "random" && (
              <CommitField label="Seed" className="flex-1" value={String(settings.seed)} step={intStep} onCommit={(t) => update({ seed: wholeBetween(t, "Seed", 0, MAX_SEED) })} />
            )}
          </div>
          <div className="flex gap-2">
            {COLORS.map(({ key, label }) => (
              <label key={key} className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
                {label}
                <input
                  type="color"
                  title={settings[key]}
                  value={settings[key].toLowerCase()}
                  onChange={(e) => update({ [key]: e.target.value })}
                  className="h-7 w-full cursor-pointer rounded border border-border bg-transparent p-0.5"
                  data-testid={`wall-build-${key}`}
                />
              </label>
            ))}
          </div>
          <div className="flex gap-4">
            <Label className="text-xs font-normal"><Checkbox checked={settings.grid} onCheckedChange={(v) => update({ grid: v === true })} />Grid</Label>
            <Label className="text-xs font-normal"><Checkbox checked={settings.countdown} onCheckedChange={(v) => update({ countdown: v === true })} />Countdown</Label>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">Restart plays the build from the beginning. The finished wall holds. Settings aren&apos;t saved with the project.</p>
        </div>
      )}
    </div>
  );
}
