import type { Project } from "@/domain/model";
import type { ContentFps } from "@/domain/motion";
import type { DisplayInfo, JsonValue, OutputClock, OutputErrorCode, OutputId, OutputRenderErrorCode, OutputSession, OutputStatus } from "@/domain/physical-output";
import { OUTPUT_ERROR_CODES, OUTPUT_RENDER_ERROR_CODES } from "@/domain/physical-output";
import type { ResolvedMapping } from "@/engines/mapping";
import { serializeProject } from "@/persistence/schema";
import { parseOutputSettings } from "./output-sources";

/**
 * The control window's side of the physical output (PHYSICAL_OUTPUT section 3, task O12), without React:
 * building the session the output window receives, and turning an `OutputStatus` into what the operator reads and
 * which buttons they get. The panel (`output-controls.tsx`) only wires these to `window.pixelLabDesktop.output`.
 */

/** A playing clock from frame 0, its epoch on the shared clock (`performance.timeOrigin + performance.now()`). */
export function playingFromStart(fps: ContentFps, nowMs: number): OutputClock {
  return { state: "playing", fps, startFrame: 0, epochMs: nowMs };
}

export class OutputRequestError extends Error {}

/**
 * The session for one output: the project serialized exactly as a project file, this output's id, the source with
 * its frozen settings (validated by the same parser the output page uses), and the clock.
 */
export function buildOutputSession(args: {
  project: Project;
  mapping: ResolvedMapping;
  outputId: OutputId;
  source: { id: string; settings: JsonValue };
  clock: OutputClock;
  revision?: number;
}): OutputSession {
  const { project, mapping, outputId, source, clock } = args;
  if (!mapping.outputs.some((o) => o.outputId === outputId)) throw new OutputRequestError(`Output "${outputId}" isn't in this project.`);
  parseOutputSettings(source.id, source.settings);
  return { revision: args.revision ?? 1, projectText: serializeProject(project), outputId, source: { id: source.id, settings: source.settings }, clock };
}

// ── Error codes in plain language (section 3 table, 8.4) ─────────────────────────────────────────────────────────

const ERROR_TEXT: Record<OutputErrorCode | OutputRenderErrorCode, string> = {
  BAD_REQUEST: "The output request was rejected. This is a bug in Pixel Lab; try again.",
  UNTRUSTED_SENDER: "The output request came from the wrong window and was rejected.",
  UNKNOWN_OUTPUT: "This output isn't in the project. Fix the mapping first.",
  DISPLAY_NOT_FOUND: "That monitor isn't connected any more. Choose it again from the list.",
  DISPLAY_BUSY: "Another output is already on that monitor.",
  CONTROL_DISPLAY: "That monitor shows Pixel Lab. Tick the box to cover it, or choose another monitor.",
  ALREADY_OPEN: "This output is already open.",
  TOO_MANY_OUTPUTS: "Only one output can be open at a time in this version.",
  PROJECT_INVALID: "The mapping has errors. Fix them first.",
  LOAD_FAILED: "The output window couldn't start.",
  OPEN_TIMEOUT: "The output window didn't draw its first frame in time.",
  RENDERER_GONE: "The output window crashed.",
  RENDERER_UNRESPONSIVE: "The output window stopped responding. The last frame stays on the monitor.",
  DISPLAY_AMBIGUOUS: "A monitor came back, but Pixel Lab can't be sure it's the same one. Close and open the output again.",
  NOT_RESUMABLE: "There's nothing to resume.",
  NOT_ONE_TO_ONE: "The monitor doesn't show the output pixel for pixel.",
  SOURCE_UNKNOWN: "This content can't be sent to a monitor.",
  SOURCE_SETTINGS_INVALID: "The content's settings are invalid.",
  ASSET_MISSING: "The test card logo didn't load. Set the logo to Off, or try again.",
  GPU_UNAVAILABLE: "This content needs a graphics feature this computer doesn't provide.",
  MASTER_TOO_LARGE: "The canvas is larger than this monitor's window can draw. It's never scaled down.",
  DRAW_FAILED: "The output couldn't draw a frame.",
};

const KNOWN = new Set<string>([...OUTPUT_ERROR_CODES, ...OUTPUT_RENDER_ERROR_CODES]);

/** Plain text for a section 3 or 8.4 code; unknown codes are shown as they are. */
export function errorText(code: string): string {
  return KNOWN.has(code) ? ERROR_TEXT[code as OutputErrorCode] : code;
}

/** A rejected invoke carries the code first ("DISPLAY_BUSY: ..."). */
export function codeOfRejection(error: unknown): { code: string; text: string } {
  const message = error instanceof Error ? error.message : String(error);
  const match = /^([A-Z_]+):\s*([\s\S]*)$/.exec(message);
  // Electron prefixes its own text to rejected invokes: "Error invoking remote method 'output:open': Error: CODE: ..."
  const inner = /([A-Z][A-Z_]+):\s*([\s\S]*)$/.exec(message);
  const found = match ?? inner;
  if (found && KNOWN.has(found[1])) return { code: found[1], text: errorText(found[1]) };
  return { code: "BAD_REQUEST", text: message };
}

// ── Monitors ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** "DELL U2723QE · 3840 × 2160 · 1× · 60 Hz", with what the monitor already shows. */
export function displayLabel(d: DisplayInfo): string {
  const hz = d.refreshHz > 0 ? ` · ${Math.round(d.refreshHz)} Hz` : "";
  const scale = Number.isInteger(d.scaleFactor) ? `${d.scaleFactor}×` : `${d.scaleFactor.toFixed(2)}×`;
  const notes = [d.hostsControlWindow ? "shows Pixel Lab" : null, d.hostsOutput ? "has an output" : null].filter(Boolean);
  return `${d.label} · ${d.devicePx.width} × ${d.devicePx.height} · ${scale}${hz}${notes.length ? ` (${notes.join(", ")})` : ""}`;
}

/** The key the open request carries for a monitor. */
export const sameDisplay = (a: DisplayInfo, b: DisplayInfo) => a.key.electronId === b.key.electronId && a.key.label === b.key.label;

// ── Status → what the operator sees ──────────────────────────────────────────────────────────────────────────────

export type OutputAction = "open" | "close" | "retry" | "resume";

export interface OutputView {
  readonly state: OutputStatus["state"];
  /** One word for the badge. */
  readonly badge: string;
  readonly tone: "idle" | "busy" | "ok" | "warn" | "error";
  /** What happened, in a sentence. */
  readonly message: string | null;
  /** Fit on the monitor: "Exact" / "Smaller than the monitor: 160 px black at the right" ... */
  readonly fit: string | null;
  readonly actions: readonly OutputAction[];
  /** The output covers a monitor: tell the operator Esc closes it. */
  readonly escHint: boolean;
}

function fitText(s: OutputStatus): string | null {
  if (s.state !== "live" && s.state !== "held") return null;
  const parts: string[] = [];
  if (s.croppedPx && (s.croppedPx.right || s.croppedPx.bottom)) parts.push(`${axis(s.croppedPx)} of the output cut off`);
  if (s.blackPx && (s.blackPx.right || s.blackPx.bottom)) parts.push(`${axis(s.blackPx)} of the monitor black`);
  switch (s.sizeMatch) {
    case "exact":
      return "Exact: the output fills the monitor pixel for pixel.";
    case "smaller-than-display":
      return `Smaller than the monitor, shown 1:1 at the top-left: ${parts.join("; ")}.`;
    case "larger-than-display":
      return `Larger than the monitor, never scaled: ${parts.join("; ")}.`;
    case "mixed":
      return `Doesn't match the monitor, never scaled: ${parts.join("; ")}.`;
    default:
      return null;
  }
}

function axis(px: { right: number; bottom: number }): string {
  return [px.right ? `${px.right} px at the right` : null, px.bottom ? `${px.bottom} px at the bottom` : null].filter(Boolean).join(" and ");
}

/** What the panel shows for an output's status. `null` status = never opened (closed). */
export function outputView(status: OutputStatus | null, names: { output: string; display?: string }): OutputView {
  const state = status?.state ?? "closed";
  const errorLine = status?.error ? `${errorText(status.error.code)}${status.error.code === "NOT_ONE_TO_ONE" ? ` ${status.error.message}` : ""}` : null;
  const on = status?.display ? status.display.label : names.display ?? "the monitor";
  switch (state) {
    case "opening":
      return { state, badge: "Opening", tone: "busy", message: `Opening ${names.output} on ${on}…`, fit: null, actions: ["close"], escHint: true };
    case "live":
      return { state, badge: "Live", tone: errorLine ? "warn" : "ok", message: errorLine ?? `${names.output} is on ${on}.`, fit: fitText(status!), actions: ["close"], escHint: true };
    case "waiting-display": {
      // D7 stays here when a monitor comes back but can't take the output: tell the operator why, or they'd wait forever.
      const code = status?.error?.code;
      const message =
        code === "CONTROL_DISPLAY"
          ? `${on} came back, but it now shows Pixel Lab, so ${names.output} stays off it. Close the output, or move Pixel Lab to another screen.`
          : code
            ? `${errorText(code)} ${names.output} is paused.`
            : `${on} was disconnected. ${names.output} is paused and waits for it to come back.`;
      return { state, badge: "Waiting", tone: code ? "error" : "warn", message, fit: null, actions: ["close"], escHint: false };
    }
    case "held": {
      const frame = status?.render?.frame;
      return {
        state,
        badge: "Held",
        tone: "warn",
        message: `${names.output} is back on ${on}, paused${frame !== undefined ? ` at frame ${frame}` : ""}. Resume when the monitor is ready.`,
        fit: fitText(status!),
        actions: ["resume", "close"],
        escHint: true,
      };
    }
    case "failed":
      return { state, badge: "Failed", tone: "error", message: errorLine ?? "The output failed.", fit: null, actions: ["retry", "close"], escHint: true };
    default:
      // Closed by D7 when the monitor disappears while opening or failed: say why. The next open pushes a new status.
      return { state: "closed", badge: "Closed", tone: errorLine ? "error" : "idle", message: errorLine, fit: null, actions: ["open"], escHint: false };
  }
}

/**
 * Whether Open may be pressed on a monitor. The monitor that shows Pixel Lab needs the operator's explicit opt-in
 * every time; it is never the default and never remembered.
 */
export function openBlocker(display: DisplayInfo | null, args: { coverControlDisplay: boolean; mappingErrors: number; outputExists: boolean; busyElsewhere: boolean }): string | null {
  if (!args.outputExists) return "Choose an output.";
  if (args.mappingErrors > 0) return "Fix the mapping's errors first.";
  if (!display) return "Choose a monitor.";
  if (display.hostsOutput) return "Another output is already on that monitor.";
  if (args.busyElsewhere) return "Close the open output first: one output at a time in this version.";
  if (display.hostsControlWindow && !args.coverControlDisplay) return "This monitor shows Pixel Lab. Tick the box to cover it.";
  return null;
}

// ── Update output (output:update) ────────────────────────────────────────────────────────────────────────────────

/** Whether "Update output" may be pressed, and why not. Hidden (`null`) when there's no open output. */
export function updateAvailability(state: OutputStatus["state"] | "closed"): { enabled: boolean; reason: string | null } | null {
  switch (state) {
    case "opening":
    case "live":
    case "failed":
      return { enabled: true, reason: null };
    case "waiting-display":
    case "held":
      return { enabled: false, reason: "Resume first." };
    default:
      return null;
  }
}

/**
 * The clock an update carries: the live output keeps its frame and play state, never restarting from 0.
 * - Not re-timed since it was sent: the same clock, so playback continues without a jump.
 * - Re-timed by main since (a disconnect, then Resume): re-anchored at the last frame the page reported, now.
 */
export function updateClock(sent: OutputClock, args: { retimed: boolean; reportedFrame: number | null; nowMs: number }): OutputClock {
  if (!args.retimed || args.reportedFrame === null) return sent;
  return sent.state === "playing" ? { state: "playing", fps: sent.fps, startFrame: args.reportedFrame, epochMs: args.nowMs } : { state: "paused", frame: args.reportedFrame };
}

/** An update's session: the current project and source, the next revision, and the kept clock. */
export function buildUpdateSession(args: { project: Project; mapping: ResolvedMapping; outputId: OutputId; source: { id: string; settings: JsonValue }; clock: OutputClock; previousRevision: number }): OutputSession {
  return buildOutputSession({ ...args, revision: args.previousRevision + 1 });
}

/** A rejected update in plain language. An output main doesn't have open is "This output isn't open." */
export function updateErrorText(error: unknown): string {
  const { code, text } = codeOfRejection(error);
  return code === "UNKNOWN_OUTPUT" ? "This output isn't open." : text;
}

// ── Colour profile warning (DisplayInfo.colorSpace, #48) ─────────────────────────────────────────────────────────

export const SRGB_WARNING = "This monitor isn't using the sRGB colour profile. Colours sent to the LED processor may be altered. Set it to sRGB IEC61966-2.1 in System Settings → Displays.";

/** The warning for a monitor whose colour profile isn't sRGB; `null` when it is, or when Electron doesn't say. */
export function colourWarning(display: DisplayInfo | null): string | null {
  const cs = display?.colorSpace;
  if (!cs) return null;
  return cs.includes("primaries:BT709") && cs.includes("transfer:SRGB") ? null : SRGB_WARNING;
}
