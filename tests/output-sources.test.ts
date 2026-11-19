import { describe, expect, it } from "vitest";
import type { JsonValue } from "@/domain/physical-output";
import { OUTPUT_SOURCE_IDS } from "@/domain/physical-output";
import { EMERALD_CHAMBER, normalizeDepthConfig } from "@/engines/depth/config";
import { useCalibrationSource } from "@/modules/output/calibration-store";
import { createOutputSource, frozenSettings, OutputSourceError, parseOutputSettings, type OutputSourceEnv } from "@/modules/output/output-sources";

const master = { width: 1920, height: 1080 };
const env = (over: Partial<OutputSourceEnv> = {}): OutputSourceEnv => ({
  prepareCalibration: async () => ({ logo: true, font: true }),
  depthMaxSize: () => 16384,
  ...over,
});
const depthJson = (): JsonValue => JSON.parse(JSON.stringify(normalizeDepthConfig(EMERALD_CHAMBER)));

async function code(p: Promise<unknown> | (() => unknown)): Promise<string | null> {
  try {
    await (typeof p === "function" ? p() : p);
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(OutputSourceError);
    return (e as OutputSourceError).code;
  }
}

describe("parseOutputSettings (PHYSICAL_OUTPUT 8.5)", () => {
  it("accepts every valid setting of every source", () => {
    for (const mode of ["identification", "calibration"]) for (const logo of ["center", "watermark", "off"]) {
      expect(parseOutputSettings("calibration-test-card", { mode, logo })).toEqual({ id: "calibration-test-card", settings: { mode, logo } });
    }
    for (const space of ["master", "display"]) for (const motion of [true, false]) {
      expect(parseOutputSettings("pixel-grid", { space, motion })).toEqual({ id: "pixel-grid", settings: { space, motion } });
    }
    expect(parseOutputSettings("depth-scene", depthJson()).settings).toEqual(normalizeDepthConfig(EMERALD_CHAMBER));
  });

  it("SOURCE_UNKNOWN for an id outside the shared list, including the live preview's Motion Lab patterns", async () => {
    for (const id of ["flow", "", "calibration", "Pixel-Grid"]) expect(await code(() => parseOutputSettings(id, {}))).toBe("SOURCE_UNKNOWN");
  });

  it("SOURCE_SETTINGS_INVALID for wrong shapes, values, unknown and missing keys", async () => {
    const bad: [string, JsonValue][] = [
      ["calibration-test-card", null],
      ["calibration-test-card", []],
      ["calibration-test-card", "identification"],
      ["calibration-test-card", { mode: "identification" }],
      ["calibration-test-card", { mode: "identification", logo: "center", extra: 1 }],
      ["calibration-test-card", { mode: "Identification", logo: "center" }],
      ["calibration-test-card", { mode: "identification", logo: true }],
      ["pixel-grid", { space: "master" }],
      ["pixel-grid", { space: "output", motion: true }],
      ["pixel-grid", { space: "master", motion: "yes" }],
      ["pixel-grid", { space: "master", motion: true, scale: 2 }],
      ["depth-scene", {}],
      ["depth-scene", null],
    ];
    for (const [id, settings] of bad) expect(await code(() => parseOutputSettings(id, settings)), JSON.stringify(settings)).toBe("SOURCE_SETTINGS_INVALID");
  });

  it("refuses a Depth Studio config the normalizer would change, instead of fixing it", async () => {
    const config = depthJson() as { [k: string]: JsonValue };
    expect(await code(() => parseOutputSettings("depth-scene", { ...config, seed: -5 }))).toBe("SOURCE_SETTINGS_INVALID");
    expect(await code(() => parseOutputSettings("depth-scene", { ...config, fps: 29 }))).toBe("SOURCE_SETTINGS_INVALID");
    expect(await code(() => parseOutputSettings("depth-scene", { ...config, unknown: 1 }))).toBe("SOURCE_SETTINGS_INVALID");
    // Key order doesn't matter.
    const reversed = Object.fromEntries(Object.entries(config).reverse());
    expect(await code(() => parseOutputSettings("depth-scene", reversed))).toBeNull();
  });
});

describe("frozenSettings", () => {
  it("is plain JSON that its own parser accepts, for every source", () => {
    for (const id of OUTPUT_SOURCE_IDS) {
      const settings = frozenSettings(id);
      expect(JSON.parse(JSON.stringify(settings))).toEqual(settings);
      expect(parseOutputSettings(id, settings).id).toBe(id);
    }
  });

  it("follows the test card controls at the moment it's called", () => {
    useCalibrationSource.getState().setMode("calibration");
    useCalibrationSource.getState().setLogo("watermark");
    expect(frozenSettings("calibration-test-card")).toEqual({ mode: "calibration", logo: "watermark" });
    useCalibrationSource.getState().setMode("identification");
    expect(frozenSettings("calibration-test-card")).toEqual({ mode: "identification", logo: "center" });
  });

  it("the pixel grid freezes as the live preview plays it: master space, motion on", () => {
    expect(frozenSettings("pixel-grid")).toEqual({ space: "master", motion: true });
  });
});

describe("createOutputSource", () => {
  it("builds each source under its own id", async () => {
    expect((await createOutputSource("calibration-test-card", { mode: "calibration", logo: "off" }, master, env())).id).toBe("calibration-test-card");
    expect((await createOutputSource("pixel-grid", { space: "master", motion: false }, master, env())).id).toBe("pixel-grid");
    expect((await createOutputSource("depth-scene", depthJson(), master, env())).id).toBe("depth-scene");
  });

  it("ASSET_MISSING when the test card needs a logo that didn't load; fine with the logo off", async () => {
    const noLogo = env({ prepareCalibration: async () => ({ logo: false, font: true }) });
    expect(await code(createOutputSource("calibration-test-card", { mode: "identification", logo: "center" }, master, noLogo))).toBe("ASSET_MISSING");
    expect(await code(createOutputSource("calibration-test-card", { mode: "identification", logo: "watermark" }, master, noLogo))).toBe("ASSET_MISSING");
    expect(await code(createOutputSource("calibration-test-card", { mode: "identification", logo: "off" }, master, noLogo))).toBeNull();
  });

  it("GPU_UNAVAILABLE without WebGL 2, and in node by default", async () => {
    expect(await code(createOutputSource("depth-scene", depthJson(), master, env({ depthMaxSize: () => null })))).toBe("GPU_UNAVAILABLE");
    expect(await code(createOutputSource("depth-scene", depthJson(), master))).toBe("GPU_UNAVAILABLE");
  });

  it("MASTER_TOO_LARGE when the master is over the GPU limit on either side, never scaled", async () => {
    const limit = env({ depthMaxSize: () => 4096 });
    expect(await code(createOutputSource("depth-scene", depthJson(), { width: 5120, height: 1664 }, limit))).toBe("MASTER_TOO_LARGE");
    expect(await code(createOutputSource("depth-scene", depthJson(), { width: 1024, height: 4097 }, limit))).toBe("MASTER_TOO_LARGE");
    expect(await code(createOutputSource("depth-scene", depthJson(), { width: 4096, height: 4096 }, limit))).toBeNull();
  });

  it("display-space grid is the output page's job, not a master-canvas source", async () => {
    expect(await code(createOutputSource("pixel-grid", { space: "display", motion: true }, master, env()))).toBe("SOURCE_SETTINGS_INVALID");
  });

  it("validates before loading anything", async () => {
    let loaded = false;
    const watch = env({ prepareCalibration: async () => ((loaded = true), { logo: true, font: true }) });
    expect(await code(createOutputSource("calibration-test-card", { mode: "nope", logo: "off" }, master, watch))).toBe("SOURCE_SETTINGS_INVALID");
    expect(loaded).toBe(false);
  });
});
