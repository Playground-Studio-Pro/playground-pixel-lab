import { describe, expect, it } from "vitest";
import { resolveMapping } from "@/engines/mapping";
import { h264Problem, videoTargets } from "@/engines/video-targets";
import { buildExample } from "@/examples";
import { calibrationFrameFor, createCalibrationSource } from "@/modules/output/calibration-source";
import { useCalibrationSource } from "@/modules/output/calibration-store";
import { validateVideoSettings } from "@/modules/output/video-export";

const mapping = resolveMapping(buildExample("keynote"));

describe("video export targets", () => {
  it("lists the master, each output and each screen at their resolved sizes, unscaled", () => {
    const targets = videoTargets(mapping);
    expect(targets.map((t) => [t.kind, t.width, t.height])).toEqual([
      ["master", 4224, 1536],
      ...mapping.outputs.map((o) => ["output", o.width, o.height]),
      ...mapping.screens.map((s) => ["screen", s.masterRect.width, s.masterRect.height]),
    ]);
    for (const t of targets.filter((t) => t.kind === "screen")) {
      const s = mapping.screens.find((s) => `screen:${s.screenId}` === t.id)!;
      expect(t.regions).toEqual([{ from: { x: s.masterRect.x, y: s.masterRect.y, width: s.masterRect.width, height: s.masterRect.height }, to: { x: 0, y: 0 } }]);
    }
  });

  it("places each screen at its output rectangle in an output target", () => {
    const [output] = videoTargets(mapping).filter((t) => t.kind === "output");
    for (const s of mapping.screens.filter((s) => s.outputId === output.id)) {
      expect(output.regions).toContainEqual({ from: { x: s.masterRect.x, y: s.masterRect.y, width: s.masterRect.width, height: s.masterRect.height }, to: { x: s.outputRect.x, y: s.outputRect.y } });
    }
  });

  it("refuses what H.264 can't take at its own size, with the reason, instead of scaling", () => {
    const byId = Object.fromEntries(videoTargets(mapping).map((t) => [t.id, t]));
    expect(byId.master.problem).toMatch(/4096/);
    const mainWall = mapping.screens.find((s) => s.name === "Main Wall")!;
    expect(byId[`screen:${mainWall.screenId}`].problem).toBeNull();
    expect(h264Problem(1921, 1080)).toMatch(/even/);
    expect(h264Problem(4096, 2304)).toMatch(/pixels/);
  });

  it("agrees with the encoder's own validation for every target", () => {
    for (const t of videoTargets(mapping)) {
      const validate = () => validateVideoSettings({ width: t.width, height: t.height, fps: 30, frames: 300 });
      if (t.problem) expect(validate).toThrow();
      else expect(validate).not.toThrow();
    }
  });
});

describe("frozen calibration source", () => {
  it("keeps the settings it was created with while the Live preview controls change", () => {
    useCalibrationSource.setState({ mode: "calibration", logoByMode: { identification: "center", calibration: "off" } });
    const source = createCalibrationSource({ mode: "identification", logo: "center" });
    useCalibrationSource.getState().setMode("calibration");
    const input = { frame: 3, fps: 30 as const, width: mapping.master.width, height: mapping.master.height, screens: [], context: { project: buildExample("keynote"), mapping } };
    const frozen = calibrationFrameFor(input, { mode: "identification", logo: "center" });
    expect(frozen.mode).toBe("identification");
    expect(frozen.nodes.some((n) => n.kind === "logo")).toBe(true);
    expect(calibrationFrameFor(input).mode).toBe("calibration");
    expect(source.id).toBe("calibration-test-card");
  });
});
