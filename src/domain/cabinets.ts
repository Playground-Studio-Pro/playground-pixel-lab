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

/**
 * A cabinet profile kept in the browser's cabinet library, outside any project.
 * The supplier fields live only in the library: a project stores a plain
 * `CabinetProfile` copy (see `toProjectCabinet`), so project files stay unchanged.
 * Empty strings mean "not stated". Never fill them with guessed values.
 */
export interface LibraryCabinet extends CabinetProfile {
  readonly source: "custom";
  readonly supplier: string;
  readonly model: string;
  /** Free text from the data sheet: variant, revision, values not modelled yet. */
  readonly datasheetNote: string;
}

/** The copy a project stores: the profile fields only. */
export function toProjectCabinet(entry: LibraryCabinet): CabinetProfile {
  const { id, name, widthUm, heightUm, pixelsX, pixelsY, nominalPitchUm } = entry;
  return { id, name, widthUm, heightUm, pixelsX, pixelsY, nominalPitchUm, source: "custom" };
}

/**
 * Seeded into a new cabinet library once. The user may edit or delete it.
 * Values: 500 × 500 mm, 192 × 192 px. Nominal pitch 2.604 mm (500 mm ÷ 192 px = 2.6041… mm).
 * Weight, power and refresh rate are deliberately not stored until there are fields for them (E2).
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
  datasheetNote: "Indoor. Pitch is nominal: 500 mm ÷ 192 px = 2.6042 mm. Weight, power and refresh rate aren't stored here; read them from the Yestech data sheet.",
};

export const SEED_LIBRARY_CABINETS: readonly LibraryCabinet[] = [YESTECH_MG6S_P26_INDOOR];
