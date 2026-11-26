import type { ResolvedMapping, ResolvedScreen } from "@/engines/mapping";
import type { Rect } from "@/domain/units";
import { rowLetters, type CalibrationScreen } from "./frame";
import { screenAccent } from "./tokens";

/** One thing a calibration frame can be made for: the master canvas, one output, or one screen. */
export interface CalibrationTarget {
  readonly id: string;
  readonly label: string;
  /** The pixel space the frame is drawn in. A single screen is drawn in its own local pixels. */
  readonly space: "master" | "output" | "screen";
  readonly width: number;
  readonly height: number;
  readonly screens: readonly CalibrationScreen[];
}

/** Display identifiers by screen order: SCR-01, SCR-02. Labels for people, not project ids. */
export function screenLabel(index: number, total: number): string {
  return `SCR-${String(index + 1).padStart(total > 99 ? 3 : 2, "0")}`;
}

/** Screen letters by order, for cabinet ids: A, B, … Z, AA. */
export function screenLetter(index: number): string {
  return rowLetters(index + 1);
}

/**
 * Everything a project can show a calibration frame for. Reads rectangles from `resolveMapping`
 * as they are: no coordinate is computed here.
 */
export function calibrationTargets(mapping: ResolvedMapping, options: { screenCabinetIds?: boolean } = {}): CalibrationTarget[] {
  const total = mapping.screens.length;
  const describe = (screen: ResolvedScreen, index: number, rect: Rect<number>): CalibrationScreen => {
    const outputIndex = mapping.outputs.findIndex((o) => o.outputId === screen.outputId);
    return {
      label: screenLabel(index, total),
      name: screen.name,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      canvasX: screen.masterRect.x,
      canvasY: screen.masterRect.y,
      output: outputIndex >= 0 ? { label: `OUT ${outputIndex + 1}`, name: mapping.outputs[outputIndex].name } : undefined,
      cabinet: { pixelsX: screen.cabinet.pixelsX, pixelsY: screen.cabinet.pixelsY, columns: screen.columns, rows: screen.rows },
      physical: { widthUm: screen.stage.width, heightUm: screen.stage.height },
      accent: screenAccent(screen.color, index),
      ...(options.screenCabinetIds ? { cabinetPrefix: screenLetter(index) } : {}),
    };
  };
  const indexed = mapping.screens.map((screen, index) => ({ screen, index }));
  return [
    {
      id: "master",
      label: "Master canvas",
      space: "master",
      width: mapping.master.width,
      height: mapping.master.height,
      screens: indexed.map(({ screen, index }) => describe(screen, index, screen.masterRect)),
    },
    ...mapping.outputs.map((output, i): CalibrationTarget => ({
      id: output.outputId,
      label: `OUT ${i + 1} · ${output.name}`,
      space: "output",
      width: output.width,
      height: output.height,
      // Every screen, or every part of a split screen, in this output. A part is named “Centre · part 1/2” and its
      // cabinets keep the whole screen's rows and columns, so the cut shows from the audience.
      screens: indexed.flatMap(({ screen, index }) =>
        screen.parts
          .filter((p) => p.outputId === output.outputId)
          .map((p) => {
            const whole = describe(screen, index, p.outputRect);
            if (p.count === 1) return whole;
            return {
              ...whole,
              name: `${screen.name} · part ${p.index}/${p.count}`,
              canvasX: p.masterRect.x,
              canvasY: p.masterRect.y,
              cabinet: { pixelsX: screen.cabinet.pixelsX, pixelsY: screen.cabinet.pixelsY, columns: p.source.width / screen.cabinet.pixelsX, rows: p.source.height / screen.cabinet.pixelsY },
              cabinetStart: { row: p.source.y / screen.cabinet.pixelsY, column: p.source.x / screen.cabinet.pixelsX },
              physical: { widthUm: (p.source.width / screen.cabinet.pixelsX) * screen.cabinet.widthUm, heightUm: (p.source.height / screen.cabinet.pixelsY) * screen.cabinet.heightUm },
            };
          }),
      ),
    })),
    ...indexed.map(({ screen, index }): CalibrationTarget => ({
      id: `screen:${screen.screenId}`,
      label: `${screenLabel(index, total)} · ${screen.name}`,
      space: "screen",
      width: screen.masterRect.width,
      height: screen.masterRect.height,
      screens: [describe(screen, index, { x: 0, y: 0, width: screen.masterRect.width, height: screen.masterRect.height })],
    })),
  ];
}
