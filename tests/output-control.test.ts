import { describe, expect, it } from "vitest";
import type { DisplayInfo, OutputStatus } from "@/domain/physical-output";
import { OUTPUT_ERROR_CODES, OUTPUT_RENDER_ERROR_CODES } from "@/domain/physical-output";
import { resolveMapping } from "@/engines/mapping";
import { buildExample } from "@/examples";
import { buildOutputSession, codeOfRejection, displayLabel, errorText, openBlocker, OutputRequestError, outputView, playingFromStart } from "@/modules/output/output-control";
import { frozenSettings, OutputSourceError } from "@/modules/output/output-sources";
import { parseProjectFile, serializeProject } from "@/persistence/schema";

const project = buildExample("keynote");
const mapping = resolveMapping(project);
const outputId = mapping.outputs[0].outputId;

const display = (over: Partial<DisplayInfo> = {}): DisplayInfo => ({
  key: { label: "DELL U2723QE", devicePx: { width: 3840, height: 2160 }, internal: false, electronId: 9 },
  electronId: 9,
  label: "DELL U2723QE",
  internal: false,
  primary: false,
  boundsDip: { x: 1800, y: 0, width: 3840, height: 2160 },
  scaleFactor: 1,
  devicePx: { width: 3840, height: 2160 },
  devicePxExact: true,
  rotation: 0,
  refreshHz: 60,
  hostsControlWindow: false,
  hostsOutput: null,
  ...over,
});

const status = (over: Partial<OutputStatus>): OutputStatus => ({
  outputId,
  state: "closed",
  display: display(),
  sessionRevision: 1,
  sizeMatch: "unknown",
  croppedPx: null,
  blackPx: null,
  reconnected: false,
  render: null,
  error: null,
  ...over,
});

describe("buildOutputSession (O12)", () => {
  it("carries the project serialized exactly as a project file, the output id, the frozen source and the clock", () => {
    const clock = playingFromStart(30, 1_700_000_000_123.5);
    const session = buildOutputSession({ project, mapping, outputId, source: { id: "calibration-test-card", settings: frozenSettings("calibration-test-card") }, clock });
    expect(session.projectText).toBe(serializeProject(project));
    expect(parseProjectFile(session.projectText)).toEqual(project);
    expect(session).toMatchObject({ revision: 1, outputId, source: { id: "calibration-test-card", settings: { mode: "identification", logo: "center" } } });
    expect(session.clock).toEqual({ state: "playing", fps: 30, startFrame: 0, epochMs: 1_700_000_000_123.5 });
    // Plain JSON, as main's validator and the IPC need.
    expect(JSON.parse(JSON.stringify(session))).toEqual(session);
  });

  it("refuses an output that isn't in the project and settings the output page would refuse", () => {
    const clock = playingFromStart(30, 1);
    expect(() => buildOutputSession({ project, mapping, outputId: "nope", source: { id: "pixel-grid", settings: { space: "master", motion: true } }, clock })).toThrow(OutputRequestError);
    expect(() => buildOutputSession({ project, mapping, outputId, source: { id: "pixel-grid", settings: { space: "master" } }, clock })).toThrow(OutputSourceError);
    expect(() => buildOutputSession({ project, mapping, outputId, source: { id: "flow", settings: {} }, clock })).toThrow(OutputSourceError);
  });
});

describe("error codes in plain language", () => {
  it("every section 3 and 8.4 code has its own sentence, without the code itself", () => {
    const texts = new Set<string>();
    for (const code of [...OUTPUT_ERROR_CODES, ...OUTPUT_RENDER_ERROR_CODES]) {
      const t = errorText(code);
      expect(t, code).not.toBe(code);
      expect(t).not.toMatch(/[A-Z]{3,}_[A-Z]/);
      texts.add(t);
    }
    // PROJECT_INVALID and UNKNOWN_OUTPUT appear in both lists: one sentence each.
    expect(texts.size).toBe(new Set([...OUTPUT_ERROR_CODES, ...OUTPUT_RENDER_ERROR_CODES]).size);
    expect(errorText("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });

  it("reads the code from a rejected invoke, with or without Electron's prefix", () => {
    expect(codeOfRejection(new Error("DISPLAY_BUSY: Output out-2 is on that display"))).toEqual({ code: "DISPLAY_BUSY", text: errorText("DISPLAY_BUSY") });
    expect(codeOfRejection(new Error("Error invoking remote method 'output:open': Error: CONTROL_DISPLAY: That display shows the Pixel Lab window")).code).toBe("CONTROL_DISPLAY");
    expect(codeOfRejection(new Error("network down"))).toEqual({ code: "BAD_REQUEST", text: "network down" });
  });
});

describe("monitor list", () => {
  it("shows name, device pixels, scale and refresh, and what the monitor already shows", () => {
    expect(displayLabel(display())).toBe("DELL U2723QE · 3840 × 2160 · 1× · 60 Hz");
    expect(displayLabel(display({ label: "Built-in Retina Display", devicePx: { width: 3600, height: 2338 }, scaleFactor: 2, refreshHz: 120.0006, hostsControlWindow: true }))).toBe("Built-in Retina Display · 3600 × 2338 · 2× · 120 Hz (shows Pixel Lab)");
    expect(displayLabel(display({ scaleFactor: 1.25, refreshHz: 0, hostsOutput: "out-1" }))).toBe("DELL U2723QE · 3840 × 2160 · 1.25× (has an output)");
  });
});

describe("status → what the operator sees", () => {
  const names = { output: "OUT 1", display: "DELL U2723QE" };
  it("closed: Open only, no Esc hint", () => {
    expect(outputView(null, names)).toMatchObject({ state: "closed", badge: "Closed", actions: ["open"], escHint: false });
  });
  it("opening and live: Close, and the Esc hint while it covers a monitor", () => {
    expect(outputView(status({ state: "opening" }), names)).toMatchObject({ badge: "Opening", actions: ["close"], escHint: true });
    const live = outputView(status({ state: "live", sizeMatch: "exact", croppedPx: { right: 0, bottom: 0 }, blackPx: { right: 0, bottom: 0 } }), names);
    expect(live).toMatchObject({ badge: "Live", tone: "ok", actions: ["close"], escHint: true, message: "OUT 1 is on DELL U2723QE." });
    expect(live.fit).toBe("Exact: the output fills the monitor pixel for pixel.");
  });
  it("live with a size mismatch says what is cut off and what is black, never scaled", () => {
    const v = outputView(status({ state: "live", sizeMatch: "mixed", croppedPx: { right: 624, bottom: 0 }, blackPx: { right: 0, bottom: 802 } }), names);
    expect(v.fit).toBe("Doesn't match the monitor, never scaled: 624 px at the right of the output cut off; 802 px at the bottom of the monitor black.");
    expect(outputView(status({ state: "live", sizeMatch: "smaller-than-display", croppedPx: { right: 0, bottom: 0 }, blackPx: { right: 1920, bottom: 1080 } }), names).fit).toBe(
      "Smaller than the monitor, shown 1:1 at the top-left: 1920 px at the right and 1080 px at the bottom of the monitor black.",
    );
  });
  it("live with NOT_ONE_TO_ONE warns with the measured values", () => {
    const v = outputView(status({ state: "live", error: { code: "NOT_ONE_TO_ONE", message: "canvasPx 1919 × 1080, expected 1920 × 1080" } }), names);
    expect(v.tone).toBe("warn");
    expect(v.message).toContain("canvasPx 1919 × 1080, expected 1920 × 1080");
  });
  it("failed: the error in plain language, Retry and Close", () => {
    const v = outputView(status({ state: "failed", error: { code: "RENDERER_GONE", message: "crashed" } }), names);
    expect(v).toMatchObject({ badge: "Failed", tone: "error", actions: ["retry", "close"], message: errorText("RENDERER_GONE") });
  });
  it("waiting for a disconnected monitor: paused, Close only", () => {
    expect(outputView(status({ state: "waiting-display" }), names)).toMatchObject({ badge: "Waiting", actions: ["close"] });
  });
  it("held: back on the monitor, paused at frame N, Resume and Close; never resumed by itself", () => {
    const v = outputView(status({ state: "held", reconnected: true, render: { frame: 412 } as OutputStatus["render"] }), names);
    expect(v).toMatchObject({ badge: "Held", actions: ["resume", "close"], escHint: true });
    expect(v.message).toBe("OUT 1 is back on DELL U2723QE, paused at frame 412. Resume when the monitor is ready.");
  });
});

describe("Open on a monitor", () => {
  const ok = { coverControlDisplay: false, mappingErrors: 0, outputExists: true, busyElsewhere: false };
  it("allowed on a free external monitor", () => {
    expect(openBlocker(display(), ok)).toBeNull();
  });
  it("the monitor that shows Pixel Lab needs the explicit tick, every time", () => {
    const own = display({ hostsControlWindow: true, internal: true });
    expect(openBlocker(own, ok)).toMatch(/shows Pixel Lab/);
    expect(openBlocker(own, { ...ok, coverControlDisplay: true })).toBeNull();
  });
  it("refused with mapping errors, without an output or monitor, on a busy monitor, or with another output open", () => {
    expect(openBlocker(display(), { ...ok, mappingErrors: 2 })).toMatch(/errors/);
    expect(openBlocker(display(), { ...ok, outputExists: false })).toMatch(/output/);
    expect(openBlocker(null, ok)).toMatch(/monitor/);
    expect(openBlocker(display({ hostsOutput: "out-2" }), ok)).toMatch(/already/);
    expect(openBlocker(display(), { ...ok, busyElsewhere: true })).toMatch(/one output at a time/);
  });
});
