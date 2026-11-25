"use client";

import { useId, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatNumber, parseTypedColor, parseTypedNumber, stepTypedNumber, type Typed, type ValueLimit } from "@/engines/content/typed-value";
import { cn } from "@/lib/utils";

/**
 * Typed values for Content, with the same rules as the inspector's `CommitField`: Enter or leaving the field
 * applies, Escape cancels, arrows step (Shift for 10). Text that can't be used keeps the old value and says
 * why. A number out of range is brought to its limit, and that's said too.
 */

interface TypedInputProps<T> {
  id: string;
  /** The current value as text. */
  value: string;
  parse(text: string): Typed<T>;
  onCommit(value: T): void;
  step?(text: string, steps: number): string | null;
  /** Receives the message to show: why text was refused, or the limit that was applied. */
  onMessage(message: { text: string; error: boolean } | null): void;
  describedBy?: string;
  invalid?: boolean;
  ariaLabel?: string;
  inputMode?: "decimal" | "numeric" | "text";
  className?: string;
}

function TypedInput<T>({ id, value, parse, onCommit, step, onMessage, describedBy, invalid, ariaLabel, inputMode, className }: TypedInputProps<T>) {
  const [draft, setDraft] = useState<string | null>(null);
  // The slider, the picker or undo changed the value: what was left half typed no longer applies.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(null);
  }

  const commit = (text: string) => {
    if (text.trim() === value) {
      setDraft(null);
      onMessage(null);
      return;
    }
    const typed = parse(text);
    if (!typed.ok) {
      setDraft(text);
      onMessage({ text: typed.reason, error: true });
      return;
    }
    onCommit(typed.value);
    setDraft(null);
    onMessage(typed.limited ? { text: typed.limited, error: false } : null);
  };

  return (
    <Input
      id={id}
      value={draft ?? value}
      inputMode={inputMode}
      spellCheck={false}
      autoComplete="off"
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn("h-6 rounded px-1.5 text-xs tabular-nums md:text-xs", className)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== null && commit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(draft ?? value);
        if (e.key === "Escape" && draft !== null) {
          // Cancels the edit only: an enclosing panel stays open, and the canvas keeps its selection.
          e.stopPropagation();
          setDraft(null);
          onMessage(null);
        }
        if (step && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          const next = step(draft ?? value, (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1));
          if (next !== null) commit(next);
        }
      }}
    />
  );
}

function Message({ id, message }: { id: string; message: { text: string; error: boolean } | null }) {
  if (!message) return null;
  return <p id={id} role="status" className={cn("text-xs", message.error ? "text-destructive" : "text-warn")}>{message.text}</p>;
}

/** A slider with an editable number beside it. `slider` narrows what the slider covers; typing reaches all of `limit`. */
export function RangeField({ label, value, limit, slider = limit, unit, whole, onChange }: { label: string; value: number; limit: ValueLimit; slider?: ValueLimit; unit?: string; whole?: boolean; onChange(value: number): void }) {
  const id = useId();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3 text-xs">
        <Label htmlFor={`${id}-number`} className="min-w-0 truncate text-xs font-normal text-muted-foreground">{label}</Label>
        <span className="flex shrink-0 items-center gap-1">
          <TypedInput
            id={`${id}-number`}
            value={formatNumber(value)}
            parse={(text) => parseTypedNumber(text, limit, { unit, whole })}
            onCommit={onChange}
            step={(text, steps) => stepTypedNumber(text, steps, limit, { unit, whole })}
            onMessage={setMessage}
            describedBy={message ? `${id}-message` : undefined}
            invalid={message?.error}
            inputMode={whole ? "numeric" : "decimal"}
            className="w-16 text-right"
          />
          <span aria-hidden className="w-3 text-muted-foreground">{unit}</span>
        </span>
      </div>
      <input
        type="range"
        aria-label={label}
        aria-valuetext={`${formatNumber(value)}${unit ? ` ${unit}` : ""}`}
        min={slider.min}
        max={slider.max}
        step={slider.step}
        value={value}
        onChange={(e) => {
          setMessage(null);
          onChange(Number(e.currentTarget.value));
        }}
        className="h-4 w-full cursor-pointer accent-[var(--signal)]"
      />
      <Message id={`${id}-message`} message={message} />
    </div>
  );
}

/** A colour picker with its `#RRGGBB` value beside or below it. */
export function ColorField({ label, value, stacked, hideLabel, testId, onChange }: { label: string; value: string; stacked?: boolean; hideLabel?: boolean; testId?: string; onChange(value: string): void }) {
  const id = useId();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const picker: ReactNode = (
    <input
      type="color"
      aria-label={`${label}: pick`}
      title={value}
      value={value.toLowerCase()}
      onChange={(e) => {
        setMessage(null);
        onChange(e.currentTarget.value.toUpperCase());
      }}
      className={cn("h-6 cursor-pointer rounded border border-input bg-transparent p-0.5", stacked ? "w-full" : "w-9 shrink-0")}
      data-testid={testId}
    />
  );
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      {!hideLabel && <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">{label}</Label>}
      <div className={cn("flex min-w-0 gap-1", stacked ? "flex-col" : "items-center")}>
        {picker}
        <TypedInput
          id={id}
          value={value.toUpperCase()}
          parse={parseTypedColor}
          onCommit={onChange}
          onMessage={setMessage}
          describedBy={message ? `${id}-message` : undefined}
          invalid={message?.error}
          ariaLabel={hideLabel ? `${label}, #RRGGBB` : undefined}
          className="w-full min-w-0"
        />
      </div>
      <Message id={`${id}-message`} message={message} />
    </div>
  );
}
