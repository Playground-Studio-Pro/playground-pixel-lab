# Design Lane Brief

**Objective:** a distinctive, professional look, and an interface users can customize, without ever changing what goes to a physical wall.

Read first:
1. [README](README.md), especially the rules and file ownership.
2. [DESIGN_SYSTEM](../product/DESIGN_SYSTEM.md).
3. [MODULES section 2](../product/MODULES.md#2-customization).

## How the interface works today

**Stack.**
- **Styling:** Tailwind v4 with shadcn/ui components on Base UI. The components are in `src/components/ui/` and were generated, so they're safe to restyle.
- **Fonts:** Inter through `next/font`, with tabular numerals set globally.
- **Icons:** `lucide-react`.

**Tokens.** `src/app/globals.css` is the only source of values.
- **Surfaces:** `--stage`, `--background`, `--panel`, `--popover`, `--card`, `--secondary`, `--muted` and `--accent`.
- **Meaning:**
  - `--primary` is the blue for actions;
  - `--signal` is the cyan for selection and live guides;
  - `--warn` is amber;
  - `--destructive` is red;
  - `--motion` and `--motion-strong` are the Motion Lab violet.
- **Shape:** `--radius` is 6 px.
- **Tailwind:** the `@theme` block maps every token to a utility, such as `bg-panel` and `text-signal`.

**There's only one theme.** It's set in `:root` with no `data-theme` switching, and no user preferences are stored anywhere.

**Layout.**
- **Shell:** fixed, in `components/workspace/app.tsx`:
  - `TopBar` on top;
  - `Explorer` on the left, at 256 px, from the grid `grid-cols-[256px_minmax(0,1fr)_288px]`;
  - `CanvasArea` in the center, holding the header tabs and either the Mapping canvas or Live preview;
  - `Inspector` on the right, at 288 px.
- **Behaviour:** panels can't be resized or collapsed.
- **Top bar:** below 1440 px wide, its align buttons fold into a menu.

**Colors outside the tokens.** These need a decision:

| File | Hardcoded colors | Why they exist | Can a theme change them? |
| --- | --- | --- | --- |
| `components/workspace/workspace-canvas.tsx` | 12 | Konva can't read CSS variables. Selection, guides, labels | Yes, by reading tokens with `getComputedStyle` once per theme change |
| `preview/live-renderer.ts` | 12 | Canvas 2D: guide labels, overlap colors, stage | Yes, the same way. The overlap colors carry meaning, so keep their roles |
| `exports/scene.ts` | 4 | Exported pixel maps | **No.** Exports must look the same under every theme |
| Screen identification colors | `domain/` | Stored per screen in the project | **No.** They're project data |

**Motion Lab design** is in [DESIGN_SYSTEM, Motion Lab](../product/DESIGN_SYSTEM.md#motion-lab). The violet belongs to Motion Lab alone.

**Known inconsistencies** are listed in [DESIGN_SYSTEM](../product/DESIGN_SYSTEM.md#known-inconsistencies).

## How to improve it toward customization

In order. Each step is shippable on its own:

1. **Theme switching through tokens.**
   - Add `[data-theme="..."]` and `[data-density="..."]` blocks in `globals.css` that override token values.
   - Components don't change, because they already use tokens.
   - Start with density, compact or comfortable, by tokenizing control heights and paddings. Then contrast and accent variants.
2. **Preferences store** in a new `src/state/preferences.ts`:
   - holds theme, density, text size, panel sizes and visibility, and the workspace preset;
   - is stored under its own key, never in the project file, and is read before first paint to avoid a flash;
   - wraps storage access in try and catch, falling back to defaults.
3. **Canvas colors from tokens.**
   - Read the needed tokens once with `getComputedStyle(document.documentElement)` when the theme changes.
   - Pass them to Konva and to `LiveRenderer`. Don't read them per frame.
4. **Panels and layout.**
   - Make the explorer and inspector resizable and collapsible, sized from preferences, and add a focus mode that hides both.
   - Check that the canvas viewport refits, since `use-canvas-viewport.ts` watches its size.
5. **Workspace presets:** Mapping, Motion Lab and Present, as named sets of the values above.
6. **A settings surface:** a small popover or dialog. Copy follows DESIGN_SYSTEM: plain, specific, sentence case.

## Rules specific to this lane

- **Exports and pixel maps never change**, under any theme or setting. Check this by exporting the Festival Main Stage PNG before and after; the files should be byte-identical.
- **Content stays brightest.**
- **Accents keep their meaning.** Status is never carried by color alone.
- **Contrast:** WCAG AA in every theme and density.
- **Motion:** 100 to 150 ms responses to user actions. Respect reduced motion. No idle animation.
- **Performance:** no measurable regression in [editor budgets](../development/PERFORMANCE.md#budgets). Theme changes may re-render; frames may not.
- **Browser checks:** at 1280 px and at 1440 px or wider, with Festival Main Stage loaded, in both Mapping and Live preview.
- **Shared files:** coordinate edits to `top-bar.tsx` and `app.tsx` with the core lane (see the README).

## Status

Not started. Update this section in your PRs.
