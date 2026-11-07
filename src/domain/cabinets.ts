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
