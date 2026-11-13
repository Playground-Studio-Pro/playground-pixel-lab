import type { ResolvedMapping, ResolvedScreen } from "@/engines/mapping";
import type { Rect } from "@/domain/units";
import type { CalibrationScreen } from "./frame";
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

/**
 * Everything a project can show a calibration frame for. Reads rectangles from `resolveMapping`
 * as they are: no coordinate is computed here.
 */
export function calibrationTargets(mapping: ResolvedMapping): CalibrationTarget[] {
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
      accent: screenAccent(screen.color, index),
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
      screens: indexed.filter(({ screen }) => screen.outputId === output.outputId).map(({ screen, index }) => describe(screen, index, screen.outputRect)),
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
