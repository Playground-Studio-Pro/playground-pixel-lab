import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDbCabinetLibrary, IndexedDbProjectRepository, openDatabase } from "@/persistence/indexeddb";
import { RevisionConflictError } from "@/persistence/repository";
import { ProjectFormatError, parseProject, parseProjectFile, serializeProject } from "@/persistence/schema";
import { resolveMapping } from "@/engines/mapping";
import * as ops from "@/engines/project-ops";
import { CAB, testContext, threeScreenProject } from "./helpers";

describe("project file", () => {
  it("round-trips without change", () => {
    const { project } = threeScreenProject();
    expect(parseProjectFile(serializeProject(project))).toEqual(project);
  });

  it("explains invalid JSON", () => {
    expect(() => parseProjectFile("{oops")).toThrow(/isn't valid JSON/);
  });

  it("explains a manifest opened by mistake", () => {
    expect(() => parseProjectFile(JSON.stringify({ format: "playground-pixel-lab/mapping-manifest" }))).toThrow(/project file/);
  });

  it("names the bad field in corrupted data", () => {
    const { project } = threeScreenProject();
    const broken = structuredClone(project) as unknown as { content: { regions: { x: number }[] } };
    broken.content.regions[0].x = 1.5;
    expect(() => parseProject(broken)).toThrow(ProjectFormatError);
    expect(() => parseProject(broken)).toThrow(/content\.regions\.0\.x/);
  });

  it("rejects negative region coordinates and zero-size cabinets", () => {
    const { project } = threeScreenProject();
    const neg = structuredClone(project) as unknown as { content: { regions: { x: number }[] } };
    neg.content.regions[0].x = -1;
    expect(() => parseProject(neg)).toThrow(ProjectFormatError);
    const cab = structuredClone(project) as unknown as { cabinets: { pixelsX: number }[] };
    cab.cabinets[0].pixelsX = 0;
    expect(() => parseProject(cab)).toThrow(ProjectFormatError);
  });

  it("refuses a file from a newer schema with a clear message", () => {
    const { project } = threeScreenProject();
    expect(() => parseProject({ ...project, schemaVersion: 99 })).toThrow(/newer version/);
  });
});

describe("IndexedDB repository", () => {
  let repo: IndexedDbProjectRepository;
  let library: IndexedDbCabinetLibrary;

  beforeEach(async () => {
    const db = await openDatabase(new IDBFactory());
    repo = new IndexedDbProjectRepository(db);
    library = new IndexedDbCabinetLibrary(db);
  });

  it("reopens a project with its mapping unchanged", async () => {
    const { project } = threeScreenProject();
    await repo.save(project, 0);
    const loaded = await repo.load(project.id);
    expect(loaded).toEqual(project);
    expect(resolveMapping(loaded!)).toEqual(resolveMapping(project));
  });

  it("returns null for a missing project", async () => {
    expect(await repo.load("missing")).toBeNull();
  });

  it("lists summaries, newest first", async () => {
    const ctx = testContext();
    const a = ops.createProject({ name: "A" }, ctx);
    const b = { ...ops.createProject({ name: "B" }, ctx), meta: { ...ops.createProject({ name: "B" }, ctx).meta, updatedAt: "2027-01-01T00:00:00.000Z" } };
    await repo.save(a, 0);
    await repo.save(b, 0);
    expect((await repo.list()).map((p) => p.name)).toEqual(["B", "A"]);
  });

  it("rejects a stale save and keeps the stored version", async () => {
    const { project } = threeScreenProject();
    await repo.save(project, 0);
    const tabA = { ...project, meta: { ...project.meta, name: "Tab A", revision: 1 } };
    await repo.save(tabA, 0);
    const tabB = { ...project, meta: { ...project.meta, name: "Tab B", revision: 1 } };
    await expect(repo.save(tabB, 0)).rejects.toBeInstanceOf(RevisionConflictError);
    expect((await repo.load(project.id))!.meta.name).toBe("Tab A");
  });

  it("deletes", async () => {
    const { project } = threeScreenProject();
    await repo.save(project, 0);
    await repo.delete(project.id);
    expect(await repo.load(project.id)).toBeNull();
  });

  it("stores reusable cabinets", async () => {
    await library.upsert(CAB);
    await library.upsert({ ...CAB, name: "Renamed" });
    const all = await library.list();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Renamed");
  });
});
