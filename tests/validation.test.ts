import { describe, expect, it } from "vitest";
import { px, um } from "@/domain/units";
import { resolveMapping } from "@/engines/mapping";
import * as ops from "@/engines/project-ops";
import { hasErrors, validateProject } from "@/engines/validation";
import type { Project } from "@/domain/model";
import { CAB, testContext, threeScreenProject } from "./helpers";

const check = (project: Project) => validateProject(project, resolveMapping(project));
const codes = (project: Project) => check(project).map((i) => i.code);

describe("validateProject", () => {
  it("passes a clean three-screen project", () => {
    const { project } = threeScreenProject();
    const issues = check({ ...project, physical: { ...project.physical } });
    expect(hasErrors(issues)).toBe(false);
  });

  it("flags an empty project", () => {
    expect(codes(ops.createProject({ name: "Empty" }, testContext()))).toContain("NO_SCREENS");
  });

  it("reports the exact overlap area in pixels", () => {
    const { project, ids } = threeScreenProject();
    const issues = check(ops.setRegionPosition(project, ids.right, px(2000), px(0)));
    const overlap = issues.find((i) => i.code === "REGION_OVERLAP")!;
    expect(overlap.severity).toBe("error");
    expect(overlap.message).toContain("48×640 px at (2000, 0)");
    expect(overlap.screenIds).toEqual([ids.center, ids.right]);
  });

  it("does not flag regions that only touch", () => {
    const { project } = threeScreenProject();
    expect(codes(project)).not.toContain("REGION_OVERLAP");
  });

  it("allows overlap only when both regions are marked as sharing", () => {
    const { project, ids } = threeScreenProject();
    const overlapping = ops.setRegionPosition(project, ids.right, px(0), px(0));
    const oneMarked = ops.setRegionShared(overlapping, ids.right, true);
    expect(codes(oneMarked)).toContain("REGION_OVERLAP");
    const bothMarked = ops.setRegionShared(oneMarked, ids.left, true);
    const c = codes(bothMarked);
    expect(c).not.toContain("REGION_OVERLAP");
    expect(c).toContain("REGION_SHARED");
  });

  it("errors on overlapping output slices even when content is shared", () => {
    const { project, ids } = threeScreenProject();
    const next = ops.setSlicePositions(project, [{ id: ids.left, x: px(0), y: px(0) }, { id: ids.right, x: px(100), y: px(100) }]);
    expect(codes(next)).toContain("SLICE_OVERLAP");
  });

  it("ignores slice overlap across different outputs", () => {
    const ctx = testContext();
    const { project, ids } = threeScreenProject(ctx);
    const { project: two, outputId } = ops.addOutput(project, "Output 2", ctx);
    let next = ops.setSlicePositions(two, [{ id: ids.left, x: px(0), y: px(0) }, { id: ids.right, x: px(0), y: px(0) }]);
    next = ops.assignOutput(next, ids.right, outputId);
    expect(codes(next)).not.toContain("SLICE_OVERLAP");
  });

  it("errors when a region leaves a fixed master", () => {
    const { project } = threeScreenProject();
    const next = ops.setMasterSizing(project, { mode: "fixed", width: px(1920), height: px(1080) });
    const issues = check(next).filter((i) => i.code === "REGION_OUTSIDE_MASTER");
    expect(issues.map((i) => i.message).join()).toContain("Right");
    expect(issues.length).toBeGreaterThan(0);
  });

  it("errors when a slice leaves a fixed output", () => {
    const { project, ids } = threeScreenProject();
    const next = ops.updateOutput(project, project.output.outputs[0].id, { sizing: { mode: "fixed", width: px(2100), height: px(1080) } });
    const issue = check(next).find((i) => i.code === "SLICE_OUTSIDE_OUTPUT")!;
    expect(issue.screenIds).toEqual([ids.right]);
  });

  it("flags a master canvas over the size limit", () => {
    const { project, ids } = threeScreenProject();
    expect(codes(ops.setRegionPosition(project, ids.right, px(20000), px(0)))).toContain("MASTER_TOO_LARGE");
  });

  it("warns about physical overlap without blocking", () => {
    const { project, ids } = threeScreenProject();
    const next = ops.setStagePositions(project, [{ id: ids.left, x: um(0), y: um(0) }, { id: ids.center, x: um(0), y: um(0) }]);
    const issue = check(next).find((i) => i.code === "PHYSICAL_OVERLAP")!;
    expect(issue.severity).toBe("warning");
  });

  it("warns about a pitch that doesn't match the cabinet", () => {
    const { project } = threeScreenProject();
    const next = ops.updateCabinet(project, CAB.id, { nominalPitchUm: um(5000) });
    expect(codes(next)).toContain("CABINET_PITCH_MISMATCH");
  });

  it("warns about duplicate screen names", () => {
    const { project, ids } = threeScreenProject();
    expect(codes(ops.updateScreen(project, ids.left, { name: "Center" }))).toContain("SCREEN_DUPLICATE_NAME");
  });

  it("reports a dangling cabinet reference clearly", () => {
    const { project } = threeScreenProject();
    const issues = check({ ...project, cabinets: [] });
    expect(issues[0].message).toContain("its cabinet profile no longer exists");
    expect(hasErrors(issues)).toBe(true);
  });

  it("notes unused space and trims it exactly", () => {
    const { project } = threeScreenProject();
    const canvas = project.content.canvases[0];
    const offset = ops.updateCanvas(project, canvas.id, { originX: px(64), originY: px(32) });
    expect(codes(offset)).toContain("MASTER_HAS_MARGIN");
    const trimmed = ops.trimContent(offset);
    expect(codes(trimmed)).not.toContain("MASTER_HAS_MARGIN");
    expect(resolveMapping(trimmed).master).toMatchObject({ width: 2432, height: 768 });
  });

  it("sorts errors first", () => {
    const { project, ids } = threeScreenProject();
    let next = ops.setRegionPosition(project, ids.right, px(0), px(0));
    next = ops.updateScreen(next, ids.left, { name: "Center" });
    expect(check(next)[0].severity).toBe("error");
  });
});
