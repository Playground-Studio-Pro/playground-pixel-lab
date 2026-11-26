import { DomainError } from "../project-ops";
import { packRects, type PackBin } from "../fast-map/pack";
import type { ScreenSizing } from "./plan";

/**
 * Screens larger than one output: the questions the operator answers, and what each answer would give. Pure. Nothing
 * here decides: it lists options and their consequences, and computes the parts of an answer already given.
 *
 * A part is a run of whole cabinet columns (or rows) of a screen, read from the screen's own content region. Never a
 * cut through a cabinet, never scaled.
 */

export interface FitIssue {
  readonly key: string;
  readonly name: string;
  /** The side that doesn't fit, or both. */
  readonly axis: "columns" | "rows" | "both";
  readonly widthPx: number;
  readonly heightPx: number;
  readonly outputWidth: number;
  readonly outputHeight: number;
  /** Plain words with the numbers: “Centre is 5376 px wide; one output is 3840 px.” */
  readonly text: string;
}

export function fitIssues(screens: readonly ScreenSizing[], output: { width: number; height: number }): FitIssue[] {
  return screens.flatMap((s) => {
    const wide = s.widthPx > output.width;
    const tall = s.heightPx > output.height;
    if (!wide && !tall) return [];
    const axis = wide && tall ? "both" : wide ? "columns" : "rows";
    const parts = [wide ? `${s.widthPx} px wide; one output is ${output.width} px` : null, tall ? `${s.heightPx} px tall; one output is ${output.height} px` : null].filter(Boolean).join(", and ");
    return [{ key: s.key, name: s.name, axis, widthPx: s.widthPx, heightPx: s.heightPx, outputWidth: output.width, outputHeight: output.height, text: `${s.name} is ${parts}.` }];
  });
}

export type CutMode = "equal" | "fill" | "custom";

export interface CutAnswer {
  readonly mode: CutMode;
  /** For "custom": cabinets in the first part, counted from the left (or top). */
  readonly at?: number;
}

export interface ScreenPart {
  /** `<screen key>#<n>`, 1-based. */
  readonly key: string;
  readonly screenKey: string;
  readonly index: number;
  readonly count: number;
  readonly axis: "columns" | "rows";
  /** First cabinet column (or row) of the part, 0-based, and how many. */
  readonly from: number;
  readonly span: number;
  /** The part's region in the screen's own pixels. */
  readonly source: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

/**
 * Cabinet counts per part for a cut. "equal": the fewest parts that fit, as even as whole cabinets allow (28 → 14 + 14).
 * "fill": as many cabinets as fit in each part, the rest last (28 at 20 per output → 20 + 8). "custom": one cut after
 * `at` cabinets. Returns a reason in words when the cut can't fit.
 */
export function cutSpans(total: number, cabinetPx: number, outputPx: number, answer: CutAnswer): number[] | string {
  if (!Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(cabinetPx) || cabinetPx < 1) throw new DomainError("A screen needs whole cabinets to be split.");
  const perOutput = Math.floor(outputPx / cabinetPx);
  if (perOutput < 1) return `One cabinet is ${cabinetPx} px, more than one output (${outputPx} px).`;
  if (answer.mode === "fill") {
    const spans: number[] = [];
    for (let left = total; left > 0; left -= perOutput) spans.push(Math.min(perOutput, left));
    return spans;
  }
  if (answer.mode === "equal") {
    const n = Math.ceil(total / perOutput);
    const base = Math.floor(total / n);
    return Array.from({ length: n }, (_, i) => base + (i < total % n ? 1 : 0));
  }
  const at = answer.at;
  if (at === undefined || !Number.isSafeInteger(at) || at < 1 || at >= total) return `Choose a cut between cabinet 1 and ${total - 1}.`;
  const spans = [at, total - at];
  const over = spans.findIndex((n) => n > perOutput);
  if (over >= 0) return `Part ${over + 1} would be ${spans[over]} cabinets (${spans[over] * cabinetPx} px), more than one output holds (${perOutput} cabinets, ${perOutput * cabinetPx} px).`;
  return spans;
}

/** The parts of a screen for given spans, in its own pixels. Together they are exactly the screen. */
export function screenParts(screen: ScreenSizing, axis: "columns" | "rows", spans: readonly number[]): ScreenPart[] {
  const total = axis === "columns" ? screen.columns : screen.rows;
  if (spans.reduce((a, b) => a + b, 0) !== total || spans.some((n) => !Number.isSafeInteger(n) || n < 1)) throw new DomainError(`The parts of ${screen.name} must add up to its ${total} cabinet ${axis}.`);
  const cab = axis === "columns" ? screen.cabinet.pixelsX : screen.cabinet.pixelsY;
  let from = 0;
  return spans.map((span, i) => {
    const offset = from * cab;
    const part: ScreenPart = {
      key: `${screen.key}#${i + 1}`,
      screenKey: screen.key,
      index: i + 1,
      count: spans.length,
      axis,
      from,
      span,
      source: axis === "columns" ? { x: offset, y: 0, width: span * cab, height: screen.heightPx } : { x: 0, y: offset, width: screen.widthPx, height: span * cab },
    };
    from += span;
    return part;
  });
}

/** The parts an answer gives, or why it can't. */
export function partsForAnswer(screen: ScreenSizing, axis: "columns" | "rows", output: { width: number; height: number }, answer: CutAnswer): ScreenPart[] | string {
  const columns = axis === "columns";
  const spans = cutSpans(columns ? screen.columns : screen.rows, columns ? screen.cabinet.pixelsX : screen.cabinet.pixelsY, columns ? output.width : output.height, answer);
  return typeof spans === "string" ? spans : screenParts(screen, axis, spans);
}

/** What goes into outputs: whole screens, and the parts of split ones. */
export interface OutputItem {
  readonly key: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

export function outputItems(screens: readonly ScreenSizing[], parts: Readonly<Record<string, readonly ScreenPart[]>>): OutputItem[] {
  return screens.flatMap((s) =>
    parts[s.key]?.length
      ? parts[s.key].map((p) => ({ key: p.key, label: `${s.name} · part ${p.index}/${p.count}`, width: p.source.width, height: p.source.height }))
      : [{ key: s.key, label: s.name, width: s.widthPx, height: s.heightPx }],
  );
}

export interface OutputPlan {
  /** Output index and position per item key. */
  readonly placements: ReadonlyMap<string, { bin: number; x: number; y: number }>;
  readonly unplaced: readonly string[];
  /** Pixels used in each output. */
  readonly used: readonly number[];
}

/** Packs items 1:1 into `count` outputs, items pinned to an output first. Same input, same result. */
export function planOutputs(items: readonly OutputItem[], output: { width: number; height: number }, count: number, pinned: Readonly<Record<string, number>> = {}): OutputPlan {
  const bins: PackBin[] = Array.from({ length: count }, () => ({ ...output, obstacles: [] }));
  const placements = new Map<string, { bin: number; x: number; y: number }>();
  const unplaced: string[] = [];
  for (let bin = 0; bin < count; bin++) {
    const mine = items.filter((it) => pinned[it.key] === bin);
    const r = packRects(mine, [bins[bin]]);
    for (const [k, p] of r.placements) placements.set(k, { ...p, bin });
    unplaced.push(...r.unplaced);
  }
  unplaced.push(...items.filter((it) => pinned[it.key] !== undefined && pinned[it.key] >= count).map((it) => it.key));
  const taken = bins.map((b, i) => ({ ...b, obstacles: items.filter((it) => placements.get(it.key)?.bin === i).map((it) => ({ ...placements.get(it.key)!, width: it.width, height: it.height })) }));
  const auto = packRects(items.filter((it) => pinned[it.key] === undefined), taken);
  for (const [k, p] of auto.placements) placements.set(k, p);
  unplaced.push(...auto.unplaced);
  const used = bins.map((_, i) => items.filter((it) => placements.get(it.key)?.bin === i).reduce((n, it) => n + it.width * it.height, 0));
  return { placements, unplaced, used };
}

/** The fewest outputs of a size that hold every item, or null when one item is larger than an output. */
export function minimumOutputs(items: readonly OutputItem[], output: { width: number; height: number }, max = 16): number | null {
  if (items.some((it) => it.width > output.width || it.height > output.height)) return null;
  for (let n = 1; n <= max; n++) if (planOutputs(items, output, n).unplaced.length === 0) return n;
  return null;
}

export interface UnitPlan {
  /** Processor unit per output index, 0-based. */
  readonly unitOf: readonly number[];
  /** Pixels each unit carries. */
  readonly load: readonly number[];
  /** Units whose load is over the stated figure. */
  readonly over: readonly number[];
}

/**
 * Outputs given to processor units: an output goes to one unit whole, largest first, each to the first unit with room
 * for it under the stated load, otherwise to the least loaded. Deterministic. Says which units are over.
 */
export function assignUnits(used: readonly number[], units: number, loadPx: number): UnitPlan {
  if (!Number.isSafeInteger(units) || units < 1) throw new DomainError("There must be at least one processor.");
  if (loadPx <= 0) throw new DomainError("A processor load must be positive.");
  const unitOf: number[] = used.map(() => 0);
  const load = Array.from({ length: units }, () => 0);
  const order = used.map((px, i) => ({ px, i })).sort((a, b) => b.px - a.px || a.i - b.i);
  for (const { px, i } of order) {
    let unit = load.findIndex((l) => l + px <= loadPx);
    if (unit < 0) unit = load.indexOf(Math.min(...load));
    unitOf[i] = unit;
    load[unit] += px;
  }
  return { unitOf, load, over: load.flatMap((l, i) => (l > loadPx ? [i] : [])) };
}

/**
 * The fewest units that carry every output under the stated load, an output never shared between units: a proposal,
 * never applied without the operator's yes. At least total ÷ load, rounded up; more when outputs don't share well.
 */
export function minimumUnits(used: readonly number[], loadPx: number, max = 64): number {
  const total = used.reduce((a, b) => a + b, 0);
  for (let n = Math.max(1, Math.ceil(total / loadPx)); n <= max; n++) if (assignUnits(used, n, loadPx).over.length === 0) return n;
  return max;
}
