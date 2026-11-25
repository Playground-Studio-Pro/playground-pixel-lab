"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const MARGIN = 8;

/**
 * A compact header button that opens settings below it. The panel is fixed to the window: the Live preview
 * header scrolls sideways, and would cut off anything placed inside it.
 */
export function SettingsPopover({ title, label, width, testId, button, children }: { title: string; label: string; width: number; testId: string; button: ReactNode; children: ReactNode }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const open = at !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setAt(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      trigger.current?.focus();
    };
    // Select lists open in a portal: clicks in them stay inside the settings.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t && !root.current?.contains(t) && !t.closest('[role="listbox"],[role="option"]')) close();
    };
    // The button moved, so the panel would no longer be under it.
    const onScroll = (e: Event) => e.target instanceof Node && e.target !== root.current && e.target.contains(root.current) && close();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <div ref={root} className="shrink-0" data-testid={`${testId}-controls`}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={open}
        title={title}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          setAt(open ? null : { left: Math.max(MARGIN, Math.min(box.left, window.innerWidth - width - MARGIN)), top: box.bottom + 4 });
        }}
        className={cn("flex h-7 items-center gap-1.5 rounded border border-border px-1.5 text-xs text-foreground hover:bg-accent", open && "bg-accent")}
        data-testid={`${testId}-settings`}
      >
        {button}
      </button>
      {at && (
        <div
          role="group"
          aria-label={title}
          style={{ left: at.left, top: at.top, width, maxHeight: `calc(100vh - ${at.top + MARGIN}px)` }}
          className="fixed z-50 flex flex-col gap-3 overflow-y-auto rounded-md border border-border bg-panel p-3 shadow-lg"
        >
          {children}
        </div>
      )}
    </div>
  );
}
