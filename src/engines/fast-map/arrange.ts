import type { Id, Project } from "@/domain/model";
import { px, um } from "@/domain/units";
import { right } from "../geometry";
import { resolveMapping, type ResolvedMapping } from "../mapping";
import { applyScreenPlan, clearScreens, DomainError, type OpContext, type PlannedScreen, type ScreenPlan } from "../project-ops";
import { computeScreenSpec } from "../physical";
import { validateProject, type ValidationIssue } from "../validation";
import { outputsNeeded, packRects, type PackBin } from "./pack";
import type { ParsedScreen } from "./parse";

/**
 * Arrange: from a parsed list to a project. Content keeps the stage shape in whole pixels, the stage plan uses real
 * cabinet sizes in micrometres, and outputs are packed 1:1. Every number shown afterwards comes from
 * `resolveMapping` and `validateProject` on the result, never from this file. Pure.
 */

export interface ArrangeSettings {
  /** "replace" clears the project's screens first; "add" keeps them and fills around them. */
  readonly mode: "add" | "replace";
  /** Space between screens on the master canvas, px. */
  readonly gapPx: number;
  /** Space between screens on the stage plan, µm. */
  readonly stageGapUm: number;
  /** Size of each output Fast map creates. */
  readonly output: { readonly width: number; readonly height: number };
  /** Outputs of that size Fast map may create. In "add" mode the project's outputs are filled first. */
  readonly newOutputs: number;
}

export const MAX_NEW_OUTPUTS = 16;
export const MAX_GAP_PX = 4096;
/** Space left on stage between screens already in the project and an added list: 1 m, as Add screen does. */
const ADD_STAGE_OFFSET_UM = 1_000_000;

export interface FastMapBuild {
  /** The project with the list applied. Use only when `ready`; before that it is a preview. */
  readonly project: Project;
  readonly mapping: ResolvedMapping;
  readonly issues: readonly ValidationIssue[];
  /** New screen ids, in list order. */
  readonly screenIds: readonly Id[];
  /** Names of screens that found no room in the outputs. */
  readonly unplaced: readonly string[];
  /** Outputs of the chosen size that would hold everything, or null when a screen is larger than one. */
  readonly outputsNeeded: number | null;
  /** Why it can't be created yet, in plain words. Empty when ready. */
  readonly blocking: readonly string[];
  readonly ready: boolean;
}

function requireSettings(s: ArrangeSettings) {
  const whole = (v: number, min: number, max: number, what: string) => {
    if (!Number.isSafeInteger(v) || v < min || v > max) throw new DomainError(`${what} must be a whole number from ${min} to ${max}.`);
  };
  whole(s.gapPx, 0, MAX_GAP_PX, "Space between screens");
  whole(s.stageGapUm, 0, 100_000_000, "Space on stage");
  whole(s.output.width, 1, 16384, "Output width");
  whole(s.output.height, 1, 16384, "Output height");
  whole(s.newOutputs, s.mode === "replace" ? 1 : 0, MAX_NEW_OUTPUTS, "Outputs");
}

/** Rows of a list, top to bottom, each left to right. */
function rowsOf(screens: readonly ParsedScreen[]): ParsedScreen[][] {
  const rows: ParsedScreen[][] = [];
  screens.forEach((s) => (rows[s.row] ??= []).push(s));
  return rows.filter(Boolean).map((r) => [...r].sort((a, b) => a.column - b.column));
}

/** Centres each row on the widest, and each screen on its row's height. Integer floor, so it is exact. */
function layoutRows(rows: ParsedScreen[][], size: (s: ParsedScreen) => { w: number; h: number }, gap: number) {
  const width = (r: ParsedScreen[]) => r.reduce((n, s) => n + size(s).w, 0) + gap * (r.length - 1);
  const widest = Math.max(0, ...rows.map(width));
  const at = new Map<ParsedScreen, { x: number; y: number }>();
  let y = 0;
  for (const r of rows) {
    const h = Math.max(...r.map((s) => size(s).h));
    let x = Math.floor((widest - width(r)) / 2);
    for (const s of r) {
      at.set(s, { x, y: y + Math.floor((h - size(s).h) / 2) });
      x += size(s).w + gap;
    }
    y += h + gap;
  }
  return at;
}

function blockingErrors(before: readonly ValidationIssue[], after: readonly ValidationIssue[], newIds: ReadonlySet<Id>): ValidationIssue[] {
  const old = new Set(before.filter((i) => i.severity === "error").map((i) => `${i.code}|${i.message}`));
  return after.filter((i) => i.severity === "error" && (i.screenIds.some((id) => newIds.has(id)) || (i.screenIds.length === 0 && !old.has(`${i.code}|${i.message}`))));
}

/** Builds the project a list would make. Same project, list, settings and ids give the same result. */
export function buildFastMap(project: Project, screens: readonly ParsedScreen[], settings: ArrangeSettings, ctx: OpContext): FastMapBuild {
  requireSettings(settings);
  if (screens.length === 0) throw new DomainError("The list has no screens.");
  const replace = settings.mode === "replace";
  const base = replace ? clearScreens(project) : project;
  const baseMapping = resolveMapping(base);
  const canvas = base.content.canvases[0];

  // Content: the stage shape, in pixels.
  const rows = rowsOf(screens);
  const content = layoutRows(rows, (s) => ({ w: s.widthPx, h: s.heightPx }), settings.gapPx);
  const bounds = baseMapping.master.contentBounds;
  const masterX0 = Math.max(canvas.originX, bounds ? right(bounds) + (bounds.width > 0 ? settings.gapPx : 0) : canvas.originX);
  const masterY0 = canvas.originY;

  // Stage: real cabinet sizes, in micrometres.
  const specs = new Map(screens.map((s) => [s, computeScreenSpec(s, s.cabinet)]));
  const stage = layoutRows(rows, (s) => ({ w: specs.get(s)!.widthUm, h: specs.get(s)!.heightUm }), settings.stageGapUm);
  const stageX0 = baseMapping.screens.length ? Math.max(...baseMapping.screens.map((s) => right(s.stage))) + ADD_STAGE_OFFSET_UM : 0;

  // Outputs: the project's own first when adding, then new ones of the chosen size.
  const existing = replace ? [] : baseMapping.outputs;
  const bins: (PackBin & { ref: PlannedScreen["output"] })[] = [
    ...existing.map((o) => ({
      ref: { kind: "existing" as const, id: o.outputId },
      width: o.sizing === "fixed" ? o.width : settings.output.width,
      height: o.sizing === "fixed" ? o.height : settings.output.height,
      obstacles: baseMapping.screens.filter((s) => s.outputId === o.outputId).map((s) => s.outputRect),
    })),
    ...Array.from({ length: settings.newOutputs }, (_, index) => ({ ref: { kind: "new" as const, index }, ...settings.output, obstacles: [] })),
  ];
  const items = screens.map((s, i) => ({ key: String(i), width: s.widthPx, height: s.heightPx }));
  const packed = packRects(items, bins);

  // New outputs actually used, renumbered in order, so an unused declared output isn't created.
  const usedNew = [...new Set([...packed.placements.values()].map((p) => bins[p.bin].ref).filter((r) => r.kind === "new").map((r) => (r as { index: number }).index))].sort((a, b) => a - b);
  if (bins[0]?.ref.kind === "new" && !usedNew.includes(0)) usedNew.unshift(0);
  const renumber = new Map(usedNew.map((index, n) => [index, n]));
  const fallback: PlannedScreen["output"] = bins[0]?.ref.kind === "existing" ? bins[0].ref : { kind: "new", index: 0 };

  const planned: PlannedScreen[] = screens.map((s, i) => {
    const place = packed.placements.get(String(i));
    const ref = place ? bins[place.bin].ref : fallback;
    const c = content.get(s)!;
    const st = stage.get(s)!;
    return {
      name: s.name,
      cabinet: s.cabinet,
      columns: s.columns,
      rows: s.rows,
      stageX: um(stageX0 + st.x),
      stageY: um(st.y),
      masterX: px(masterX0 + c.x),
      masterY: px(masterY0 + c.y),
      output: ref.kind === "new" ? { kind: "new", index: renumber.get(ref.index)! } : ref,
      outputX: px(place?.x ?? 0),
      outputY: px(place?.y ?? 0),
    };
  });
  const plan: ScreenPlan = { screens: planned, newOutputs: usedNew.map(() => ({ width: px(settings.output.width), height: px(settings.output.height) })) };
  const applied = applyScreenPlan(base, plan, ctx, { reuseFirstOutput: replace });
  const mapping = resolveMapping(applied.project);
  const issues = validateProject(applied.project, mapping);

  const unplaced = packed.unplaced.map((k) => screens[Number(k)].name);
  const needed = outputsNeeded(items, settings.output, MAX_NEW_OUTPUTS);
  const blocking: string[] = [];
  if (unplaced.length) {
    const size = `${settings.output.width}×${settings.output.height}`;
    const tooBig = screens.filter((s) => s.widthPx > settings.output.width || s.heightPx > settings.output.height);
    if (tooBig.length) blocking.push(`Larger than a ${size} output: ${tooBig.map((s) => `${s.name} (${s.widthPx}×${s.heightPx})`).join(", ")}. Choose a larger output. Nothing is scaled.`);
    else blocking.push(`Doesn't fit: ${unplaced.join(", ")}.` + (needed !== null ? ` Everything fits in ${needed} ${needed === 1 ? "output" : "outputs"} of ${size}.` : ` Choose a larger output.`) + " Nothing is scaled.");
  }
  const newIds = new Set(applied.screenIds);
  const unplacedIds = new Set(packed.unplaced.map((k) => applied.screenIds[Number(k)]));
  for (const issue of blockingErrors(validateProject(base, baseMapping), issues, newIds)) {
    // A slice overlap caused only by a screen that found no room is already said above.
    if (issue.code === "SLICE_OVERLAP" && issue.screenIds.some((id) => unplacedIds.has(id))) continue;
    if (issue.code === "SLICE_OUTSIDE_OUTPUT" && issue.screenIds.every((id) => unplacedIds.has(id))) continue;
    blocking.push(issue.message);
  }
  return {
    project: applied.project,
    mapping,
    issues,
    screenIds: applied.screenIds,
    unplaced,
    outputsNeeded: needed,
    blocking,
    ready: blocking.length === 0,
  };
}
