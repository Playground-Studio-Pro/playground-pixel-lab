"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** A compact one-of-many control for toolbars: modes, zoom, logo placement. */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange(value: T): void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex h-7 shrink-0 items-center rounded border border-border bg-background p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-6 rounded-sm px-2.5 text-xs whitespace-nowrap outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring/60",
            option.value === value ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** An on/off element switch. The check mark carries the state, so it never depends on color alone. */
export function ToggleChip({ label, pressed, onChange }: { label: string; pressed: boolean; onChange(pressed: boolean): void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-xs whitespace-nowrap outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring/60",
        pressed ? "border-border bg-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      <span className="flex size-3 items-center justify-center rounded-[2px] border border-input">{pressed && <Check className="size-2.5" strokeWidth={3} />}</span>
      {label}
    </button>
  );
}

/** A label for a group of toolbar controls. */
export function ToolLabel({ children }: { children: string }) {
  return <span className="shrink-0 text-[11px] tracking-wide text-muted-foreground uppercase">{children}</span>;
}
