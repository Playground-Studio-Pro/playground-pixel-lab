import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "@/domain/model";
import { resolveMapping } from "@/engines/mapping";
import * as ops from "@/engines/project-ops";
import { MODULE_SOURCES, STUDIOS } from "@/modules/catalog";
import { readModuleData } from "@/modules/module-data";
import { findSource, MODULES } from "@/modules/registry";
import { sceneFrame } from "@/modules/depth-studio/source";
import { summarizeEngineering } from "@/engines/led/summary";
import { parseProject, parseProjectFile, serializeProject } from "@/persistence/schema";
import { threeScreenProject } from "./helpers";

describe("module registry", () => {
  it("lists each module once, in a known studio", () => {
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MODULES) expect(STUDIOS.map((s) => s.id)).toContain(m.studio);
  });

  it("the shell's catalog matches the registry, so every listed source plays", () => {
    for (const info of MODULE_SOURCES) {
      const source = findSource(info.id);
      expect(source, info.id).not.toBeNull();
      expect(MODULES.find((m) => m.id === info.moduleId)?.sources?.some((s) => s.id === info.id)).toBe(true);
    }
    const registered = MODULES.flatMap((m) => m.sources ?? []).map((s) => s.id);
    expect(registered.sort()).toEqual(MODULE_SOURCES.map((s) => s.id).sort());
  });

  it("the engineering summary keeps its contract signature", () => {
    const { project } = threeScreenProject();
    const summary = summarizeEngineering(project, resolveMapping(project));
    expect(summary === null || Array.isArray(summary.findings)).toBe(true);
  });
});

describe("depth scene timing", () => {
  it("shows the scene frame at the same content time", () => {
    expect(sceneFrame(0, 60, { fps: 30 })).toBe(0);
    expect(sceneFrame(1, 60, { fps: 30 })).toBe(0);
    expect(sceneFrame(2, 60, { fps: 30 })).toBe(1);
    expect(sceneFrame(25, 25, { fps: 30 })).toBe(30);
    expect(sceneFrame(450, 30, { fps: 30 })).toBe(450);
  });
});

describe("module data (schema 2)", () => {
  it("upgrades a schema 1 file with an empty modules section", () => {
    const text = readFileSync("tests/fixtures/festival-main-stage.schema-1.pixellab.json", "utf8");
    expect(JSON.parse(text).project.schemaVersion).toBe(1);
    const project = parseProjectFile(text);
    expect(project.schemaVersion).toBe(SCHEMA_VERSION);
    expect(project.modules).toEqual({});
    expect(resolveMapping(project).screens.length).toBeGreaterThan(0);
  });

  it("new projects start with no module data", () => {
    expect(threeScreenProject().project.modules).toEqual({});
  });

  it("stores, reads back and removes a module's data", () => {
    const { project } = threeScreenProject();
    const next = ops.setModuleData(project, "engineering", 1, { processors: [{ id: "p1", modelId: "x", outputIds: [] }] });
    const reloaded = parseProjectFile(serializeProject(next));
    expect(reloaded.modules.engineering).toEqual({ version: 1, data: { processors: [{ id: "p1", modelId: "x", outputIds: [] }] } });
    const parse = (data: unknown, version: number) => (version === 1 ? (data as { processors: unknown[] }) : null);
    expect(readModuleData(reloaded, "engineering", parse)?.processors).toHaveLength(1);
    expect(readModuleData(reloaded, "missing", parse)).toBeNull();
    expect(ops.removeModuleData(reloaded, "engineering").modules).toEqual({});
  });

  it("a module's parser that throws reads as no data", () => {
    const next = ops.setModuleData(threeScreenProject().project, "depth-studio", 1, { bad: true });
    expect(readModuleData(next, "depth-studio", () => { throw new Error("nope"); })).toBeNull();
  });

  it("rejects ids, versions and values that wouldn't save", () => {
    const { project } = threeScreenProject();
    expect(() => ops.setModuleData(project, "Bad Id", 1, {})).toThrow(ops.DomainError);
    expect(() => ops.setModuleData(project, "ok", 0, {})).toThrow(ops.DomainError);
    expect(() => ops.setModuleData(project, "ok", 1, { n: Number.NaN })).toThrow(ops.DomainError);
    expect(() => ops.setModuleData(project, "ok", 1, { d: new Date(0) })).toThrow(ops.DomainError);
    expect(() => ops.setModuleData(project, "ok", 1, { u: undefined })).toThrow(ops.DomainError);
  });

  it("the schema rejects a malformed modules section", () => {
    const { project } = threeScreenProject();
    expect(() => parseProject({ ...project, modules: { engineering: { data: 1 } } })).toThrow(/modules/);
    expect(() => parseProject({ ...project, modules: { "Not An Id": { version: 1, data: 1 } } })).toThrow();
  });
});
