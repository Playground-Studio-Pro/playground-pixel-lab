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

**Pixel maps** are test patterns, not UI: identification colors, one checker square per cabinet, a white 1 px border and corner diagonals.

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
