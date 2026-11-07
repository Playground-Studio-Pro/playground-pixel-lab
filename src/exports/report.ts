import type { Project } from "@/domain/model";
import { formatMm } from "@/domain/units";
import type { ResolvedMapping } from "@/engines/mapping";
import type { ValidationIssue } from "@/engines/validation";

export function mdCell(value: string | number): string {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function mdTable(headers: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  return [
    `| ${headers.map(mdCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(mdCell).join(" | ")} |`),
  ].join("\n");
}

/** A human-readable technical mapping report in Markdown. */
export function buildReport(project: Project, mapping: ResolvedMapping, issues: readonly ValidationIssue[], generatedAt: string): string {
  const totalCabinets = mapping.screens.reduce((sum, s) => sum + s.spec.cabinetCount, 0);
  const totalPixels = mapping.screens.reduce((sum, s) => sum + s.spec.totalPixels, 0);
  const cabinetIds = new Set(mapping.screens.map((s) => s.cabinet.id));

  const sections = [
    `# ${project.meta.name}: technical mapping report`,
    [
      project.meta.client && `Client: ${project.meta.client}`,
      project.meta.venue && `Venue: ${project.meta.venue}`,
      `Project revision: ${project.meta.revision}`,
      `Generated: ${generatedAt}`,
    ].filter(Boolean).join("  \n"),
    `## Summary`,
    mdTable(["Item", "Value"], [
      ["Master canvas", `${mapping.master.width} × ${mapping.master.height} px (${mapping.master.sizing})`],
      ["Screens", mapping.screens.length],
      ["Cabinets", totalCabinets],
      ["Mapped LED pixels", totalPixels],
      ["Outputs", mapping.outputs.length],
    ]),
    `Coordinates are whole LED pixels. The origin is top-left, with x to the right and y down.`,
    `## Screens`,
    mdTable(
      ["Screen", "Cabinet", "Arrangement", "Cabinets", "Resolution (px)", "Physical size (mm)", "Stage position (mm)"],
      mapping.screens.map((s) => [
        s.name,
        s.cabinet.name,
        `${s.columns} × ${s.rows}`,
        s.spec.cabinetCount,
        `${s.spec.pixelWidth} × ${s.spec.pixelHeight}`,
        `${formatMm(s.spec.widthUm)} × ${formatMm(s.spec.heightUm)}`,
        `${formatMm(s.stage.x)}, ${formatMm(s.stage.y)}`,
      ]),
    ),
    `## Content mapping (master canvas)`,
    mdTable(
      ["Screen", "Canvas", "X", "Y", "W", "H"],
      mapping.screens.map((s) => [
        s.name,
        mapping.canvases.find((c) => c.canvasId === s.canvasId)?.name ?? "",
        s.masterRect.x,
        s.masterRect.y,
        s.masterRect.width,
        s.masterRect.height,
      ]),
    ),
    `## Content canvases`,
    mdTable(
      ["Canvas", "Origin", "Bounds in master (x, y, w, h)", "Screens"],
      mapping.canvases.map((c) => [
        c.name,
        `${c.originX}, ${c.originY}`,
        c.bounds ? `${c.bounds.x}, ${c.bounds.y}, ${c.bounds.width}, ${c.bounds.height}` : "empty",
        c.screenIds.length,
      ]),
    ),
    `## Output mapping`,
    ...mapping.outputs.flatMap((o) => [
      `### ${o.name}: ${o.width} × ${o.height} px (${o.sizing})`,
      mdTable(
        ["Screen", "X", "Y", "W", "H", "Position"],
        mapping.screens
          .filter((s) => s.outputId === o.outputId)
          .map((s) => [s.name, s.outputRect.x, s.outputRect.y, s.outputRect.width, s.outputRect.height, s.followsContent ? "Follows content" : "Manual"]),
      ),
    ]),
    `## Cabinet profiles`,
    mdTable(
      ["Cabinet", "Size (mm)", "Pixels", "Nominal pitch (mm)"],
      project.cabinets
        .filter((c) => cabinetIds.has(c.id))
        .map((c) => [c.name, `${formatMm(c.widthUm)} × ${formatMm(c.heightUm)}`, `${c.pixelsX} × ${c.pixelsY}`, formatMm(c.nominalPitchUm)]),
    ),
    `## Validation`,
    issues.length === 0
      ? `No issues found.`
      : issues.map((i) => `- **${i.severity}** (${i.code}): ${i.message}`).join("\n"),
  ];
  return sections.join("\n\n") + "\n";
}
