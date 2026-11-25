import { beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type Project } from "@/domain/model";
import { AURORA_PRESETS, DEFAULT_AURORA, normalizeAurora } from "@/engines/content/aurora";
import { activeLook, addLook, changedPaths, LookError, MAX_LOOKS, MAX_LOOK_NAME, nextLookName, parseSavedContent, removeLook, renameLook, type Look } from "@/engines/content/looks";
import { EMERALD_CHAMBER, normalizeDepthConfig, type DepthSceneConfig } from "@/engines/depth/config";
import { resolveMapping } from "@/engines/mapping";
import { useAurora } from "@/modules/content/aurora-store";
import "@/modules/content/aurora-saved";
import { useDepth } from "@/modules/depth-studio/depth-store";
import "@/modules/depth-studio/depth-saved";
import { parseProjectFile, serializeProject } from "@/persistence/schema";
import { emptyHistory } from "@/state/history";
import { useApp } from "@/state/store";
import { festivalMainStage, threeScreenProject } from "./helpers";

/** Three looks of one scene, like an operator's violet, fire and ice. */
const PALETTES = {
  Violet: { background: "#12062B", particle: "#7B61FF", accent: "#E9E2FF" },
  Fire: { background: "#1C0702", particle: "#FF6A1A", accent: "#FFE1A6" },
  Ice: { background: "#03131C", particle: "#3EC1E3", accent: "#EAFBFF" },
};
const NAMES = Object.keys(PALETTES) as (keyof typeof PALETTES)[];

function open(project: Project | null) {
  useApp.setState({ project, mapping: project && resolveMapping(project), issues: [], history: emptyHistory, canUndo: false, canRedo: false, saveStatus: "saved" });
}
const app = () => useApp.getState();
const depth = () => useDepth.getState();
const aurora = () => useAurora.getState();
const reopen = () => {
  const file = serializeProject(app().project!);
  open(null);
  open(parseProjectFile(file));
};

beforeEach(() => {
  open(null);
  open(festivalMainStage());
});

describe("looks: the list", () => {
  const looks: readonly Look<number>[] = [{ id: "a", name: "Violet", settings: 1 }, { id: "b", name: "Fire", settings: 2 }];

  it("adds, renames and removes without changing the list it was given", () => {
    const before = JSON.stringify(looks);
    expect(addLook(looks, "c", "  Ice   blue ", 3).at(-1)).toEqual({ id: "c", name: "Ice blue", settings: 3 });
    expect(renameLook(looks, "b", "Ember")[1]).toEqual({ id: "b", name: "Ember", settings: 2 });
    expect(renameLook(looks, "a", "VIOLET")[0].name).toBe("VIOLET");
    expect(removeLook(looks, "a").map((l) => l.id)).toEqual(["b"]);
    expect(removeLook(looks, "x")).toBe(looks);
    expect(renameLook(looks, "a", "Violet")).toBe(looks);
    expect(JSON.stringify(looks)).toBe(before);
  });

  it("refuses a name it can't use, and says why", () => {
    for (const bad of ["", "   ", "x".repeat(MAX_LOOK_NAME + 1), "violet", " FIRE "]) expect(() => addLook(looks, "c", bad, 3)).toThrow(LookError);
    expect(() => renameLook(looks, "a", "fire")).toThrow("There's already a look called Fire.");
    const full = Array.from({ length: MAX_LOOKS }, (_, i) => ({ id: String(i), name: `L${i}`, settings: i }));
    expect(() => addLook(full, "more", "One more", 0)).toThrow(LookError);
  });

  it("suggests the first free name", () => {
    expect(nextLookName([])).toBe("Look 1");
    expect(nextLookName([{ id: "1", name: "look 1", settings: 0 }, { id: "3", name: "Look 3", settings: 0 }])).toBe("Look 2");
  });

  it("finds what changed", () => {
    expect(changedPaths(EMERALD_CHAMBER, EMERALD_CHAMBER)).toEqual([]);
    expect(changedPaths(EMERALD_CHAMBER, structuredClone(EMERALD_CHAMBER))).toEqual([]);
    expect(changedPaths(EMERALD_CHAMBER, { ...EMERALD_CHAMBER, room: { ...EMERALD_CHAMBER.room, depthM: 5 } })).toEqual(["room.depthM"]);
    expect(changedPaths({ a: [1, 2] }, { a: [1] })).toEqual(["a.1"]);
  });
});

describe("looks: reading saved data", () => {
  const read = (data: unknown, version = 1) => parseSavedContent(data, version, normalizeDepthConfig);

  it("brings settings into range and fills what's missing", () => {
    const saved = read({ settings: { room: { depthM: 999 }, palette: { particle: "red" } }, looks: [] })!;
    expect(saved.settings.room.depthM).toBe(30);
    expect(saved.settings.palette.particle).toBe(EMERALD_CHAMBER.palette.particle);
    expect(saved.settings.viewer).toEqual(EMERALD_CHAMBER.viewer);
  });

  it("drops looks it can't read and keeps the rest", () => {
    const good = { id: "a", name: "Violet", settings: { seed: 5 } };
    const saved = read({ settings: {}, looks: [good, null, 3, { id: "a", name: "Twin id", settings: {} }, { id: "b", name: "violet", settings: {} }, { id: "c", name: "", settings: {} }, { id: "d", name: "No settings" }, { id: "", name: "No id", settings: {} }, { id: "e", name: "Ice", settings: {} }] })!;
    expect(saved.looks.map((l) => l.name)).toEqual(["Violet", "Ice"]);
    expect(saved.looks[0].settings.seed).toBe(5);
  });

  it("reads nothing from another shape or a newer version", () => {
    for (const data of [null, 1, "x", [], {}, { settings: null }, { settings: [] }]) expect(read(data)).toBeNull();
    expect(read({ settings: {}, looks: [] }, 2)).toBeNull();
    expect(read({ settings: {}, looks: "none" })!.looks).toEqual([]);
  });

  it("normalizes Aurora settings", () => {
    expect(normalizeAurora(null)).toEqual(DEFAULT_AURORA);
    expect(normalizeAurora({ colors: ["#ff00aa", "bad", "#00FF00"], speed: 3, direction: 45 })).toEqual({ colors: ["#FF00AA", "#00FF00"], speed: 1, direction: 45 });
    expect(normalizeAurora({ colors: ["#ff00aa"], speed: 2, direction: 7 })).toEqual({ colors: DEFAULT_AURORA.colors, speed: 2, direction: 0 });
    for (const p of AURORA_PRESETS) expect(normalizeAurora({ ...DEFAULT_AURORA, colors: p.colors }).colors).toEqual(p.colors);
  });
});

describe("content settings in the project", () => {
  it("opening a project never edits it, and an older one opens unchanged", () => {
    for (const project of [festivalMainStage(), threeScreenProject().project]) {
      open(null);
      open(project);
      expect(app().project).toBe(project);
      expect(app().project!.modules).toEqual({});
      expect([app().canUndo, app().saveStatus]).toEqual([false, "saved"]);
      expect(depth().config).toEqual(EMERALD_CHAMBER);
      expect(aurora().settings).toEqual(DEFAULT_AURORA);
    }
  });

  it("saves every Depth Studio and Aurora value, and brings it back from a file", () => {
    const config: DepthSceneConfig = normalizeDepthConfig({ ...EMERALD_CHAMBER, seed: 42, fps: 60, durationSeconds: 20, room: { depthM: 18.25, showGrid: false, gridOpacity: 0.5 }, viewer: { distanceM: 6, offsetXM: -1.5, offsetYM: 0.3 }, particles: { enabled: false, count: 1234, speed: 0.5, size: 2, opacity: 0.4 }, lighting: { intensity: 1.5, directionDeg: 90, sweepWidth: 0.3 }, atmosphere: { fogDensity: 0.1 }, palette: PALETTES.Violet });
    depth().patch(config);
    aurora().setColors(["#FF6A3D", "#FFD23D"]);
    aurora().setSpeed(4);
    aurora().setDirection(225);
    const settings = aurora().settings;
    expect(app().project!.schemaVersion).toBe(SCHEMA_VERSION);
    reopen();
    expect(depth().config).toEqual(config);
    expect(aurora().settings).toEqual(settings);
  });

  it("each project has its own, and a project without data gets the defaults", () => {
    depth().patch({ seed: 42 });
    const first = app().project!;
    open(threeScreenProject().project);
    expect(depth().config.seed).toBe(EMERALD_CHAMBER.seed);
    open(first);
    expect(depth().config.seed).toBe(42);
  });

  it("unreadable data falls back to defaults and is left alone until something is edited", () => {
    const project = { ...festivalMainStage(), modules: { "depth-studio": { version: 9, data: { future: true } }, aurora: { version: 1, data: "broken" } } };
    open(project);
    expect(depth().config).toEqual(EMERALD_CHAMBER);
    expect(aurora().settings).toEqual(DEFAULT_AURORA);
    expect(app().project).toBe(project);
  });

  it("writes only its own module and never the mapping", () => {
    const before = app().project!;
    open({ ...before, modules: { engineering: { version: 1, data: { keep: true } } } });
    const mapping = JSON.stringify(app().mapping);
    depth().patch({ room: { depthM: 5 } });
    aurora().setSpeed(2);
    expect(Object.keys(app().project!.modules).sort()).toEqual(["aurora", "depth-studio", "engineering"]);
    expect(app().project!.modules.engineering).toEqual({ version: 1, data: { keep: true } });
    expect(JSON.stringify(app().mapping)).toBe(mapping);
  });

  it("a drag is one undo step, different values are separate, and nothing changed is no step", () => {
    for (const depthM of [5, 6, 7, 8]) depth().patch({ room: { depthM } });
    depth().patch({ viewer: { distanceM: 4 } });
    depth().patch({ viewer: { distanceM: 4 } });
    expect(app().history.past).toHaveLength(2);
    app().undo();
    expect([depth().config.room.depthM, depth().config.viewer.distanceM]).toEqual([8, EMERALD_CHAMBER.viewer.distanceM]);
    app().undo();
    expect(depth().config).toEqual(EMERALD_CHAMBER);
    expect(app().canUndo).toBe(false);
    app().redo();
    app().redo();
    expect([depth().config.room.depthM, depth().config.viewer.distanceM]).toEqual([8, 4]);
  });

  it("undoing a mapping edit leaves content alone", () => {
    depth().patch({ seed: 42 });
    app().edit((p) => ({ ...p, meta: { ...p.meta, name: "Renamed" } }));
    const { config } = depth();
    app().undo();
    expect(depth().config).toBe(config);
  });

  it("with no project open, settings still change and nothing is saved", () => {
    open(null);
    depth().patch({ seed: 7 });
    expect(depth().config.seed).toBe(7);
    expect(app().project).toBeNull();
  });
});

describe("named looks: violet, fire and ice", () => {
  const saveAll = () => {
    for (const name of NAMES) {
      depth().patch({ palette: PALETTES[name] });
      depth().saveLook(name);
    }
  };
  const id = (name: string) => depth().looks.find((l) => l.name === name)!.id;

  it("save, apply and come back from a file", () => {
    saveAll();
    reopen();
    expect(depth().looks.map((l) => l.name)).toEqual(NAMES);
    for (const name of NAMES) {
      depth().applyLook(id(name));
      expect(depth().config.palette).toEqual(PALETTES[name]);
      expect(activeLook({ settings: depth().config, looks: depth().looks })).toBe(id(name));
    }
    depth().patch({ seed: 3 });
    expect(activeLook({ settings: depth().config, looks: depth().looks })).toBeNull();
  });

  it("saving, applying, renaming and deleting each undo in one step", () => {
    saveAll();
    depth().applyLook(id("Violet"));
    const steps = app().history.past.length;
    depth().renameLook(id("Fire"), "Ember");
    depth().removeLook(id("Violet"));
    depth().applyLook(id("Ice"));
    expect(app().history.past).toHaveLength(steps + 3);
    app().undo();
    expect(depth().config.palette).toEqual(PALETTES.Violet);
    app().undo();
    expect(depth().looks.map((l) => l.name)).toEqual(["Violet", "Ember", "Ice"]);
    app().undo();
    expect(depth().looks.map((l) => l.name)).toEqual(NAMES);
  });

  it("deleting a look keeps the current settings", () => {
    saveAll();
    const { config } = depth();
    depth().removeLook(id("Ice"));
    expect(depth().config).toBe(config);
  });

  it("a look keeps its own copy: later edits don't change it", () => {
    saveAll();
    depth().patch({ palette: { particle: "#FFFFFF" } });
    expect(depth().looks[2].settings.palette).toEqual(PALETTES.Ice);
  });

  it("a name that can't be used changes nothing", () => {
    saveAll();
    const before = app().project;
    expect(() => depth().saveLook(" fire ")).toThrow(LookError);
    expect(() => depth().renameLook(id("Ice"), "")).toThrow(LookError);
    expect(app().project).toBe(before);
  });

  it("a look with another length and rate keeps the loop frame where it still exists", () => {
    depth().patch({ durationSeconds: 30 });
    depth().saveLook("Long");
    depth().patch({ durationSeconds: 10, fps: 60 });
    depth().seek(120);
    depth().applyLook(id("Long"));
    expect(depth().clock.baseMs).toBeCloseTo((120 * 1000) / 30, 6);
  });

  it("Aurora has its own looks", () => {
    saveAll();
    aurora().setColors(AURORA_PRESETS[2].colors);
    aurora().saveLook("Sunset");
    aurora().setColors(AURORA_PRESETS[3].colors);
    reopen();
    expect(aurora().looks.map((l) => l.name)).toEqual(["Sunset"]);
    aurora().applyLook(aurora().looks[0].id);
    expect(aurora().settings.colors).toEqual(AURORA_PRESETS[2].colors);
    expect(depth().looks).toHaveLength(3);
  });
});
