import { beforeEach, describe, expect, it } from "vitest";
import { drawCalibration } from "@/components/shell/calibration/draw";
import { calibrationTargets } from "@/components/shell/calibration/from-mapping";
import { resolveMapping } from "@/engines/mapping";
import { buildExample } from "@/examples";
import { calibrationFrameFor, calibrationSource } from "@/modules/output/calibration-source";
import { useCalibrationSource } from "@/modules/output/calibration-store";
import type { FrameInput } from "@/preview/contract";

/** A 2D context that records what is drawn, so two drawings can be compared call for call. */
function recorder() {
  const calls: unknown[][] = [];
  const state = { fillStyle: "", font: "", globalAlpha: 1 };
  const ctx = new Proxy(state as Record<string, unknown>, {
    get(target, key) {
      if (key in target) return target[key as string];
      return (...args: unknown[]) => {
        if (key === "fillRect" || key === "fillText" || key === "drawImage") calls.push([key, target.fillStyle, target.font, ...args]);
      };
    },
    set(target, key, value) {
      target[key as string] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const project = buildExample("keynote");
const mapping = resolveMapping(project);
const screens = mapping.screens.map((s) => ({ id: s.screenId, name: s.name, ...s.masterRect }));
const input = (frame: number): FrameInput => ({ frame, fps: 30, width: mapping.master.width, height: mapping.master.height, screens, context: { project, mapping } });

describe("calibration test card source", () => {
  beforeEach(() => useCalibrationSource.setState({ mode: "identification", logoByMode: { identification: "center", calibration: "off" } }));

  it("builds the same master frame the Preview dialog builds, from the shared mapping", () => {
    const frame = calibrationFrameFor(input(0));
    const [master] = calibrationTargets(mapping);
    expect(frame.width).toBe(mapping.master.width);
    expect(frame.height).toBe(mapping.master.height);
    for (const s of master.screens) expect(frame.nodes.some((n) => n.kind === "text" && n.text === s.label)).toBe(true);
    expect(frame.nodes.some((n) => n.kind === "logo")).toBe(true);
  });

  it("draws exactly the dialog's frame at scale 1, after one black fill of the master canvas", () => {
    useCalibrationSource.setState({ mode: "calibration" });
    const viaSource = recorder();
    calibrationSource.draw(viaSource.ctx, input(42), { scale: 1, fontFamily: "sans-serif" });
    const direct = recorder();
    const frame = calibrationFrameFor(input(42));
    const options = { scale: 1, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", logo: null, frame: 42, fps: 30 as const };
    drawCalibration(direct.ctx, frame, options, "static");
    drawCalibration(direct.ctx, frame, options, "counters");
    expect(viaSource.calls[0]).toEqual(["fillRect", "#000000", "", 0, 0, mapping.master.width, mapping.master.height]);
    expect(viaSource.calls.slice(1)).toEqual(direct.calls);
    // Every rectangle lands on whole master pixels.
    for (const call of viaSource.calls.filter((c) => c[0] === "fillRect")) for (const v of call.slice(3)) expect(Number.isInteger(v)).toBe(true);
  });

  it("follows the mode and logo settings, and reuses the frame while they and the mapping stay the same", () => {
    const a = calibrationFrameFor(input(0));
    expect(calibrationFrameFor(input(5))).toBe(a);
    useCalibrationSource.getState().setLogo("off");
    const b = calibrationFrameFor(input(0));
    expect(b).not.toBe(a);
    expect(b.nodes.some((n) => n.kind === "logo")).toBe(false);
    useCalibrationSource.getState().setMode("calibration");
    expect(calibrationFrameFor(input(0)).mode).toBe("calibration");
  });

  it("labels screens by order when no mapping is given", () => {
    const frame = calibrationFrameFor({ ...input(0), context: undefined });
    expect(frame.nodes.some((n) => n.kind === "text" && n.text === "SCR-01")).toBe(true);
  });
});
