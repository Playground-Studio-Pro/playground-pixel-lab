/** Readability on any background. Pure: WCAG relative luminance and contrast ratio. */

const HEX = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_BACKGROUND = "#0A0D1C";

/** The two outline colours. Between them, one always stands out from any background. */
export const OUTLINE_LIGHT = "#FFFFFF";
export const OUTLINE_DARK = "#05070F";

export function isHexColor(color: string | undefined): color is string {
  return color !== undefined && HEX.test(color);
}

function luminance(color: string): number {
  const n = Number.parseInt(color.slice(1), 16);
  const linear = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear((n >> 16) & 255) + 0.7152 * linear((n >> 8) & 255) + 0.0722 * linear(n & 255);
}

/** 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The outline that stands out most from a background. */
export function outlineFor(background: string | undefined): string {
  const bg = isHexColor(background) ? background : DEFAULT_BACKGROUND;
  return contrastRatio(OUTLINE_LIGHT, bg) >= contrastRatio(OUTLINE_DARK, bg) ? OUTLINE_LIGHT : OUTLINE_DARK;
}
