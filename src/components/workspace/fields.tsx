"use client";

import { useId, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const fieldInput = "h-7 rounded px-2 text-[13px] tabular-nums md:text-[13px]";

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-b border-border px-3 py-3">
      <div className="mb-2 flex h-5 items-center justify-between">
        <h3 className="text-xs font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

export function Readout({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-right tabular-nums", strong && "font-semibold")}>{value}</span>
    </div>
  );
}

interface CommitFieldProps {
  label: string;
  value: string;
  suffix?: string;
  disabled?: boolean;
  /** Applies the text. Throw to reject it: the message shows under the field. */
  onCommit(text: string): void;
  /** Enables arrow-key stepping when set. */
  step?: (current: string, delta: number) => string | null;
  className?: string;
}

/** A text field that applies on Enter or blur, reverts on Escape and shows validation inline. */
export function CommitField({ label, value, suffix, disabled, onCommit, step, className }: CommitFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const commit = (text: string) => {
    if (text === value) {
      setDraft(null);
      setError(null);
      return;
    }
    try {
      onCommit(text);
      setDraft(null);
      setError(null);
    } catch (e) {
      setDraft(text);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">{label}</Label>
      <div className="relative">
        <Input
          id={id}
          value={draft ?? value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(fieldInput, suffix && "pr-7")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== null && commit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(draft ?? value);
            if (e.key === "Escape") {
              setDraft(null);
              setError(null);
            }
            if (step && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
              e.preventDefault();
              const delta = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1);
              const next = step(draft ?? value, delta);
              if (next !== null) commit(next);
            }
          }}
        />
        {suffix && <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
      </div>
      {error && <p id={`${id}-error`} className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

const WHOLE = /^-?\d+$/;

export function intStep(current: string, delta: number): string | null {
  return WHOLE.test(current.trim()) ? String(Number(current) + delta) : null;
}

/** Parses whole-number field text, or throws a message for the field to show. */
export function requireWhole(text: string, what: string): number {
  if (!WHOLE.test(text.trim())) throw new Error(`${what} must be a whole number.`);
  return Number(text);
}

export function SelectField({
  label,
  value,
  items,
  onChange,
  className,
  disabled,
  ariaLabel,
  triggerClassName,
}: {
  label?: string;
  /** Names the field when there's no visible label. */
  ariaLabel?: string;
  triggerClassName?: string;
  value: string;
  items: readonly { value: string; label: string }[];
  onChange(value: string): void;
  className?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      {label && <Label id={id} className="text-xs font-normal text-muted-foreground">{label}</Label>}
      <Select
        value={value}
        items={items as { value: string; label: string }[]}
        disabled={disabled}
        onValueChange={(v) => v !== null && onChange(v as string)}
      >
        <SelectTrigger size="sm" aria-labelledby={label ? id : undefined} aria-label={label ? undefined : ariaLabel} className={cn("w-full min-w-0 rounded text-[13px]", triggerClassName)}>
          <SelectValue className="truncate" />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value} className="text-[13px]">{item.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
