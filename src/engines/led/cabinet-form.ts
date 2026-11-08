import type { CabinetEnvironment, LibraryCabinet } from "@/domain/cabinets";
import { formatMm, parseMm, parsePx, type Px, type Um } from "@/domain/units";

/** What the user typed in the cabinet form. Lengths in millimetres, pixels as whole numbers. */
export interface CabinetFormText {
  name: string;
  supplier: string;
  model: string;
  width: string;
  height: string;
  pixelsX: string;
  pixelsY: string;
  pitch: string;
  /** Optional data-sheet values. Empty text means "not stated" and is stored as null. */
  maxPower: string; // W, up to 3 decimals
  typicalPower: string; // W, up to 3 decimals
  weight: string; // kg, up to 3 decimals
  refreshRate: string; // Hz, whole number
  environment: "" | CabinetEnvironment;
  datasheetNote: string;
}

export type CabinetFormErrors = Partial<Record<keyof CabinetFormText, string>>;

export type CabinetFormValue = Omit<LibraryCabinet, "id">;

export type CabinetFormResult = { ok: true; value: CabinetFormValue } | { ok: false; errors: CabinetFormErrors };

export const EMPTY_CABINET_FORM: CabinetFormText = {
  name: "",
  supplier: "",
  model: "",
  width: "500",
  height: "500",
  pixelsX: "",
  pixelsY: "",
  pitch: "",
  maxPower: "",
  typicalPower: "",
  weight: "",
  refreshRate: "",
  environment: "",
  datasheetNote: "",
};

export const TEXT_LIMITS = { name: 120, supplier: 120, model: 120, datasheetNote: 2000 } as const;

export function cabinetFormText(entry: CabinetFormValue): CabinetFormText {
  return {
    name: entry.name,
    supplier: entry.supplier,
    model: entry.model,
    width: formatMm(entry.widthUm),
    height: formatMm(entry.heightUm),
    pixelsX: String(entry.pixelsX),
    pixelsY: String(entry.pixelsY),
    pitch: formatMm(entry.nominalPitchUm),
    maxPower: formatThousandths(entry.maxPowerMw),
    typicalPower: formatThousandths(entry.typicalPowerMw),
    weight: formatThousandths(entry.weightG),
    refreshRate: entry.refreshRateHz === null ? "" : String(entry.refreshRateHz),
    environment: entry.environment ?? "",
    datasheetNote: entry.datasheetNote,
  };
}

/** 5700 → "5.7", null → "". Integer thousandths (mW, g) shown as W or kg without float maths. */
export function formatThousandths(value: number | null): string {
  return value === null ? "" : formatMm(value);
}

/**
 * Parses W or kg text with up to 3 decimals into integer thousandths (mW, g).
 * Empty text is null ("not stated"). Returns undefined when the text is invalid.
 */
export function parseThousandths(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(trimmed);
  if (!match) return undefined;
  const value = Number(match[1]) * 1000 + Number((match[2] ?? "").padEnd(3, "0"));
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function optionalThousandths(text: string, what: string, unit: string, errors: CabinetFormErrors, key: keyof CabinetFormText): number | null {
  const value = parseThousandths(text);
  if (value === undefined) {
    errors[key] = `${what} must be ${unit} above 0, with up to 3 decimals, or left empty.`;
    return null;
  }
  return value;
}

function optionalWhole(text: string, what: string, errors: CabinetFormErrors, key: keyof CabinetFormText): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = parsePx(trimmed);
  if (value === null || value <= 0) {
    errors[key] = `${what} must be a whole number above 0, or left empty.`;
    return null;
  }
  return value;
}

function positiveMm(text: string, what: string, errors: CabinetFormErrors, key: keyof CabinetFormText): Um | null {
  const value = parseMm(text);
  if (value === null || value <= 0) {
    errors[key] = `${what} must be millimetres above 0, with up to 3 decimals.`;
    return null;
  }
  return value;
}

function positivePx(text: string, what: string, errors: CabinetFormErrors, key: keyof CabinetFormText): Px | null {
  const value = parsePx(text);
  if (value === null || value <= 0) {
    errors[key] = `${what} must be a whole number above 0.`;
    return null;
  }
  return value;
}

/** Validates the form without rounding: a value that isn't exact is rejected, never adjusted. */
export function parseCabinetForm(text: CabinetFormText): CabinetFormResult {
  const errors: CabinetFormErrors = {};
  const name = text.name.trim();
  if (!name) errors.name = "Enter a cabinet name.";
  for (const key of ["name", "supplier", "model", "datasheetNote"] as const) {
    if (text[key].trim().length > TEXT_LIMITS[key]) errors[key] = `Keep this under ${TEXT_LIMITS[key]} characters.`;
  }
  const widthUm = positiveMm(text.width, "Width", errors, "width");
  const heightUm = positiveMm(text.height, "Height", errors, "height");
  const pixelsX = positivePx(text.pixelsX, "Pixels across", errors, "pixelsX");
  const pixelsY = positivePx(text.pixelsY, "Pixels down", errors, "pixelsY");
  const nominalPitchUm = positiveMm(text.pitch, "Nominal pitch", errors, "pitch");
  const maxPowerMw = optionalThousandths(text.maxPower, "Maximum power", "watts", errors, "maxPower");
  const typicalPowerMw = optionalThousandths(text.typicalPower, "Typical power", "watts", errors, "typicalPower");
  const weightG = optionalThousandths(text.weight, "Weight", "kilograms", errors, "weight");
  const refreshRateHz = optionalWhole(text.refreshRate, "Refresh rate", errors, "refreshRate");
  if (maxPowerMw !== null && typicalPowerMw !== null && typicalPowerMw > maxPowerMw) {
    errors.typicalPower = "Typical power can't be more than maximum power. Check the data sheet.";
  }
  if (Object.keys(errors).length > 0 || widthUm === null || heightUm === null || pixelsX === null || pixelsY === null || nominalPitchUm === null) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      name,
      widthUm,
      heightUm,
      pixelsX,
      pixelsY,
      nominalPitchUm,
      source: "custom",
      supplier: text.supplier.trim(),
      model: text.model.trim(),
      datasheetNote: text.datasheetNote.trim(),
      maxPowerMw,
      typicalPowerMw,
      weightG,
      refreshRateHz,
      environment: text.environment === "" ? null : text.environment,
    },
  };
}
