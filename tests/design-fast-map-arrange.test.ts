import { describe, expect, it } from "vitest";
import { BUILTIN_CABINETS } from "@/domain/cabinets";
import type { Project } from "@/domain/model";
import { px } from "@/domain/units";
import { overlaps } from "@/engines/geometry";
import { buildFastMap, packRects, parseScreenList, type ArrangeSettings, type ParsedScreen } from "@/engines/fast-map";
import { resolveMapping } from "@/engines/mapping";
import * as ops from "@/engines/project-ops";
import { validateProject } from "@/engines/validation";
import { parseProjectFile, serializeProject } from "@/persistence/schema";
import { choices, HP_STAGE_LIST, SIZE_500 } from "./design-fast-map-fixtures";
import { testContext, threeScreenProject } from "./helpers";

const HD = { width: 1920, height: 1080 };
const settings = (extra: Partial<ArrangeSettings> = {}): ArrangeSettings => ({ mode: "replace", gapPx: 32, stageGapUm: 0, output: HD, newOutputs: 1, ...extra });
const hpScreens = () => parseScreenList(HP_STAGE_LIST, { cabinets: choices(), sizeIfMissing: SIZE_500 }).screens;
const empty = () => ops.createProject({ name: "Fast" }, testContext());
/** Ids for what Fast map creates, apart from the project's own. */
const fm = (): ops.OpContext => {
  let n = 0;
  return { newId: () => `fm-${++n}`, now: () => "2026-11-25T00:00:00.000Z" };
};

/** Seeded, so a failing case can be rerun. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomList(seed: number): string {
  const r = rng(seed);
  const n = 1 + Math.floor(r() * 60);
  const lines: string[] = [];
  let line: string[] = [];
  for (let i = 0; i < n; i++) {
    const cab = BUILTIN_CABINETS[Math.floor(r() * BUILTIN_CABINETS.length)];
    line.push(`S${i} ${1 + Math.floor(r() * 6)}x${1 + Math.floor(r() * 4)} ${cab.name}`);
    if (r() < 0.3) {
      lines.push(line.join(" | "));
      line = [];
    }
  }
  if (line.length) lines.push(line.join(" | "));
  return lines.join("\n") + "\nEnd 1x1 Generic 500×500 P3.91 |";
}

describe("arrange: the HP Stage list", () => {
  const build = buildFastMap(empty(), hpScreens(), settings(), fm());

  it("fits 1:1 in one 1920×1080 output with no errors", () => {
    expect(build.blocking).toEqual([]);
    expect(build.ready).toBe(true);
    expect(validateProject(build.project, build.mapping).filter((i) => i.severity === "error")).toEqual([]);
    expect(build.mapping.outputs).toHaveLength(1);
    expect(build.project.output.outputs[0].sizing).toEqual({ mode: "fixed", width: 1920, height: 1080 });
    for (const s of build.mapping.screens) {
      expect([s.outputRect.width, s.outputRect.height]).toEqual([s.spec.pixelWidth, s.spec.pixelHeight]);
      expect(s.followsContent).toBe(false);
    }
  });

  it("keeps the stage shape on the content canvas, in whole pixels, centred per row", () => {
    const at = Object.fromEntries(build.mapping.screens.map((s) => [s.name, s.masterRect]));
    // Row 1: 256 + 128 + 960 + 128 + 256 + 4 gaps of 32 = 1856 wide, the widest row.
    expect(at["Torre izq"]).toMatchObject({ x: 0, y: 160 });
    expect(at["Centro"]).toMatchObject({ x: 448, y: 160 + 96 });
    expect(at["Header"]).toMatchObject({ x: 416, y: 0 });
    expect(at["DJ"]).toMatchObject({ x: 672, y: 160 + 768 + 32 });
    expect(at["Cinta"].y).toBe(160 + 768 + 32 + 128 + 32);
    expect(build.mapping.master.width).toBe(1856);
  });

  it("puts the stage plan together from real cabinet sizes, in micrometres", () => {
    const at = Object.fromEntries(build.mapping.screens.map((s) => [s.name, s.stage]));
    // The widest row on stage is Cinta, 14 × 500 mm = 7 m; row 1 is 1 + 0.5 + 2.5 + 0.5 + 1 = 5.5 m.
    expect(at["Cinta"]).toEqual({ x: 0, y: 500_000 + 3_000_000 + 500_000, width: 7_000_000, height: 500_000 });
    expect(at["Torre izq"]).toEqual({ x: 750_000, y: 500_000, width: 1_000_000, height: 3_000_000 });
    expect(at["Cuchilla izq"]).toEqual({ x: 1_750_000, y: 500_000 + 500_000, width: 500_000, height: 2_000_000 });
    expect(at["Header"]).toEqual({ x: 1_500_000, y: 0, width: 4_000_000, height: 500_000 });
    for (const s of build.mapping.screens) for (const v of Object.values(s.stage)) expect(Number.isSafeInteger(v)).toBe(true);
  });

  it("round-trips through save and load", () => {
    const loaded = parseProjectFile(serializeProject(build.project));
    expect(loaded).toEqual(build.project);
    expect(resolveMapping(loaded)).toEqual(build.mapping);
  });

  it("is the same every time", () => {
    expect(buildFastMap(empty(), hpScreens(), settings(), fm())).toEqual(build);
  });

  it("says what doesn't fit in a smaller output, and never scales", () => {
    const small = buildFastMap(empty(), hpScreens(), settings({ output: { width: 1280, height: 720 } }), fm());
    expect(small.ready).toBe(false);
    expect(small.unplaced).toEqual(expect.arrayContaining(["Torre izq", "Torre der", "Cinta"]));
    expect(small.blocking[0]).toBe("Larger than a 1280×720 output: Torre izq (256×768), Torre der (256×768), Cinta (1792×128). Choose a larger output. Nothing is scaled.");
    expect(small.outputsNeeded).toBeNull();
  });

  it("uses as many declared outputs as needed, and creates no unused one", () => {
    const size = { width: 1920, height: 800 };
    const one = buildFastMap(empty(), hpScreens(), settings({ output: size }), fm());
    expect(one.ready).toBe(false);
    expect(one.outputsNeeded).toBe(2);
    expect(one.blocking[0]).toMatch(/^Doesn't fit: .+\. Everything fits in 2 outputs of 1920×800\. Nothing is scaled\.$/);
    const two = buildFastMap(empty(), hpScreens(), settings({ output: size, newOutputs: 4 }), fm());
    expect(two.blocking).toEqual([]);
    expect(two.mapping.outputs.map((o) => [o.name, o.width, o.height])).toEqual([["Output 1", 1920, 800], ["Output 2", 1920, 800]]);
  });
});

describe("arrange: packing never overlaps or leaves an output (seeded cases up to 60 screens)", () => {
  for (let seed = 1; seed <= 40; seed++) {
    it(`seed ${seed}`, () => {
      const r = rng(seed * 7919);
      const parsed = parseScreenList(randomList(seed), { cabinets: choices() });
      expect(parsed.errors).toEqual([]);
      const output = [{ width: 1920, height: 1080 }, { width: 3840, height: 2160 }, { width: 2560, height: 1440 }][Math.floor(r() * 3)];
      const build = buildFastMap(empty(), parsed.screens, settings({ output, newOutputs: 1 + Math.floor(r() * 8), gapPx: Math.floor(r() * 64) }), fm());
      const placed = build.mapping.screens.filter((s) => !build.unplaced.includes(s.name));
      for (const s of placed) {
        const out = build.mapping.outputs.find((o) => o.outputId === s.outputId)!;
        expect(s.outputRect.x).toBeGreaterThanOrEqual(0);
        expect(s.outputRect.y).toBeGreaterThanOrEqual(0);
        expect(s.outputRect.x + s.outputRect.width).toBeLessThanOrEqual(out.width);
        expect(s.outputRect.y + s.outputRect.height).toBeLessThanOrEqual(out.height);
        expect([s.outputRect.width, s.outputRect.height]).toEqual([s.spec.pixelWidth, s.spec.pixelHeight]);
      }
      for (const a of placed) for (const b of placed) if (a !== b && a.outputId === b.outputId) expect(overlaps(a.outputRect, b.outputRect), `${a.name} / ${b.name}`).toBe(false);
      for (const a of build.mapping.screens) for (const b of build.mapping.screens) if (a !== b) expect(overlaps(a.masterRect, b.masterRect)).toBe(false);
      if (build.ready) expect(build.issues.filter((i) => i.severity === "error")).toEqual([]);
      else expect(build.blocking.length).toBeGreaterThan(0);
      const again = rng(seed * 7919);
      const sameOutput = [{ width: 1920, height: 1080 }, { width: 3840, height: 2160 }, { width: 2560, height: 1440 }][Math.floor(again() * 3)];
      expect(buildFastMap(empty(), parsed.screens, settings({ output: sameOutput, newOutputs: 1 + Math.floor(again() * 8), gapPx: Math.floor(again() * 64) }), fm())).toEqual(build);
    });
  }

  it("packs the same input the same way", () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ key: `k${i}`, width: 64 + ((i * 37) % 300), height: 32 + ((i * 53) % 200) }));
    const bins = [{ width: 1920, height: 1080, obstacles: [] }, { width: 1920, height: 1080, obstacles: [] }];
    expect(packRects(items, bins)).toEqual(packRects(items, bins));
  });

  it("never places over space already taken", () => {
    const taken = { x: 0, y: 0, width: 1000, height: 500 };
    const result = packRects([{ key: "a", width: 1000, height: 500 }], [{ width: 1920, height: 1080, obstacles: [taken] }]);
    const p = result.placements.get("a")!;
    expect(overlaps(taken, { x: p.x, y: p.y, width: 1000, height: 500 })).toBe(false);
  });
});

describe("arrange: adding to a project that already has screens", () => {
  function existing(): Project {
    const { project } = threeScreenProject();
    return ops.updateOutput(project, project.output.outputs[0].id, { sizing: { mode: "fixed", width: px(3840), height: px(2160) } });
  }
  const list = (): readonly ParsedScreen[] => parseScreenList("DJ 4x1 P3.9 500x500 | Cinta 14x1 P3.9 500x500", { cabinets: choices() }).screens;

  it("keeps every existing screen exactly, and fills around it", () => {
    const before = existing();
    const build = buildFastMap(before, list(), settings({ mode: "add", newOutputs: 0 }), fm());
    expect(build.ready).toBe(true);
    const old = resolveMapping(before).screens;
    expect(build.mapping.screens.slice(0, 3)).toEqual(old);
    expect(build.project.physical.screens.slice(0, 3)).toEqual(before.physical.screens);
    const added = build.mapping.screens.slice(3);
    for (const a of added) {
      expect(a.outputId).toBe(before.output.outputs[0].id);
      for (const o of old) expect(overlaps(a.outputRect, o.outputRect)).toBe(false);
      expect(a.masterRect.x).toBeGreaterThanOrEqual(Math.max(...old.map((o) => o.masterRect.x + o.masterRect.width)));
      expect(a.stage.x).toBeGreaterThan(Math.max(...old.map((o) => o.stage.x + o.stage.width)));
    }
  });

  it("replaces after a clear, keeping cabinets and the first output's id", () => {
    const before = existing();
    const build = buildFastMap(before, list(), settings({ mode: "replace" }), fm());
    expect(build.mapping.screens.map((s) => s.name)).toEqual(["DJ", "Cinta"]);
    expect(build.project.output.outputs[0].id).toBe(before.output.outputs[0].id);
    expect(build.project.cabinets.map((c) => c.id)).toContain(before.cabinets[0].id);
    expect(build.ready).toBe(true);
  });

  it("refuses bad settings", () => {
    expect(() => buildFastMap(empty(), list(), settings({ gapPx: -1 }), fm())).toThrow("Space between screens");
    expect(() => buildFastMap(empty(), list(), settings({ newOutputs: 0 }), fm())).toThrow("Outputs");
  });
});
