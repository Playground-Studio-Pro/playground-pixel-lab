import type { CabinetProfile, ContentFlip, Id, Project } from "@/domain/model";
import { px, um } from "@/domain/units";
import { resolveMapping, type ResolvedMapping } from "../mapping";
import { applyScreenPlan, clearScreens, DomainError, setRegionFlip, setRegionRotation, setSliceParts, type OpContext, type PlannedScreen } from "../project-ops";
import { cornersBounds, rotatedCorners } from "../rotation";
import { minimumOutputs, outputItems, planOutputs, type ScreenPart } from "./split";
import { validateProject, type ValidationIssue } from "../validation";
import { outputsNeeded } from "../fast-map/pack";
import { formatUm } from "./dimension";
import type { LaidOutScreen } from "./drawing";

/**
 * From confirmed screens and answers to a project: cabinets per screen, whole-cabinet sizes, the stage plan and the
 * processor pixel map packed 1:1 over as many outputs as needed. Pure; every number shown afterwards comes from
 * `resolveMapping` and `validateProject` on the result.
 */

/** What to do when a size isn't a whole number of cabinets. Never decided silently. */
export type Rounding = "down" | "up" | "keep";

export interface AxisFit {
  readonly sizeUm: number;
  readonly cabinetUm: number;
  readonly exact: boolean;
  /** Whole cabinets below and above the size. `down` is 0 when the size is smaller than one cabinet. */
  readonly down: number;
  readonly up: number;
}

export function fitAxis(sizeUm: number, cabinetUm: number): AxisFit {
  if (!Number.isSafeInteger(sizeUm) || sizeUm <= 0) throw new DomainError("A screen size must be a positive whole number of micrometres.");
  if (!Number.isSafeInteger(cabinetUm) || cabinetUm <= 0) throw new DomainError("A cabinet size must be a positive whole number of micrometres.");
  const down = Math.floor(sizeUm / cabinetUm);
  const exact = down * cabinetUm === sizeUm;
  return { sizeUm, cabinetUm, exact, down, up: exact ? down : down + 1 };
}

/** Cabinets for a rounding choice. "keep" takes the nearest whole count (up on a tie) and stays a warning. */
export function countFor(fit: AxisFit, rounding: Rounding): number {
  if (fit.exact) return fit.down;
  if (rounding === "down") return Math.max(fit.down, 0);
  if (rounding === "up") return fit.up;
  const toDown = fit.sizeUm - fit.down * fit.cabinetUm;
  const toUp = fit.up * fit.cabinetUm - fit.sizeUm;
  return fit.down >= 1 && toDown < toUp ? fit.down : fit.up;
}

export interface GuidedAnswers {
  /** Cabinet per screen key. */
  readonly cabinets: Readonly<Record<string, CabinetProfile>>;
  /** Rounding per `width:<key>` / `height:<key>`, needed only where the size isn't whole cabinets. */
  readonly rounding: Readonly<Record<string, Rounding>>;
}

export interface FitChoice {
  readonly id: string;
  readonly key: string;
  readonly axis: "width" | "height";
  readonly fit: AxisFit;
  readonly text: string;
}

export interface ScreenSizing {
  readonly key: string;
  readonly name: string;
  readonly cabinet: CabinetProfile;
  readonly columns: number;
  readonly rows: number;
  readonly widthPx: number;
  readonly heightPx: number;
  /** LED size, micrometres: whole cabinets. */
  readonly widthUm: number;
  readonly heightUm: number;
  readonly gapBeforeUm: number;
  readonly yUm: number;
  /** Differences from the drawing the operator chose to keep. */
  readonly warnings: readonly string[];
}

export type SizingResult = { readonly ok: true; readonly screens: readonly ScreenSizing[] } | { readonly ok: false; readonly missingCabinet: readonly string[]; readonly choices: readonly FitChoice[] };

/** Sizes every screen in whole cabinets, or lists the cabinets and rounding decisions still needed. */
export function sizeScreens(layout: readonly LaidOutScreen[], answers: GuidedAnswers): SizingResult {
  const missingCabinet: string[] = [];
  const choices: FitChoice[] = [];
  const sized: ScreenSizing[] = [];
  for (const s of layout) {
    const cabinet = answers.cabinets[s.key];
    if (!cabinet) {
      missingCabinet.push(s.key);
      continue;
    }
    const axes = (["width", "height"] as const).map((axis) => {
      const fit = fitAxis(axis === "width" ? s.widthUm : s.heightUm, axis === "width" ? cabinet.widthUm : cabinet.heightUm);
      const id = `${axis}:${s.key}`;
      const rounding = answers.rounding[id];
      if (!fit.exact && (!rounding || (rounding === "down" && fit.down < 1))) {
        const cab = formatUm(fit.cabinetUm);
        const down = fit.down >= 1 ? `${fit.down} cabinets make ${formatUm(fit.down * fit.cabinetUm)} (${formatUm(fit.sizeUm - fit.down * fit.cabinetUm)} less)` : `less than one cabinet`;
        choices.push({ id, key: s.key, axis, fit, text: `${s.name} is ${formatUm(fit.sizeUm)} ${axis === "width" ? "wide" : "tall"}, not whole ${cab} cabinets: ${down}, or ${fit.up} make ${formatUm(fit.up * fit.cabinetUm)} (${formatUm(fit.up * fit.cabinetUm - fit.sizeUm)} more).` });
        return null;
      }
      const count = countFor(fit, rounding ?? "keep");
      const warning = !fit.exact && rounding === "keep" ? `${s.name}: the drawing says ${formatUm(fit.sizeUm)} ${axis === "width" ? "wide" : "tall"}; ${count} cabinets make ${formatUm(count * fit.cabinetUm)}.` : null;
      return { count, warning };
    });
    const [w, h] = axes;
    if (!w || !h) continue;
    sized.push({
      key: s.key,
      name: s.name,
      cabinet,
      columns: w.count,
      rows: h.count,
      widthPx: w.count * cabinet.pixelsX,
      heightPx: h.count * cabinet.pixelsY,
      widthUm: w.count * cabinet.widthUm,
      heightUm: h.count * cabinet.heightUm,
      gapBeforeUm: s.gapBeforeUm,
      yUm: s.yUm,
      warnings: [w.warning, h.warning].filter((x): x is string => x !== null),
    });
  }
  if (missingCabinet.length || choices.length) return { ok: false, missingCabinet, choices };
  return { ok: true, screens: sized };
}

export interface OutputSettings {
  readonly width: number;
  readonly height: number;
  /** Outputs to create. */
  readonly count: number;
  /** An item key (a screen key, or `<screen>#<n>` for a part) pinned to an output index; others are placed automatically. */
  readonly assignment?: Readonly<Record<string, number>>;
  /** Parts of split screens, by screen key. */
  readonly parts?: Readonly<Record<string, readonly ScreenPart[]>>;
  /** Rotation (degrees) and mirror of a screen's content, by screen key. */
  readonly turns?: Readonly<Record<string, { readonly rotation: number; readonly flip: ContentFlip }>>;
}

export const MAX_OUTPUTS = 16;

/** Outputs of a size that would hold every screen, or null when one screen is larger than an output. */
export function guidedOutputsNeeded(screens: readonly ScreenSizing[], size: { width: number; height: number }): number | null {
  return outputsNeeded(screens.map((s) => ({ key: s.key, width: s.widthPx, height: s.heightPx })), size, MAX_OUTPUTS);
}

export interface GuidedBuild {
  readonly project: Project;
  readonly mapping: ResolvedMapping;
  readonly issues: readonly ValidationIssue[];
  /** Screen ids by key. */
  readonly screenIds: Readonly<Record<string, Id>>;
  /** Output index each screen landed in, by key. */
  readonly placedIn: Readonly<Record<string, number>>;
  readonly blocking: readonly string[];
  readonly ready: boolean;
}

/**
 * Replaces the project's screens with the guided plan. Stage: left to right with the drawing's gaps, in whole
 * cabinets. Master canvas: side by side in the same order, tops aligned, no space between; a rotated screen gets the
 * room its turned corners reach, centred in it. Outputs: whole screens and the parts of split screens, pinned ones
 * first, then the rest packed 1:1. Same input, same ids, same result.
 */
export function buildGuidedProject(project: Project, screens: readonly ScreenSizing[], output: OutputSettings, ctx: OpContext): GuidedBuild {
  if (screens.length === 0) throw new DomainError("There are no screens to build.");
  const whole = (v: number, min: number, max: number, what: string) => {
    if (!Number.isSafeInteger(v) || v < min || v > max) throw new DomainError(`${what} must be a whole number from ${min} to ${max}.`);
  };
  whole(output.width, 1, 16384, "Output width");
  whole(output.height, 1, 16384, "Output height");
  whole(output.count, 1, MAX_OUTPUTS, "Outputs");
  const base = clearScreens(project);
  const parts = output.parts ?? {};
  const items = outputItems(screens, parts);
  const size = { width: output.width, height: output.height };
  const plan = planOutputs(items, size, output.count, output.assignment ?? {});
  const blocking: string[] = [];
  const nameOf = (key: string) => items.find((it) => it.key === key)?.label ?? key;
  for (const [key, a] of Object.entries(output.assignment ?? {})) {
    if (a >= output.count && items.some((it) => it.key === key)) blocking.push(`${nameOf(key)} is sent to output ${a + 1}, but there are only ${output.count}.`);
  }
  const pinnedOut = plan.unplaced.filter((k) => output.assignment?.[k] !== undefined && output.assignment[k] < output.count);
  for (const k of pinnedOut) blocking.push(`${nameOf(k)} doesn't fit in output ${output.assignment![k] + 1} with the other screens sent there.`);
  const unplaced = plan.unplaced.filter((k) => output.assignment?.[k] === undefined);
  if (unplaced.length) {
    const tooBig = items.filter((it) => it.width > output.width || it.height > output.height);
    const needed = tooBig.length ? null : minimumOutputs(items, size);
    if (tooBig.length) blocking.push(`Larger than a ${output.width}×${output.height} output: ${tooBig.map((it) => `${it.label} (${it.width}×${it.height} px)`).join(", ")}. Split it, or choose a larger output. Nothing is scaled.`);
    else blocking.push(`Doesn't fit in ${output.count} ${output.count === 1 ? "output" : "outputs"} of ${output.width}×${output.height}: ${unplaced.map(nameOf).join(", ")}.${needed !== null ? ` Everything fits in ${needed}.` : ""} Nothing is scaled.`);
  }

  let stageX = 0;
  let masterX = 0;
  const slots = screens.map((s) => {
    const turn = output.turns?.[s.key];
    const reach = turn && turn.rotation ? cornersBounds(rotatedCorners({ x: 0, y: 0, width: s.widthPx, height: s.heightPx }, turn.rotation)) : { x: 0, y: 0, width: s.widthPx, height: s.heightPx };
    return { w: Math.max(s.widthPx, reach.width), h: Math.max(s.heightPx, reach.height) };
  });
  const planned: PlannedScreen[] = screens.map((s, i) => {
    if (i > 0) stageX += screens[i - 1].widthUm + s.gapBeforeUm;
    const slot = slots[i];
    const at = masterX + Math.ceil((slot.w - s.widthPx) / 2);
    masterX += slot.w;
    const firstKey = parts[s.key]?.length ? parts[s.key][0].key : s.key;
    const place = plan.placements.get(firstKey);
    return {
      name: s.name,
      cabinet: s.cabinet,
      columns: s.columns,
      rows: s.rows,
      stageX: um(stageX),
      stageY: um(s.yUm),
      masterX: px(at),
      masterY: px(Math.ceil((slot.h - s.heightPx) / 2)),
      output: { kind: "new", index: place?.bin ?? 0 },
      outputX: px(place?.x ?? 0),
      outputY: px(place?.y ?? 0),
    };
  });
  const newOutputs = Array.from({ length: output.count }, () => ({ width: px(output.width), height: px(output.height) }));
  const applied = applyScreenPlan(base, { screens: planned, newOutputs }, ctx, { reuseFirstOutput: true });
  // Outputs in plan order: the reused first output, then the ones added after it.
  const outputIds = applied.project.output.outputs.map((o) => o.id);
  let built = applied.project;
  screens.forEach((s, i) => {
    const id = applied.screenIds[i];
    const turn = output.turns?.[s.key];
    if (turn?.rotation) built = setRegionRotation(built, id, turn.rotation);
    if (turn && turn.flip !== "none") built = setRegionFlip(built, id, turn.flip);
    const ps = parts[s.key];
    if (ps?.length && ps.every((p) => plan.placements.has(p.key))) {
      built = setSliceParts(
        built,
        id,
        ps.map((p) => {
          const at = plan.placements.get(p.key)!;
          return { outputId: outputIds[at.bin], x: px(at.x), y: px(at.y), source: { x: px(p.source.x), y: px(p.source.y), width: px(p.source.width), height: px(p.source.height) } };
        }),
      );
    }
  });
  const mapping = resolveMapping(built);
  const issues = validateProject(built, mapping);
  const unplacedScreens = new Set(screens.flatMap((s, i) => (items.filter((it) => it.key === s.key || it.key.startsWith(`${s.key}#`)).some((it) => !plan.placements.has(it.key)) ? [applied.screenIds[i]] : [])));
  for (const issue of issues) {
    if (issue.severity !== "error") continue;
    if ((issue.code === "SLICE_OVERLAP" || issue.code === "SLICE_OUTSIDE_OUTPUT") && issue.screenIds.some((id) => unplacedScreens.has(id))) continue;
    blocking.push(issue.message);
  }
  return {
    project: built,
    mapping,
    issues,
    screenIds: Object.fromEntries(screens.map((s, i) => [s.key, applied.screenIds[i]])),
    placedIn: Object.fromEntries(items.flatMap((it) => (plan.placements.has(it.key) ? [[it.key, plan.placements.get(it.key)!.bin]] : []))),
    blocking,
    ready: blocking.length === 0,
  };
}
