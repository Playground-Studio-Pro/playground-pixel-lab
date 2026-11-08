import type { LibraryCabinet } from "@/domain/cabinets";
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
    datasheetNote: entry.datasheetNote,
  };
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
    },
  };
}
