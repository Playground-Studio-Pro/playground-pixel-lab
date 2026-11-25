import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTENT_FPS } from "@/domain/motion";
import { OUTPUT_SOURCE_IDS } from "@/domain/physical-output";
import { countdownText, placedColor, placedEdge, wallBuildOps, type Box, type WallBuildOp } from "@/engines/content/wall-build/frame";
import { fitWorker, shapesBounds } from "@/engines/content/wall-build/fit";
import { frameTick, MAX_WORKERS, planWallBuild, secondsLeft, TICKS_PER_SECOND, type WallBuildPlan } from "@/engines/content/wall-build/plan";
import { applyWallBuild, BUILD_ORDERS, DEFAULT_WALL_BUILD, MAX_BUILD_SECONDS, MIN_BUILD_SECONDS } from "@/engines/content/wall-build/settings";
import { resolveMapping, type ResolvedMapping } from "@/engines/mapping";
import * as ops from "@/engines/project-ops";
import { corporateKeynote } from "@/examples/keynote";
import { stress500 } from "@/examples/stress";
import { MODULE_SOURCES } from "@/modules/catalog";
import { prepareWallBuildSource, wallBuildSource } from "@/modules/content/wall-build-source";
import { useWallBuild } from "@/modules/content/wall-build-store";
import { findSource } from "@/modules/registry";
import { OutputSourceError, parseOutputSettings } from "@/modules/output/output-sources";
import { CAB, festivalMainStage, testContext, threeScreenProject } from "./helpers";

const look = DEFAULT_WALL_BUILD;
const CABINET = { width: 128, height: 128 };
const oneCabinet = () => {
  const ctx = testContext();
  return ops.addScreen(ops.addCabinet(ops.createProject({ name: "One" }, ctx), CAB), { name: "Single", cabinetId: CAB.id, columns: 1, rows: 1 }, ctx);
};
/** A 1-cabinet-wide tower and a tiny-cabinet wall: the shapes most likely to break a worker's path. */
const odd = () => {
  const ctx = testContext();
  const tiny = { ...CAB, id: "tiny", name: "Tiny", pixelsX: 5 as typeof CAB.pixelsX, pixelsY: 7 as typeof CAB.pixelsY };
  let p = ops.addCabinet(ops.addCabinet(ops.createProject({ name: "Odd" }, ctx), CAB), tiny);
  p = ops.addScreen(p, { name: "Tower", cabinetId: CAB.id, columns: 1, rows: 9 }, ctx);
  return ops.addScreen(p, { name: "Tiny", cabinetId: "tiny", columns: 3, rows: 2 }, ctx);
};

const FIXTURES: [string, ResolvedMapping][] = [
  ["Festival Main Stage", resolveMapping(festivalMainStage())],
  ["Corporate Keynote", resolveMapping(corporateKeynote())],
  ["three screens", resolveMapping(threeScreenProject().project)],
  ["one cabinet", resolveMapping(oneCabinet())],
  ["odd walls", resolveMapping(odd())],
  ["500 screens", resolveMapping(stress500())],
];
const festival = FIXTURES[0][1];
const plan = (mapping: ResolvedMapping, change: Partial<typeof look> = {}) => planWallBuild(mapping, { ...look, ...change });

const workers = (list: readonly WallBuildOp[]) => list.filter((o) => o.kind === "worker");
const covers = (b: Box, x: number, y: number) => x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h;

/** Colour of one master pixel, painted from fills and edges. Workers aren't painted. */
function pixel(list: readonly WallBuildOp[], x: number, y: number): string | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i];
    if (o.kind === "worker" || !covers(o, x, y)) continue;
    if (o.kind === "fill") return o.color;
    if (x === o.x || y === o.y || x === o.x + o.w - 1 || y === o.y + o.h - 1) return o.color;
  }
  return null;
}

/** The finished wall's pixel, worked out from the mapping alone. */
function expectedPixel(mapping: ResolvedMapping, x: number, y: number, grid: boolean): string {
  let fill = "#000000";
  let edge: string | null = null;
  for (const s of mapping.screens) {
    const u = x - s.masterRect.x;
    const v = y - s.masterRect.y;
    if (u < 0 || v < 0 || u >= s.masterRect.width || v >= s.masterRect.height) continue;
    const [w, h] = [s.cabinet.pixelsX, s.cabinet.pixelsY];
    fill = placedColor(s, Math.floor(u / w), Math.floor(v / h));
    if (grid && (u % w === 0 || v % h === 0 || u % w === w - 1 || v % h === h - 1)) edge = placedEdge(s);
  }
  return edge ?? fill;
}

describe("Wall Build schedule", () => {
  for (const [name, mapping] of FIXTURES) {
    for (const order of BUILD_ORDERS) {
      it(`${name}, ${order}: places every cabinet exactly once, at its mapped position, within the build time`, () => {
        for (const buildSeconds of [MIN_BUILD_SECONDS, 20, MAX_BUILD_SECONDS]) {
          const p = plan(mapping, { order, buildSeconds });
          expect(p.screens.map((s) => s.screenId)).toEqual(mapping.screens.map((s) => s.screenId));
          p.screens.forEach((s, i) => {
            const m = mapping.screens[i];
            const count = m.columns * m.rows;
            expect([...s.sequence].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, k) => k));
            expect(s.cabinets).toHaveLength(count);
            s.cabinets.forEach((c, k) => {
              expect([c.x, c.y]).toEqual([m.masterRect.x + (k % m.columns) * m.cabinet.pixelsX, m.masterRect.y + Math.floor(k / m.columns) * m.cabinet.pixelsY]);
              expect(Number.isInteger(c.placedAt) && c.placedAt > s.start && c.placedAt <= s.end).toBe(true);
            });
            // In sequence order, time never goes back, and the last lands exactly on the wall's end.
            const times = s.sequence.map((k) => s.cabinets[k].placedAt);
            times.forEach((t, k) => k > 0 && expect(t).toBeGreaterThanOrEqual(times[k - 1]));
            expect(times[times.length - 1]).toBe(s.end);
          });
          expect(Math.max(...p.screens.map((s) => s.end))).toBe(buildSeconds * TICKS_PER_SECOND);
        }
      });

      it(`${name}, ${order}: each worker's trips follow one another, inside the wall and in view`, () => {
        for (const s of plan(mapping, { order }).screens) {
          for (const trips of s.workers) {
            expect(trips.length).toBeGreaterThan(0);
            trips.forEach((t, k) => {
              expect(t.end).toBeGreaterThan(t.start);
              if (k > 0) expect(t.start).toBeGreaterThanOrEqual(trips[k - 1].end);
              expect(s.cabinets[t.lead].placedAt).toBe(t.end);
              // Feet on the wall, helmet below its top.
              expect(t.y).toBeLessThanOrEqual(s.y + s.height);
              expect(t.y - s.workerHeight).toBeGreaterThanOrEqual(s.y);
              if (s.columns > 2) expect(t.x >= s.x && t.x <= s.x + s.width).toBe(true);
            });
          }
        }
      });
    }
  }

  it("bottom up: a cabinet is always placed after the one below it", () => {
    for (const [, mapping] of FIXTURES) {
      for (const s of plan(mapping, { order: "bottom-up" }).screens) {
        for (const c of s.cabinets) if (c.row + 1 < s.rows) expect(c.placedAt).toBeGreaterThan(s.cabinets[(c.row + 1) * s.columns + c.column].placedAt);
      }
    }
  });

  it("from the center: starts beside the center and ends at a corner", () => {
    const s = plan(festival, { order: "center" }).screens[0];
    const distance = (k: number) => Math.hypot((s.cabinets[k].column + 0.5 - s.columns / 2) * s.cabinetWidth, (s.cabinets[k].row + 0.5 - s.rows / 2) * s.cabinetHeight);
    const all = s.cabinets.map((_, k) => distance(k));
    expect(distance(s.sequence[0])).toBeLessThan(2.5 * s.cabinetWidth);
    // Each quarter of the build is farther out than the one before.
    const quarter = s.sequence.length / 4;
    const means = [0, 1, 2, 3].map((q) => s.sequence.slice(q * quarter, (q + 1) * quarter).reduce((sum, k) => sum + distance(k), 0) / quarter);
    expect([...means].sort((a, b) => a - b)).toEqual(means);
    expect(s.sequence.slice(-12).map(distance)).toContain(Math.max(...all));
  });

  it("random: the seed decides, and only for random", () => {
    expect(plan(festival, { order: "random", seed: 7 })).toEqual(plan(festival, { order: "random", seed: 7 }));
    expect(plan(festival, { order: "random", seed: 7 }).screens[0].sequence).not.toEqual(plan(festival, { order: "random", seed: 8 }).screens[0].sequence);
    expect(plan(festival, { order: "center", seed: 7 })).toEqual(plan(festival, { order: "center", seed: 8 }));
    // Two equal walls get different orders.
    const [, a, b] = plan(festival, { order: "random" }).screens;
    expect(a.sequence).not.toEqual(b.sequence);
  });

  it("leaves out unresolved screens, and an empty project draws nothing but black", () => {
    const { project, ids } = threeScreenProject();
    const broken = { ...project, content: { ...project.content, regions: project.content.regions.filter((r) => r.screenId !== ids.center) } };
    const mapping = resolveMapping(broken);
    expect(mapping.unresolved.map((u) => u.screenId)).toEqual([ids.center]);
    const p = plan(mapping);
    expect(p.screens.map((s) => s.screenId)).toEqual([ids.left, ids.right]);
    expect(() => wallBuildOps(p, 3000, look)).not.toThrow();

    const empty = plan(resolveMapping(ops.createProject({ name: "Empty" }, testContext())));
    expect(wallBuildOps(empty, 0, { ...look, countdown: true }).every((o) => o.kind === "fill" && o.color === "#000000")).toBe(true);
  });

  it("500 screens: bounded workers at every moment, in turns", () => {
    const p = plan(FIXTURES[5][1]);
    for (let t = 0; t <= p.settledTick; t += 150) expect(workers(wallBuildOps(p, t, look)).length).toBeLessThanOrEqual(2 * MAX_WORKERS);
    for (const [, mapping] of FIXTURES.slice(0, 5)) expect(plan(mapping).screens.reduce((n, s) => n + s.workers.length, 0)).toBeLessThanOrEqual(2 * MAX_WORKERS);
  });
});

describe("Wall Build frames", () => {
  it("the same frame is the same drawing, from a new plan and in any order", () => {
    const a = plan(festival);
    const b = plan(festival);
    const ticks = [0, 613, 4000, 9999, 12000, 12345];
    const first = ticks.map((t) => wallBuildOps(a, t, look));
    expect([...ticks].reverse().map((t) => wallBuildOps(b, t, look)).reverse()).toEqual(first);
  });

  it("the same moment is the same drawing at every content fps", () => {
    for (const order of BUILD_ORDERS) {
      const p = plan(festival, { order });
      for (const second of [0, 1, 7, 13, 20, 21]) {
        const drawings = CONTENT_FPS.map((fps) => wallBuildOps(p, frameTick(second * fps, fps), { ...look, countdown: true }));
        for (const d of drawings) expect(d).toEqual(drawings[0]);
      }
    }
    for (const fps of CONTENT_FPS) for (const frame of [1, 7, 119]) expect(Number.isInteger(frameTick(frame, fps))).toBe(true);
  });

  it("every coordinate is a whole pixel, and a carried cabinet keeps its mapped size inside its own wall", () => {
    for (const [name, mapping] of FIXTURES) {
      const p = plan(mapping);
      const sizes = new Set(p.screens.map((s) => `${s.cabinetWidth}x${s.cabinetHeight}`));
      for (let t = 0; t <= p.settledTick; t += name === "500 screens" ? 2400 : 397) {
        for (const o of wallBuildOps(p, t, look)) {
          if (o.kind !== "worker") {
            expect([o.x, o.y, o.w, o.h].every(Number.isInteger)).toBe(true);
            continue;
          }
          expect([o.x, o.y].every(Number.isInteger)).toBe(true);
          expect(p.screens.some((s) => s.x === o.clip.x && s.y === o.clip.y && s.width === o.clip.w && s.height === o.clip.h)).toBe(true);
          for (const b of [...(o.under ?? []), ...o.boxes]) expect([b.x, b.y, b.w, b.h].every(Number.isInteger)).toBe(true);
          const whole = o.boxes[0];
          if (whole && o.boxes.length > 2) expect(sizes.has(`${whole.w}x${whole.h}`)).toBe(true);
        }
      }
    }
  });

  it("the carried cabinet arrives on its exact position", () => {
    for (const [name, mapping] of FIXTURES) {
      for (const order of BUILD_ORDERS) {
        const p = plan(mapping, { order });
        for (const s of p.screens.slice(0, name === "500 screens" ? 3 : undefined)) {
          for (const t of s.workers.flat()) {
            const slot = s.cabinets[t.lead];
            const boxes = workers(wallBuildOps(p, t.end - 1, look)).flatMap((o) => (o.kind === "worker" ? [...(o.under ?? []), ...o.boxes] : []));
            expect(boxes.some((b) => b.w === s.cabinetWidth && b.h === s.cabinetHeight && Math.abs(b.x - slot.x) <= 1 && Math.abs(b.y - slot.y) <= 1), `${name} ${order} ${s.screenId}`).toBe(true);
          }
        }
      }
    }
  });

  it("shows a cabinet from the tick it's placed, not before", () => {
    const p = plan(festival);
    const s = p.screens[0];
    for (const k of [0, 50, 127]) {
      const c = s.cabinets[k];
      const filled = (t: number) => wallBuildOps(p, t, look).some((o) => o.kind === "fill" && o.x === c.x && o.y === c.y && o.w === s.cabinetWidth && o.h === s.cabinetHeight);
      expect(filled(c.placedAt - 1)).toBe(false);
      expect(filled(c.placedAt)).toBe(true);
    }
  });
});

/** One wall of each given shape, side by side. */
const walls = (...shapes: readonly (readonly [columns: number, rows: number, pixelsX: number, pixelsY: number])[]) => {
  const ctx = testContext();
  let p = ops.createProject({ name: "Low walls" }, ctx);
  shapes.forEach(([columns, rows, pixelsX, pixelsY], i) => {
    const cabinet = { ...CAB, id: `c${i}`, name: `C${i}`, pixelsX: pixelsX as typeof CAB.pixelsX, pixelsY: pixelsY as typeof CAB.pixelsY };
    p = ops.addScreen(ops.addCabinet(p, cabinet), { name: `${columns}x${rows} of ${pixelsX}x${pixelsY}`, cabinetId: cabinet.id, columns, rows }, ctx);
  });
  return resolveMapping(p);
};

describe("Wall Build low walls", () => {
  const LOW: [string, ResolvedMapping][] = [
    ["Festival Main Stage: Ribbon, DJ Booth and Header", festival],
    ["one cabinet", FIXTURES[3][1]],
    ["one row", walls([2, 1, 128, 128], [3, 1, 192, 192], [12, 1, 256, 64], [7, 1, 64, 256], [1, 1, 64, 256], [1, 1, 400, 32])],
    ["two rows", walls([1, 2, 128, 128], [2, 2, 192, 192], [5, 2, 256, 128], [6, 2, 64, 128], [1, 2, 48, 96])],
    ["500 screens", FIXTURES[5][1]],
  ];

  for (const [name, mapping] of LOW) {
    for (const order of BUILD_ORDERS) {
      it(`${name}, ${order}: every worker stays whole inside its wall on every frame`, () => {
        const p = plan(mapping, { order });
        const low = p.screens.filter((s) => s.low);
        expect(low.length).toBeGreaterThan(0);
        const byClip = new Map(low.map((s) => [`${s.x},${s.y},${s.width},${s.height}`, s]));
        const seen = new Set<string>();
        // Every frame at 30 fps, and every 30th for 500 screens.
        for (let t = 0; t <= p.settledTick; t += name === "500 screens" ? 600 : 20) {
          for (const o of wallBuildOps(p, t, { ...look, grid: false })) {
            if (o.kind !== "worker") continue;
            const s = byClip.get(`${o.clip.x},${o.clip.y},${o.clip.w},${o.clip.h}`);
            if (!s) continue;
            seen.add(s.screenId);
            const b = shapesBounds([...o.behind, ...o.front]);
            const inside = o.x + b.left >= s.x && o.x + b.right <= s.x + s.width && o.y + b.top >= s.y && o.y + b.bottom <= s.y + s.height;
            if (!inside) throw new Error(`${s.screenId} at tick ${t}: ${JSON.stringify(b)} at ${o.x},${o.y} leaves ${s.x},${s.y} ${s.width}x${s.height}`);
            // The cabinet is never scaled.
            const whole = (o.under ?? o.boxes)[0];
            if (whole && (o.under ?? o.boxes).length > 2) expect([whole.w, whole.h]).toEqual([s.cabinetWidth, s.cabinetHeight]);
          }
        }
        if (name !== "500 screens") expect([...seen].sort()).toEqual(low.map((s) => s.screenId).sort());
      });
    }
  }

  it("only walls with no room overhead are low; the rest keep the normal size", () => {
    for (const [, mapping] of FIXTURES) {
      for (const s of plan(mapping).screens) {
        expect(s.low !== null).toBe(s.rows <= 2);
        if (!s.low) expect(s.workerHeight).toBe(Math.round((s.cabinetHeight * 3) / 2));
        if (!s.low) expect(s.workers.flat().every((t) => !t.guided)).toBe(true);
      }
    }
  });

  it("low walls keep their schedule, and their finished wall is the mapping's", () => {
    for (const [, mapping] of LOW) {
      const p = plan(mapping);
      const list = wallBuildOps(p, p.settledTick, look);
      expect(workers(list)).toHaveLength(0);
      for (const s of p.screens.filter((q) => q.low).slice(0, 8)) {
        expect(Math.max(...s.cabinets.map((c) => c.placedAt))).toBe(s.end);
        const at = mapping.screens.find((m) => m.screenId === s.screenId)!.masterRect;
        for (const c of s.cabinets) {
          expect([c.x, c.y]).toEqual([at.x + c.column * s.cabinetWidth, at.y + c.row * s.cabinetHeight]);
          for (const [px, py] of [[c.x, c.y], [c.x + s.cabinetWidth - 1, c.y + s.cabinetHeight - 1], [c.x + 1, c.y + 1]]) expect(pixel(list, px, py)).toBe(expectedPixel(mapping, px, py, true));
        }
      }
    }
  });

  it("the Ribbon's worker is as large as the wall allows, and its face is still whole pixels", () => {
    const ribbon = plan(festival).screens[4];
    expect([ribbon.width, ribbon.height, ribbon.rows]).toEqual([4608, 128, 1]);
    const fit = ribbon.low!;
    expect(fit.above + fit.below).toBeLessThanOrEqual(128);
    expect(fitWorker({ width: 4608, height: 128, rows: 1, cabinet: CABINET }, fit.height + 1)?.height).toBe(fit.height);
    expect(ribbon.workerHeight).toBeGreaterThanOrEqual(112);
  });

  it("a wall too small for any worker still builds", () => {
    const p = plan(walls([2, 1, 4, 4]));
    expect(p.screens[0].workerHeight).toBe(0);
    for (const t of [0, 3000, p.settledTick]) expect(workers(wallBuildOps(p, t, look))).toHaveLength(0);
    expect(p.screens[0].cabinets.every((c) => c.placedAt > 0)).toBe(true);
  });
});

describe("Wall Build finished wall", () => {
  for (const [name, mapping] of FIXTURES) {
    for (const grid of [true, false]) {
      it(`${name}, grid ${grid ? "on" : "off"}: cabinet edges match the mapping, pixel by pixel`, () => {
        const p = plan(mapping);
        const list = wallBuildOps(p, p.settledTick, { ...look, grid, countdown: true });
        expect(workers(list)).toHaveLength(0);
        const screens = name === "500 screens" ? [mapping.screens[0], mapping.screens[249], mapping.screens[499]] : mapping.screens;
        for (const s of screens) {
          const [w, h] = [s.cabinet.pixelsX, s.cabinet.pixelsY];
          for (let row = 0; row < s.rows; row++) {
            for (let column = 0; column < s.columns; column++) {
              const x = s.masterRect.x + column * w;
              const y = s.masterRect.y + row * h;
              // Both sides of every edge, the first inner pixel, the corners and the centre.
              for (const [px, py] of [[x, y], [x + w - 1, y], [x, y + h - 1], [x + w - 1, y + h - 1], [x + 1, y + 1], [x + w - 2, y + h - 2], [x - 1, y + (h >> 1)], [x + w, y + (h >> 1)], [x + (w >> 1), y - 1], [x + (w >> 1), y + h], [x + (w >> 1), y + (h >> 1)]]) {
                if (px < 0 || py < 0 || px >= p.width || py >= p.height) continue;
                expect(pixel(list, px, py), `${s.name} ${column},${row} at ${px},${py}`).toBe(expectedPixel(mapping, px, py, grid));
              }
            }
          }
        }
      });
    }
  }

  it("the festival's shared band shows both screens' grids", () => {
    const [center, , , header] = festival.screens;
    expect([center.name, header.name]).toEqual(["Center Wall", "Header"]);
    const p = plan(festival);
    const list = wallBuildOps(p, p.settledTick, look);
    expect(pixel(list, header.masterRect.x + 10, header.masterRect.y + 10)).toBe(placedColor(header, 0, 0));
    expect(pixel(list, header.masterRect.x, header.masterRect.y + 10)).toBe(placedEdge(header));
    // Below the band, the Center Wall.
    expect(pixel(list, center.masterRect.x + 10, header.masterRect.y + header.masterRect.height + 10)).toBe(placedColor(center, 0, 2));
  });

  it("holds: nothing changes after it settles, and no worker or countdown remains", () => {
    const p = plan(festival);
    const settled = wallBuildOps(p, p.settledTick, { ...look, countdown: true });
    for (const later of [1, 600, 360_000]) expect(wallBuildOps(p, p.settledTick + later, { ...look, countdown: true })).toEqual(settled);
    expect(settled).toEqual(wallBuildOps(p, p.settledTick, look));
  });

  it("neighbouring cabinets differ with the grid off", () => {
    for (const s of festival.screens) expect(placedColor(s, 0, 0)).not.toBe(placedColor(s, 1, 0));
  });
});

describe("Wall Build settings", () => {
  it("grid and countdown switch on and off", () => {
    const p = plan(festival);
    const count = (change: Partial<typeof look>) => wallBuildOps(p, 3000, { ...look, ...change });
    expect(count({ grid: false }).some((o) => o.kind === "edge")).toBe(false);
    expect(count({ grid: true }).some((o) => o.kind === "edge")).toBe(true);
    expect(count({ countdown: true }).length).toBeGreaterThan(count({ countdown: false }).length);
  });

  it("the countdown goes from the build time to nothing", () => {
    const p: WallBuildPlan = plan(festival, { buildSeconds: 75 });
    expect(secondsLeft(p, 0)).toBe(75);
    expect(secondsLeft(p, 1)).toBe(75);
    expect(secondsLeft(p, 600)).toBe(74);
    expect(secondsLeft(p, p.buildTicks - 1)).toBe(1);
    expect(secondsLeft(p, p.buildTicks)).toBe(0);
    expect([countdownText(9), countdownText(60), countdownText(75), countdownText(600)]).toEqual(["9", "1:00", "1:15", "10:00"]);
  });

  it("the background fills each wall, and master pixels without a screen stay black", () => {
    const list = wallBuildOps(plan(festival), 0, { ...look, background: "#123456", grid: false });
    expect(pixel(list, 100, 200)).toBe("#123456");
    expect(pixel(list, 100, 10)).toBe("#000000");
  });

  it("keeps only valid values", () => {
    const next = applyWallBuild(look, { helmet: "red", vest: "#abcdef", background: "#12", buildSeconds: 1, seed: -4, order: "sideways" as never });
    expect(next).toEqual({ ...look, vest: "#ABCDEF", buildSeconds: MIN_BUILD_SECONDS, seed: 0 });
    expect(applyWallBuild(look, { buildSeconds: 99999, seed: 1.6 })).toMatchObject({ buildSeconds: MAX_BUILD_SECONDS, seed: 2 });
    expect(applyWallBuild(look, { buildSeconds: Number.NaN, seed: Number.POSITIVE_INFINITY })).toEqual(look);
  });
});

describe("Wall Build source", () => {
  afterEach(() => useWallBuild.setState({ settings: DEFAULT_WALL_BUILD }));

  it("loads its engine on first use and says so, then says when settings change", async () => {
    const rects: number[][] = [];
    const ctx = { setTransform: () => undefined, fillRect: (...r: number[]) => rects.push(r), fillStyle: "" } as unknown as CanvasRenderingContext2D;
    let calls = 0;
    const stop = wallBuildSource.subscribe!(() => calls++);
    wallBuildSource.draw(ctx, { frame: 0, fps: 30, width: 10, height: 10, screens: [] }, { scale: 1, fontFamily: "x" });
    expect(rects).toEqual([[0, 0, 10, 10]]);
    await prepareWallBuildSource();
    expect(calls).toBe(1);
    useWallBuild.getState().update({ grid: false });
    expect(calls).toBe(2);
    stop();
    useWallBuild.getState().update({ grid: true });
    expect(calls).toBe(2);
  });

  it("draw never loads the engine, and a failed load is tried again only by the next subscriber", async () => {
    vi.resetModules();
    let loads = 0;
    let fail = true;
    vi.doMock("@/modules/content/wall-build-draw", () => {
      loads++;
      if (fail) throw new Error("offline");
      return { drawWallBuild: () => undefined };
    });
    try {
      const { wallBuildSource: source } = await import("@/modules/content/wall-build-source");
      const ctx = { setTransform: () => undefined, fillRect: () => undefined, fillStyle: "" } as unknown as CanvasRenderingContext2D;
      const draw = () => source.draw(ctx, { frame: 0, fps: 30, width: 10, height: 10, screens: [] }, { scale: 1, fontFamily: "x" });
      const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

      draw();
      await settle();
      expect(loads).toBe(0);

      let calls = 0;
      source.subscribe!(() => calls++)();
      await settle();
      expect(loads).toBe(1);
      for (let i = 0; i < 10; i++) draw();
      await settle();
      expect([loads, calls]).toEqual([1, 0]);

      fail = false;
      const stop = source.subscribe!(() => calls++);
      await settle();
      expect([loads, calls]).toEqual([2, 1]);
      stop();
      source.subscribe!(() => calls++)();
      await settle();
      expect(loads).toBe(2);
    } finally {
      vi.doUnmock("@/modules/content/wall-build-draw");
      vi.resetModules();
    }
  });
});

describe("Wall Build stays in the Live preview", () => {
  it("is listed and plays there", () => {
    expect(MODULE_SOURCES.find((s) => s.id === "wall-build")?.moduleId).toBe("content");
    expect(findSource("wall-build")).toBe(wallBuildSource);
  });

  it("can't be sent to the output window", () => {
    expect(OUTPUT_SOURCE_IDS as readonly string[]).not.toContain("wall-build");
    const refusal = (() => {
      try {
        parseOutputSettings("wall-build", {});
      } catch (error) {
        return error;
      }
    })();
    expect(refusal).toBeInstanceOf(OutputSourceError);
    expect((refusal as OutputSourceError).code).toBe("SOURCE_UNKNOWN");
  });
});
