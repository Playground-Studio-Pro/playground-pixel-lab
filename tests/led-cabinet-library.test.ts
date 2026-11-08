import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { EMPTY_LIBRARY_FIELDS, toProjectCabinet, YESTECH_MG6S_P26_INDOOR, type LibraryCabinet } from "@/domain/cabinets";
import { mmToUm, px } from "@/domain/units";
import { cabinetFormText, parseCabinetForm, parseThousandths, type CabinetFormText } from "@/engines/led/cabinet-form";
import { computeScreenSpec } from "@/engines/physical";
import * as ops from "@/engines/project-ops";
import {
  CabinetFormatError,
  IndexedDbCabinetLibraryRepository,
  openCabinetLibrary,
  openCabinetLibraryDatabase,
  parseLibraryCabinet,
  type CabinetLibraryRepository,
} from "@/persistence/cabinet-library";
import { IndexedDbCabinetLibrary, IndexedDbProjectRepository, openDatabase } from "@/persistence/indexeddb";
import { parseProject } from "@/persistence/schema";
import { createCabinetLibraryStore } from "@/modules/engineering/library-store";
import { CAB, testContext } from "./helpers";

const ABSEN: LibraryCabinet = {
  id: "lib-absen",
  name: "Absen test 500×1000",
  widthUm: mmToUm(500),
  heightUm: mmToUm(1000),
  pixelsX: px(128),
  pixelsY: px(256),
  nominalPitchUm: mmToUm(3.906),
  source: "custom",
  supplier: "Absen",
  model: "Test",
  datasheetNote: "",
  maxPowerMw: null,
  typicalPowerMw: null,
  weightG: null,
  refreshRateHz: null,
  environment: null,
};

/** Made-up test values, not a real product's specifications. */
const WITH_SPECS: LibraryCabinet = {
  ...ABSEN,
  id: "lib-specs",
  name: "Spec test cabinet",
  maxPowerMw: 180_000,
  typicalPowerMw: 60_500,
  weightG: 7_250,
  refreshRateHz: 3840,
  environment: "outdoor",
};

describe("Yestech MG6S P2.6 Indoor seed", () => {
  it("holds the data-sheet values exactly, in integer units", () => {
    expect(YESTECH_MG6S_P26_INDOOR).toMatchObject({
      name: "Yestech MG6S P2.6 Indoor",
      widthUm: 500_000,
      heightUm: 500_000,
      pixelsX: 192,
      pixelsY: 192,
      nominalPitchUm: 2_604,
      supplier: "Yestech",
      model: "MG6S P2.6",
    });
    expect(parseLibraryCabinet(YESTECH_MG6S_P26_INDOOR)).toEqual(YESTECH_MG6S_P26_INDOOR);
  });

  it("gives the 5.5 × 3 m wall from cabinet pixels × count, not from pitch", () => {
    const spec = computeScreenSpec({ columns: 11, rows: 6 }, YESTECH_MG6S_P26_INDOOR);
    expect([spec.pixelWidth, spec.pixelHeight]).toEqual([2112, 1152]);
    expect([spec.widthUm, spec.heightUm]).toEqual([5_500_000, 3_000_000]);
  });

  it("states indoor, and leaves power, weight and refresh rate empty rather than guessed", () => {
    expect(YESTECH_MG6S_P26_INDOOR.environment).toBe("indoor");
    expect([YESTECH_MG6S_P26_INDOOR.maxPowerMw, YESTECH_MG6S_P26_INDOOR.typicalPowerMw, YESTECH_MG6S_P26_INDOOR.weightG, YESTECH_MG6S_P26_INDOOR.refreshRateHz]).toEqual([null, null, null, null]);
  });
});

describe("IndexedDB cabinet library", () => {
  let factory: IDBFactory;
  let library: CabinetLibraryRepository;

  beforeEach(async () => {
    factory = new IDBFactory();
    library = await openCabinetLibrary(factory);
  });

  it("starts with the Yestech profile", async () => {
    expect(await library.list()).toEqual([YESTECH_MG6S_P26_INDOOR]);
  });

  it("creates, edits and deletes profiles", async () => {
    await library.save(ABSEN);
    expect((await library.list()).map((c) => c.id)).toEqual([ABSEN.id, YESTECH_MG6S_P26_INDOOR.id]);

    await library.save({ ...ABSEN, name: "Absen renamed", datasheetNote: "Rev B" });
    const edited = await library.get(ABSEN.id);
    expect(edited).toMatchObject({ name: "Absen renamed", datasheetNote: "Rev B", supplier: "Absen" });
    expect(await library.list()).toHaveLength(2);

    await library.delete(ABSEN.id);
    expect(await library.get(ABSEN.id)).toBeNull();
    expect(await library.list()).toEqual([YESTECH_MG6S_P26_INDOOR]);
  });

  it("keeps profiles across reopening, and a deleted seed stays deleted", async () => {
    await library.save(ABSEN);
    await library.delete(YESTECH_MG6S_P26_INDOOR.id);
    const reopened = await openCabinetLibrary(factory);
    expect(await reopened.list()).toEqual([ABSEN]);
  });

  it("refuses an invalid profile and stores nothing", async () => {
    await expect(library.save({ ...ABSEN, pixelsX: 127.5 as never })).rejects.toBeInstanceOf(CabinetFormatError);
    await expect(library.save({ ...ABSEN, name: "  " })).rejects.toBeInstanceOf(CabinetFormatError);
    await expect(library.save({ ...ABSEN, source: "builtin" as never })).rejects.toBeInstanceOf(CabinetFormatError);
    expect(await library.get(ABSEN.id)).toBeNull();
  });

  it("skips unreadable records without deleting them", async () => {
    const db = await openCabinetLibraryDatabase(factory);
    const tx = db.transaction("profiles", "readwrite");
    tx.objectStore("profiles").put({ id: "broken", name: "Half a record" });
    await new Promise((resolve) => (tx.oncomplete = resolve));
    expect(await library.list()).toEqual([YESTECH_MG6S_P26_INDOOR]);
    await expect(library.get("broken")).rejects.toBeInstanceOf(CabinetFormatError);
  });

  it("is stored apart from projects", async () => {
    const projectDb = await openDatabase(factory);
    const projects = new IndexedDbProjectRepository(projectDb);
    const project = ops.addCabinet(ops.createProject({ name: "Show" }, testContext()), toProjectCabinet(ABSEN));
    await library.save(ABSEN);
    await projects.save(project, 0);
    await projects.delete(project.id);
    expect(await library.get(ABSEN.id)).toEqual(ABSEN);
    projectDb.close();
  });
});

describe("older custom cabinets", () => {
  it("are copied into the library once, and generic ones are left out", async () => {
    const factory = new IDBFactory();
    const projectDb = await openDatabase(factory);
    const legacy = new IndexedDbCabinetLibrary(projectDb);
    await legacy.upsert(CAB);
    await legacy.upsert({ ...CAB, id: "builtin-x", source: "builtin" });
    projectDb.close();

    const library = await openCabinetLibrary(factory);
    expect(await library.get(CAB.id)).toEqual({ ...CAB, ...EMPTY_LIBRARY_FIELDS });
    expect(await library.get("builtin-x")).toBeNull();

    await library.delete(CAB.id);
    const reopened = await openCabinetLibrary(factory);
    expect(await reopened.get(CAB.id)).toBeNull();
  });

  it("never overwrite a library profile with the same id", async () => {
    const factory = new IDBFactory();
    const db = await openCabinetLibraryDatabase(factory);
    await new IndexedDbCabinetLibraryRepository(db).save({ ...ABSEN, id: CAB.id });
    db.close();
    const projectDb = await openDatabase(factory);
    await new IndexedDbCabinetLibrary(projectDb).upsert(CAB);
    projectDb.close();

    const library = await openCabinetLibrary(factory);
    expect((await library.get(CAB.id))!.supplier).toBe("Absen");
  });
});

describe("using a library profile in a project", () => {
  it("copies only the profile fields, so the project file keeps its shape", () => {
    const copy = toProjectCabinet(YESTECH_MG6S_P26_INDOOR);
    expect(Object.keys(copy).sort()).toEqual(["heightUm", "id", "name", "nominalPitchUm", "pixelsX", "pixelsY", "source", "widthUm"]);
    const ctx = testContext();
    let project = ops.addCabinet(ops.createProject({ name: "Wall" }, ctx), copy);
    project = ops.addScreen(project, { name: "LED", cabinetId: copy.id, columns: 11, rows: 6 }, ctx);
    expect(parseProject(JSON.parse(JSON.stringify(project)))).toEqual(project);
  });

  it("keeps the project's copy when the library profile changes or is deleted", async () => {
    const library = await openCabinetLibrary(new IDBFactory());
    const project = ops.addCabinet(ops.createProject({ name: "Wall" }, testContext()), toProjectCabinet(YESTECH_MG6S_P26_INDOOR));
    await library.save({ ...YESTECH_MG6S_P26_INDOOR, pixelsX: px(200) });
    await library.delete(YESTECH_MG6S_P26_INDOOR.id);
    expect(project.cabinets[0].pixelsX).toBe(192);
  });
});

describe("cabinet form", () => {
  const text = cabinetFormText(YESTECH_MG6S_P26_INDOOR);

  it("round-trips a profile through its text", () => {
    const result = parseCabinetForm(text);
    expect(result).toEqual({ ok: true, value: { ...YESTECH_MG6S_P26_INDOOR, id: undefined } });
  });

  it.each<[Partial<CabinetFormText>, keyof CabinetFormText]>([
    [{ name: " " }, "name"],
    [{ width: "0" }, "width"],
    [{ height: "500.0001" }, "height"],
    [{ pixelsX: "191.5" }, "pixelsX"],
    [{ pixelsY: "" }, "pixelsY"],
    [{ pitch: "2.6041" }, "pitch"],
    [{ supplier: "x".repeat(121) }, "supplier"],
  ])("rejects %o without rounding", (patch, field) => {
    const result = parseCabinetForm({ ...text, ...patch });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[field]).toBeTruthy();
  });

  it("leaves unknown supplier fields empty rather than guessing", () => {
    const result = parseCabinetForm({ ...text, supplier: "  ", model: "", datasheetNote: "" });
    expect(result.ok && [result.value.supplier, result.value.model, result.value.datasheetNote]).toEqual(["", "", ""]);
  });
});

describe("cabinet library store", () => {
  it("loads, saves, removes and keeps supplier fields when a project edits a profile", async () => {
    const factory = new IDBFactory();
    const store = createCabinetLibraryStore(() => openCabinetLibrary(factory));
    await store.getState().init();
    expect(store.getState().status).toBe("ready");
    expect(store.getState().entries).toEqual([YESTECH_MG6S_P26_INDOOR]);

    await store.getState().save(ABSEN);
    expect(store.getState().entries.map((e) => e.id)).toEqual([ABSEN.id, YESTECH_MG6S_P26_INDOOR.id]);

    await store.getState().saveFromProject({ ...toProjectCabinet(ABSEN), name: "Edited in project" });
    expect(store.getState().entries[0]).toMatchObject({ name: "Edited in project", supplier: "Absen" });

    await store.getState().saveFromProject({ ...CAB, id: "builtin-500x500-p391", source: "builtin" });
    expect(store.getState().entries).toHaveLength(2);

    await store.getState().remove(ABSEN.id);
    expect(store.getState().entries).toEqual([YESTECH_MG6S_P26_INDOOR]);
  });
});

describe("optional data-sheet specs", () => {
  it("persist in integer units and survive reopening", async () => {
    const factory = new IDBFactory();
    await (await openCabinetLibrary(factory)).save(WITH_SPECS);
    const reopened = await openCabinetLibrary(factory);
    expect(await reopened.get(WITH_SPECS.id)).toEqual(WITH_SPECS);
  });

  it("can be cleared back to not stated", async () => {
    const library = await openCabinetLibrary(new IDBFactory());
    await library.save(WITH_SPECS);
    await library.save({ ...WITH_SPECS, maxPowerMw: null, weightG: null, environment: null });
    expect(await library.get(WITH_SPECS.id)).toMatchObject({ maxPowerMw: null, typicalPowerMw: 60_500, weightG: null, environment: null });
  });

  it("read as null on profiles saved before the fields existed", async () => {
    const factory = new IDBFactory();
    const db = await openCabinetLibraryDatabase(factory);
    const tx = db.transaction("profiles", "readwrite");
    // The exact shape PR #10's first version stored: no spec fields at all.
    tx.objectStore("profiles").put({ ...toProjectCabinet(ABSEN), supplier: "Absen", model: "Test", datasheetNote: "" });
    await new Promise((resolve) => (tx.oncomplete = resolve));
    db.close();
    const library = await openCabinetLibrary(factory);
    expect(await library.get(ABSEN.id)).toEqual(ABSEN);
  });

  it.each<[string, Partial<LibraryCabinet>]>([
    ["fractional milliwatts", { maxPowerMw: 1.5 }],
    ["zero weight", { weightG: 0 }],
    ["negative refresh rate", { refreshRateHz: -60 }],
    ["an unknown environment", { environment: "semi-outdoor" as never }],
    ["typical above maximum power", { maxPowerMw: 100_000, typicalPowerMw: 120_000 }],
  ])("refuse %s", async (_, patch) => {
    const library = await openCabinetLibrary(new IDBFactory());
    await expect(library.save({ ...WITH_SPECS, ...patch })).rejects.toBeInstanceOf(CabinetFormatError);
    expect(await library.get(WITH_SPECS.id)).toBeNull();
  });

  it("never reach the project copy, so project files keep their shape", () => {
    const copy = toProjectCabinet(WITH_SPECS);
    expect(Object.keys(copy).some((k) => /power|weight|refresh|environment/i.test(k))).toBe(false);
    const project = ops.addCabinet(ops.createProject({ name: "Wall" }, testContext()), copy);
    expect(parseProject(JSON.parse(JSON.stringify(project)))).toEqual(project);
  });

  it("are kept when a project edits the same profile", async () => {
    const store = createCabinetLibraryStore(() => openCabinetLibrary(new IDBFactory()));
    await store.getState().save(WITH_SPECS);
    await store.getState().saveFromProject({ ...toProjectCabinet(WITH_SPECS), name: "Renamed in project" });
    expect(store.getState().entries.find((e) => e.id === WITH_SPECS.id)).toEqual({ ...WITH_SPECS, name: "Renamed in project" });
  });
});

describe("spec form fields", () => {
  const base = cabinetFormText(WITH_SPECS);

  it("show W and kg from integer mW and g, and round-trip exactly", () => {
    expect([base.maxPower, base.typicalPower, base.weight, base.refreshRate, base.environment]).toEqual(["180", "60.5", "7.25", "3840", "outdoor"]);
    const result = parseCabinetForm(base);
    expect(result.ok && result.value).toMatchObject({ maxPowerMw: 180_000, typicalPowerMw: 60_500, weightG: 7_250, refreshRateHz: 3840, environment: "outdoor" });
  });

  it("store empty fields as null", () => {
    const result = parseCabinetForm({ ...base, maxPower: "", typicalPower: " ", weight: "", refreshRate: "", environment: "" });
    expect(result.ok && result.value).toMatchObject({ maxPowerMw: null, typicalPowerMw: null, weightG: null, refreshRateHz: null, environment: null });
  });

  it("parse thousandths without floating point", () => {
    expect(parseThousandths("0.001")).toBe(1);
    expect(parseThousandths("5.7")).toBe(5_700);
    expect(parseThousandths("")).toBeNull();
    expect(parseThousandths("0")).toBeUndefined();
    expect(parseThousandths("1.2345")).toBeUndefined();
    expect(parseThousandths("-3")).toBeUndefined();
    expect(parseThousandths("5,7")).toBeUndefined();
  });

  it.each<[Partial<CabinetFormText>, keyof CabinetFormText]>([
    [{ maxPower: "abc" }, "maxPower"],
    [{ typicalPower: "200" }, "typicalPower"],
    [{ weight: "0" }, "weight"],
    [{ refreshRate: "3840.5" }, "refreshRate"],
    [{ refreshRate: "0" }, "refreshRate"],
  ])("rejects %o", (patch, field) => {
    const result = parseCabinetForm({ ...base, ...patch });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[field]).toBeTruthy();
  });
});
