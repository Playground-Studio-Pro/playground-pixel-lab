import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildExample } from "@/examples";
import { EXAMPLES } from "@/examples/catalog";
import { resolveMapping } from "@/engines/mapping";
import { overlapMarks, previewRegions } from "@/engines/motion/regions";
import { validateProject } from "@/engines/validation";
import { parseProjectFile, serializeProject } from "@/persistence/schema";
import { buildViewModel } from "@/state/view-model";
import { festivalMainStage } from "./helpers";

const FESTIVAL_FILE = resolve(__dirname, "../examples/festival-main-stage.pixellab.json");

describe("example gallery", () => {
  it.each(EXAMPLES.map((e) => [e.id, e] as const))("%s matches its catalog entry and has no errors", (id, entry) => {
    const project = buildExample(id);
    const mapping = resolveMapping(project);
    expect(project.meta.name).toBe(entry.name);
    expect(project.physical.screens).toHaveLength(entry.screens);
    expect(`${mapping.master.width} × ${mapping.master.height}`).toBe(entry.master);
    expect(project.output.outputs).toHaveLength(entry.outputs);
    expect(validateProject(project, mapping).filter((i) => i.severity === "error")).toEqual([]);
    // Opened through the same path as an imported file.
    expect(parseProjectFile(serializeProject(project))).toEqual(project);
  });

  it("builds the same project every time", () => {
    for (const { id } of EXAMPLES) expect(serializeProject(buildExample(id))).toBe(serializeProject(buildExample(id)));
  });
});

describe("Festival Main Stage example", () => {
  const project = festivalMainStage();
  const mapping = resolveMapping(project);

  it("has a 5120×1664 master and two named outputs", () => {
    expect([mapping.master.width, mapping.master.height]).toEqual([5120, 1664]);
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
    if (process.env.UPDATE_EXAMPLES) writeFileSync(FESTIVAL_FILE, text);
    const committed = readFileSync(FESTIVAL_FILE, "utf8");
    expect(committed).toBe(text);
    expect(parseProjectFile(committed)).toEqual(project);
  });
});
