import { describe, expect, it } from "vitest";
import { BUILTIN_CABINETS, SEED_LIBRARY_CABINETS, type LibraryCabinet } from "@/domain/cabinets";
import type { CabinetProfile } from "@/domain/model";
import { mmToUm, px } from "@/domain/units";
import { parseScreenList, type ParseOptions } from "@/engines/fast-map";
import { choices, HP_STAGE_LIST, SIZE_500 } from "./design-fast-map-fixtures";
import * as ops from "@/engines/project-ops";
import { testContext } from "./helpers";

const opts = (extra: Partial<ParseOptions> = {}): ParseOptions => ({ cabinets: choices(), ...extra });
const sizes = (text: string, extra?: Partial<ParseOptions>) => parseScreenList(text, opts(extra)).screens.map((s) => `${s.widthPx}x${s.heightPx}`);
const firstError = (text: string, extra?: Partial<ParseOptions>) => parseScreenList(text, opts(extra)).errors[0]?.message ?? "";

describe("fast map list: the HP Stage list", () => {
  it("gives 8 screens with the expected sizes once 500×500 is chosen for lines without a size", () => {
    const result = parseScreenList(HP_STAGE_LIST, opts({ sizeIfMissing: SIZE_500 }));
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.screens.map((s) => s.name)).toEqual(["Header", "Torre izq", "Cuchilla izq", "Centro", "Cuchilla der", "Torre der", "DJ", "Cinta"]);
    expect(result.screens.map((s) => `${s.widthPx}x${s.heightPx}`)).toEqual(["1024x128", "256x768", "128x512", "960x576", "128x512", "256x768", "512x128", "1792x128"]);
    expect(result.screens.map((s) => [s.row, s.column])).toEqual([[0, 0], [1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [2, 0], [3, 0]]);
  });

  it("picks the generic profile, says so, and names the same-size cabinets it could also be", () => {
    const centro = parseScreenList(HP_STAGE_LIST, opts({ sizeIfMissing: SIZE_500 })).screens[3];
    expect(centro.cabinet.id).toBe("builtin-500x500-p26");
    expect(centro.cabinetNote).toContain("Size not written: 500×500 mm, as chosen");
    expect(centro.cabinetNote).toContain("Unilumin Upad IV 2.6");
  });

  it("without a chosen size, never guesses: each line without a size is an error listing both cabinets", () => {
    const result = parseScreenList(HP_STAGE_LIST, opts());
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.line)).toEqual([1, 2, 2, 2, 3, 4]);
    expect(result.screens.map((s) => s.name)).toEqual(["Cuchilla izq", "Cuchilla der"]);
    const header = result.errors[0];
    expect(header.message).toContain("fits different cabinets");
    expect(header.candidates.map((c) => c.id).sort()).toEqual(["builtin-500x1000-p391", "builtin-500x500-p391"]);
    expect(result.missingSizeOptions).toEqual([SIZE_500, { widthUm: mmToUm(500), heightUm: mmToUm(1000) }]);
  });

  it("is deterministic", () => {
    expect(parseScreenList(HP_STAGE_LIST, opts({ sizeIfMissing: SIZE_500 }))).toEqual(parseScreenList(HP_STAGE_LIST, opts({ sizeIfMissing: SIZE_500 })));
  });
});

describe("fast map list: layout of rows", () => {
  it("without any |, every line goes side by side in one row", () => {
    const result = parseScreenList("A 2x2 P2.6 500x500\nB 1x1 P2.6 500x500\n\nC 3x1 P2.6 500x500", opts());
    expect(result.screens.map((s) => [s.name, s.line, s.row, s.column])).toEqual([["A", 1, 0, 0], ["B", 2, 0, 1], ["C", 4, 0, 2]]);
  });

  it("with a |, each line is a stage row, top to bottom; empty cells and comments are skipped", () => {
    const result = parseScreenList("# stage\nA 1x1 P2.6 500x500 | | B 1x1 P2.6 500x500 |\n\nC 1x1 P2.6 500x500", opts());
    expect(result.errors).toEqual([]);
    expect(result.screens.map((s) => [s.name, s.row, s.column])).toEqual([["A", 0, 0], ["B", 0, 1], ["C", 1, 0]]);
  });
});

describe("fast map list: spreadsheet and typing variants", () => {
  const same = "960x576";
  it.each([
    ["Centro 5x3 P2.6 500x500"],
    ["Centro 5×3 P2.6 500×500"],
    ["Centro 5 x 3 P 2.6 500 x 500"],
    ["Centro\t5x3\tP2.6\t500x500"],
    ["Centro,5x3,P2.6,500x500"],
    ["Centro;5x3;P2,6;500x500"],
    ["Centro 5x3 P2,6 500x500mm"],
    ['"Centro",5x3,"P2.6","500x500"'],
    ["  centro   5X3   p2.6   500X500  "],
    ["Centro 5x3 500x500 P2.6"],
    ["Centro 5x3 P2.604 500x500"],
    ["Centro 5x3 Generic 500×500 P2.6"],
    ["Centro 5x3 generic 500x500 p2.6"],
  ])("%s", (text) => {
    expect(parseScreenList(text, opts()).errors).toEqual([]);
    expect(sizes(text)).toEqual([same]);
  });

  it("keeps a name with numbers and an x in it", () => {
    const result = parseScreenList("Pantalla 2x2 5x3 P2.6 500x500", opts());
    expect(result.screens.map((s) => [s.name, s.columns, s.rows])).toEqual([["Pantalla 2x2", 5, 3]]);
  });

  it("keeps Spanish names with accents, normalized", () => {
    const result = parseScreenList("Pantalla León 2x2 P3.9 500x500 | Señal Cañón 1x1 P3.9 500x500 | Dirección 1x1 P3.9 500x500", opts());
    expect(result.errors).toEqual([]);
    expect(result.screens.map((s) => s.name)).toEqual(["Pantalla León", "Señal Cañón", "Dirección"]);
  });
});

describe("fast map list: bad lines are errors on their own line", () => {
  it.each([
    ["Centro", "write the name, then columns x rows"],
    ["5x3 P2.6", "write the name"],
    ["Centro 0x3 P2.6 500x500", "start at 1"],
    ["Centro 5x0 P2.6 500x500", "start at 1"],
    ["Centro 5x3", "no cabinet"],
    ["Centro 5x3 500x500", "add the pitch"],
    ["Centro 5x3 P7 500x500", "never guessed"],
    ["Centro 5x3 P2.6 600x600", "never guessed"],
    ["Centro 5x3 Missing Brand P9", "No cabinet called"],
    ["Centro 1001x1 P2.6 500x500", "more than 1000 cabinets"],
    ["Cuchilla 500x1000 P3.9", "looks like a cabinet size"],
    ["Cinta ancha 90x1 P2.6 500x500", "more than 16384 px"],
  ])("%s", (text, expected) => {
    const result = parseScreenList(text, opts());
    expect(result.ok).toBe(false);
    expect(result.screens).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(1);
    expect(result.errors[0].message).toContain(expected);
  });

  it("lists the closest cabinets for an unknown pitch", () => {
    const error = parseScreenList("Centro 5x3 P2.8", opts()).errors[0];
    expect(error.message).toContain("Closest");
    expect(error.candidates.map((c) => c.name)).toContain("ROE Black Pearl BP2V2");
  });

  it("names a duplicate by its first line, case and accent form insensitive", () => {
    const text = "León 1x1 P3.9 500x500\nOtra 1x1 P3.9 500x500\n" + "león 1x1 P3.9 500x500";
    const result = parseScreenList(text, opts());
    expect(result.errors).toEqual([expect.objectContaining({ line: 3, message: expect.stringContaining("used twice, first on line 1") })]);
  });

  it("refuses a name the project already has, when adding", () => {
    expect(firstError("Left 1x1 P3.9 500x500", { takenNames: ["Left"] })).toContain("already a screen in this project");
  });

  it("reports every bad line and creates nothing until all are valid", () => {
    const result = parseScreenList("A 1x1 P3.9 500x500\nB 0x1 P3.9 500x500\nC 1x1 P9\nD 1x1 P3.9 500x500", opts());
    expect(result.errors.map((e) => e.line)).toEqual([2, 3]);
    expect(result.ok).toBe(false);
  });

  it("caps the list", () => {
    const text = Array.from({ length: 201 }, (_, i) => `S${i} 1x1 P3.9 500x500`).join("\n");
    expect(parseScreenList(text, opts()).errors.at(-1)?.message).toContain("up to 200");
  });
});

describe("fast map list: which cabinet", () => {
  const custom = (id: string, pitchMm: number, x = 176): CabinetProfile => ({ id, name: `Custom ${id}`, widthUm: mmToUm(500), heightUm: mmToUm(500), pixelsX: px(x), pixelsY: px(x), nominalPitchUm: mmToUm(pitchMm), source: "custom" });
  const lib = (c: CabinetProfile): LibraryCabinet => ({ ...SEED_LIBRARY_CABINETS[0], ...c, source: "custom" });

  it("prefers the project's own cabinet over a same-size generic one", () => {
    const ctx = testContext();
    const projectCab: CabinetProfile = { ...BUILTIN_CABINETS[0], id: "mine", name: "Our P3.9", source: "custom" };
    const project = ops.addCabinet(ops.createProject({ name: "p" }, ctx), projectCab);
    const result = parseScreenList("A 1x1 P3.9 500x500", { cabinets: choices(project) });
    expect(result.screens[0].cabinet.id).toBe("mine");
  });

  it("refuses two same-size cabinets when neither is the project's or generic", () => {
    const result = parseScreenList("A 1x1 P2.84 500x500", { cabinets: choices(null, [lib(custom("x", 2.84))]) });
    expect(result.errors[0].message).toContain("Write the cabinet's name instead");
    expect(result.errors[0].candidates.map((c) => c.name).sort()).toEqual(["Custom x", "ROE Black Pearl BP2V2"]);
  });

  it("finds a library cabinet by its name", () => {
    const result = parseScreenList("A 2x1 Custom x", { cabinets: choices(null, [lib(custom("x", 2.84))]) });
    expect(result.screens[0]).toMatchObject({ widthPx: 352, heightPx: 176 });
  });

  it("refuses two different cabinets with the same name", () => {
    const result = parseScreenList("A 2x1 Custom x", { cabinets: choices(null, [lib(custom("x", 2.84)), lib({ ...custom("y", 2.6, 192), name: "Custom x" })]) });
    expect(result.errors[0].message).toContain("Several different cabinets");
  });

  it("matches a written pitch only within 0.02 mm", () => {
    expect(sizes("A 1x1 P3.91 500x500")).toEqual(["128x128"]);
    expect(sizes("A 1x1 P3.93 500x500")).toEqual(["128x128"]);
    expect(firstError("A 1x1 P3.94 500x500")).toContain("never guessed");
    expect(firstError("A 1x1 P4 500x500")).toContain("never guessed");
  });

  it("only uses the chosen size for lines that need one", () => {
    const result = parseScreenList("A 1x1 P5.95", opts({ sizeIfMissing: SIZE_500 }));
    expect(result.screens[0].cabinet.id).toBe("builtin-1000x500-p595");
    expect(result.screens[0].cabinetNote).not.toContain("as chosen");
  });
});
