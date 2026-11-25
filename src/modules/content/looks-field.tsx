"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LookError, MAX_LOOK_NAME, nextLookName } from "@/engines/content/looks";
import { cn } from "@/lib/utils";

interface LookRow {
  readonly id: string;
  readonly name: string;
  readonly swatches: readonly string[];
}

const nameInput = "h-7 min-w-0 rounded px-2 text-xs md:text-xs";

/** Runs a look change and returns why it can't be done, or null. */
function attempt(change: () => void): string | null {
  try {
    change();
    return null;
  } catch (error) {
    if (error instanceof LookError) return error.message;
    throw error;
  }
}

/** Named looks in the project: save the current settings, apply, rename and delete. Every change undoes. */
export function LooksField({ looks, activeId, onSave, onApply, onRename, onRemove }: {
  looks: readonly LookRow[];
  /** The look whose settings are the current ones. */
  activeId: string | null;
  onSave(name: string): void;
  onApply(id: string): void;
  onRename(id: string, name: string): void;
  onRemove(id: string): void;
}) {
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const suggested = nextLookName(looks.map((l) => ({ ...l, settings: null })));

  const save = () => {
    const reason = attempt(() => onSave(name.trim() ? name : suggested));
    setProblem(reason);
    if (reason === null) setName("");
  };
  const rename = () => {
    if (!editing) return;
    const reason = attempt(() => onRename(editing.id, editing.name));
    setProblem(reason);
    if (reason === null) setEditing(null);
  };
  const cancelRename = () => {
    setEditing(null);
    setProblem(null);
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid="looks">
      {looks.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {looks.map((look) => (
            <li key={look.id} className="flex h-7 items-center gap-0.5">
              {editing?.id === look.id ? (
                <Input
                  autoFocus
                  aria-label={`New name for ${look.name}`}
                  value={editing.name}
                  maxLength={MAX_LOOK_NAME}
                  className={cn(nameInput, "flex-1")}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setEditing({ id: look.id, name: e.target.value })}
                  onBlur={rename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") rename();
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      cancelRename();
                    }
                  }}
                />
              ) : (
                <>
                  <button
                    type="button"
                    aria-pressed={look.id === activeId}
                    title={`Apply ${look.name}`}
                    onClick={() => onApply(look.id)}
                    className={cn("flex h-7 min-w-0 flex-1 items-center gap-2 rounded px-1.5 text-left text-xs hover:bg-accent", look.id === activeId && "bg-accent font-semibold")}
                  >
                    <span aria-hidden className="flex shrink-0">
                      {look.swatches.map((c, i) => (
                        <span key={i} className="-ml-0.5 size-3 rounded-full border border-panel first:ml-0" style={{ background: c }} />
                      ))}
                    </span>
                    <span className="truncate">{look.name}</span>
                  </button>
                  <Button variant="ghost" size="icon-sm" className="rounded" aria-label={`Rename ${look.name}`} title="Rename" onClick={() => setEditing({ id: look.id, name: look.name })}>
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="rounded"
                    aria-label={`Delete ${look.name}`}
                    title="Delete. Undo brings it back"
                    onClick={() => {
                      onRemove(look.id);
                      nameRef.current?.focus();
                    }}
                  >
                    <Trash2 />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">Save the current settings as a look</Label>
      <div className="flex gap-1">
        <Input
          ref={nameRef}
          id={id}
          value={name}
          placeholder={suggested}
          maxLength={MAX_LOOK_NAME}
          aria-describedby={problem ? `${id}-problem` : undefined}
          className={cn(nameInput, "flex-1")}
          onChange={(e) => {
            setName(e.target.value);
            setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape" && name) {
              e.stopPropagation();
              setName("");
              setProblem(null);
            }
          }}
        />
        <Button variant="secondary" size="sm" className="h-7 rounded px-2 text-xs" onClick={save}>Save look</Button>
      </div>
      {problem && <p id={`${id}-problem`} role="status" className="text-xs text-destructive">{problem}</p>}
    </div>
  );
}
