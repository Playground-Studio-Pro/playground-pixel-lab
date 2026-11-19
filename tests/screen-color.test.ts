import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drawCalibration } from "@/components/shell/calibration/draw";
import { cabinetCells } from "@/components/shell/calibration/frame";
import { calibrationTargets } from "@/components/shell/calibration/from-mapping";
import { CAL_CHECKER, screenAccent, tint } from "@/components/shell/calibration/tokens";
import { resolveMapping } from "@/engines/mapping";
import * as ops from "@/engines/project-ops";
import { calibrationFrameFor } from "@/modules/output/calibration-source";
import { parseProjectFile, serializeProject } from "@/persistence/schema";
import type { FrameInput } from "@/preview/contract";
import { opContext, useApp } from "@/state/store";
import { CAB } from "./helpers";

const app = () => useApp.getState();
const current = () => app().project!;
const screen = () => current().physical.screens[0];

beforeAll(async () => {
  await app().init();
});

beforeEach(async () => {
  await app().newProject({ name: "Color test" });
  app().edit((p) => ops.addCabinet(p, CAB));
  app().edit((p) => ops.addScreen(p, { name: "Left", cabinetId: CAB.id, columns: 8, rows: 6 }, opContext));
});

describe("screen color (updateScreen)", () => {
  it("sets any hex color, stored uppercase, and undo / redo restore it exactly", () => {
    const before = screen().color;
    app().edit((p) => ops.updateScreen(p, screen().id, { color: "#ff7a00" }));
    expect(screen().color).toBe("#FF7A00");
    app().undo();
    expect(screen().color).toBe(before);
    app().redo();
    expect(screen().color).toBe("#FF7A00");
  });

  it("offers the palette new screens are colored from", () => {
    expect(ops.SCREEN_COLORS).toContain(screen().color);
    for (const c of ops.SCREEN_COLORS) expect(c).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("rejects anything that isn't a 6-digit hex color, and leaves the project unchanged", () => {
    const before = current();
    for (const bad of ["red", "#FFF", "#GG0000", "FF0000", "#FF00001", "", "rgb(255,0,0)"]) {
      expect(() => ops.updateScreen(before, screen().id, { color: bad }), bad).toThrow(ops.DomainError);
    }
    expect(current()).toBe(before);
  });

  it("persists through the project file and its schema", () => {
    app().edit((p) => ops.updateScreen(p, screen().id, { color: "#12AB34" }));
    const text = serializeProject(current());
    expect(parseProjectFile(text).physical.screens[0].color).toBe("#12AB34");
    // The schema refuses a stored color that isn't hex.
    const broken = text.replace('"#12AB34"', '"green"');
    expect(() => parseProjectFile(broken)).toThrow();
  });
});

describe("the test card uses the chosen color and name", () => {
  function input(): FrameInput {
    const project = current();
    const mapping = resolveMapping(project);
    return { frame: 0, fps: 30, width: mapping.master.width, height: mapping.master.height, screens: mapping.screens.map((s) => ({ id: s.screenId, name: s.name, ...s.masterRect })), context: { project, mapping } };
  }

  /** Records fills so the test can probe the color painted at a pixel: the last fillRect covering it. */
  function probe(i: FrameInput, x: number, y: number): string {
    let fill = "";
    let found = "";
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k) => (k in t ? t[k as string] : (...a: number[]) => {
        if (k === "fillRect" && x >= a[0] && x < a[0] + a[2] && y >= a[1] && y < a[1] + a[3]) found = fill;
      }),
      set: (t, k, v) => ((t[k as string] = v), k === "fillStyle" && (fill = String(v)), true),
    }) as unknown as CanvasRenderingContext2D;
    const frame = calibrationFrameFor(i, { mode: "identification", logo: "off" });
    drawCalibration(ctx, frame, { scale: 1, fontFamily: "monospace", logo: null, frame: 0, fps: 30 }, "static");
    return found;
  }

  it("cabinet tones follow the color picked in the inspector", () => {
    app().edit((p) => ops.updateScreen(p, screen().id, { color: "#E01070" }));
    const i = input();
    const [target] = calibrationTargets(i.context!.mapping);
    const s = target.screens[0];
    expect(s.accent).toBe(screenAccent("#E01070", 0));
    // Probe B1 (row 2, column 1: dark) and B2 (light) 28, 20 px in from their corner: past the sweep bar, edge
    // marker and seams, and clear of the centered label.
    const cells = cabinetCells(s);
    const b1 = cells.find((c) => c.row === 2 && c.column === 1)!.box;
    const b2 = cells.find((c) => c.row === 2 && c.column === 2)!.box;
    expect(probe(i, b1.x + 28, b1.y + 20)).toBe(tint(s.accent, CAL_CHECKER.dark));
    expect(probe(i, b2.x + 28, b2.y + 20)).toBe(tint(s.accent, CAL_CHECKER.light));
  });

  it("the plate carries the name as edited", () => {
    app().edit((p) => ops.updateScreen(p, screen().id, { name: "Stage Left" }));
    const frame = calibrationFrameFor(input(), { mode: "identification", logo: "off" });
    expect(frame.nodes.some((n) => n.kind === "text" && n.text === "STAGE LEFT")).toBe(true);
  });
});
