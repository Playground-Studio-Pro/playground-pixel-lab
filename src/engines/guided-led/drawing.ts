import { formatUm, parseDimension } from "./dimension";

/**
 * Reading a constructivo (a stage drawing): screens, their sizes and the gaps between them, as an editable proposal.
 *
 * Pure. It works on what a PDF reader already extracted (text with positions, closed axis-aligned rectangles) in the
 * drawing's own units, top-left origin, y down. It never invents a value: every value says whether it was read from a
 * label, typed by the operator, guessed from the drawing (and why), or is missing.
 */

export type ValueSource = "read" | "typed" | "guessed" | "missing";

export interface Sourced<T> {
  readonly value: T | null;
  readonly source: ValueSource;
  /** Why, in plain words: the label read, or what the guess rests on. */
  readonly note?: string;
}

export interface DrawingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DrawingText extends DrawingBox {
  readonly text: string;
}

export interface DrawingPage {
  /** "vector": text and rectangles were extracted. "raster": an image, nothing can be read automatically. */
  readonly kind: "vector" | "raster";
  readonly width: number;
  readonly height: number;
  readonly texts: readonly DrawingText[];
  readonly rects: readonly DrawingBox[];
}

export interface ProposedScreen {
  /** Stable key for this proposal, not a project id. */
  readonly key: string;
  /** Where the screen is on the drawing, in drawing units. */
  readonly rect: DrawingBox;
  readonly name: Sourced<string>;
  /** Micrometres. */
  readonly width: Sourced<number>;
  readonly height: Sourced<number>;
  /** Distance from the highest screen's top down to this screen's top, micrometres. */
  readonly top: Sourced<number>;
}

export interface ProposedGap {
  readonly left: string;
  readonly right: string;
  /** Micrometres between the right edge of `left` and the left edge of `right`. */
  readonly um: Sourced<number>;
}

export interface DrawingProposal {
  readonly screens: readonly ProposedScreen[];
  readonly gaps: readonly ProposedGap[];
  /** What the reader could not use, in plain words. */
  readonly notes: readonly string[];
}

const missing = <T>(note?: string): Sourced<T> => ({ value: null, source: "missing", note });
const centreX = (b: DrawingBox) => b.x + b.width / 2;
const centreY = (b: DrawingBox) => b.y + b.height / 2;
const contains = (outer: DrawingBox, inner: DrawingBox, slack = 0) =>
  inner.x >= outer.x - slack && inner.y >= outer.y - slack && inner.x + inner.width <= outer.x + outer.width + slack && inner.y + inner.height <= outer.y + outer.height + slack;
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** Screens drawn closer than this share of the page width count as touching. */
const TOUCH_SHARE = 0.002;
/** Rectangles smaller than this share of the page on either side are ticks or symbols, not screens. */
const MIN_SHARE = 0.01;
/** A label further than this share of the page height from a screen is not that screen's. */
const LABEL_REACH = 0.2;

/** Rectangles that look like screens: not the sheet border, not a title block full of text, not a frame around others. */
function screenRects(page: DrawingPage): DrawingBox[] {
  const tol = Math.max(page.width, page.height) * 0.001;
  const candidates: DrawingBox[] = [];
  for (const r of page.rects) {
    if (r.width < page.width * MIN_SHARE || r.height < page.height * MIN_SHARE) continue;
    if (r.width > page.width * 0.9 && r.height > page.height * 0.9) continue;
    if (page.texts.filter((t) => contains(r, t)).length > 2) continue;
    if (candidates.some((c) => near(c.x, r.x, tol) && near(c.y, r.y, tol) && near(c.width, r.width, tol) && near(c.height, r.height, tol))) continue;
    candidates.push(r);
  }
  return candidates.filter((r) => !candidates.some((o) => o !== r && contains(r, o, tol)));
}

type Target = { kind: "width" | "height"; screen: number } | { kind: "gap"; pair: number };

/** Builds the editable proposal from one page. */
export function readDrawing(page: DrawingPage): DrawingProposal {
  const notes: string[] = [];
  if (page.kind === "raster") {
    return {
      screens: [],
      gaps: [],
      notes: ["This is an image, so nothing can be read from it automatically. Draw each screen on it and type its size."],
    };
  }
  const rects = screenRects(page).sort((a, b) => a.x - b.x || a.y - b.y);
  if (rects.length === 0) notes.push("No screen outlines were found. Draw each screen on the drawing.");
  const reach = page.height * LABEL_REACH;

  // Every dimension label can measure a screen's width (centred over or under it), its height (beside it, within its
  // height) or the gap between two neighbours (over or under the gap). Each measure takes at most one label. Labels are
  // matched so that as many as possible are used, each trying its closest measure first: a label squeezed into a narrow
  // gap then still goes to its own screen when the neighbour has a label of its own.
  const labels = page.texts.map((t) => ({ t, d: parseDimension(t.text) })).filter((l) => l.d !== null);
  const keyOf = (target: Target) => (target.kind === "gap" ? `gap:${target.pair}` : `${target.kind}:${target.screen}`);
  const candidates = labels.map((label) => {
    const cx = centreX(label.t);
    const cy = centreY(label.t);
    const options: { key: string; distance: number }[] = [];
    const consider = (target: Target, distance: number) => {
      if (distance <= reach) options.push({ key: keyOf(target), distance });
    };
    rects.forEach((r, i) => {
      const inX = cx >= r.x && cx <= r.x + r.width;
      const inY = cy >= r.y && cy <= r.y + r.height;
      if (inX && !inY) consider({ kind: "width", screen: i }, cy < r.y ? r.y - cy : cy - (r.y + r.height));
      if (inY && !inX) consider({ kind: "height", screen: i }, cx < r.x ? r.x - cx : cx - (r.x + r.width));
    });
    for (let i = 0; i + 1 < rects.length; i++) {
      const [a, b] = [rects[i], rects[i + 1]];
      const inGap = cx > a.x + a.width && cx < b.x;
      const outside = (r: DrawingBox) => cy < r.y || cy > r.y + r.height;
      if (inGap && outside(a) && outside(b)) {
        const top = Math.min(a.y, b.y);
        const bottom = Math.max(a.y + a.height, b.y + b.height);
        consider({ kind: "gap", pair: i }, cy < top ? top - cy : Math.max(0, cy - bottom));
      }
    }
    return options.sort((x, y) => x.distance - y.distance);
  });
  // Maximum matching (augmenting paths), labels taken closest-first, options tried closest-first. Deterministic.
  const holder = new Map<string, number>();
  const tryAssign = (li: number, seen: Set<string>): boolean => {
    for (const o of candidates[li]) {
      if (seen.has(o.key)) continue;
      seen.add(o.key);
      const current = holder.get(o.key);
      if (current === undefined || tryAssign(current, seen)) {
        holder.set(o.key, li);
        return true;
      }
    }
    return false;
  };
  const order = labels.map((_, i) => i).sort((a, b) => (candidates[a][0]?.distance ?? Infinity) - (candidates[b][0]?.distance ?? Infinity) || a - b);
  for (const li of order) {
    if (candidates[li].length === 0) notes.push(`“${labels[li].t.text}” wasn't next to any screen, so it wasn't used.`);
    else if (!tryAssign(li, new Set())) notes.push(`“${labels[li].t.text}” wasn't used: the measures near it already have closer labels.`);
  }
  const best = new Map([...holder].map(([key, li]) => [key, { label: labels[li] }]));
  const readValue = (key: string): Sourced<number> | null => {
    const hit = best.get(key);
    if (!hit || !hit.label.d) return null;
    const d = hit.label.d;
    return { value: d.um, source: "read", note: d.unitAssumed ? `Read “${d.text}”, taken as ${d.unit === "m" ? "metres" : "millimetres"}` : `Read “${d.text}”` };
  };

  const names = rects.map((r, i): Sourced<string> => {
    const inside = page.texts.filter((t) => contains(r, t) && !parseDimension(t.text)).sort((a, b) => a.y - b.y || a.x - b.x);
    const text = inside.map((t) => t.text.trim()).filter(Boolean).join(" ");
    return text ? { value: text, source: "read" } : { value: `Screen ${i + 1}`, source: "guessed", note: "No name on the drawing" };
  });
  const widths = rects.map((_, i) => readValue(`width:${i}`));
  const heights = rects.map((_, i) => readValue(`height:${i}`));
  // A size drawn exactly like a labelled one is proposed as a guess, naming the screen it copies. Never silently.
  const copySize = (values: (Sourced<number> | null)[], side: "width" | "height"): Sourced<number>[] =>
    values.map((v, i) => {
      if (v) return v;
      const drawn = rects[i][side];
      const twin = values.findIndex((o, j) => o?.source === "read" && near(rects[j][side], drawn, drawn * 0.005));
      if (twin < 0) return missing(`No ${side} label`);
      return { value: values[twin]!.value, source: "guessed", note: `No ${side} label; drawn the same ${side} as ${names[twin].value}` };
    });
  const w = copySize(widths, "width");
  const h = copySize(heights, "height");

  // Vertical position: aligned tops are read as aligned; otherwise the drawing's own scale gives a guess.
  const minTop = Math.min(...rects.map((r) => r.y));
  const tol = page.height * 0.002;
  const scales = rects.flatMap((r, i) => (widths[i]?.value ? [widths[i]!.value! / r.width] : []));
  const scale = scales.length ? [...scales].sort((a, b) => a - b)[Math.floor(scales.length / 2)] : null;
  const tops = rects.map((r): Sourced<number> => {
    if (near(r.y, minTop, tol)) return { value: 0, source: "read", note: "Top aligned with the highest screen on the drawing" };
    if (scale === null) return missing("Not aligned with the others, and the drawing has no scale to measure it");
    const um = Math.round(((r.y - minTop) * scale) / 1000) * 1000;
    return { value: um, source: "guessed", note: `Measured on the drawing at its scale: ${formatUm(um)} below the highest top` };
  });

  const screens = rects.map((rect, i): ProposedScreen => ({ key: `s${i + 1}`, rect, name: names[i], width: w[i], height: h[i], top: tops[i] }));
  const gaps = reconcileGaps(screens, [], page.width).map((g, i) => {
    const read = readValue(`gap:${i}`);
    return read ? { ...g, um: read } : g;
  });
  return { screens, gaps, notes };
}

/**
 * The gaps between screens left to right on the drawing. Values already given for the same pair are kept; screens
 * drawn touching get a guessed 0; any other gap is missing until it is read or typed.
 */
export function reconcileGaps(screens: readonly ProposedScreen[], previous: readonly ProposedGap[], pageWidth: number): ProposedGap[] {
  const ordered = [...screens].sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y);
  const gaps: ProposedGap[] = [];
  for (let i = 0; i + 1 < ordered.length; i++) {
    const [a, b] = [ordered[i], ordered[i + 1]];
    const kept = previous.find((g) => g.left === a.key && g.right === b.key);
    if (kept) {
      gaps.push(kept);
      continue;
    }
    const drawn = b.rect.x - (a.rect.x + a.rect.width);
    gaps.push({
      left: a.key,
      right: b.key,
      um: Math.abs(drawn) <= pageWidth * TOUCH_SHARE ? { value: 0, source: "guessed", note: "Drawn touching" } : missing("No gap label"),
    });
  }
  return gaps;
}

/** One screen ready for the plan: every value known. Positions are stage space, micrometres. */
export interface LaidOutScreen {
  readonly key: string;
  readonly name: string;
  readonly widthUm: number;
  readonly heightUm: number;
  /** Space from the previous screen's right edge, micrometres. 0 for the first screen. */
  readonly gapBeforeUm: number;
  /** Distance below the highest screen's top, micrometres. */
  readonly yUm: number;
}

/** A value still needed, as a question for the operator, pointed at the drawing. */
export interface Question {
  readonly id: string;
  readonly text: string;
  /** The screen or the pair of screens it is about, by key. */
  readonly about: readonly string[];
  readonly field: "name" | "width" | "height" | "top" | "gap";
}

export type LayoutResult = { readonly ok: true; readonly screens: readonly LaidOutScreen[] } | { readonly ok: false; readonly questions: readonly Question[] };

/**
 * Turns a confirmed proposal into the screens left to right on the drawing, with their sizes and the gaps between them.
 * Guessed values count as answers only once the operator has accepted them (`accepted` keys `field:key`).
 */
export function layoutFromProposal(screens: readonly ProposedScreen[], gaps: readonly ProposedGap[], accepted: ReadonlySet<string> = new Set()): LayoutResult {
  const questions: Question[] = [];
  const known = (v: Sourced<unknown>, id: string) => v.value !== null && (v.source !== "guessed" || accepted.has(id));
  const ordered = [...screens].sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y);
  const nameOf = (s: ProposedScreen) => s.name.value ?? s.key;
  const names = new Set<string>();
  for (const s of ordered) {
    const n = nameOf(s).trim();
    if (!n) questions.push({ id: `name:${s.key}`, text: `What is this screen called?`, about: [s.key], field: "name" });
    else if (names.has(n.toLowerCase())) questions.push({ id: `name:${s.key}`, text: `Two screens are called “${n}”. What is this one called?`, about: [s.key], field: "name" });
    names.add(n.toLowerCase());
    if (!known(s.width, `width:${s.key}`)) questions.push({ id: `width:${s.key}`, text: s.width.value === null ? `How wide is ${n}?` : `Is ${n} ${formatUm(s.width.value)} wide? ${s.width.note ?? ""}`.trim(), about: [s.key], field: "width" });
    if (!known(s.height, `height:${s.key}`)) questions.push({ id: `height:${s.key}`, text: s.height.value === null ? `How tall is ${n}?` : `Is ${n} ${formatUm(s.height.value)} tall? ${s.height.note ?? ""}`.trim(), about: [s.key], field: "height" });
    if (!known(s.top, `top:${s.key}`)) questions.push({ id: `top:${s.key}`, text: s.top.value === null ? `How far below the highest screen is the top of ${n}?` : `Is the top of ${n} ${formatUm(s.top.value)} below the highest screen?`, about: [s.key], field: "top" });
  }
  for (let i = 0; i + 1 < ordered.length; i++) {
    const [a, b] = [ordered[i], ordered[i + 1]];
    const gap = gaps.find((g) => g.left === a.key && g.right === b.key);
    const id = `gap:${a.key}:${b.key}`;
    if (!gap || !known(gap.um, id)) {
      const text = gap?.um.value != null ? `Is the gap between ${nameOf(a)} and ${nameOf(b)} ${formatUm(gap.um.value)}? ${gap.um.note ?? ""}`.trim() : `How big is the gap between ${nameOf(a)} and ${nameOf(b)}?`;
      questions.push({ id, text, about: [a.key, b.key], field: "gap" });
    }
  }
  if (ordered.length === 0) questions.push({ id: "screens", text: "Where are the screens? Draw at least one on the drawing.", about: [], field: "name" });
  if (questions.length) return { ok: false, questions };

  const out = ordered.map((s, i): LaidOutScreen => {
    const gap = i > 0 ? gaps.find((g) => g.left === ordered[i - 1].key && g.right === s.key)!.um.value! : 0;
    return { key: s.key, name: nameOf(s).trim(), widthUm: s.width.value!, heightUm: s.height.value!, gapBeforeUm: gap, yUm: s.top.value! };
  });
  return { ok: true, screens: out };
}

/** A value the operator typed. */
export function typed<T>(value: T): Sourced<T> {
  return { value, source: "typed" };
}

/**
 * A screen the operator drew on the drawing. Its size starts missing; its top is guessed level with the highest screen
 * when drawn level with it (within 2% of its height), otherwise missing.
 */
export function drawnScreen(screens: readonly ProposedScreen[], rect: DrawingBox): ProposedScreen {
  let n = screens.length + 1;
  while (screens.some((s) => s.key === `s${n}`)) n++;
  const others = screens.map((s) => s.rect.y);
  const minTop = others.length ? Math.min(...others) : rect.y;
  const level = Math.abs(rect.y - minTop) <= rect.height * 0.02;
  return {
    key: `s${n}`,
    rect,
    name: missing("Not named yet"),
    width: missing("Type the width"),
    height: missing("Type the height"),
    top: level ? { value: 0, source: others.length ? "guessed" : "read", note: others.length ? "Drawn level with the highest screen" : "The first screen sets the top" } : missing("Not level with the others"),
  };
}
