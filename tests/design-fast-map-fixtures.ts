import { SEED_LIBRARY_CABINETS, type LibraryCabinet } from "@/domain/cabinets";
import type { Project } from "@/domain/model";
import { mmToUm } from "@/domain/units";
import { cabinetOptions } from "@/components/workspace/cabinet-options";
import type { CabinetChoice } from "@/engines/fast-map";

/** The list from the HP Stage demo (Act 1), as the prototype has it. */
export const HP_STAGE_LIST = `Header 8x1 P3.9
Torre izq 2x6 P3.9 | Cuchilla izq 1x2 500x1000 P3.9 | Centro 5x3 P2.6 | Cuchilla der 1x2 500x1000 P3.9 | Torre der 2x6 P3.9
DJ 4x1 P3.9
Cinta 14x1 P3.9`;

export const SIZE_500 = { widthUm: mmToUm(500), heightUm: mmToUm(500) };

/** Every cabinet a new project offers: generic, catalog and the seeded library, as the dropdowns list them. */
export function choices(project: Project | null = null, library: readonly LibraryCabinet[] = SEED_LIBRARY_CABINETS): CabinetChoice[] {
  return cabinetOptions(project, library);
}

