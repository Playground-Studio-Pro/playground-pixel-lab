/** Numbers and colours as an operator types them. Pure: text in, a valid value or a reason out. */

export interface ValueLimit {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** A refusal keeps the old value and says why. `limited` tells the operator a typed value was brought into range. */
export type Typed<T> = { readonly ok: true; readonly value: T; readonly limited: string | null } | { readonly ok: false; readonly reason: string };

/** The most decimals a typed value keeps, and the most shown. */
const DECIMALS = 3;

const NUMBER = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/;

// Adding zero turns -0 into 0.
const tidy = (value: number) => Number(value.toFixed(DECIMALS)) + 0;

/** Without trailing zeros: 12, 12.5, 0.045. */
export function formatNumber(value: number): string {
  return String(tidy(value));
}

/** A decimal point or comma is accepted, and the unit may be typed after the number. */
export function parseTypedNumber(text: string, limit: ValueLimit, { unit = "", whole = false }: { unit?: string; whole?: boolean } = {}): Typed<number> {
  let body = text.trim();
  if (unit && body.toLowerCase().endsWith(unit.toLowerCase())) body = body.slice(0, -unit.length).trim();
  if (!NUMBER.test(body)) return { ok: false, reason: whole ? "Type a whole number, such as 12." : "Type a number, such as 12.5." };
  const value = Number(body.replace(",", "."));
  if (!Number.isFinite(value)) return { ok: false, reason: "That number is too large." };
  if (whole && !Number.isInteger(value)) return { ok: false, reason: "Type a whole number, such as 12." };
  const suffix = unit ? ` ${unit}` : "";
  if (value < limit.min) return { ok: true, value: limit.min, limited: `The lowest is ${formatNumber(limit.min)}${suffix}.` };
  if (value > limit.max) return { ok: true, value: limit.max, limited: `The highest is ${formatNumber(limit.max)}${suffix}.` };
  return { ok: true, value: tidy(value), limited: null };
}

/** One arrow-key step from what's in the field. Null when the text isn't a number yet. */
export function stepTypedNumber(text: string, steps: number, limit: ValueLimit, options: { unit?: string; whole?: boolean } = {}): string | null {
  const typed = parseTypedNumber(text, limit, options);
  if (!typed.ok) return null;
  return formatNumber(Math.min(limit.max, Math.max(limit.min, typed.value + steps * limit.step)));
}

/** `#RRGGBB`, with or without the `#`. Upper case, as projects store it. */
export function parseTypedColor(text: string): Typed<string> {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(text.trim());
  return match ? { ok: true, value: `#${match[1].toUpperCase()}`, limited: null } : { ok: false, reason: "Type a color as #RRGGBB, such as #5FD08C." };
}
