import type { Id, Project } from "@/domain/model";
import { formatMm } from "@/domain/units";
import { fitsInside, intersection } from "./geometry";
import type { ResolvedMapping, UnresolvedScreen } from "./mapping";
import { pitchDeviation } from "./physical";

export type Severity = "error" | "warning" | "info";

export type IssueCode =
  | "NO_SCREENS"
  | "CABINET_INVALID"
  | "CABINET_PITCH_MISMATCH"
  | "SCREEN_UNRESOLVED"
  | "SCREEN_INVALID_ARRANGEMENT"
  | "SCREEN_DUPLICATE_NAME"
  | "PHYSICAL_OVERLAP"
  | "REGION_NEGATIVE"
  | "REGION_OVERLAP"
  | "REGION_SHARED"
  | "REGION_OUTSIDE_MASTER"
  | "MASTER_INVALID"
  | "MASTER_TOO_LARGE"
  | "MASTER_HAS_MARGIN"
  | "SLICE_NEGATIVE"
  | "SLICE_OVERLAP"
  | "SLICE_OUTSIDE_OUTPUT"
  | "OUTPUT_INVALID"
  | "OUTPUT_TOO_LARGE"
  | "OUTPUT_EMPTY";

export interface ValidationIssue {
  readonly code: IssueCode;
  readonly severity: Severity;
  readonly message: string;
  /** Screens involved, for selecting from the UI. */
  readonly screenIds: readonly Id[];
}

/** Largest canvas side browsers can rasterize reliably, and a common GPU texture limit. */
export const MAX_SIDE_PX = 16384;
const PITCH_TOLERANCE = 0.02;

const severityOrder: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

const unresolvedText: Record<UnresolvedScreen["reason"], string> = {
  "missing-cabinet": "its cabinet profile no longer exists",
  "missing-region": "it has no content region",
  "missing-canvas": "its content region points to a canvas that no longer exists",
  "missing-slice": "it has no output slice",
  "missing-output": "its output slice points to an output that no longer exists",
};

/** Checks a project and its resolved mapping. Issues are sorted most severe first. */
export function validateProject(project: Project, mapping: ResolvedMapping): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (severity: Severity, code: IssueCode, message: string, screenIds: readonly Id[] = []) =>
    issues.push({ severity, code, message, screenIds });

  if (project.physical.screens.length === 0) {
    add("error", "NO_SCREENS", "Add at least one screen to calculate a master canvas.");
  }

  for (const cabinet of project.cabinets) {
    const dims = [cabinet.widthUm, cabinet.heightUm, cabinet.pixelsX, cabinet.pixelsY, cabinet.nominalPitchUm];
    if (dims.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
      add("error", "CABINET_INVALID", `Cabinet “${cabinet.name}” needs a size, pixel count and pitch above zero.`);
      continue;
    }
    const deviation = pitchDeviation(cabinet);
    if (deviation > PITCH_TOLERANCE) {
      add(
        "warning",
        "CABINET_PITCH_MISMATCH",
        `Cabinet “${cabinet.name}”: ${formatMm(cabinet.widthUm)}×${formatMm(cabinet.heightUm)} mm at ${cabinet.pixelsX}×${cabinet.pixelsY} px doesn't match the ${formatMm(cabinet.nominalPitchUm)} mm pitch (${(deviation * 100).toFixed(1)}% off). Check the data sheet.`,
      );
    }
  }

  for (const screen of project.physical.screens) {
    if (!Number.isSafeInteger(screen.columns) || !Number.isSafeInteger(screen.rows) || screen.columns < 1 || screen.rows < 1) {
      add("error", "SCREEN_INVALID_ARRANGEMENT", `“${screen.name}” needs at least 1 column and 1 row of whole cabinets.`, [screen.id]);
    }
  }

  for (const entry of mapping.unresolved) {
    add("error", "SCREEN_UNRESOLVED", `“${entry.name}” can't be mapped: ${unresolvedText[entry.reason]}.`, [entry.screenId]);
  }

  const byName = new Map<string, Id[]>();
  for (const screen of project.physical.screens) {
    const key = screen.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), screen.id]);
  }
  for (const [, ids] of byName) {
    if (ids.length > 1) {
      const name = project.physical.screens.find((s) => s.id === ids[0])!.name;
      add("warning", "SCREEN_DUPLICATE_NAME", `${ids.length} screens are named “${name}”. Slice names in Resolume will be ambiguous.`, ids);
    }
  }

  const screens = mapping.screens;
  for (let i = 0; i < screens.length; i++) {
    const a = screens[i];

    if (a.masterRect.x < 0 || a.masterRect.y < 0 || a.canvasRect.x < 0 || a.canvasRect.y < 0) {
      add("error", "REGION_NEGATIVE", `“${a.name}” has a negative content position (${a.masterRect.x}, ${a.masterRect.y}). Coordinates must start at 0.`, [a.screenId]);
    }
    if (a.outputRect.x < 0 || a.outputRect.y < 0) {
      add("error", "SLICE_NEGATIVE", `“${a.name}” has a negative output position (${a.outputRect.x}, ${a.outputRect.y}). Coordinates must start at 0.`, [a.screenId]);
    }
    if (mapping.master.sizing === "fixed" && !fitsInside(a.masterRect, mapping.master.width, mapping.master.height)) {
      add("error", "REGION_OUTSIDE_MASTER", `“${a.name}” extends outside the ${mapping.master.width}×${mapping.master.height} master canvas.`, [a.screenId]);
    }
    const output = mapping.outputs.find((o) => o.outputId === a.outputId);
    if (output && output.sizing === "fixed" && !fitsInside(a.outputRect, output.width, output.height)) {
      add("error", "SLICE_OUTSIDE_OUTPUT", `“${a.name}” extends outside “${output.name}” (${output.width}×${output.height}).`, [a.screenId]);
    }

    for (let j = i + 1; j < screens.length; j++) {
      const b = screens[j];
      const content = intersection(a.masterRect, b.masterRect);
      if (content) {
        const where = `${content.width}×${content.height} px at (${content.x}, ${content.y})`;
        if (a.allowOverlap && b.allowOverlap) {
          add("info", "REGION_SHARED", `“${a.name}” and “${b.name}” intentionally share content: ${where}.`, [a.screenId, b.screenId]);
        } else {
          add("error", "REGION_OVERLAP", `Content of “${a.name}” and “${b.name}” overlaps by ${where}. Move one, or mark both as sharing content.`, [a.screenId, b.screenId]);
        }
      }
      if (a.outputId === b.outputId) {
        const slice = intersection(a.outputRect, b.outputRect);
        if (slice) {
          add("error", "SLICE_OVERLAP", `Output slices of “${a.name}” and “${b.name}” overlap by ${slice.width}×${slice.height} px at (${slice.x}, ${slice.y}). A processor can only read each output pixel once.`, [a.screenId, b.screenId]);
        }
      }
      if (intersection(a.stage, b.stage)) {
        add("warning", "PHYSICAL_OVERLAP", `“${a.name}” and “${b.name}” overlap on the stage plan. Check their positions unless they sit at different depths.`, [a.screenId, b.screenId]);
      }
    }
  }

  if (mapping.master.sizing === "fixed" && (mapping.master.width < 1 || mapping.master.height < 1)) {
    add("error", "MASTER_INVALID", "A fixed master canvas needs a width and height of at least 1 px.");
  }
  if (mapping.master.width > MAX_SIDE_PX || mapping.master.height > MAX_SIDE_PX) {
    add("error", "MASTER_TOO_LARGE", `The ${mapping.master.width}×${mapping.master.height} master canvas exceeds ${MAX_SIDE_PX} px per side, the limit for pixel map images and many GPUs.`);
  }
  const box = mapping.master.contentBounds;
  if (mapping.master.sizing === "auto" && box && (box.x > 0 || box.y > 0)) {
    add("info", "MASTER_HAS_MARGIN", `The master canvas has unused space: content starts at (${box.x}, ${box.y}). Use “Trim to content” to remove it.`);
  }

  for (const output of mapping.outputs) {
    if (output.sizing === "fixed" && (output.width < 1 || output.height < 1)) {
      add("error", "OUTPUT_INVALID", `Output “${output.name}” needs a width and height of at least 1 px.`);
    }
    if (output.width > MAX_SIDE_PX || output.height > MAX_SIDE_PX) {
      add("error", "OUTPUT_TOO_LARGE", `Output “${output.name}” (${output.width}×${output.height}) exceeds ${MAX_SIDE_PX} px per side.`);
    }
    if (output.screenIds.length === 0 && mapping.outputs.length > 1) {
      add("warning", "OUTPUT_EMPTY", `Output “${output.name}” has no screens assigned.`);
    }
  }

  return issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

export function hasErrors(issues: readonly ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}
