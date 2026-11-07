# Resolume compatibility

Researched 2026-11-07. Resolume itself was not available on the development machine, so **nothing here has been tested in Resolume**.

## What is known

| Finding | Source | Confidence |
| --- | --- | --- |
| Advanced Output presets are `.xml` files in the Resolume documents folder, shareable between machines and between Mac and PC | [Advanced Output](https://resolume.com/support/en/advanced-output) | Official docs. The folder path given is for an old version |
| Resolume staff have said the format is undocumented and not part of the public API | Forum post seen only through a search result summary ([link](https://resolume.com/forum/viewtopic.php?p=101084)). The page itself returned HTTP 403 | Second-hand. Read it directly before relying on it |
| Community tools read this XML; one repo reverse-engineered it from Arena 7.27 and says its output was never opened in Arena | Search results ([ResToAE](https://github.com/AuxVR/ResToAE)) | Unverified. Not used |
| Workflow: match Output Transformation to the supplier's map, then use Match Output Shape on Input Selection | [Input Maps](https://resolume.com/article/32) | Official docs |
| Input Selection has numeric fields, arrow keys nudge 1 px, Shift + arrow 10 px | [Input Selection](https://resolume.com/article/50) | Official docs. Exact field labels aren't listed |
| Guides load an image at native size from the top left | [Modifiers and Shortcuts](https://resolume.com/article/51) | Official docs |
| Output Transformation is Arena only | [Output Transformation](https://resolume.com/support/en/output-transformation) | Official docs |

## Decision

No preset file is generated. The package contains exact slice tables, a CSV, pixel map guides, a JSON manifest and a setup guide.

## Before enabling native presets

All of these are required:

1. Save presets from Arena for known setups (one slice, several slices, several screens, non-zero offsets) and compare them to learn the structure.
2. Generate files that reproduce those presets.
3. Load them in Arena on Mac and Windows, and verify every slice value against the pixel map.
4. Record the tested versions, and show them in the app. Treat other versions as unverified.

Then implement the `supported` variant of `nativePresetSupport` in `src/exports/resolume/adapter.ts`. Back up any existing preset before writing near Resolume's folders.

## First real-world check

The manual guide hasn't been followed in Resolume yet. On the first use, confirm:

- [ ] The menu and field names in the guide match your Arena version.
- [ ] Slices entered from the table sit exactly on the pixel map with Input and Output Guides loaded.
- [ ] On the wall: all four border edges visible, diagonals meet at the corners, one checker square per cabinet.
