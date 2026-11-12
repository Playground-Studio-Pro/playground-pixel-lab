# Design System

Direction for the visual system. Tokens live in [`src/app/globals.css`](../../src/app/globals.css), which is the source of truth for values.

## Direction

Pixel Lab should feel like a premium professional audiovisual tool, the kind of software trusted at front of house. It is a dark workspace where the only bright thing is the content.

| Principle | In practice |
| --- | --- |
| Dark production workspace | Comfortable in a dark venue. Panels stay quiet and recede |
| Bright content previews | Content is the most luminous element on screen. The UI never competes with it |
| Vibrant blue, violet and cyan | Accents carry meaning: blue for actions, cyan for selection and live guides, violet reserved for Motion Lab |
| High contrast | All text meets WCAG AA. Status is never carried by color alone |
| Precise technical typography | Tabular numerals on every value. Dimensions and coordinates are easy to scan and compare |
| Elegant microinteractions | Short, responsive to the user's action, and never delaying work |
| Clean panels and inspectors | Density over decoration. Borders separate; shadows and gradients don't |
| Professional, not playful | Plain, specific copy. Errors state what happened and how to fix it |

**Avoid:** generic SaaS dashboards, identical rounded cards, KPI tiles, decorative gradients and glow, animation that doesn't respond to an action.

## Foundations

**Brand source:** the Playground design system (Inter and Satoshi; navy `#1A2E7A`, indigo `#3B3FD4`, blue `#2F6FE4`, cyan `#3EC1E3`, violet `#5B4FE0`; ink `#0C0C14`).

**Surfaces, from back to front:** stage `#07080F`, background `#0C0C14`, panel `#12131E`, popover `#181A27`.

**Accents:** `--primary` blue, `--signal` cyan, `--warn` amber, `--destructive` red.

**Type:** Inter, with tabular numerals set globally. Interface text is 13 px, secondary text is 12 px, and exported maps use Arial so they render the same on any machine.

**Shape:** 6 px radius (`--radius`), 4 px on dense controls.

**Layout:** left explorer, center canvas, right inspector, top actions.

**Motion:** 100 to 150 ms for responses to user actions. Respects reduced motion.

**Pixel maps** are test patterns, not UI: identification colors, one checker square per cabinet, a white 1 px border and corner diagonals. The Preview dialog no longer shows them: see [Screen identification and calibration](#screen-identification-and-calibration).

## Motion Lab

Violet is reserved for Motion Lab and marks live playback. Tokens: `--motion` `#9B87FF` for text and icons, and `--motion-strong` `#5B4FE0` for fills such as the active Play button, with white icons.

| Element | Treatment |
| --- | --- |
| Canvas header | One strip above the canvas: Mapping or Live preview, then playback controls only in Live preview. A violet dot on the Live preview tab pulses while playing, unless reduced motion is set |
| Readouts | In the status bar: frame number, timecode, target rate, measured preview rate, late and skipped. Tabular numerals. Preview rate is always labeled as the browser's |
| Content palette | Bright and saturated, chosen for LED: cyan `#3EC1E3`, blue `#2F6FE4`, violet `#7B61FF`, magenta `#FF3DC8`, white, on deep navy `#070B24` |
| Guides | 1 px white screen outlines, cyan when selected. Labels sit on a dark backing so they read over bright content |
| Overlaps | Diagonal hatch with an outline. Violet dashed for shared, red for conflicts, amber for stage overlaps. Color is never the only signal: each mark has a text label when there's room, and conflicts also appear under Checks |
| Pixels | Enlarged LED pixels are drawn square and sharp; reduced ones are smoothed |

Content is the only bright thing on screen, as everywhere in the product: controls stay in the quiet panel colors.

## Screen identification and calibration

The Preview dialog shows two kinds of frame for the master canvas, each output and each single screen. They replace the checkerboard preview as what a technician looks at; the exported pixel maps are unchanged.

| Mode | Answers | Shows |
| --- | --- | --- |
| Identification | Which screen is this, and is it the right way up? | A dark field tinted with the screen's accent, cabinet seams, the identifier and name above center, resolution, canvas coordinates and output below, and the logo |
| Calibration | Is every pixel where it should be? | A black field, grid, center crosshair, reference patches, frame counter and compact metadata in the corners |

**Code:** `src/components/shell/calibration/`. `tokens.ts` holds every value, `frame.ts` is the pure layout, `draw.ts` paints it, `from-mapping.ts` reads the resolved mapping, and `calibration-view.tsx` with `controls.tsx` is the interface.

**Identifiers.** `SCR-01`, `SCR-02` by screen order, and `OUT 1` by output order. They are display labels, not project ids, and nothing stores them.

**Elements, all on whole pixels:**

| Element | Rule |
| --- | --- |
| Border | 1 px white on the outermost pixels of every edge, in both modes |
| Corner markers | Brackets inset from each corner. The top-left one carries a solid accent square: the origin |
| Orientation | A solid arrow on the top edge with a TOP label. With the origin square, a mirrored or rotated screen shows without reading text |
| Cabinet seams | 2 px straddling each seam: the last pixel of one cabinet and the first of the next |
| Grid | 1 px lines every quarter or half cabinet, when that is a whole number of at least 16 px |
| Center crosshair | 1 px through an odd dimension, 2 px straddling the middle of an even one, with a square reticle |
| Reference patches | Exact `#FF0000`, `#00FF00`, `#0000FF`, white, black with an outline, and 1 px line pairs that turn grey under any scaling |
| Frame counter | Frame number, non-drop timecode and the content rate, labelled CONTENT so it's never read as a browser or panel rate |
| Coordinates | First pixel top-left and last pixel bottom-right, both on the master canvas |

**Type.** JetBrains Mono, loaded through `next/font` and not preloaded. It is monospace, so a label's width is its character count × 0.6 × size, known without a canvas. Sizes follow the square root of a screen's area, kept between one and two shorter sides, so a portrait screen beside a wide wall doesn't get type half the size. Nothing is drawn below 9 px.

**Labels never clip or overlap.** Each label reserves a plate that knocks out the grid behind it. A label that doesn't fit is shortened with an ellipsis, then loses its least important lines, then is dropped. The identifier goes last. Where two screens share pixels, the smaller one owns the shared area and the larger keeps its labels out of it. Screens under 192 px on their shorter side use one centered block, and ribbons one line.

**Color.** Each screen's accent is its project color, lifted toward white until it has 4.5:1 contrast on black. It appears only in the identifier, the origin square, the seams and a 12% field tint. Lines are solid colors mixed over black, never transparent, so each has one exact value. These are content colors: no interface theme changes them.

**Logo.** The Playground Studio horizontal outline logo, `public/brand/playground-studio-outline-white.png`, centered on the frame at its own aspect ratio.

| Setting | Treatment |
| --- | --- |
| Center | 18% of the frame's shorter side, on a black plate that every label and mark stays out of |
| Watermark | 50% of the shorter side at 8% opacity, under the calibration geometry |
| Off | Not drawn |

Each mode remembers its own setting. Identification starts on Center and calibration on Off, since a centered logo covers the crosshair.

**Preview.** Fit snaps edges to device pixels and never draws a line thinner than one, so a reduced preview keeps its lines; it is not pixel-exact. 100% draws one LED pixel per CSS pixel. "Export frame (PNG)" draws at exactly 1:1.

### Handoff

Product Design owns the design and the preview. Three things belong to other lanes and are not built:

| For | What | How |
| --- | --- | --- |
| Content Engineering | Play these frames in Live preview and on outputs | Wrap `buildCalibrationFrame` and `drawCalibration` in a `FrameSource` (`preview/contract.ts`): `draw(ctx, input, options)` builds the frame from `input.width`, `input.height` and `input.screens`, then draws both layers at `options.scale` with `input.frame` and `input.fps`. Cache the built frame by input identity: only counters change per frame. `MotionScreen` carries id, name and rectangle only, so label, output, cabinet and accent need either a wider `MotionScreen` (a contract change, through the Lead Architect) or a lookup the source is given at registration. The logo must be decoded before playback, as the contract requires |
| Output Engineering | Calibration frames in the Export menu and the Resolume package | An `ExportEntry` per mode. `PixelMapScene` has no image node and its text is centered Arial, so either add `image` and left-aligned monospace text to `SceneNode`, or rasterize `CalNode`s directly as `calibration-view.tsx` does. The dialog's own "Export frame (PNG)" is a stopgap until then. An SVG version needs the font embedded or converted to outlines |
| Lead Architect | The mapping canvas still draws the checkerboard | `workspace-canvas.tsx` could take its screen fill and labels from `tokens.ts`. Inconsistency 2 below still applies |

## Known inconsistencies

Found in the audit, recorded for [Phase 1](ROADMAP.md#phase-1-mapping-studio). Only item 9 has been partly fixed so far.

| # | Inconsistency | Where |
| --- | --- | --- |
| 1 | Canvas colors are hardcoded and duplicate CSS tokens (`#3EC1E3`, `#F0695E`, `#E8B04A`) | `workspace-canvas.tsx` |
| 2 | Editor dims content (0.8 and 0.55 brightness) while the export doesn't (1.0 and 0.62), so screens aren't bright and don't match the exported map | `workspace-canvas.tsx`, `scene.ts` |
| 3 | No violet token, though violet is a brand accent | `globals.css` |
| 4 | Two control scales: dense `h-7` in the inspector, default shadcn sizes in dialogs | `fields.tsx`, `dialogs.tsx` |
| 5 | Radius is overridden case by case with `rounded`, on top of component defaults | `components/workspace` |
| 6 | Satoshi, the brand heading face, isn't used | `layout.tsx` |
| 7 | Font sizes mix `text-[13px]` and `text-xs` with no named scale | `components/workspace` |
| 8 | Dialog backdrop blur hides the content behind it, which matters when checking a layout | `ui/dialog.tsx` |
| 9 | The status bar hint truncates. The top bar is fixed: the save status has a fixed width, and below 1440 px the align buttons fold into one menu. It fits from 1200 px up with no overlap | `workspace-canvas.tsx` |
| 10 | The cursor readout keeps the previous view's unit until the pointer moves | `workspace-canvas.tsx` |
| 11 | Microinteractions are component defaults rather than designed | Throughout |
