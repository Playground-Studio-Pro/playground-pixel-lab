import { hasErrors, type ValidationIssue } from "@/engines/validation";

export class ExportBlockedError extends Error {
  constructor(readonly issues: readonly ValidationIssue[]) {
    const errors = issues.filter((i) => i.severity === "error");
    super(`Fix ${errors.length === 1 ? "this problem" : `these ${errors.length} problems`} before exporting: ${errors.map((e) => e.message).join(" ")}`);
    this.name = "ExportBlockedError";
  }
}

/** Mapping exports must never leave the app with known errors in their coordinates. */
export function assertExportable(issues: readonly ValidationIssue[]): void {
  if (hasErrors(issues)) throw new ExportBlockedError(issues);
}

export function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}
