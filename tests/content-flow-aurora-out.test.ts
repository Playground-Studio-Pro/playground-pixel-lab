import { afterEach, describe, expect, it } from "vitest";
import { CONTENT_FPS } from "@/domain/motion";
import { OUTPUT_SOURCE_IDS, type JsonValue } from "@/domain/physical-output";
import { AURORA_DIRECTIONS, AURORA_PRESETS, AURORA_SPEEDS, DEFAULT_AURORA, parseAuroraSettings } from "@/engines/content/aurora";
import { resolveMapping } from "@/engines/mapping";
import { renderPattern } from "@/engines/motion/patterns";
import { useAurora } from "@/modules/content/aurora-store";
import { createExportSource, exportSourceForPreview, exportSourceLabel, patternLoopNote } from "@/modules/output/export-sources";
import { createOutputSource, frozenSettings, OutputSourceError, parseOutputSettings } from "@/modules/output/output-sources";
import { drawPattern } from "@/preview/draw-pattern";
import type { FrameInput, FrameSource } from "@/preview/contract";
import { festivalMainStage } from "./helpers";

const mapping = resolveMapping(festivalMainStage());
const master = { width: mapping.master.width, height: mapping.master.height };
const input = (frame: number, fps: (typeof CONTENT_FPS)[number] = 30): FrameInput => ({
  frame,
  fps,
  ...master,
  screens: mapping.screens.map((s) => ({ id: s.screenId, name: s.name, x: s.masterRect.x, y: s.masterRect.y, width: s.masterRect.width, height: s.masterRect.height })),
});
const SUNSET = { colors: [...AURORA_PRESETS[2].colors], speed: 2, direction: 135 } as const;

/** A 2D context that records every call and assignment, so two drawings can be compared exactly. */
function recorder() {
  const log: unknown[] = [];
  const gradient = { addColorStop: (...a: unknown[]) => log.push(["stop", ...a]) };
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_t, key) => (...args: unknown[]) => {
      log.push([key, ...args]);
      return key === "createLinearGradient" || key === "createRadialGradient" ? gradient : undefined;
    },
    set: (_t, key, value) => {
      log.push(["=", key, typeof value === "object" ? "object" : value]);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

const draw = (source: FrameSource, frame: FrameInput, scale = 1) => {
  const { ctx, log } = recorder();
  source.draw(ctx, frame, { scale, fontFamily: "Inter" });
  return log;
};

/** What the Live preview draws for a pattern: the same functions `LiveRenderer` calls. */
const preview = (pattern: "flow" | "aurora", frame: FrameInput, aurora = DEFAULT_AURORA, scale = 1) => {
  const { ctx, log } = recorder();
  drawPattern(ctx, renderPattern(pattern, frame, { aurora }), scale, "Inter");
  return log;
};

async function code(p: Promise<unknown> | (() => unknown)): Promise<string | null> {
  try {
    await (typeof p === "function" ? p() : p);
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(OutputSourceError);
    return (e as OutputSourceError).code;
  }
}

afterEach(() => useAurora.setState({ settings: DEFAULT_AURORA }));

describe("Content Flow and Aurora: settings", () => {
  it("are in the shared list, after the existing sources", () => {
    expect([...OUTPUT_SOURCE_IDS]).toEqual(["calibration-test-card", "pixel-grid", "depth-scene", "content-flow", "aurora-gradient"]);
    expect([exportSourceLabel("content-flow"), exportSourceLabel("aurora-gradient")]).toEqual(["content-flow", "aurora"]);
  });

  it("accepts every valid Aurora setting, and Content Flow's empty settings", () => {
    for (const p of AURORA_PRESETS) for (const speed of AURORA_SPEEDS) for (const direction of AURORA_DIRECTIONS) {
      const settings = { colors: [...p.colors], speed, direction };
      expect(parseOutputSettings("aurora-gradient", settings)).toEqual({ id: "aurora-gradient", settings });
    }
    expect(parseOutputSettings("aurora-gradient", { colors: ["#ff00aa", "#00ff00"], speed: 1, direction: 0 }).settings).toEqual({ colors: ["#FF00AA", "#00FF00"], speed: 1, direction: 0 });
    expect(parseOutputSettings("content-flow", {})).toEqual({ id: "content-flow", settings: {} });
  });

  it("refuses a bad setting with the reason, never a silent default", async () => {
    const bad: [string, JsonValue, string][] = [
      ["aurora-gradient", null, "expected an object"],
      ["aurora-gradient", [], "expected an object"],
      ["aurora-gradient", { colors: ["#FF0000"], speed: 1, direction: 0 }, "two to six"],
      ["aurora-gradient", { colors: Array(7).fill("#FF0000"), speed: 1, direction: 0 }, "two to six"],
      ["aurora-gradient", { colors: ["#FF0000", "red"], speed: 1, direction: 0 }, "two to six"],
      ["aurora-gradient", { colors: ["#FF0000", "#00FF00"], speed: 3, direction: 0 }, '"speed" must be one of'],
      ["aurora-gradient", { colors: ["#FF0000", "#00FF00"], speed: 1, direction: 30 }, '"direction" must be one of'],
      ["aurora-gradient", { colors: ["#FF0000", "#00FF00"], speed: 1 }, '"direction" must be one of'],
      ["aurora-gradient", { colors: ["#FF0000", "#00FF00"], speed: 1, direction: 0, extra: 1 }, 'unknown key "extra"'],
      ["content-flow", { speed: 1 }, 'unknown key "speed"'],
      ["content-flow", null, "expected an object"],
    ];
    for (const [id, settings, reason] of bad) {
      expect(await code(() => parseOutputSettings(id, settings)), JSON.stringify(settings)).toBe("SOURCE_SETTINGS_INVALID");
      expect(() => parseOutputSettings(id, settings)).toThrow(reason);
    }
    expect(parseAuroraSettings({ colors: ["#FF0000", "#00FF00"], speed: 4, direction: 315 }).ok).toBe(true);
  });

  it("freeze what the Live preview shows at that moment, as plain JSON", () => {
    expect(frozenSettings("content-flow")).toEqual({});
    expect(frozenSettings("aurora-gradient")).toEqual({ ...DEFAULT_AURORA, colors: [...DEFAULT_AURORA.colors] });
    useAurora.setState({ settings: SUNSET });
    expect(frozenSettings("aurora-gradient")).toEqual(SUNSET);
    for (const id of ["content-flow", "aurora-gradient"] as const) {
      const settings = frozenSettings(id);
      expect(JSON.parse(JSON.stringify(settings))).toEqual(settings);
      expect(parseOutputSettings(id, settings).id).toBe(id);
    }
  });

  it("an invalid palette plays as the default in the preview, and freezes as that default", () => {
    useAurora.setState({ settings: { ...SUNSET, colors: ["#FF0000"] } });
    const frozen = frozenSettings("aurora-gradient") as { colors: string[] };
    expect(frozen.colors).toEqual([...DEFAULT_AURORA.colors]);
  });
});

describe("Content Flow and Aurora: frames", () => {
  it("the output window draws what the Live preview draws, frame for frame", async () => {
    useAurora.setState({ settings: SUNSET });
    const flow = await createOutputSource("content-flow", frozenSettings("content-flow"), master);
    const aurora = await createOutputSource("aurora-gradient", frozenSettings("aurora-gradient"), master);
    for (const fps of CONTENT_FPS) {
      for (const frame of [0, 1, 37, 599, 2400]) {
        expect(draw(flow, input(frame, fps))).toEqual(preview("flow", input(frame, fps)));
        expect(draw(aurora, input(frame, fps))).toEqual(preview("aurora", input(frame, fps), SUNSET));
      }
    }
    // Scaled, as the preview draws when zoomed out.
    expect(draw(aurora, input(90), 0.25)).toEqual(preview("aurora", input(90), SUNSET, 0.25));
  });

  it("the MP4 export draws the engine's frames at scale 1", async () => {
    useAurora.setState({ settings: SUNSET });
    for (const [id, pattern] of [["content-flow", "flow"], ["aurora-gradient", "aurora"]] as const) {
      const source = await createExportSource(id, master);
      expect(source.id).toBe(id);
      for (const frame of [0, 299, 300]) expect(draw(source, input(frame))).toEqual(preview(pattern, input(frame), SUNSET));
    }
  });

  it("settings are fixed when the export or the output starts: later edits don't reach them", async () => {
    useAurora.setState({ settings: SUNSET });
    const exported = await createExportSource("aurora-gradient", master);
    const output = await createOutputSource("aurora-gradient", frozenSettings("aurora-gradient"), master);
    const before = [draw(exported, input(42)), draw(output, input(42))];
    useAurora.setState({ settings: DEFAULT_AURORA });
    expect([draw(exported, input(42)), draw(output, input(42))]).toEqual(before);
  });

  it("Aurora repeats exactly at its loop length, at every speed", async () => {
    for (const speed of AURORA_SPEEDS) {
      const source = await createOutputSource("aurora-gradient", { ...SUNSET, speed }, master);
      const loop = 30 * (20 / speed);
      expect(draw(source, input(loop))).toEqual(draw(source, input(0)));
    }
  });
});

describe("Content Flow and Aurora: the Export panel", () => {
  it("starts on what the Live preview is playing", () => {
    expect(exportSourceForPreview(null, "aurora")).toBe("aurora-gradient");
    expect(exportSourceForPreview(null, "flow")).toBe("content-flow");
    expect(exportSourceForPreview(null, "grid")).toBeNull();
    expect(exportSourceForPreview("pixel-grid", "aurora")).toBe("pixel-grid");
  });

  it("says when the file loops seamlessly, and when it doesn't", () => {
    expect(patternLoopNote("aurora-gradient", 20, 30, 1)).toBe("Loops seamlessly: the picture repeats every 20 s at 1× flow speed.");
    expect(patternLoopNote("aurora-gradient", 10, 30, 2)).toBe("Loops seamlessly: the picture repeats every 10 s at 2× flow speed.");
    expect(patternLoopNote("aurora-gradient", 60, 25, 4)).toMatch(/^Loops seamlessly: the picture repeats every 5 s/);
    expect(patternLoopNote("aurora-gradient", 10, 30, 1)).toBe("The picture repeats every 20 s at 1× flow speed, so a 10 s file won't loop seamlessly. Use a multiple of 20 s.");
    expect(patternLoopNote("aurora-gradient", 30, 24, 0.25)).toMatch(/every 80 s .* won't loop/);
    expect(patternLoopNote("content-flow", 20, 30, 1)).toMatch(/^Content Flow never repeats exactly, so the file won't loop seamlessly/);
  });
});
