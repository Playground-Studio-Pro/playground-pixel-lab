import type { CabinetProfile } from "@/domain/model";
import { formatMm, parseMm, type Um } from "@/domain/units";
import { computeScreenSpec } from "../physical";
import { MAX_SIDE_PX } from "../validation";

/**
 * The fast map list: one line is one row on stage, top to bottom; `|` separates screens side by side. Without any
 * `|` in the whole list, every line goes side by side in one row.
 *
 *   Centro 5x3 P2.6
 *   Cuchilla izq 1x2 500x1000 P3.9
 *   Torre 2x6 Generic 500×500 P3.91      (a cabinet named exactly, instead of a pitch)
 *
 * Pure. A cabinet is never guessed, scaled or defaulted silently: an unknown or ambiguous one is an error on its
 * line, listing the candidates. The only way to settle a missing cabinet size is `sizesIfMissing`, one size per pitch, which the person
 * chooses and the interface shows.
 */

/** Where a cabinet comes from, in priority order. Same names as the cabinet dropdowns. */
export type CabinetGroup = "Project" | "Generic" | "Catalog" | "Library";

export interface CabinetChoice {
  readonly cabinet: CabinetProfile;
  readonly group: CabinetGroup;
}

/** A cabinet's physical size in micrometres. */
export interface CabinetSize {
  readonly widthUm: Um;
  readonly heightUm: Um;
}

export interface ParseOptions {
  /** Every cabinet the list may use, as `cabinetOptions` lists them: project, generic, catalog, library. */
  readonly cabinets: readonly CabinetChoice[];
  /**
   * Chosen by the person, one per written pitch: the cabinet size for every line of that pitch that writes no size and
   * fits more than one. Never applied to a line that states a size. A pitch without a choice: those lines are errors.
   */
  readonly sizesIfMissing?: readonly SizeChoice[];
  /** Screen names already in the project, when the list is added to it. */
  readonly takenNames?: readonly string[];
}

/** A size chosen for one written pitch, such as P3.9 → 500×500 mm. */
export interface SizeChoice {
  /** The pitch as written, in µm: P3.9 is 3900. */
  readonly pitchUm: Um;
  readonly size: CabinetSize;
}

/** A written pitch that fits more than one cabinet size on lines that write none. */
export interface MissingSize {
  readonly pitchUm: Um;
  /** The sizes to choose from. */
  readonly sizes: readonly CabinetSize[];
  /** Lines of this pitch with no size written: all of them take the choice. */
  readonly lines: number;
  /** The size chosen for this pitch, or null. */
  readonly chosen: CabinetSize | null;
}

export interface ParsedScreen {
  /** 1-based line in the pasted text. */
  readonly line: number;
  /** Stage row, 0 at the top, and position in that row, 0 at the left. */
  readonly row: number;
  readonly column: number;
  readonly name: string;
  readonly columns: number;
  readonly rows: number;
  readonly cabinet: CabinetProfile;
  readonly widthPx: number;
  readonly heightPx: number;
  /** Shown beside the line, so how its cabinet was found is never hidden. */
  readonly cabinetNote: string;
}

export interface LineError {
  readonly line: number;
  /** The piece of the line it is about. */
  readonly text: string;
  readonly message: string;
  /** Cabinets that would make this line valid, when the problem is which cabinet. */
  readonly candidates: readonly CabinetProfile[];
}

export interface ParseResult {
  readonly screens: readonly ParsedScreen[];
  readonly errors: readonly LineError[];
  /** Each written pitch whose lines without a size need a size choice, chosen or not, in pitch order. */
  readonly missingSizes: readonly MissingSize[];
  /** True when there is at least one screen and no error: only then may anything be created. */
  readonly ok: boolean;
}

/** Same limit as `project-ops` columns and rows. */
export const MAX_CABINETS_PER_SIDE = 1000;
/** Largest list, so arranging stays instant. */
export const MAX_LIST_SCREENS = 200;
/** A written pitch matches a cabinet's nominal pitch within this, in µm: P3.9 is 3.91, P2.6 is 2.604. */
export const PITCH_TOLERANCE_UM = 20;

const GROUP_RANK: Record<CabinetGroup, number> = { Project: 0, Generic: 1, Catalog: 2, Library: 2 };

/** Case, spacing and width-sign insensitive key for names. */
export function nameKey(name: string): string {
  return name.normalize("NFC").replace(/[×✕]/g, "x").replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeCell(text: string): string {
  return text
    .normalize("NFC")
    .replace(/["“”]/g, "")
    .replace(/[×✕]/g, "x")
    // A decimal comma in a pitch, as a Spanish spreadsheet writes it: P3,9.
    .replace(/(\bp\s*\d+),(\d{1,3})(?![\dx])/gi, "$1.$2")
    .replace(/[\t,;]+/g, " ")
    .replace(/(\d)\s*mm\b/gi, "$1")
    .replace(/(\d)\s*x\s*(?=\d)/gi, "$1x")
    .replace(/\bp\s+(?=\d)/gi, "P")
    .replace(/\s+/g, " ")
    .trim();
}

const GRID = /^(\d+)x(\d+)$/i;
const PITCH = /^p(\d+(?:\.\d{1,3})?)$/i;
const SIZE = /^(\d{2,5}(?:\.\d{1,3})?)x(\d{2,5}(?:\.\d{1,3})?)$/i;

type Spec = { kind: "spec"; pitchUm: Um | null; size: CabinetSize | null } | { kind: "name"; name: string } | { kind: "none" };

function readSpec(tokens: readonly string[]): Spec | null {
  if (tokens.length === 0) return { kind: "none" };
  let pitchUm: Um | null = null;
  let size: CabinetSize | null = null;
  for (const t of tokens) {
    const p = PITCH.exec(t);
    const s = SIZE.exec(t);
    if (p && pitchUm === null) pitchUm = parseMm(p[1]);
    else if (s && size === null) {
      const w = parseMm(s[1]);
      const h = parseMm(s[2]);
      if (w === null || h === null) return null;
      size = { widthUm: w, heightUm: h };
    } else return null;
  }
  return { kind: "spec", pitchUm, size };
}

const geometryKey = (c: CabinetProfile) => `${c.widthUm}x${c.heightUm}:${c.pixelsX}x${c.pixelsY}`;
export const sizeLabel = (s: CabinetSize) => `${formatMm(s.widthUm)}×${formatMm(s.heightUm)} mm`;
const cabinetLabel = (c: CabinetProfile) => `${c.name} (${sizeLabel(c)}, ${c.pixelsX}×${c.pixelsY} px)`;

type Ambiguous = { pitchUm: Um; sizes: CabinetSize[] };
type Match = ({ ok: true; cabinet: CabinetProfile; note: string } | { ok: false; message: string; candidates: CabinetProfile[] }) & { ambiguous?: Ambiguous };

/** Several cabinets of the same size and pixels map identically. A project or generic one wins; otherwise it must be unique. */
function pickOne(same: readonly CabinetChoice[], how: string): Match {
  const best = Math.min(...same.map((c) => GROUP_RANK[c.group]));
  const top = same.filter((c) => GROUP_RANK[c.group] === best);
  const ids = [...new Set(top.map((c) => c.cabinet.id))];
  if (ids.length > 1) {
    const list = top.map((c) => c.cabinet);
    return {
      ok: false,
      message: `${how} fits ${list.length} cabinets of the same size: ${list.map((c) => `“${c.name}”`).join(", ")}. Write the cabinet's name instead.`,
      candidates: list,
    };
  }
  const chosen = top[0].cabinet;
  const others = [...new Set(same.map((c) => c.cabinet).filter((c) => c.id !== chosen.id).map((c) => c.name))];
  const note = `${chosen.name}, ${sizeLabel(chosen)}, ${chosen.pixelsX}×${chosen.pixelsY} px` + (others.length ? `. Same size and pixels as ${others.join(", ")}` : "");
  return { ok: true, cabinet: chosen, note };
}

function byGeometry(choices: readonly CabinetChoice[]): CabinetChoice[][] {
  const groups = new Map<string, CabinetChoice[]>();
  for (const c of choices) groups.set(geometryKey(c.cabinet), [...(groups.get(geometryKey(c.cabinet)) ?? []), c]);
  return [...groups.values()];
}

function matchCabinet(spec: Spec, options: ParseOptions): Match {
  const all = options.cabinets;
  if (spec.kind === "none") {
    return { ok: false, message: "no cabinet. Add the pitch, such as P2.6, and the cabinet size in mm when the pitch comes in more than one: 500x1000.", candidates: [] };
  }
  if (spec.kind === "name") {
    const found = all.filter((c) => nameKey(c.cabinet.name) === nameKey(spec.name));
    if (found.length === 0) {
      return { ok: false, message: `No cabinet called “${spec.name}”. Write a pitch such as P2.6, or a cabinet name from the project or library.`, candidates: [] };
    }
    const geometries = byGeometry(found);
    if (geometries.length > 1) {
      const list = found.map((c) => c.cabinet);
      return { ok: false, message: `Several different cabinets are called “${spec.name}”: ${list.map(cabinetLabel).join("; ")}. Rename one in the library.`, candidates: list };
    }
    return pickOne(geometries[0], `“${spec.name}”`);
  }

  const written = [spec.pitchUm !== null && `P${formatMm(spec.pitchUm)}`, spec.size && sizeLabel(spec.size)].filter(Boolean).join(" ");
  if (spec.pitchUm === null) {
    return { ok: false, message: `${written}: add the pitch, such as P3.9. A size alone doesn't say which cabinet.`, candidates: [] };
  }
  const pitchUm = spec.pitchUm;
  const samePitch = all.filter((c) => Math.abs(c.cabinet.nominalPitchUm - pitchUm) <= PITCH_TOLERANCE_UM);
  const fits = spec.size ? samePitch.filter((c) => c.cabinet.widthUm === spec.size!.widthUm && c.cabinet.heightUm === spec.size!.heightUm) : samePitch;
  if (fits.length === 0) {
    const near = (samePitch.length ? samePitch : [...all].sort((a, b) => Math.abs(a.cabinet.nominalPitchUm - pitchUm) - Math.abs(b.cabinet.nominalPitchUm - pitchUm)).slice(0, 3)).map((c) => c.cabinet);
    const unique = [...new Map(near.map((c) => [c.id, c])).values()];
    return {
      ok: false,
      message: `No ${written} cabinet in the project, the generic profiles, the catalog or your library. Add it in Cabinets first; it is never guessed.` + (unique.length ? ` Closest: ${unique.map(cabinetLabel).join("; ")}.` : ""),
      candidates: unique,
    };
  }
  let geometries = byGeometry(fits);
  const sizesOf = (gs: CabinetChoice[][]) => [...new Map(gs.map((g) => g[0].cabinet).map((c) => [`${c.widthUm}x${c.heightUm}`, { widthUm: c.widthUm, heightUm: c.heightUm }])).values()];
  const ambiguous: Ambiguous | undefined = geometries.length > 1 && !spec.size && sizesOf(geometries).length > 1 ? { pitchUm, sizes: sizesOf(geometries) } : undefined;
  const chosen = ambiguous && options.sizesIfMissing?.find((c) => c.pitchUm === pitchUm)?.size;
  if (chosen) {
    const narrowed = geometries.filter((g) => g[0].cabinet.widthUm === chosen.widthUm && g[0].cabinet.heightUm === chosen.heightUm);
    if (narrowed.length === 1) {
      const match = pickOne(narrowed[0], written);
      return { ...(match.ok ? { ...match, note: `${match.note}. Size not written: ${sizeLabel(chosen)}, as chosen for P${formatMm(pitchUm)} lines without a size` } : match), ambiguous };
    }
    if (narrowed.length > 1) geometries = narrowed;
  }
  if (geometries.length > 1) {
    const list = geometries.map((g) => g[0].cabinet);
    const hint = !ambiguous ? "Write the cabinet's name instead." : `Add the cabinet size, such as ${formatMm(list[0].widthUm)}x${formatMm(list[0].heightUm)}, or choose a size for P${formatMm(pitchUm)} lines without one.`;
    return { ok: false, message: `${written} fits different cabinets: ${list.map(cabinetLabel).join("; ")}. ${hint}`, candidates: list, ambiguous };
  }
  return pickOne(geometries[0], written);
}

interface Cell {
  readonly line: number;
  readonly row: number;
  readonly column: number;
  readonly raw: string;
}

function cells(text: string): Cell[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const sketch = lines.some((l) => l.includes("|"));
  const out: Cell[] = [];
  let row = 0;
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) return;
    const parts = sketch ? trimmed.split("|") : [trimmed];
    let column = sketch ? 0 : out.length;
    let any = false;
    for (const part of parts) {
      if (!part.trim()) continue;
      out.push({ line: i + 1, row: sketch ? row : 0, column: column++, raw: part.trim() });
      any = true;
    }
    if (sketch && any) row++;
  });
  return out;
}

/** Parses the whole list. Same text and options always give the same result. */
export function parseScreenList(text: string, options: ParseOptions): ParseResult {
  const screens: ParsedScreen[] = [];
  const errors: LineError[] = [];
  const missing = new Map<number, { pitchUm: Um; sizes: Map<string, CabinetSize>; lines: number }>();
  const seen = new Map<string, number>();
  const taken = new Set((options.takenNames ?? []).map(nameKey));
  const all = cells(text);

  for (const cell of all) {
    const fail = (message: string, candidates: readonly CabinetProfile[] = []) => errors.push({ line: cell.line, text: cell.raw, message, candidates });
    const tokens = normalizeCell(cell.raw).split(" ").filter(Boolean);
    const grids = tokens.map((t, i) => (i > 0 && GRID.test(t) ? i : -1)).filter((i) => i > 0);
    if (grids.length === 0) {
      fail(`“${cell.raw}”: write the name, then columns x rows, then the pitch: Centro 5x3 P2.6`);
      continue;
    }
    // Prefer a reading whose rest is exactly a cabinet name, then one whose rest is a pitch and size, then any.
    const readings = grids.map((i) => ({ i, rest: tokens.slice(i + 1) }));
    const named = readings.find((r) => r.rest.length > 0 && options.cabinets.some((c) => nameKey(c.cabinet.name) === nameKey(r.rest.join(" "))));
    const specced = readings.find((r) => readSpec(r.rest) !== null);
    const reading = named ?? specced ?? readings[0];
    const spec: Spec = named ? { kind: "name", name: reading.rest.join(" ") } : (readSpec(reading.rest) ?? { kind: "name", name: reading.rest.join(" ") });

    const name = tokens.slice(0, reading.i).join(" ");
    const [, c, r] = GRID.exec(tokens[reading.i])!;
    const columns = Number(c);
    const rows = Number(r);
    if (columns < 1 || rows < 1) {
      fail(`“${name}”: columns and rows start at 1, not ${columns}x${rows}.`);
      continue;
    }
    if (columns > MAX_CABINETS_PER_SIDE || rows > MAX_CABINETS_PER_SIDE) {
      fail(`“${name}”: ${columns}x${rows} is more than ${MAX_CABINETS_PER_SIDE} cabinets on a side. If it is the cabinet size in mm, write columns x rows first: ${name} 2x3 ${columns}x${rows} P3.9.`);
      continue;
    }
    if (columns >= 100 && rows >= 100) {
      fail(`“${name}”: ${columns}x${rows} looks like a cabinet size in mm, not columns x rows. Write columns x rows first: ${name} 1x2 ${columns}x${rows} P3.9.`);
      continue;
    }
    const key = nameKey(name);
    if (taken.has(key)) {
      fail(`“${name}” is already a screen in this project. Use another name, or replace the project's screens.`);
      continue;
    }
    const first = seen.get(key);
    if (first !== undefined) {
      fail(`“${name}” is used twice, first on line ${first}. Each screen needs its own name.`);
      continue;
    }
    seen.set(key, cell.line);

    const match = matchCabinet(spec, options);
    if (match.ambiguous) {
      const entry = missing.get(match.ambiguous.pitchUm) ?? { pitchUm: match.ambiguous.pitchUm, sizes: new Map(), lines: 0 };
      for (const s of match.ambiguous.sizes) entry.sizes.set(`${s.widthUm}x${s.heightUm}`, s);
      entry.lines++;
      missing.set(entry.pitchUm, entry);
    }
    if (!match.ok) {
      fail(`“${name}”: ${match.message}`, match.candidates);
      continue;
    }
    const size = computeScreenSpec({ columns, rows }, match.cabinet);
    if (size.pixelWidth > MAX_SIDE_PX || size.pixelHeight > MAX_SIDE_PX) {
      fail(`“${name}” would be ${size.pixelWidth}×${size.pixelHeight} px, more than ${MAX_SIDE_PX} px on a side.`);
      continue;
    }
    screens.push({ line: cell.line, row: cell.row, column: cell.column, name, columns, rows, cabinet: match.cabinet, widthPx: size.pixelWidth, heightPx: size.pixelHeight, cabinetNote: match.note });
  }

  if (all.length > MAX_LIST_SCREENS) {
    errors.push({ line: all[MAX_LIST_SCREENS].line, text: all[MAX_LIST_SCREENS].raw, message: `The list has ${all.length} screens. Fast map takes up to ${MAX_LIST_SCREENS} at a time.`, candidates: [] });
  }
  const missingSizes: MissingSize[] = [...missing.values()]
    .sort((a, b) => a.pitchUm - b.pitchUm)
    .map((m) => ({
      pitchUm: m.pitchUm,
      sizes: [...m.sizes.values()].sort((a, b) => a.widthUm - b.widthUm || a.heightUm - b.heightUm),
      lines: m.lines,
      chosen: options.sizesIfMissing?.find((c) => c.pitchUm === m.pitchUm)?.size ?? null,
    }));
  return { screens, errors: errors.sort((a, b) => a.line - b.line), missingSizes, ok: screens.length > 0 && errors.length === 0 };
}
