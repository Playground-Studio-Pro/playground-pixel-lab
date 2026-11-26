# Resolume Integration

Researched 2026-11-07. First checked in Resolume Arena on 2026-11-24 (O11, below): the slice values and the MP4 cut match there, within the limits listed. On 2026-11-25 a generated Advanced Output preset with one Screen loaded in Arena (below). Nothing else here has been tested, and nothing on Windows.

## O11: checked in Arena 7.28.1 (2026-11-24)

Reported by the Lead Architect from the owner's session: trial version, macOS 26.2, HP 27er at 1920 × 1080, Pixel test project (`tests/fixtures/pixel-test.ts`).

| Check | Result |
| --- | --- |
| **X and Y of a slice** | **They're the slice's centre.** Typing the package's top-left corners shifted all six rectangles in `AdvancedOutput.xml` by exactly half their size (Wall A input at −283, −219 instead of 101, 37). Typing the centres gave exact rectangles, input and output |
| B: master MP4 cut by the slices, on the HP | Matches: 4 native quadrants, offset 0, 0 pixels over 64 of luma |
| A: OUT 1 MP4, 1:1 | Matches: offset 0, 0 pixels over 64 of luma, 68 frames in 2.27 s, loops at 10 s. Probably played through Arena's simple full-screen output, not a slice |
| Output routing | The simple output stays on until Advanced is selected: the display showed the uncut composition until **Output > Disabled** and the Screen's device set to the HP |

**What this doesn't cover**

- Trial version, one project, whole-pixel centres only. Slices with an odd width or height have a centre on half a pixel: the package shows the .5, never rounds it and warns, but **Arena hasn't been checked with one**.
- The calibration card. The pixel grid was only compared full screen, from an MP4 made before the duration fix; also exact.
- Measured from a capture of Arena's window, not from the cable, the display or an LED processor.
- Arena on macOS only. Nothing is claimed for Windows, other versions or Avenue.

**Is the centre documented?** Not in the official pages read on 2026-11-24 ([Advanced Output](https://resolume.com/support/en/advanced-output), [Output Transformation](https://resolume.com/support/en/output-transformation), [Input Selection](https://resolume.com/support/en/input-selection), [Input Maps](https://resolume.com/article/32), [Modifiers and Shortcuts](https://resolume.com/article/51)): none says which point X and Y mean, mentions odd sizes or describes the Output menu. A search summary of [the forum](https://resolume.com/forum/viewtopic.php?p=49205) says centre, and that a top-left option was promised; the thread wasn't read. So this rests on the O11 result: **check the first slice against its guide in any other version.**

`manifest.json` (version 1) and `mapping-report.md` keep top-left corners, which they state: they're Pixel Lab's coordinates for other tools, not values to type.

## Generated preset loaded in Arena 7.28.1 (2026-11-25)

The owner loaded a generated Advanced Output preset for HP Stage (one virtual Screen at 1920 × 1080, eight slices, two of them on the same pixels) in Arena 7.28.1 on macOS. Arena accepted it, and saved it back with **all eight slices unchanged, to the pixel**. The only differences were the preset's internal name, which Arena took from the file name, and XML whitespace (`/>` without a space, an empty last line).

The package's writer (`src/exports/resolume/arena-preset.ts`) now writes that saved form. For HP Stage it gives Arena's saved file byte for byte, apart from the ids. The owner's files stay outside the repo; `tests/fixtures/arena-7.28.1-advanced-output-shape.xml` keeps Arena's structure with synthetic values.

What a preset holds, as Arena saved it: per Screen, a name, two guides, the slices and an `OutputDeviceVirtual`. Per slice, a name, `InputRect` and `OutputRect` as four corners (top left, top right, bottom right, bottom left; top-left corners, not the centres typed in the fields), a 4 × 4 `BezierWarper` grid over the output rectangle at thirds, and a `Homography` whose `src` and `dst` are the output corners.

**Not covered:** several Screens (the writer makes one per output, and the README marks them as not verified), several setups, other versions, Windows, Avenue, a real display chosen as device. Corners are always whole pixels in Pixel Lab; the grid's thirds are written to 10 significant digits, as in the tested file. **Where presets live**, seen on the owner's Mac with Arena 7.28.1 and not documented by Resolume: `~/Documents/Resolume Arena/Presets/Advanced Output/` (it existed, empty, before the test). The file was copied there and loaded from the preset menu at the top left of Output > Advanced Output; Arena listed it without a restart, and re-saved it in the same folder when it was used. Arena's live settings are a separate file, `~/Documents/Resolume Arena/Preferences/AdvancedOutput.xml` (root `ScreenSetup`): never write there. On Windows the folder is probably `Documents\Resolume Arena\Presets\Advanced Output`, unverified. The README says all of this, and to restart Arena if the preset isn't listed.

## What is known

| Finding | Source | Confidence |
| --- | --- | --- |
| Advanced Output presets are `.xml` files in the Resolume documents folder, shareable between machines and between Mac and PC | [Advanced Output](https://resolume.com/support/en/advanced-output) | Official docs. The folder path given is for an old version |
| Resolume staff have said the format is undocumented and not part of the public API | Forum post seen only through a search result summary ([link](https://resolume.com/forum/viewtopic.php?p=101084)). The page itself returned HTTP 403 | Second-hand. Read it directly before relying on it |
| Community tools read this XML; one repo reverse-engineered it from Arena 7.27 and says its output was never opened in Arena | Search results ([ResToAE](https://github.com/AuxVR/ResToAE)) | Unverified. Not used |
| Workflow: match Output Transformation to the supplier's map, then use Match Output Shape on Input Selection | [Input Maps](https://resolume.com/article/32) | Official docs |
| Input Selection has numeric fields, arrow keys nudge 1 px, Shift + arrow 10 px | [Input Selection](https://resolume.com/article/50) | Official docs. Exact field labels aren't listed, nor which point X and Y mean (the centre, O11) |
| Guides load an image at native size from the top left | [Modifiers and Shortcuts](https://resolume.com/article/51) | Official docs |
| Output Transformation is Arena only | [Output Transformation](https://resolume.com/support/en/output-transformation) | Official docs |

## Decision

The package contains slice tables with the centres to type (top-left corners apart, for reference), a CSV, pixel map guides, a JSON manifest, a setup guide and, since 2026-11-25, **a test Arena preset** (`<project>_arena-preset_TEST.xml`). The README tells the operator to save their current setup first, then compare every slice with the tables and guides; the manual steps stay. Native support (`nativePresetSupport`) stays off until the conditions below are all met: steps 1 and 3 are done for one Screen on macOS only.

## Before enabling native presets

All of these are required:

1. Save presets from Arena for known setups (one slice, several slices, several screens, non-zero offsets) and compare them to learn the structure.
2. Generate files that reproduce those presets.
3. Load them in Arena on Mac and Windows, and verify every slice value against the pixel map.
4. Record the tested versions, and show them in the app. Treat other versions as unverified.

Then implement the `supported` variant of `nativePresetSupport` in [`adapter.ts`](../../src/exports/resolume/adapter.ts). This work belongs to [Phase 3](../product/ROADMAP.md#phase-3-resolume-bridge). Back up any existing preset before writing near Resolume's folders.

## First real-world check

O11 checked the slice values. Still to confirm on the first use of the whole guide:

- [ ] The menu and field names in the guide match your Arena version.
- [ ] Slices entered from the table sit exactly on the pixel map with Input and Output Guides loaded.
- [ ] On the wall: all four border edges visible, diagonals meet at the corners, one checker square per cabinet.
