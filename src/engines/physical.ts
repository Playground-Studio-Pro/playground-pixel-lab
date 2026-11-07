import type { CabinetProfile, LedScreen } from "@/domain/model";
import { px, um, type Px, type StageRect, type Um } from "@/domain/units";

export interface ScreenSpec {
  readonly pixelWidth: Px;
  readonly pixelHeight: Px;
  readonly widthUm: Um;
  readonly heightUm: Um;
  readonly cabinetCount: number;
  readonly totalPixels: number;
}

/** Screen size comes from whole cabinets only: resolution is cabinet pixels × count, never derived from pitch. */
export function computeScreenSpec(
  screen: Pick<LedScreen, "columns" | "rows">,
  cabinet: Pick<CabinetProfile, "widthUm" | "heightUm" | "pixelsX" | "pixelsY">,
): ScreenSpec {
  const pixelWidth = px(cabinet.pixelsX * screen.columns);
  const pixelHeight = px(cabinet.pixelsY * screen.rows);
  return {
    pixelWidth,
    pixelHeight,
    widthUm: um(cabinet.widthUm * screen.columns),
    heightUm: um(cabinet.heightUm * screen.rows),
    cabinetCount: screen.columns * screen.rows,
    totalPixels: pixelWidth * pixelHeight,
  };
}

export function stageRect(screen: LedScreen, spec: ScreenSpec): StageRect {
  return { x: screen.stageX, y: screen.stageY, width: spec.widthUm, height: spec.heightUm };
}

/** Largest relative difference between nominal pitch and the pitch implied by size ÷ pixels, horizontally or vertically. */
export function pitchDeviation(
  cabinet: Pick<CabinetProfile, "widthUm" | "heightUm" | "pixelsX" | "pixelsY" | "nominalPitchUm">,
): number {
  const dx = cabinet.widthUm / cabinet.pixelsX;
  const dy = cabinet.heightUm / cabinet.pixelsY;
  return Math.max(Math.abs(dx - cabinet.nominalPitchUm), Math.abs(dy - cabinet.nominalPitchUm)) / cabinet.nominalPitchUm;
}
