import type { CabinetProfile } from "./model";
import { mmToUm, px } from "./units";

function generic(id: string, name: string, wMm: number, hMm: number, x: number, y: number, pitchMm: number): CabinetProfile {
  return {
    id: `builtin-${id}`,
    name,
    widthUm: mmToUm(wMm),
    heightUm: mmToUm(hMm),
    pixelsX: px(x),
    pixelsY: px(y),
    nominalPitchUm: mmToUm(pitchMm),
    source: "builtin",
  };
}

/** Generic starting points only. Always confirm against the supplier's data sheet. */
export const BUILTIN_CABINETS: readonly CabinetProfile[] = [
  generic("500x500-p391", "Generic 500×500 P3.91", 500, 500, 128, 128, 3.91),
  generic("500x1000-p391", "Generic 500×1000 P3.91", 500, 1000, 128, 256, 3.91),
  generic("500x500-p26", "Generic 500×500 P2.6", 500, 500, 192, 192, 2.604),
  generic("500x1000-p26", "Generic 500×1000 P2.6", 500, 1000, 192, 384, 2.604),
  generic("1000x500-p595", "Generic 1000×500 P5.95", 1000, 500, 168, 84, 5.95),
];

export type CabinetEnvironment = "indoor" | "outdoor";

/**
 * Optional data-sheet values, per cabinet, in integer units. `null` means "not stated":
 * never fill one with a guessed or typical-for-the-class value. Stored for later
 * engineering calculations (E2); nothing computes with them yet.
 */
export interface CabinetSpecs {
  /** Maximum power draw of one cabinet, in milliwatts. */
  readonly maxPowerMw: number | null;
  /** Typical (average) power draw of one cabinet, in milliwatts. */
  readonly typicalPowerMw: number | null;
  /** Weight of one cabinet, in grams. */
  readonly weightG: number | null;
  /** LED refresh rate from the data sheet, in hertz. Never content FPS or browser FPS. */
  readonly refreshRateHz: number | null;
  readonly environment: CabinetEnvironment | null;
}

/**
 * A cabinet profile kept in the browser's cabinet library, outside any project.
 * The supplier fields and specs live only in the library: a project stores a plain
 * `CabinetProfile` copy (see `toProjectCabinet`), so project files stay unchanged.
 * Empty strings and nulls mean "not stated". Never fill them with guessed values.
 */
export interface LibraryCabinet extends CabinetProfile, CabinetSpecs {
  readonly source: "custom";
  readonly supplier: string;
  readonly model: string;
  /** Free text from the data sheet: variant, revision, values not modelled yet. */
  readonly datasheetNote: string;
}

/** Library-only fields with nothing stated. Used for records saved before a field existed. */
export const EMPTY_LIBRARY_FIELDS: Omit<LibraryCabinet, keyof CabinetProfile> = {
  supplier: "",
  model: "",
  datasheetNote: "",
  maxPowerMw: null,
  typicalPowerMw: null,
  weightG: null,
  refreshRateHz: null,
  environment: null,
};

/** The copy a project stores: the profile fields only. */
export function toProjectCabinet(entry: LibraryCabinet): CabinetProfile {
  const { id, name, widthUm, heightUm, pixelsX, pixelsY, nominalPitchUm } = entry;
  return { id, name, widthUm, heightUm, pixelsX, pixelsY, nominalPitchUm, source: "custom" };
}

/**
 * Seeded into a new cabinet library once. The user may edit or delete it.
 * Values: 500 × 500 mm, 192 × 192 px. Nominal pitch 2.604 mm (500 mm ÷ 192 px = 2.6041… mm).
 * Indoor, as stated. Power, weight and refresh rate stay null: enter them from the data sheet
 * for the exact variant (front-service and cube versions differ).
 */
export const YESTECH_MG6S_P26_INDOOR: LibraryCabinet = {
  id: "library-yestech-mg6s-p26-indoor",
  name: "Yestech MG6S P2.6 Indoor",
  widthUm: mmToUm(500),
  heightUm: mmToUm(500),
  pixelsX: px(192),
  pixelsY: px(192),
  nominalPitchUm: mmToUm(2.604),
  source: "custom",
  supplier: "Yestech",
  model: "MG6S P2.6",
  datasheetNote: "Pitch is nominal: 500 mm ÷ 192 px = 2.6042 mm. Power, weight and refresh rate are left empty: enter them from the Yestech data sheet for the exact variant.",
  maxPowerMw: null,
  typicalPowerMw: null,
  weightG: null,
  refreshRateHz: null,
  environment: "indoor",
};

export const SEED_LIBRARY_CABINETS: readonly LibraryCabinet[] = [YESTECH_MG6S_P26_INDOOR];

/**
 * A cabinet from the researched catalog (docs/engineering/LED_HARDWARE_CATALOG.md). Read-only and shipped with the
 * app, so every user sees it without a library reset. A project stores a plain `CabinetProfile` copy
 * (`toProjectCabinet`), marked `builtin` so it can't be edited in place, like the generic profiles.
 * `null` means "not stated by a source": never a guessed value.
 */
export interface CatalogCabinet extends CabinetProfile, CabinetSpecs {
  readonly source: "builtin";
  readonly supplier: string;
  readonly model: string;
  /** Where each value comes from, and that it isn't checked against the manufacturer's PDF yet. */
  readonly datasheetNote: string;
}

const UNCHECKED = "Not checked against the manufacturer's PDF yet (docs/engineering/LED_HARDWARE_CATALOG.md).";

function catalog(entry: Omit<CatalogCabinet, "source" | "widthUm" | "heightUm" | "nominalPitchUm" | "pixelsX" | "pixelsY"> & { wMm: number; hMm: number; x: number; y: number; pitchMm: number }): CatalogCabinet {
  const { wMm, hMm, x, y, pitchMm, ...rest } = entry;
  return { ...rest, widthUm: mmToUm(wMm), heightUm: mmToUm(hMm), pixelsX: px(x), pixelsY: px(y), nominalPitchUm: mmToUm(pitchMm), source: "builtin" };
}

/** Researched cabinets, shown after the generic profiles. Values per the catalog doc, in integer units. */
export const CATALOG_CABINETS: readonly CatalogCabinet[] = [
  catalog({
    id: "catalog-roe-bp2v2",
    name: "ROE Black Pearl BP2V2",
    supplier: "ROE Visual",
    model: "Black Pearl BP2V2",
    wMm: 500, hMm: 500, x: 176, y: 176, pitchMm: 2.84,
    weightG: 9_350,
    maxPowerMw: 190_000,
    typicalPowerMw: 95_000,
    refreshRateHz: null,
    environment: "indoor",
    datasheetNote: `${UNCHECKED} Sources: ROE BP2V2 brochure 2024-02-03 [1], Rentex [2]. 500 × 500 × 90 mm, 176 × 176 px, 2.84 mm, 9.35 kg, 190 / 95 W. ROE has also published 160 / 80 W (older spec sheet) and 185 / 92 W (2021 brochure); the newest, 190 / 95 W, is used until the current PDF confirms it.`,
  }),
  catalog({
    id: "catalog-absen-pl39-v10",
    name: "Absen PL3.9 V10",
    supplier: "Absen",
    model: "PL3.9 V10",
    wMm: 500, hMm: 500, x: 128, y: 128, pitchMm: 3.91,
    weightG: 7_700,
    maxPowerMw: 135_000,
    typicalPowerMw: 45_000,
    refreshRateHz: null,
    environment: "indoor",
    datasheetNote: `${UNCHECKED} Sources: Absen spec sheet V20221201 [7], Full Compass [8]. 500 × 500 × 88 mm, 128 × 128 px, 3.91 mm, 7.7 kg. Power derived from 540 / 180 W/m² × 0.25 m² = 135 / 45 W (the cut sheet may show 680 / 230 W/m²). Refresh 3840 Hz is stated only by a retailer, so it is left empty.`,
  }),
  catalog({
    id: "catalog-unilumin-upad-iv-26",
    name: "Unilumin Upad IV 2.6",
    supplier: "Unilumin",
    model: "Upad IV 2.6",
    wMm: 500, hMm: 500, x: 192, y: 192, pitchMm: 2.6,
    weightG: 6_300,
    maxPowerMw: 120_000,
    typicalPowerMw: 40_000,
    refreshRateHz: null,
    environment: "indoor",
    datasheetNote: `${UNCHECKED} Sources: 4Wall [9], Hartford Rents [10] (distributors). 500 × 500 × 70 mm, 192 × 192 px, 2.6 mm, 6.3 kg, 120 / 40 W. Refresh 3840 Hz is stated only by a distributor, so it is left empty.`,
  }),
  catalog({
    id: "catalog-yestech-mg6s-p26",
    name: "Yestech MG6S P2.6 Indoor",
    supplier: "Yestech",
    model: "MG6S P2.6",
    wMm: 500, hMm: 500, x: 192, y: 192, pitchMm: 2.604,
    weightG: null,
    maxPowerMw: 112_500,
    typicalPowerMw: 37_500,
    refreshRateHz: null,
    environment: "indoor",
    datasheetNote: `${UNCHECKED} Sources: Yestech MG6S series page [12], distributors [13][14]. 500 × 500 × 73 mm, 192 × 192 px, nominal pitch 500 mm ÷ 192 px = 2.604 mm. Power derived from 450 / 150 W/m² × 0.25 m² = 112.5 / 37.5 W. Weight differs by variant (6.7 kg cube, 5.7 kg front service), so it is left empty. Refresh is stated as ≥ 3840 Hz, so it is left empty.`,
  }),
];

/** The plain profile a project stores for a catalog cabinet. */
export function catalogProfile(entry: CatalogCabinet): CabinetProfile {
  const { id, name, widthUm, heightUm, pixelsX, pixelsY, nominalPitchUm } = entry;
  return { id, name, widthUm, heightUm, pixelsX, pixelsY, nominalPitchUm, source: "builtin" };
}

/** Same name and geometry: a library copy of a catalog cabinet (the old Yestech seed) is shown once. */
export function sameCabinetProfile(a: CabinetProfile, b: CabinetProfile): boolean {
  return a.name === b.name && a.widthUm === b.widthUm && a.heightUm === b.heightUm && a.pixelsX === b.pixelsX && a.pixelsY === b.pixelsY && a.nominalPitchUm === b.nominalPitchUm;
}
