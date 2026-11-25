import type { Project } from "@/domain/model";
import type { ResolvedMapping } from "@/engines/mapping";
import { mdCell, mdTable } from "../report";

/**
 * Resolume adapter.
 *
 * Native preset support stays off. Advanced Output presets are XML files whose
 * format Resolume doesn't publish. One generated preset (one Screen) was loaded
 * and saved back by Arena 7.28.1 on macOS, so the package ships one marked as a
 * test (`arena-preset.ts`), next to the manual steps. Several setups, several
 * Screens and Windows are still untested. See docs/integrations/RESOLUME.md.
 */
export type NativePresetSupport =
  | { readonly status: "unsupported"; readonly reason: string }
  | { readonly status: "supported"; readonly testedVersions: readonly string[]; readonly write: (slices: ResolumeSetup) => string };

export const nativePresetSupport: NativePresetSupport = {
  status: "unsupported",
  reason: "Resolume does not publish the Advanced Output preset format. One generated preset with one Screen loaded in Arena 7.28.1 on macOS; several setups, several Screens and Windows haven't been tested.",
};

/** The Arena version these values were typed into and checked with. See docs/integrations/RESOLUME.md. */
export const TESTED_ARENA = "7.28.1";

export interface ResolumeRect {
  /** Top-left corner, as everywhere else in Pixel Lab. Never typed into Arena. */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** What Arena's X and Y fields mean: the slice's centre. Ends in .5 when the size is odd; never rounded. */
  readonly centerX: number;
  readonly centerY: number;
}

export interface ResolumeSlice {
  readonly name: string;
  readonly screenName: string;
  /** Input Selection rectangle, in composition pixels. */
  readonly input: ResolumeRect;
  /** Output Transformation rectangle, in output pixels. */
  readonly output: ResolumeRect;
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

function resolumeRect(r: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): ResolumeRect {
  return { left: r.x, top: r.y, width: r.width, height: r.height, centerX: r.x + r.width / 2, centerY: r.y + r.height / 2 };
}

const wholeCenter = (r: ResolumeRect) => Number.isInteger(r.centerX) && Number.isInteger(r.centerY);

/** Slices whose input or output centre isn't a whole pixel. Arena hasn't been checked with those. */
export function halfPixelSlices(setup: ResolumeSetup): ResolumeSlice[] {
  return setup.screens.flatMap((s) => s.slices).filter((s) => !wholeCenter(s.input) || !wholeCenter(s.output));
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
            input: resolumeRect(s.masterRect),
            output: resolumeRect(s.outputRect),
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

/** The values to type first (centres), then the top-left corners for reference. No column is a bare x or y. */
export function buildSlicesCsv(setup: ResolumeSetup): string {
  const header = [
    "resolume_screen", "slice",
    "input_center_x", "input_center_y", "input_w", "input_h",
    "output_center_x", "output_center_y", "output_w", "output_h",
    "input_left", "input_top", "output_left", "output_top",
  ];
  const rows = setup.screens.flatMap((screen) =>
    screen.slices.map((slice) => [
      screen.name,
      slice.name,
      slice.input.centerX,
      slice.input.centerY,
      slice.input.width,
      slice.input.height,
      slice.output.centerX,
      slice.output.centerY,
      slice.output.width,
      slice.output.height,
      slice.input.left,
      slice.input.top,
      slice.output.left,
      slice.output.top,
    ]),
  );
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export interface GuideFiles {
  readonly masterPng: string;
  /** The test preset, when the package has one. */
  readonly arenaPreset?: string;
}

/** How to try the test preset, and what it was tested with. */
function arenaPresetSection(setup: ResolumeSetup, file: string): string[] {
  const several = setup.screens.length > 1;
  return [
    `## Arena preset (test)`,
    `\`${file}\` holds every Screen and slice above, as an Advanced Output preset. **It's a test.** One preset in this form, with one Screen and eight slices, loaded in **Arena ${TESTED_ARENA}** on macOS: Arena saved it back with every slice unchanged. Other versions, Windows and several setups haven't been tried.`,
    ...(several ? [`> **Not verified: ${setup.screens.length} Screens.** This preset has one Screen per output. Only presets with one Screen have been loaded in Arena. Check every Screen and slice.`] : []),
    [
      `1. **First save your current Advanced Output setup** from the preset menu at the top left of Advanced Output, so you can go back to it.`,
      `2. Copy the file into the folder where Arena keeps its Advanced Output presets, in the Resolume Arena folder of your Documents, and choose it from that preset menu. Pixel Lab never writes into Resolume's folders.`,
      `3. Each Screen's device is a virtual one, so loading the preset never opens a monitor. Choose the real display as each Screen's device, then continue with step 7 of the setup below.`,
      `4. Compare every slice with the tables above and the pixel map guides, as in “Check the mapping”. If anything differs, use the manual setup below and delete the preset.`,
    ].join("\n"),
    `Corners are written as whole pixels, as in the tables. The only other numbers are the 4 × 4 warp grid Arena keeps for each slice, at thirds of its size, written to 10 significant digits as in the tested file. Nothing is warped.`,
  ];
}

/** The manual setup guide, written with this project's exact values. */
export function buildResolumeGuide(project: Project, setup: ResolumeSetup, files: GuideFiles): string {
  const { width, height } = setup.composition;
  const sliceCount = setup.screens.reduce((sum, s) => sum + s.slices.length, 0);
  const screenSections = setup.screens.flatMap((screen) => [
    `### Screen: ${screen.name} (${screen.width} × ${screen.height} px)`,
    mdTable(
      ["Slice", "Input centre X", "Input centre Y", "Input W", "Input H", "Output centre X", "Output centre Y", "Output W", "Output H"],
      screen.slices.map((s) => [s.name, s.input.centerX, s.input.centerY, s.input.width, s.input.height, s.output.centerX, s.output.centerY, s.output.width, s.output.height]),
    ),
  ]);
  const reference = mdTable(
    ["Slice", "Screen", "Input left", "Input top", "Output left", "Output top"],
    setup.screens.flatMap((screen) => screen.slices.map((s) => [s.name, screen.name, s.input.left, s.input.top, s.output.left, s.output.top])),
  );
  const half = halfPixelSlices(setup);

  return [
    `# Resolume setup: ${project.meta.name}`,
    `Composition **${width} × ${height} px**, ${setup.screens.length} ${setup.screens.length === 1 ? "screen" : "screens"}, ${sliceCount} ${sliceCount === 1 ? "slice" : "slices"}.`,
    `${files.arenaPreset ? `This package has a **test** Arena preset (see “Arena preset (test)” below), and the values to enter by hand. Resolume doesn't publish the preset format, so check every slice against the pixel map either way.` : `This package has no Resolume preset file. Resolume doesn't publish that format, so you enter the values below by hand and check them against the pixel map.`} Output Transformation requires Arena. The slice values were checked by hand with **Arena ${TESTED_ARENA}** (trial, macOS); other versions and Windows haven't been. Menu and field names can differ between versions.`,
    `## Files`,
    mdTable(["File", "Use"], [
      [`manifest.json`, "Every coordinate in machine-readable form. Its x and y are top-left corners: don't type them into Resolume"],
      [`slices.csv`, "The slice tables below, for a spreadsheet"],
      ...(files.arenaPreset ? [[files.arenaPreset, "Test Arena preset with these slices. See “Arena preset (test)”"]] : []),
      [files.masterPng, "Test content for the composition, and the Input Selection guide"],
      [`pixelmaps/outputs/`, "Output Transformation guides, one per Resolume screen"],
      [`pixelmaps/screens/`, "One reference image per LED screen"],
      [`mapping-report.md`, "Full technical report. Its X and Y are top-left corners: don't type them into Resolume"],
      [`project/`, "Project file, to reopen in Pixel Lab"],
    ]),
    `## Slice values`,
    `**These are the values to type.** Arena's X and Y fields are the **centre** of the slice, not its top-left corner. Typing a top-left corner there moves the slice by half its size, up and to the left. Input and output sizes are the same for every slice, so content plays back 1:1 with no scaling.`,
    ...(half.length > 0
      ? [
          `> **Warning: half-pixel centres.** ${half.map((s) => `“${mdCell(s.name)}” (${mdCell(s.screenName)})`).join(", ")}: an odd width or height puts the centre on half a pixel (.5). Type the .5 exactly as shown and never round it. Arena was only checked with whole centres, so check these slices on the pixel map, edge by edge, before relying on them.`,
        ]
      : []),
    ...screenSections,
    `### For reference only: top-left corners`,
    `Where each slice starts, as in the pixel maps. Use these to read the guides, not to type into Arena.`,
    reference,
    ...(files.arenaPreset ? arenaPresetSection(setup, files.arenaPreset) : []),
    `## Setup`,
    [
      `1. Set the composition size to exactly **${width} × ${height}**.`,
      `2. Open Output > Advanced Output.`,
      `3. Create one Screen for each “Screen” heading above, and choose the matching device as its output.`,
      `4. On **Output Transformation**, create one slice per table row and name it. Select each slice and type its Output centre X, centre Y, W and H into the X, Y, W and H fields on the right.`,
      `5. Switch to **Input Selection**. Select all slices, right-click and choose **Match Output Shape**, so that input and output start identical.`,
      `6. Still on Input Selection, select each slice and type its Input centre X, centre Y, W and H.`,
      `7. If the display shows the whole composition uncut, Arena's simple output is still on: choose **Output > Disabled**, then check in Advanced Output that the Screen's device is the right display. Seen in Arena ${TESTED_ARENA}.`,
      `8. Save the setup from the preset menu at the top left of Advanced Output, so it can be reloaded at the venue.`,
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
