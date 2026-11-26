import { readFileSync } from "node:fs";
import { BUILTIN_CABINETS } from "@/domain/cabinets";
import { drawnScreen, layoutFromProposal, reconcileGaps, typed, type LaidOutScreen, type ProposedGap, type ProposedScreen } from "@/engines/guided-led";

export const PLENARY_PDF = () => new Uint8Array(readFileSync("tests/fixtures/plenary/plenary-elevation.pdf"));
export const PLENARY_PNG = () => new Uint8Array(readFileSync("tests/fixtures/plenary/plenary-elevation.png"));
export const P391 = BUILTIN_CABINETS.find((c) => c.id === "builtin-500x500-p391")!;

/** The plenary as the owner described it: names, widths in metres, gaps in metres. */
export const PLENARY = {
  names: ["Side left", "Wing left", "Centre", "Wing right", "Side right"],
  widthsUm: [3_500_000, 6_000_000, 14_000_000, 6_000_000, 3_500_000],
  heightUm: 3_500_000,
  gapsUm: [1_000_000, 1_500_000, 1_500_000, 1_000_000],
  columns: [7, 12, 28, 12, 7],
  rows: 7,
  pixels: [896, 1536, 3584, 1536, 896],
};

/**
 * The guided manual path on the PNG: the operator draws the five screens on the image (in image pixels, roughly where
 * they are) and types every value. Returns the confirmed layout.
 */
export function manualPlenary(heightUm = PLENARY.heightUm): { screens: ProposedScreen[]; gaps: ProposedGap[]; layout: readonly LaidOutScreen[] } {
  const boxes = [
    { x: 109, y: 579, width: 192, height: 191 },
    { x: 356, y: 579, width: 328, height: 191 },
    { x: 766, y: 579, width: 765, height: 191 },
    { x: 1612, y: 579, width: 329, height: 191 },
    { x: 1995, y: 579, width: 192, height: 191 },
  ];
  let screens: ProposedScreen[] = [];
  for (const box of boxes) screens.push(drawnScreen(screens, box));
  screens = screens.map((s, i) => ({ ...s, name: typed(PLENARY.names[i]), width: typed(PLENARY.widthsUm[i]), height: typed(heightUm) }));
  const gaps = reconcileGaps(screens, [], 2381).map((g, i) => ({ ...g, um: typed(PLENARY.gapsUm[i]) }));
  // Tops were drawn level: the operator accepts those guesses.
  const accepted = new Set(screens.map((s) => `top:${s.key}`));
  const result = layoutFromProposal(screens, gaps, accepted);
  if (!result.ok) throw new Error(result.questions.map((q) => q.text).join("\n"));
  return { screens, gaps, layout: result.screens };
}
