import type { Id } from "@/domain/model";
import type { ResolvedMapping } from "@/engines/mapping";
import { slugify } from "@/exports/gate";
import { buildCalibrationFrame, type CalibrationFrame } from "../calibration/frame";
import { calibrationTargets, screenLetter, type CalibrationTarget } from "../calibration/from-mapping";

/**
 * The guided flow's test cards: identification frames from the calibration card, with every cabinet named after its
 * screen (`C·R3·C12`), one per output at the output's exact resolution and one per screen at its own. Testing one
 * screen keeps the output cards at full size with only that screen drawn, so the rest of the wall stays black.
 * Pure: frames are drawing instructions; `draw.ts` turns them into pixels.
 */

export interface GuidedCard {
  readonly kind: "output" | "screen";
  readonly target: CalibrationTarget;
  readonly frame: CalibrationFrame;
  readonly fileName: string;
}

export function guidedCards(mapping: ResolvedMapping, options: { only: Id | null }): GuidedCard[] {
  const targets = calibrationTargets(mapping, { screenCabinetIds: true });
  const order = new Map(mapping.screens.map((s, i) => [s.screenId, i]));
  const onlyIndex = options.only === null ? null : (order.get(options.only) ?? null);
  const onlyScreen = onlyIndex === null ? null : mapping.screens[onlyIndex];
  const slug = (index: number) => `${screenLetter(index).toLowerCase()}-${slugify(mapping.screens[index].name)}`;
  const frame = (t: CalibrationTarget): CalibrationFrame =>
    buildCalibrationFrame({ width: t.width, height: t.height, screens: t.screens, mode: "identification", logo: { mode: "off", aspect: 1 }, fps: 30 });
  const cards: GuidedCard[] = [];
  mapping.outputs.forEach((o, i) => {
    const t = targets.find((x) => x.space === "output" && x.id === o.outputId)!;
    if (onlyScreen && onlyScreen.outputId !== o.outputId) return;
    const target = onlyScreen ? { ...t, screens: t.screens.filter((s) => s.name === onlyScreen.name && s.cabinetPrefix === screenLetter(onlyIndex!)) } : t;
    const suffix = onlyScreen ? `_${slug(onlyIndex!)}-only` : "";
    cards.push({ kind: "output", target, frame: frame(target), fileName: `test-card_out-${i + 1}${suffix}_${t.width}x${t.height}.png` });
  });
  mapping.screens.forEach((s, i) => {
    if (onlyIndex !== null && i !== onlyIndex) return;
    const t = targets.find((x) => x.id === `screen:${s.screenId}`)!;
    cards.push({ kind: "screen", target: t, frame: frame(t), fileName: `test-card_${slug(i)}_${t.width}x${t.height}.png` });
  });
  return cards;
}
