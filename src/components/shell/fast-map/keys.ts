/**
 * Fast map's Fix step keys, decided without a DOM so they can be tested. Shortcuts never fire while typing in a field
 * or while a dialog is open: the caller says so in `typing` and `dialogOpen`.
 */
export type FixAction =
  | { kind: "pick"; number: number }
  | { kind: "swap" }
  | { kind: "same" }
  | { kind: "nudge"; dx: number; dy: number }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "escape" };

export interface FixKey {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** Focus is in a text field, select, combobox or editable element. */
  typing: boolean;
  /** A dialog or menu is open over the page. */
  dialogOpen: boolean;
}

export function fixAction(e: FixKey): FixAction | null {
  if (e.typing || e.dialogOpen) return null;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (mod) {
    if (e.altKey) return null;
    if (key === "z") return e.shiftKey ? { kind: "redo" } : { kind: "undo" };
    if (key === "y" && e.ctrlKey && !e.metaKey) return { kind: "redo" };
    return null;
  }
  if (e.altKey) return null;
  if (/^[1-9]$/.test(e.key)) return { kind: "pick", number: Number(e.key) };
  if (key === "x" && !e.shiftKey) return { kind: "swap" };
  if (key === "t" && !e.shiftKey) return { kind: "same" };
  if (e.key === "Escape") return { kind: "escape" };
  const step = e.shiftKey ? 10 : 1;
  if (e.key === "ArrowLeft") return { kind: "nudge", dx: -step, dy: 0 };
  if (e.key === "ArrowRight") return { kind: "nudge", dx: step, dy: 0 };
  if (e.key === "ArrowUp") return { kind: "nudge", dx: 0, dy: -step };
  if (e.key === "ArrowDown") return { kind: "nudge", dx: 0, dy: step };
  return null;
}

/** True when keyboard focus is somewhere a key types or chooses, so shortcuts must stay off. */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["button", "checkbox", "radio", "submit", "reset"].includes(type);
  }
  if ((el as HTMLElement).isContentEditable) return true;
  const role = el.getAttribute("role");
  return role === "combobox" || role === "listbox" || role === "option" || role === "spinbutton" || role === "textbox" || role === "menuitem";
}
