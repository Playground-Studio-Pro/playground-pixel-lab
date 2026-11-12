import { drawCalibration } from "@/components/shell/calibration/draw";
import { buildCalibrationFrame, type CalibrationFrame, type CalibrationScreen } from "@/components/shell/calibration/frame";
import { calibrationTargets, screenLabel } from "@/components/shell/calibration/from-mapping";
import { CAL_COLORS, CAL_LOGO_ASSET, screenAccent } from "@/components/shell/calibration/tokens";
import type { FrameInput, FrameSource } from "@/preview/contract";
import { useCalibrationSource } from "./calibration-store";

/**
 * The calibration test card as a `FrameSource`: Product Design's identification and calibration frames
 * (`components/shell/calibration`), played across the mapped screens by the shared preview engine.
 *
 * The frame is built for the master canvas from the resolved mapping in `input.context`, the same
 * `calibrationTargets` the Preview dialog uses, so each screen is labelled with its identifier, name,
 * resolution, canvas position, output and cabinet grid. No coordinate is computed here. Without a
 * context it falls back to the screens' rectangles and order only.
 *
 * At scale 1 every rectangle lands on whole master pixels, as in the dialog's PNG export. The logo and
 * the monospace face load once, before they are used: call `prepareCalibrationSource` before exporting
 * frames, since a frame drawn before they arrive has no logo.
 */

const FALLBACK_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

let logo: HTMLImageElement | null = null;
let fontFamily = FALLBACK_FONT;
let preparing: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Loads the logo and the calibration face once. Resolves when both are usable, or have failed. */
export function prepareCalibrationSource(): Promise<void> {
  if (preparing) return preparing;
  if (typeof document === "undefined") return (preparing = Promise.resolve());
  const image = new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      logo = img;
      resolve();
    };
    img.onerror = () => resolve();
    img.src = CAL_LOGO_ASSET.src;
  });
  const declared = getComputedStyle(document.documentElement).getPropertyValue("--font-cal-mono").trim();
  const font = declared
    ? Promise.all([500, 600, 700].map((w) => document.fonts.load(`${w} 24px ${declared}`, "SCR-01 ×·…")))
        .then(() => {
          fontFamily = `${declared}, ${FALLBACK_FONT}`;
        })
        .catch(() => undefined)
    : Promise.resolve();
  preparing = Promise.all([image, font]).then(notify);
  return preparing;
}

/** The master canvas's screens, labelled. From the mapping when the input carries it. */
function masterScreens(input: FrameInput): readonly CalibrationScreen[] {
  const mapping = input.context?.mapping;
  if (mapping && mapping.master.width === input.width && mapping.master.height === input.height) {
    return calibrationTargets(mapping)[0].screens;
  }
  return input.screens.map((s, i) => ({
    label: screenLabel(i, input.screens.length),
    name: s.name,
    rect: { x: s.x, y: s.y, width: s.width, height: s.height },
    canvasX: s.x,
    canvasY: s.y,
    accent: screenAccent(undefined, i),
  }));
}

/** Last frame built, reused while the inputs it depends on are the same objects. Only counters change per frame. */
let cache: { key: readonly unknown[]; frame: CalibrationFrame } | null = null;

export function calibrationFrameFor(input: FrameInput): CalibrationFrame {
  const { mode, logoByMode } = useCalibrationSource.getState();
  const logoMode = logoByMode[mode];
  const key = [input.context?.mapping ?? input.screens, input.width, input.height, input.fps, mode, logoMode];
  if (cache && cache.key.length === key.length && cache.key.every((v, i) => v === key[i])) return cache.frame;
  const frame = buildCalibrationFrame({
    width: input.width,
    height: input.height,
    screens: masterScreens(input),
    mode,
    logo: { mode: logoMode, aspect: CAL_LOGO_ASSET.width / CAL_LOGO_ASSET.height },
    fps: input.fps,
  });
  cache = { key, frame };
  return frame;
}

export const calibrationSource: FrameSource = {
  id: "calibration-test-card",
  name: "Calibration test card",
  draw(ctx, input, { scale }) {
    void prepareCalibrationSource();
    const frame = calibrationFrameFor(input);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Master pixels no screen covers stay black, as on the wall.
    ctx.fillStyle = CAL_COLORS.black;
    ctx.fillRect(0, 0, Math.ceil(input.width * scale), Math.ceil(input.height * scale));
    const options = { scale, fontFamily, logo, frame: input.frame, fps: input.fps };
    drawCalibration(ctx, frame, options, "static");
    drawCalibration(ctx, frame, options, "counters");
    ctx.restore();
  },
  subscribe(onChange) {
    listeners.add(onChange);
    const unsubscribe = useCalibrationSource.subscribe(onChange);
    return () => {
      listeners.delete(onChange);
      unsubscribe();
    };
  },
};
