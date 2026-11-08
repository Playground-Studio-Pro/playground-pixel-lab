import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveMapping } from "@/engines/mapping";
import { overlapMarks, previewRegions } from "@/engines/motion/regions";
import { validateProject } from "@/engines/validation";
import { parseProjectFile, serializeProject } from "@/persistence/schema";
import { buildViewModel } from "@/state/view-model";
import { festivalMainStage } from "./helpers";

const EXAMPLE = resolve(__dirname, "../examples/festival-main-stage.pixellab.json");

describe("Festival Main Stage example", () => {
  const project = festivalMainStage();
  const mapping = resolveMapping(project);

  it("is a valid show with a 5120×1664 master and two outputs", () => {
    expect(validateProject(project, mapping).filter((i) => i.severity === "error")).toEqual([]);
    expect([mapping.master.width, mapping.master.height]).toEqual([5120, 1664]);
    expect(project.physical.screens).toHaveLength(6);
    expect(project.output.outputs.map((o) => o.name)).toEqual(["Processor A", "Processor B"]);
  });

  it("marks the Header band shared with the Center Wall", () => {
    const issues = validateProject(project, mapping);
    for (const view of ["physical", "content"] as const) {
      const regions = previewRegions(buildViewModel(project, mapping, view, null).items, mapping);
      const marks = overlapMarks(regions, issues, mapping, view);
      expect(marks.map((m) => m.kind)).toContain("shared");
      expect(marks.map((m) => m.kind)).not.toContain("conflict");
    }
  });

  it("matches the committed example file (UPDATE_EXAMPLES=1 npm test rewrites it)", () => {
    const text = serializeProject(project);
    if (process.env.UPDATE_EXAMPLES) writeFileSync(EXAMPLE, text);
    const committed = readFileSync(EXAMPLE, "utf8");
    expect(committed).toBe(text);
    expect(parseProjectFile(committed)).toEqual(project);
  });
});
