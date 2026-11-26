/**
 * Dimension labels from a drawing, as integer micrometres. Pure, exact: decimals are read as strings, never through
 * floating point.
 *
 * Accepted: `3.5`, `3,50 m`, `3.50m`, `6000`, `6000 mm`, `350 cm`. A point or comma is always a decimal mark, never a
 * thousands separator. A label without a unit is read as metres when it has a decimal part or is below 100, and as millimetres
 * when it is a whole number of 100 or more. Either way the unit is reported as assumed, so the interface can say so.
 */

export type DimensionUnit = "m" | "cm" | "mm";

export interface Dimension {
  readonly um: number;
  readonly unit: DimensionUnit;
  /** True when the label has no unit and the unit was inferred from the number. */
  readonly unitAssumed: boolean;
  /** The label as written. */
  readonly text: string;
}

const UM_PER: Record<DimensionUnit, number> = { m: 1_000_000, cm: 10_000, mm: 1_000 };
const PATTERN = /^\s*(\d{1,6})(?:[.,](\d{1,6}))?\s*(m|cm|mm)?\s*$/i;
/** Largest dimension read: 1 km. Anything larger is not a stage dimension. */
const MAX_UM = 1_000_000_000;

/** Reads one dimension label, or null when it isn't one. */
export function parseDimension(text: string): Dimension | null {
  const m = PATTERN.exec(text.replace(/ /g, " "));
  if (!m) return null;
  const [, whole, fraction = "", written] = m;
  const unitAssumed = !written;
  const unit: DimensionUnit = written ? (written.toLowerCase() as DimensionUnit) : fraction || Number(whole) < 100 ? "m" : "mm";
  const per = UM_PER[unit];
  const digits = String(per).length - 1;
  if (fraction.length > digits) return null;
  const um = Number(whole) * per + (fraction ? Number(fraction.padEnd(digits, "0")) : 0);
  if (!Number.isSafeInteger(um) || um <= 0 || um > MAX_UM) return null;
  return { um, unit, unitAssumed, text: text.trim() };
}

/** Micrometres for people: `3.5 m`, `0.25 m`, `12 mm`. Exact to the millimetre shown; never rounded silently. */
export function formatUm(um: number): string {
  const sign = um < 0 ? "-" : "";
  const abs = Math.abs(um);
  if (abs >= 100_000) {
    const metres = Math.floor(abs / 1_000_000);
    const rest = String(abs % 1_000_000).padStart(6, "0").replace(/0+$/, "");
    return `${sign}${metres}${rest ? `.${rest}` : ""} m`;
  }
  const mm = Math.floor(abs / 1000);
  const rest = String(abs % 1000).padStart(3, "0").replace(/0+$/, "");
  return `${sign}${mm}${rest ? `.${rest}` : ""} mm`;
}
