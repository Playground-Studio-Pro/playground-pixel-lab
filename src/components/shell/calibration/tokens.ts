/**
 * Design tokens for screen identification and calibration frames.
 *
 * These are content colors, not interface colors: they are drawn on a physical LED wall and written
 * to exported frames, so no theme may change them. Reference values are exact 8-bit primaries.
 */
export const CAL_COLORS = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#FF0000",
  green: "#00FF00",
  blue: "#0000FF",
  /** Secondary text: coordinates, output and cabinet lines. */
  muted: "#A9AEBA",
  /** Outline of the black reference patch, so it reads against a black field. */
  outline: "#5A5F6B",
} as const;

/** How strongly a screen's accent tints each element, as the share of accent mixed into black. */
export const CAL_TINT = {
  /** Identification field: enough to tell screens apart, dark enough for white text. */
  field: 0.12,
  /** Cabinet seams on the identification field. */
  seamOnField: 0.34,
  /** Grid lines inside a cabinet, calibration mode. */
  gridMinor: 0.3,
  /** Cabinet seams, calibration mode. */
  gridSeam: 0.62,
} as const;

/**
 * Size rules, clamped to whole pixels. Geometry (inset, arm, patch, stroke) is relative to a screen's
 * shorter side. Text is relative to the square root of its area, kept between one and two shorter sides.
 */
export const CAL_SCALE = {
  /** Inset of corner markers from the screen edge. */
  inset: { ratio: 1 / 32, min: 3, max: 48 },
  /** Arm length of a corner marker. */
  arm: { ratio: 1 / 10, min: 6, max: 160 },
  /** Metadata text in calibration mode. */
  text: { ratio: 1 / 40, min: 9, max: 40 },
  /** Screen identifier in identification mode. */
  id: { ratio: 0.13, min: 9, max: 220 },
  /** Resolution, coordinates and output in identification mode. */
  idMeta: { ratio: 0.035, min: 9, max: 56 },
  /** Reference patch side. */
  patch: { ratio: 1 / 10, min: 8, max: 192 },
  /** Line weight in identification mode. Calibration lines are always 1 px. */
  identStroke: { ratio: 1 / 512, min: 1, max: 4 },
} as const;

/** Smallest text drawn, in LED pixels. Below this a line is dropped, never shrunk further. */
export const CAL_MIN_TEXT = 9;

/** Advance of one character, as a share of the font size. Exact for the monospace calibration face. */
export const CAL_ADVANCE = 0.6;
/** Baseline below the top of a text box, as a share of the font size. */
export const CAL_BASELINE = 0.78;

/** Logo height as a share of the frame's shorter side. */
export const CAL_LOGO = {
  center: { height: 0.18, maxWidth: 0.5, opacity: 1 },
  watermark: { height: 0.5, maxWidth: 0.8, opacity: 0.08 },
} as const;

/** The Playground Studio horizontal logo, white outline. Aspect ratio is read from the file's own size. */
export const CAL_LOGO_ASSET = { src: "/brand/playground-studio-outline-white.png", width: 2000, height: 624 } as const;

/** Fallback accents for screens whose project color is missing or too dark to read. */
export const CAL_ACCENTS = ["#4F8DF7", "#2BC4B6", "#9B87FF", "#E8B04A", "#5CC46C", "#F0695E", "#C879E0", "#7FB2CC"] as const;

function channels(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb: readonly number[]): string {
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** A solid color: `share` of `hex` over black. Solid, so a line has one exact value and no blending. */
export function tint(hex: string, share: number): string {
  const rgb = channels(hex) ?? [255, 255, 255];
  return toHex(rgb.map((v) => v * share));
}

function luminance([r, g, b]: readonly number[]): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * The accent a screen is drawn with: its project color, lifted toward white until it reads on a
 * dark field (contrast of at least 4.5:1 against black). Falls back to the palette by index.
 */
export function screenAccent(color: string | undefined, index: number): string {
  let rgb = (color && channels(color)) || channels(CAL_ACCENTS[index % CAL_ACCENTS.length])!;
  for (let step = 0; step < 20 && (luminance(rgb) + 0.05) / 0.05 < 4.5; step++) {
    rgb = rgb.map((v) => v + (255 - v) * 0.12) as [number, number, number];
  }
  return toHex(rgb);
}
