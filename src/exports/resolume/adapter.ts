import type { Project } from "@/domain/model";
import type { ResolvedMapping } from "@/engines/mapping";
import { mdTable } from "../report";

/**
 * Resolume adapter.
 *
 * Native preset generation is deliberately off. Advanced Output presets are XML
 * files, but Resolume doesn't publish the format, and no generated file has been
 * tested in Arena. A writer can be plugged in here once a preset saved by Arena
 * has been analysed and generated files have been loaded and verified.
 * See docs/DECISIONS.md.
 */
export type NativePresetSupport =
  | { readonly status: "unsupported"; readonly reason: string }
  | { readonly status: "supported"; readonly testedVersions: readonly string[]; readonly write: (slices: ResolumeSetup) => string };

export const nativePresetSupport: NativePresetSupport = {
  status: "unsupported",
  reason: "Resolume does not publish the Advanced Output preset format, and generated files have not been tested in Arena.",
};

export interface ResolumeSlice {
  readonly name: string;
  readonly screenName: string;
  /** Input Selection rectangle, in composition pixels. */
  readonly input: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** Output Transformation rectangle, in output pixels. */
  readonly output: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface ResolumeScreenSetup {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly slices: readonly ResolumeSlice[];
}

export interface ResolumeSetup {
  readonly composition: { readonly width: number; readonly height: number };
  readonly screens: readonly ResolumeScreenSetup[];
}

/** Translates the mapping into Resolume's terms: each video output is a Screen, each LED screen a Slice. */
export function buildResolumeSetup(mapping: ResolvedMapping): ResolumeSetup {
  return {
    composition: { width: mapping.master.width, height: mapping.master.height },
    screens: mapping.outputs
      .filter((output) => output.screenIds.length > 0)
      .map((output) => ({
        name: output.name,
        width: output.width,
        height: output.height,
        slices: mapping.screens
          .filter((s) => s.outputId === output.outputId)
          .map((s) => ({
            name: s.name,
            screenName: output.name,
            input: { x: s.masterRect.x, y: s.masterRect.y, width: s.masterRect.width, height: s.masterRect.height },
            output: { x: s.outputRect.x, y: s.outputRect.y, width: s.outputRect.width, height: s.outputRect.height },
          })),
      })),
  };
}

function csvCell(value: string | number): string {
  const text = String(value);
  // Prefix cells a spreadsheet would treat as formulas, then quote per RFC 4180.
  const safe = /^[=+\-@\t\r]/.test(text) && typeof value === "string" ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function buildSlicesCsv(setup: ResolumeSetup): string {
  const header = ["resolume_screen", "slice", "input_x", "input_y", "input_w", "input_h", "output_x", "output_y", "output_w", "output_h"];
  const rows = setup.screens.flatMap((screen) =>
    screen.slices.map((slice) => [
      screen.name,
      slice.name,
      slice.input.x,
      slice.input.y,
      slice.input.width,
      slice.input.height,
      slice.output.x,
      slice.output.y,
      slice.output.width,
      slice.output.height,
    ]),
  );
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export interface GuideFiles {
  readonly masterPng: string;
}

/** The manual setup guide, written with this project's exact values. */
export function buildResolumeGuide(project: Project, setup: ResolumeSetup, files: GuideFiles): string {
  const { width, height } = setup.composition;
  const sliceCount = setup.screens.reduce((sum, s) => sum + s.slices.length, 0);
  const screenSections = setup.screens.flatMap((screen) => [
    `### Screen: ${screen.name} (${screen.width} × ${screen.height} px)`,
    mdTable(
      ["Slice", "Input X", "Input Y", "Input W", "Input H", "Output X", "Output Y", "Output W", "Output H"],
      screen.slices.map((s) => [s.name, s.input.x, s.input.y, s.input.width, s.input.height, s.output.x, s.output.y, s.output.width, s.output.height]),
    ),
  ]);

  return [
    `# Resolume setup: ${project.meta.name}`,
    `Composition **${width} × ${height} px**, ${setup.screens.length} ${setup.screens.length === 1 ? "screen" : "screens"}, ${sliceCount} ${sliceCount === 1 ? "slice" : "slices"}.`,
    `This package has no Resolume preset file. Resolume doesn't publish that format, so you enter the values below by hand and check them against the pixel map. Output Transformation requires Arena. Menu and field names can differ between Resolume versions.`,
    `## Files`,
    mdTable(["File", "Use"], [
      [`manifest.json`, "Every coordinate in machine-readable form"],
      [`slices.csv`, "The slice tables below, for a spreadsheet"],
      [files.masterPng, "Test content for the composition, and the Input Selection guide"],
      [`pixelmaps/outputs/`, "Output Transformation guides, one per Resolume screen"],
      [`pixelmaps/screens/`, "One reference image per LED screen"],
      [`mapping-report.md`, "Full technical report"],
      [`project/`, "Project file, to reopen in Pixel Lab"],
    ]),
    `## Slice values`,
    `Input and output sizes are the same for every slice, so content plays back 1:1 with no scaling.`,
    ...screenSections,
    `## Setup`,
    [
      `1. Set the composition size to exactly **${width} × ${height}**.`,
      `2. Open Output > Advanced Output.`,
      `3. Create one Screen for each “Screen” heading above, and choose the matching device as its output.`,
      `4. On **Output Transformation**, create one slice per table row and name it. Select each slice and type its Output X, Y, W and H into the numeric fields on the right.`,
      `5. Switch to **Input Selection**. Select all slices, right-click and choose **Match Output Shape**, so that input and output start identical.`,
      `6. Still on Input Selection, select each slice and type its Input X, Y, W and H.`,
      `7. Save the setup from the preset menu at the top left of Advanced Output, so it can be reloaded at the venue.`,
    ].join("\n"),
    `Selecting several slices makes the numeric fields describe their combined box, so enter values with one slice selected. Arrow keys nudge the selection by 1 px, and Shift + arrow by 10 px.`,
    `## Check the mapping`,
    [
      `1. Load \`${files.masterPng}\` as a clip in the composition and play it full-frame. Don't scale or reposition it.`,
      `2. In Advanced Output, load the same image as the Input Guide. Guides load at native size from the top-left corner, so each slice should sit exactly on its coloured area.`,
      `3. Load each file from \`pixelmaps/outputs/\` as that screen's Output Guide and check the slices the same way.`,
      `4. On the LED wall, check these points on each screen: its name is readable and not mirrored, the white 1 px border shows on all four edges, the diagonals meet at the corners, and each checkerboard square fills exactly one cabinet.`,
    ].join("\n"),
    `A missing border edge usually means a slice is cropped or offset by a pixel. Uneven diagonals or soft text usually mean the slice is being scaled: compare its input and output sizes with the table.`,
    `## Reference`,
    [
      `- [Input Maps](https://resolume.com/article/32)`,
      `- [Input Selection](https://resolume.com/article/50)`,
      `- [Modifiers and Shortcuts](https://resolume.com/article/51)`,
      `- [Advanced Output](https://resolume.com/support/en/advanced-output)`,
    ].join("\n"),
  ].join("\n\n") + "\n";
}
