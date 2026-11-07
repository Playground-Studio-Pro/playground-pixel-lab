import { describe, expect, it } from "vitest";
import { px } from "@/domain/units";
import { alignItems } from "@/engines/align";
import { resolveMapping } from "@/engines/mapping";
import * as ops from "@/engines/project-ops";
import { snapPosition } from "@/engines/snap";
import { fitViewport, screenToWorld, worldToScreen, zoomAt } from "@/engines/viewport";
import { CAB, testContext, threeScreenProject } from "./helpers";

describe("impossible configurations", () => {
  const ctx = testContext();
  const { project, ids } = threeScreenProject(ctx);

  it.each([
    ["zero columns", { columns: 0 }],
    ["fractional rows", { rows: 1.5 }],
    ["blank name", { name: "   " }],
    ["unknown cabinet", { cabinetId: "nope" }],
  ])("rejects %s", (_label, patch) => {
    expect(() => ops.updateScreen(project, ids.left, patch)).toThrow(ops.DomainError);
  });

  it("rejects negative coordinates", () => {
    expect(() => ops.setRegionPosition(project, ids.left, px(-1), px(0))).toThrow(/0 or more/);
    expect(() => ops.setSlicePositions(project, [{ id: ids.left, x: px(0), y: px(-8) }])).toThrow(/0 or more/);
  });

  it("rejects zero-sized fixed canvases", () => {
    expect(() => ops.setMasterSizing(project, { mode: "fixed", width: px(0), height: px(100) })).toThrow(/at least 1/);
  });

  it("rejects cabinets with zero dimensions", () => {
    expect(() => ops.validateCabinet({ ...CAB, pixelsX: px(0) })).toThrow(/Horizontal pixels/);
  });

  it("won't remove a cabinet in use, and names who uses it", () => {
    expect(() => ops.removeCabinet(project, CAB.id)).toThrow(/Left, Center, Right/);
  });

  it("won't remove the last canvas or output, or one still in use", () => {
    expect(() => ops.removeCanvas(project, project.content.canvases[0].id)).toThrow(/at least one/);
    expect(() => ops.removeOutput(project, project.output.outputs[0].id)).toThrow(/at least one/);
    const { project: withCanvas, canvasId } = ops.addCanvas(project, "B", ctx);
    const moved = ops.assignCanvas(withCanvas, ids.left, canvasId);
    expect(() => ops.removeCanvas(moved, canvasId)).toThrow(/Move this canvas/);
  });
});

describe("screen operations", () => {
  it("places new screens without overlapping", () => {
    const { project } = threeScreenProject();
    const mapping = resolveMapping(project);
    expect(mapping.screens[1].masterRect.x).toBe(mapping.screens[0].masterRect.width);
    expect(mapping.screens[1].stage.x).toBeGreaterThan(mapping.screens[0].stage.x + mapping.screens[0].stage.width);
  });

  it("duplicates with a unique name and a clean mapping", () => {
    const ctx = testContext();
    const { project, ids } = threeScreenProject(ctx);
    const first = ops.duplicateScreen(project, ids.left, ctx);
    const second = ops.duplicateScreen(first.project, ids.left, ctx);
    const names = second.project.physical.screens.map((s) => s.name);
    expect(names).toContain("Left copy");
    expect(names).toContain("Left copy 2");
    expect(resolveMapping(second.project).master.width).toBe(2432 + 512 + 512);
  });

  it("deletes a screen with its region, slice and now-empty group", () => {
    const ctx = testContext();
    const { project, ids } = threeScreenProject(ctx);
    const { project: grouped } = ops.groupScreens(project, [ids.left, ids.center], "Main", ctx);
    const next = ops.deleteScreens(grouped, [ids.left, ids.center]);
    expect(next.physical.screens).toHaveLength(1);
    expect(next.physical.groups).toHaveLength(0);
    expect(next.content.regions).toHaveLength(1);
    expect(next.output.slices).toHaveLength(1);
  });

  it("makes a screen independent without moving it", () => {
    const ctx = testContext();
    const { project, ids } = threeScreenProject(ctx);
    const before = resolveMapping(project).screens.find((s) => s.screenId === ids.right)!;
    const { project: next, canvasId } = ops.makeScreenIndependent(project, ids.right, ctx);
    const after = resolveMapping(next).screens.find((s) => s.screenId === ids.right)!;
    expect(after.canvasId).toBe(canvasId);
    expect(after.masterRect).toEqual(before.masterRect);
    expect(after.canvasRect).toMatchObject({ x: 0, y: 0 });
  });

  it("converts master positions into canvas space", () => {
    const { project, ids } = threeScreenProject();
    const shifted = ops.updateCanvas(project, project.content.canvases[0].id, { originX: px(100) });
    const next = ops.setMasterPositions(shifted, [{ id: ids.left, x: px(150), y: px(20) }]);
    expect(next.content.regions.find((r) => r.screenId === ids.left)).toMatchObject({ x: 50, y: 20 });
    expect(() => ops.setMasterPositions(shifted, [{ id: ids.left, x: px(50), y: px(0) }])).toThrow(/Canvas X/);
  });

  it("keeps a slice in place when it stops following content", () => {
    const { project, ids } = threeScreenProject();
    const next = ops.setSliceFollowsContent(project, ids.center, false);
    expect(next.output.slices.find((s) => s.screenId === ids.center)).toMatchObject({ followsContent: false, x: 512, y: 0 });
  });

  it("duplicates a project with a new id and reset revision", () => {
    const ctx = testContext();
    const { project } = threeScreenProject(ctx);
    const copy = ops.duplicateProject({ ...project, meta: { ...project.meta, revision: 9 } }, ctx);
    expect(copy.id).not.toBe(project.id);
    expect(copy.meta.revision).toBe(0);
    expect(copy.meta.name).toBe("Test show copy");
    expect(resolveMapping(copy).master).toEqual(resolveMapping(project).master);
  });
});

describe("snapPosition", () => {
  const moving = { x: 103, y: 50, width: 100, height: 100 };
  const other = { x: 0, y: 0, width: 100, height: 100 };

  it("snaps to another item's edge and reports a guide", () => {
    const result = snapPosition(moving, { others: [other], gridStep: null, threshold: 5 });
    expect(result.x).toBe(100);
    expect(result.guides).toContainEqual({ axis: "x", position: 100 });
  });

  it("does nothing beyond the threshold", () => {
    const result = snapPosition({ ...moving, x: 120, y: 30 }, { others: [other], gridStep: null, threshold: 5 });
    expect(result).toEqual({ x: 120, y: 30, guides: [] });
  });

  it("snaps to an 8 px grid", () => {
    const result = snapPosition({ x: 13, y: 21, width: 10, height: 10 }, { others: null, gridStep: 8, threshold: 4 });
    expect(result).toEqual({ x: 16, y: 24, guides: [] });
  });

  it("prefers an item edge over the grid on a tie", () => {
    const result = snapPosition({ x: 12, y: 0, width: 10, height: 10 }, { others: [{ x: 8, y: 100, width: 4, height: 4 }], gridStep: 8, threshold: 4 });
    expect(result.guides.some((g) => g.axis === "x")).toBe(true);
  });
});

describe("alignItems", () => {
  const items = [
    { id: "a", rect: { x: 0, y: 0, width: 100, height: 50 } },
    { id: "b", rect: { x: 300, y: 25, width: 101, height: 30 } },
    { id: "c", rect: { x: 150, y: 90, width: 50, height: 10 } },
  ];

  it("aligns edges", () => {
    expect(alignItems(items, "left").map((p) => p.x)).toEqual([0, 0, 0]);
    expect(alignItems(items, "right").map((p) => p.x)).toEqual([301, 300, 351]);
    expect(alignItems(items, "bottom").map((p) => p.y)).toEqual([50, 70, 90]);
  });

  it("centres to whole pixels", () => {
    for (const p of alignItems(items, "center-x")) expect(Number.isInteger(p.x)).toBe(true);
  });

  it("distributes with equal gaps and keeps the outer items fixed", () => {
    const result = alignItems(items, "distribute-x");
    const byId = Object.fromEntries(result.map((p) => [p.id, p.x]));
    expect(byId.a).toBe(0);
    expect(byId.b).toBe(300);
    expect(byId.c).toBe(100 + Math.floor((401 - 251) / 2));
  });
});

describe("viewport", () => {
  it("round-trips world and screen coordinates", () => {
    const vp = { scale: 0.5, offsetX: 10, offsetY: 20 };
    const screen = worldToScreen(vp, 100, 200);
    expect(screenToWorld(vp, screen.x, screen.y)).toEqual({ x: 100, y: 200 });
  });

  it("keeps the point under the cursor fixed while zooming", () => {
    const vp = { scale: 1, offsetX: 0, offsetY: 0 };
    const zoomed = zoomAt(vp, 2, 100, 100, 0.1, 10);
    expect(worldToScreen(zoomed, 100, 100)).toEqual({ x: 100, y: 100 });
  });

  it("respects zoom limits", () => {
    expect(zoomAt({ scale: 1, offsetX: 0, offsetY: 0 }, 100, 0, 0, 0.1, 10).scale).toBe(10);
  });

  it("fits bounds inside the view with a margin", () => {
    const vp = fitViewport({ x: 0, y: 0, width: 2000, height: 1000 }, 1100, 1100, 50);
    expect(vp.scale).toBe(0.5);
  });
});
