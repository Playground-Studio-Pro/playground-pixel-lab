# Product Design Brief

**Objective:** a distinctive, professional shell for four studios, and an interface users can customize, without ever changing what goes to a physical wall.

**Start:**
```sh
cd ~/Play.Code/playground.pixel/agents/product-design && claude "Eres el agente Product Design. Tu brief es docs/agents/product-design.md. Sigue docs/agents/START.md."
```

Worktree `~/Play.Code/playground.pixel/agents/product-design`, branch `feature/product-design`, dev port 3101.

Read first:
1. [README](README.md), especially file ownership.
2. [CONTRACTS](../architecture/CONTRACTS.md), "The product, in four studios".
3. [DESIGN_SYSTEM](../product/DESIGN_SYSTEM.md).
4. [MODULES section 2](../product/MODULES.md#2-customization).

## How the interface works today

**Stack.**
- **Styling:** Tailwind v4 with shadcn/ui on Base UI. The components in `src/components/ui/` were generated, so they're safe to restyle.
- **Fonts and icons:** Inter through `next/font`, with tabular numerals set globally. Icons from `lucide-react`.

**Tokens.** `src/app/globals.css` is the only source of values.
- **Surfaces:** `--stage`, `--background`, `--panel`, `--popover`, `--card`, `--secondary`, `--muted`, `--accent`.
- **Meaning:** `--primary` is the action blue, `--signal` the cyan for selection and live guides, `--warn` amber, `--destructive` red, `--motion` and `--motion-strong` the Motion Lab violet.
- **Shape:** `--radius` is 6 px. The `@theme` block maps every token to a utility, such as `bg-panel`.
- **One theme only:** set in `:root`. No `data-theme` switching, and no user preferences stored anywhere.

**Layout.** Fixed, in `components/workspace/app.tsx`, which the Lead Architect owns:
- `TopBar` on top;
- the grid `grid-cols-[256px_minmax(0,1fr)_288px]`: `Explorer`, then `CanvasArea` (header tabs, then the Mapping canvas or Live preview), then `Inspector`;
- panels can't be resized or collapsed. Below 1440 px, the top bar's align buttons fold into a menu.

**Colors outside the tokens:**

| File | Count | Can a theme change them? |
| --- | --- | --- |
| `components/workspace/workspace-canvas.tsx` | 12 | Yes, read from tokens once per theme change. Lead Architect's file: coordinate |
| `preview/live-renderer.ts` | 12 | Yes, the same way. Overlap colors keep their meaning. Lead Architect's file: coordinate |
| `exports/scene.ts` | 4 | **No.** Exports look the same under every theme |
| Screen identification colors | project data | **No** |

## Tasks

| Id | Task | State | Depends on |
| --- | --- | --- | --- |
| D1 | Studio navigation spec | ✅ Ready | — |
| D2 | Theme and density tokens | ✅ Ready | — |
| D3 | Preferences store | ✅ Ready | — |
| D4 | Studio navigation, built | ⏸ | L1, D1 |
| D5 | Canvas colors from tokens | ⏸ | D2, and the Lead Architect's review of the canvas files |
| D6 | Resizable and collapsible panels, focus mode, workspace presets | ⏸ | D3, L1 |
| D7 | Settings surface | ⏸ | D2, D3 |

### D1 Studio navigation spec

A design, not code. Add a "Studios" section to DESIGN_SYSTEM:
- how a user moves between Mapping, Content, Engineering and Output, and where Motion Lab's Live preview sits; it's shared, so it may be reachable from more than one studio;
- what stays fixed across studios (project name, save state, undo, Export) and what each studio swaps (left panel, canvas, inspector, toolbar);
- the empty state of a studio with no modules yet;
- how a module needing network, a native helper or a key shows that it's off;
- an ASCII wireframe per studio, at 1280 px and 1440 px.

Share it with the Lead Architect before L1 builds the minimal switch.

### D2 Theme and density tokens

`[data-theme]` and `[data-density]` blocks in `globals.css` that override token values. Components don't change. Start with density, compact or comfortable, by tokenizing control heights and paddings. Then contrast and accent shades.

### D3 Preferences store

A new `src/state/preferences.ts`:
- holds theme, density, text size, panel sizes and visibility, the workspace preset and the last studio;
- uses its own storage key, never the project file, and is read before first paint to avoid a flash;
- wraps every storage access in try and catch, falling back to defaults;
- has unit tests in `tests/design-preferences.test.ts`.

## Rules for this lane

- **Exports never change.** Export the Festival Main Stage PNG and SVG before and after: the files must be byte-identical.
- **Content stays brightest.** No theme may make the interface compete with the preview.
- **Accents keep their meaning:** cyan for selection and live guides, violet for Motion Lab. A theme may change a shade, not a role. Status is never carried by color alone.
- **Accessibility:** WCAG AA contrast in every theme and density. Respect reduced motion. No idle animation. Responses to actions take 100 to 150 ms.
- **Performance:** no regression in [editor budgets](../development/PERFORMANCE.md#budgets). A theme change may re-render; frames may not.
- **Browser checks:** at 1280 px and at 1440 px or wider, with Festival Main Stage loaded, in Mapping and in Live preview.
- **Shell files:** `app.tsx` and `canvas-header.tsx` belong to the Lead Architect. Propose changes there; don't make them.

## Status

- **Done, in review:** screen identification and calibration frames in the Preview dialog, requested by the user outside D1–D7. Design and handoff notes are in [DESIGN_SYSTEM](../product/DESIGN_SYSTEM.md#screen-identification-and-calibration).
- **Not started:** D1, D2, D3.
- **Files outside this lane's list:** `public/brand/playground-studio-outline-white.png` (new) and `tests/design-calibration.test.ts` (new).
