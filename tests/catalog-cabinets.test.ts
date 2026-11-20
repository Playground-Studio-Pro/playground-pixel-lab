import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cabinetOptions } from "@/components/workspace/cabinet-options";
import { BUILTIN_CABINETS, CATALOG_CABINETS, catalogProfile, SEED_LIBRARY_CABINETS, YESTECH_MG6S_P26_INDOOR } from "@/domain/cabinets";
import { computeScreenSpec } from "@/engines/physical";
import * as ops from "@/engines/project-ops";
import { parseProjectFile, serializeProject } from "@/persistence/schema";
import { opContext, useApp } from "@/state/store";
import { CAB } from "./helpers";

const byId = (id: string) => CATALOG_CABINETS.find((c) => c.id === id)!;

describe("catalog cabinets (LED_HARDWARE_CATALOG)", () => {
  it("each model's pixels and size, in integer units", () => {
    const expected: Record<string, [number, number, number, number, number]> = {
      "catalog-roe-bp2v2": [500_000, 500_000, 176, 176, 2_840],
      "catalog-absen-pl39-v10": [500_000, 500_000, 128, 128, 3_910],
      "catalog-unilumin-upad-iv-26": [500_000, 500_000, 192, 192, 2_600],
      "catalog-yestech-mg6s-p26": [500_000, 500_000, 192, 192, 2_604],
    };
    expect(CATALOG_CABINETS.map((c) => c.id)).toEqual(Object.keys(expected));
    for (const c of CATALOG_CABINETS) {
      expect([c.widthUm, c.heightUm, c.pixelsX, c.pixelsY, c.nominalPitchUm], c.name).toEqual(expected[c.id]);
      for (const n of [c.widthUm, c.heightUm, c.pixelsX, c.pixelsY, c.nominalPitchUm]) expect(Number.isSafeInteger(n)).toBe(true);
      // Resolution comes from pixels × count, never from pitch: a 4 × 3 wall is 4 × pixelsX wide.
      expect(computeScreenSpec({ columns: 4, rows: 3 }, c)).toMatchObject({ pixelWidth: 4 * c.pixelsX, pixelHeight: 3 * c.pixelsY, widthUm: 4 * c.widthUm, heightUm: 3 * c.heightUm });
      // The stated pitch matches width ÷ pixels to within 0.5 %.
      expect(Math.abs(c.nominalPitchUm - c.widthUm / c.pixelsX) / c.nominalPitchUm).toBeLessThan(0.005);
      expect(c.source).toBe("builtin");
      expect(c.environment).toBe("indoor");
      expect(c.datasheetNote).toContain("Not checked against the manufacturer's PDF");
    }
  });

  it("weights and power in grams and milliwatts; null where no source states it", () => {
    expect(byId("catalog-roe-bp2v2")).toMatchObject({ weightG: 9_350, maxPowerMw: 190_000, typicalPowerMw: 95_000, refreshRateHz: null });
    expect(byId("catalog-absen-pl39-v10")).toMatchObject({ weightG: 7_700, maxPowerMw: 135_000, typicalPowerMw: 45_000, refreshRateHz: null });
    expect(byId("catalog-unilumin-upad-iv-26")).toMatchObject({ weightG: 6_300, maxPowerMw: 120_000, typicalPowerMw: 40_000, refreshRateHz: null });
    // Yestech: weight varies by variant, so it's left empty; power derived from 450 / 150 W/m².
    expect(byId("catalog-yestech-mg6s-p26")).toMatchObject({ weightG: null, maxPowerMw: 112_500, typicalPowerMw: 37_500, refreshRateHz: null });
    // Retailer-only refresh rates live in the note, not the field.
    expect(byId("catalog-absen-pl39-v10").datasheetNote).toContain("3840 Hz");
    expect(byId("catalog-unilumin-upad-iv-26").datasheetNote).toContain("3840 Hz");
  });

  it("a project stores a plain CabinetProfile copy: the file and schema are unchanged", () => {
    const profile = catalogProfile(byId("catalog-roe-bp2v2"));
    expect(Object.keys(profile).sort()).toEqual(["heightUm", "id", "name", "nominalPitchUm", "pixelsX", "pixelsY", "source", "widthUm"]);
    let p = ops.createProject({ name: "Catalog" }, opContext);
    p = ops.addCabinet(p, profile);
    expect(parseProjectFile(serializeProject(p)).cabinets).toEqual([profile]);
    // Read-only in the project, like the generic profiles.
    expect(() => ops.updateCabinet(p, profile.id, { name: "Edited" })).toThrow(ops.DomainError);
  });
});

describe("cabinet dropdown options", () => {
  it("project first, then generic, catalog and library, each cabinet once", () => {
    let p = ops.createProject({ name: "Order" }, opContext);
    p = ops.addCabinet(p, CAB);
    p = ops.addCabinet(p, catalogProfile(byId("catalog-absen-pl39-v10")));
    const library = [{ ...YESTECH_MG6S_P26_INDOOR, id: "library-custom-1", name: "My custom", pixelsX: 160 as never }];
    const options = cabinetOptions(p, library);
    expect(options.map((o) => o.group)).toEqual(["Project", "Project", ...BUILTIN_CABINETS.map(() => "Generic"), "Catalog", "Catalog", "Catalog", "Library"]);
    expect(options.filter((o) => o.cabinet.id === "catalog-absen-pl39-v10")).toHaveLength(1);
    expect(options.find((o) => o.cabinet.id === "catalog-absen-pl39-v10")!.group).toBe("Project");
    expect(options.at(-1)!.cabinet.name).toBe("My custom");
  });

  it("the Yestech profile seeded into older libraries is shown once, under Catalog", () => {
    const options = cabinetOptions(null, [...SEED_LIBRARY_CABINETS]);
    expect(options.filter((o) => o.cabinet.name === "Yestech MG6S P2.6 Indoor").map((o) => o.group)).toEqual(["Catalog"]);
    // An edited library copy is the user's own and stays listed.
    const edited = cabinetOptions(null, [{ ...YESTECH_MG6S_P26_INDOOR, pixelsX: 191 as never }]);
    expect(edited.filter((o) => o.cabinet.name === "Yestech MG6S P2.6 Indoor").map((o) => o.group)).toEqual(["Catalog", "Library"]);
  });

  it("existing users see the catalog with no library reset: it's code, not seeded data", () => {
    expect(cabinetOptions(null, []).filter((o) => o.group === "Catalog")).toHaveLength(CATALOG_CABINETS.length);
  });
});

describe("choosing a catalog cabinet in the screen inspector", () => {
  const app = () => useApp.getState();
  beforeAll(async () => {
    await app().init();
  });
  beforeEach(async () => {
    await app().newProject({ name: "Inspector" });
    app().edit((p) => ops.addCabinet(p, CAB));
    app().edit((p) => ops.addScreen(p, { name: "Wall", cabinetId: CAB.id, columns: 4, rows: 3 }, opContext));
  });
  // The inspector's change: copy the cabinet if needed and assign it, in one edit.
  const choose = (cabinetId: string) => {
    const cabinet = cabinetOptions(app().project, []).find((o) => o.cabinet.id === cabinetId)!.cabinet;
    const screenId = app().project!.physical.screens[0].id;
    app().edit((p) => ops.updateScreen(ops.addCabinet(p, cabinet), screenId, { cabinetId }));
  };

  it("copies it into the project once, assigns it, and one undo reverts both", () => {
    const before = app().project!;
    choose("catalog-roe-bp2v2");
    const after = app().project!;
    expect(after.cabinets.map((c) => c.id)).toEqual([CAB.id, "catalog-roe-bp2v2"]);
    expect(after.physical.screens[0].cabinetId).toBe("catalog-roe-bp2v2");
    expect(app().mapping!.screens[0].spec).toMatchObject({ pixelWidth: 4 * 176, pixelHeight: 3 * 176 });
    app().undo();
    expect(app().project!.cabinets).toEqual(before.cabinets);
    expect(app().project!.physical.screens[0].cabinetId).toBe(CAB.id);
    app().redo();
    expect(app().project!.physical.screens[0].cabinetId).toBe("catalog-roe-bp2v2");
  });

  it("choosing it again, or switching back, never copies it twice", () => {
    choose("catalog-roe-bp2v2");
    choose(CAB.id);
    choose("catalog-roe-bp2v2");
    expect(app().project!.cabinets.filter((c) => c.id === "catalog-roe-bp2v2")).toHaveLength(1);
  });
});
