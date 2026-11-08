import { describe, expect, it } from "vitest";
import type { MotionScreen } from "@/domain/motion";
import { resolveMapping } from "@/engines/mapping";
import { renderPattern } from "@/engines/motion/patterns";
import { validateProject } from "@/engines/validation";
import type { ExportEntry, ExportInput } from "@/exports/contract";
import { assertExportable } from "@/exports/gate";
import { buildManifest } from "@/exports/manifest";
import type { PixelLabModule } from "@/modules/contract";
import type { FrameInput, FrameSource } from "@/preview/contract";
import { drawPattern } from "@/preview/draw-pattern";
import { festivalMainStage } from "./helpers";

// The shared contracts are types only. These tests show that today's code fits them unchanged,
// so the lanes can adopt them without rewriting what works.

const manifestEntry: ExportEntry = {
  id: "mapping-manifest",
  label: "Mapping manifest (.json)",
  requiresValidMapping: true,
  async build({ project, mapping, issues, generatedAt }) {
    assertExportable(issues);
    return [{ path: "manifest.json", content: JSON.stringify(buildManifest(project, mapping, issues, generatedAt), null, 2) }];
  },
};

const gridSource: FrameSource = {
  id: "motion-grid",
  name: "Moving grid",
  draw: (ctx, input, { scale, fontFamily }) => drawPattern(ctx, renderPattern("grid", input), scale, fontFamily),
};

describe("shared contracts", () => {
  const project = festivalMainStage();
  const mapping = resolveMapping(project);
  const input: ExportInput = {
    project,
    mapping,
    issues: validateProject(project, mapping),
    generatedAt: "2026-11-08T00:00:00.000Z",
    rasterize: async () => new Blob([]),
  };

  it("an existing export fits ExportEntry and gives the same bytes", async () => {
    const [file] = await manifestEntry.build(input);
    expect(file.path).toBe("manifest.json");
    expect(JSON.parse(file.content as string)).toEqual(buildManifest(project, mapping, input.issues, input.generatedAt));
  });

  it("Motion Lab pattern input is a FrameInput", () => {
    const screens: MotionScreen[] = mapping.screens.map((s) => ({ id: s.screenId, name: s.name, x: s.masterRect.x, y: s.masterRect.y, width: s.masterRect.width, height: s.masterRect.height }));
    const frame: FrameInput = { frame: 12, fps: 30, width: mapping.master.width, height: mapping.master.height, screens };
    expect(renderPattern("grid", frame).width).toBe(mapping.master.width);
    expect(gridSource.id).toBe("motion-grid");
  });

  it("a module declares its studio, exports and sources", () => {
    const checkModule: PixelLabModule = { id: "contract-check", name: "Contract check", studio: "output", exports: [manifestEntry], sources: [gridSource] };
    expect(checkModule.exports?.map((e) => e.id)).toEqual(["mapping-manifest"]);
  });
});
