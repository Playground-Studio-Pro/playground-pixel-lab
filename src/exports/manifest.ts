import type { Project } from "@/domain/model";
import { formatMm } from "@/domain/units";
import type { ResolvedMapping } from "@/engines/mapping";
import type { ValidationIssue } from "@/engines/validation";

export const MANIFEST_FORMAT = "playground-pixel-lab/mapping-manifest";
export const MANIFEST_VERSION = 1;

const rect = (r: { x: number; y: number; width: number; height: number }) => ({ x: r.x, y: r.y, width: r.width, height: r.height });

/** The machine-readable mapping: every coordinate a downstream tool needs, with units stated. */
export function buildManifest(project: Project, mapping: ResolvedMapping, issues: readonly ValidationIssue[], generatedAt: string) {
  return {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    generatedAt,
    project: {
      id: project.id,
      name: project.meta.name,
      client: project.meta.client,
      venue: project.meta.venue,
      revision: project.meta.revision,
    },
    coordinateSystem: {
      origin: "top-left",
      xAxis: "right",
      yAxis: "down",
      pixelUnit: "integer LED pixels",
      physicalUnit: "millimetres",
    },
    masterCanvas: {
      width: mapping.master.width,
      height: mapping.master.height,
      sizing: mapping.master.sizing,
      contentBounds: mapping.master.contentBounds && rect(mapping.master.contentBounds),
    },
    canvases: mapping.canvases.map((c) => ({
      id: c.canvasId,
      name: c.name,
      origin: { x: c.originX, y: c.originY },
      bounds: c.bounds && rect(c.bounds),
      screenIds: c.screenIds,
    })),
    outputs: mapping.outputs.map((o) => ({
      id: o.outputId,
      name: o.name,
      width: o.width,
      height: o.height,
      sizing: o.sizing,
      screenIds: o.screenIds,
    })),
    screens: mapping.screens.map((s) => ({
      id: s.screenId,
      name: s.name,
      cabinet: {
        id: s.cabinet.id,
        name: s.cabinet.name,
        widthMm: formatMm(s.cabinet.widthUm),
        heightMm: formatMm(s.cabinet.heightUm),
        pixelsX: s.cabinet.pixelsX,
        pixelsY: s.cabinet.pixelsY,
        nominalPitchMm: formatMm(s.cabinet.nominalPitchUm),
      },
      columns: s.columns,
      rows: s.rows,
      cabinetCount: s.spec.cabinetCount,
      resolution: { width: s.spec.pixelWidth, height: s.spec.pixelHeight },
      physical: {
        widthMm: formatMm(s.spec.widthUm),
        heightMm: formatMm(s.spec.heightUm),
        stageXMm: formatMm(s.stage.x),
        stageYMm: formatMm(s.stage.y),
      },
      content: { canvasId: s.canvasId, canvasRect: rect(s.canvasRect), masterRect: rect(s.masterRect), sharesContent: s.allowOverlap },
      output: { outputId: s.outputId, rect: rect(s.outputRect), followsContent: s.followsContent },
    })),
    validation: issues.map((i) => ({ severity: i.severity, code: i.code, message: i.message })),
  };
}

export type MappingManifest = ReturnType<typeof buildManifest>;
