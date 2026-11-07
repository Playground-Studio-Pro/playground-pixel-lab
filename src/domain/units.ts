/**
 * Units and coordinate systems.
 *
 * Every length in the domain is an integer in an explicit unit, so all layout
 * arithmetic is exact:
 *   Px — whole LED pixels.
 *   Um — whole micrometres (physical lengths, shown to users in millimetres).
 *
 * All coordinate systems have their origin top-left, +x right, +y down.
 *   master — the master canvas (the Resolume composition).
 *   canvas — local to one content canvas.
 *   output — local to one video output.
 *   stage  — the physical stage plan, in micrometres.
 */
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type Px = Brand<number, "Px">;
export type Um = Brand<number, "Um">;

export type PixelSpace = "master" | "canvas" | "output";

export interface Size<U extends number = Px> {
  readonly width: U;
  readonly height: U;
}

export interface Rect<U extends number = number> {
  readonly x: U;
  readonly y: U;
  readonly width: U;
  readonly height: U;
}

/** A rectangle in integer pixels, tagged with the space it is measured in. */
export interface PixelRect<S extends PixelSpace> extends Rect<Px> {
  readonly space: S;
}

export type StageRect = Rect<Um>;

export class UnitError extends RangeError {}

/** Validates that a number is an exact integer pixel value. Never rounds. */
export function px(value: number): Px {
  if (!Number.isSafeInteger(value)) {
    throw new UnitError(`Pixel values must be whole numbers, got ${value}.`);
  }
  return value as Px;
}

/** Validates that a number is an exact integer micrometre value. Never rounds. */
export function um(value: number): Um {
  if (!Number.isSafeInteger(value)) {
    throw new UnitError(`Micrometre values must be whole numbers, got ${value}.`);
  }
  return value as Um;
}

export const UM_PER_MM = 1000;

/** Converts a millimetre number to micrometres. Precision below 1 µm is not representable. */
export function mmToUm(mm: number): Um {
  if (!Number.isFinite(mm)) throw new UnitError(`Invalid millimetre value: ${mm}.`);
  return um(Math.round(mm * UM_PER_MM));
}

export function umToMm(value: Um): number {
  return value / UM_PER_MM;
}

/** Formats micrometres as a millimetre string using integer arithmetic: 499980 → "499.98". */
export function formatMm(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const whole = Math.floor(abs / UM_PER_MM);
  const fraction = abs % UM_PER_MM;
  if (fraction === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${String(fraction).padStart(3, "0").replace(/0+$/, "")}`;
}

/** Parses a user-entered millimetre string (max 3 decimals). Returns null if invalid. */
export function parseMm(input: string): Um | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(input.trim());
  if (!match) return null;
  const whole = Number(match[2]);
  const fraction = Number((match[3] ?? "").padEnd(3, "0"));
  const value = whole * UM_PER_MM + fraction;
  if (!Number.isSafeInteger(value)) return null;
  return um(match[1] === "-" ? -value : value);
}

/** Parses a user-entered whole pixel string. Returns null for fractions or junk. */
export function parsePx(input: string): Px | null {
  if (!/^-?\d+$/.test(input.trim())) return null;
  const value = Number(input);
  return Number.isSafeInteger(value) ? px(value) : null;
}
