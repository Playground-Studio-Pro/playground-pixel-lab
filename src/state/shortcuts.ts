/** The keys that matter for a shortcut, so the decision can be tested without a DOM. */
export interface KeyPress {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
}

/**
 * Undo is ⌘Z (Ctrl+Z elsewhere). Redo is ⌘⇧Z, or Ctrl+Y as on Windows.
 * Returns null for anything else, including Alt combinations, which type characters on some layouts.
 */
export function historyShortcut(e: KeyPress): "undo" | "redo" | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  if (key === "y" && e.ctrlKey && !e.metaKey && !e.shiftKey) return "redo";
  return null;
}
