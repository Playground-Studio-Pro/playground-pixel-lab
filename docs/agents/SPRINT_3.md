# Sprint 3: Production Studio

The owner's brief of 2026-11-12 approved this sprint: Micro Environment Studio, calibration test card, processor intelligence, cabinet engineering and production exports. It supersedes the Sprint 2 list in SESSION and lifts these earlier holds: O2 full-screen output, E2 calculations (now Phase 4 work), and an MP4 investigation (no dependency without approval). Written by the Lead Architect; each lane updates only its own Status line at the bottom.

Workflow the product follows: **Project → Mapping → Content → Engineering → Output → Export.**

## Base: what every lane starts from

Until PR #12 is merged, start from the Lead Architect's branch; after, from `main`:

```sh
git fetch origin && git merge origin/feature/lead-architect   # until #12 merges
git fetch origin && git merge origin/main                     # after
```

PR #12 carries Depth Studio milestone 1 and the Sprint 3 contracts:

| Contract | Where | Use |
| --- | --- | --- |
| Studios and registry | `src/modules/catalog.ts`, `registry.ts`, each lane's `module.ts` | Add a panel, sources and exports in **your own** `module.ts`. Never edit `registry.ts` |
| Saved module data | `project.modules[id]`, schema 2; `src/modules/module-data.ts` | `readModuleData(project, id, parse)`, `writeModuleData(id, version, data)`. Autosaves and undoes |
| Frame context | `FrameInput.context` in `src/preview/contract.ts` | A source can read the project and resolved mapping to label screens |
| Engineering summary | `src/domain/engineering.ts`; `summarizeEngineering` in `src/engines/led/summary.ts` | LED Engineering produces it, reports read it from `ExportInput.engineering` |

Details: [CONTRACTS](../architecture/CONTRACTS.md). Need a contract change? Stop and describe it for the Lead Architect; don't edit the file.

## File ownership for Sprint 3

This replaces the [README table](README.md#file-ownership) where they differ.

| Lane | Owns |
| --- | --- |
| Lead Architect | Contracts, registry, catalog, `module-data.ts`, `studio-host.tsx`, `src/domain/**` except `cabinets.ts`, mapping engines, store, schema, Motion Lab, `app.tsx`, `canvas-area.tsx`, `canvas-header.tsx`, docs it already owns |
| Product Design | As before, plus `src/components/workspace/studio-bar.tsx` and new `src/components/shell/**` |
| Content Engineering | As before, plus `src/engines/depth/**`, `src/modules/depth-studio/**` (including `module.ts` and `source.ts`), `tests/depth-engine.test.ts` |
| LED Engineering | As before: `src/domain/cabinets.ts`, `src/engines/led/**` (including `summary.ts`), `src/modules/engineering/**` (including `module.ts`), `src/persistence/cabinet-library.ts` |
| Output Engineering | As before, plus `src/engines/output/**`, `src/modules/output/**` (including `module.ts`), `public/brand/**` |

Saved module data ids: `depth-studio` (Content), `engineering` (LED), `output` (Output). Each lane writes only its own id and brings its own parser.

## Task allocation

| Id | Lane | Task | Depends on |
| --- | --- | --- | --- |
| L5 | Lead | Contracts, registry, studio switch, schema 2, Depth source in Live preview | Done in #12 |
| L6 | Lead | Integration, demo project, final QA against the acceptance list | Lanes' PRs |
| D8 | Product Design | Shared controls and dashboard primitives, first, in a small PR | #12 |
| D9 | Product Design | Studio navigation (D1 spec, then D4 build) | #12 |
| C6 | Content | Micro Environment Studio and the Frosted Botanical Chamber preset | #12 |
| E5 | LED | Processor library with cited NovaStar specs, capacity and utilization | #12 |
| E6 | LED | Cabinet engineering summary, and `summarizeEngineering` | #12 |
| O6 | Output | Calibration test card with logo modes | #12 |
| O7 | Output | Full-screen output of one output to a second display (was O2) | #12 |
| O8 | Output | Deterministic PNG sequence export | #12 |
| O9 | Output | Technical report (PDF), CSV, PNG diagram, JSON configuration | E6 for real data; fixtures until then |
| O10 | Output | MP4 H.264 investigation, written up; no claim without a played file | Last; deferred if it threatens delivery |

## Integration order

1. **PR #12** (Lead). The owner approves and merges it first; every lane then merges `origin/main`.
2. **D8** (Product Design): small and early, so the other panels adopt the same controls.
3. **E5 + E6** (LED), then **O9** (Output), because the report reads the engineering summary.
4. **C6** (Content) and **O6–O8** (Output) in any order: they don't share files.
5. **D9** (Product Design), after the panels exist, so the navigation is designed around real studios.
6. **L6** (Lead): the end-to-end demo and QA, then SESSION and CHANGELOG.

Each PR: merge `origin/main` first, pass `npm run typecheck && npm run lint && npm test && npm run build`, check in a real browser on the lane's port, list any edit outside owned files, and update the lane's Status line below. Nobody merges their own PR.

## Acceptance criteria

The sprint is done when the Lead Architect can show each of these on one demo project, from a production build:

1. **Mapped project.** A complete show with several screens, canvases and outputs, valid with no errors. Mapping exports unchanged byte for byte against `main`.
2. **Processors.** A NovaStar processor chosen per output group; total, width, height and per-port load against capacity; utilization and remaining capacity; a warning for each overload or unsupported input. Every spec shows its source and the date read. No value without a source.
3. **Cabinets.** Per screen and in total: cabinets, area, resolution, pitch, weight, maximum and typical power, supply voltage and refresh rate where the data sheet gives them, indoor or outdoor. Missing values show as not stated, never zero. Assumptions listed. Electrical values carry the disclaimer.
4. **Test card.** Per screen: name, resolution, crosshair at the exact centre, grid, safe areas, RGB, white and black patches, pixel-exact patterns, frame counter, a motion test, optional port labels. Logo centred with its aspect ratio kept, in Center, Watermark or Off. Pixel samples prove positions.
5. **Frosted Botanical Chamber.** Recognizable ferns, tropical leaves and hanging plants moving in the wind, frosted acrylic, soft interior light, optional rain. Wind, gusts, turbulence, rain, fog and lights have their own controls. The same frame always gives the same image; the loop is seamless. Preview frame rate measured and recorded.
6. **Full-screen output.** One output's exact pixel size on an external display, at scale 1, playing any source. Pixel samples prove each screen lands on its `outputRect`. Content and browser FPS shown separately.
7. **Technical report.** A PDF that opens in a standard viewer, plus CSV, PNG diagram and JSON, from the same data. Called a NovaStar-oriented report, never a NovaStar configuration file.
8. **Deterministic export.** A PNG sequence at exact output size: exporting the same range twice gives identical files; the last frame leads into the first without a jump.

**Never:** invented hardware values, MP4 claimed without a played file, native NovaStar compatibility claimed, browser FPS shown as LED refresh, a dependency added without the owner's approval.

## Agent prompts

The owner pastes one into a new terminal per lane. Agents don't see each other; they coordinate only through this file, their PRs and the Lead Architect.

### Product Design

```sh
cd ~/Play.Code/playground.pixel/agents/product-design && claude "You are the Product Design agent of Playground Pixel Lab. Follow docs/agents/START.md, but your tasks come from docs/agents/SPRINT_3.md, which overrides your brief where they differ: read it fully. Start from the base it gives. Your tasks are D8 then D9. D8, first, as a small PR: shared controls in src/components/ui/ (a labelled range slider with value readout, a colour swatch field, a segmented control) and dashboard primitives in src/components/shell/ (metric tile with unit, capacity bar with used, capacity and remaining, finding list for error, warning and info, source citation line). Base them on the RangeField, CheckRow and ColorField in src/modules/depth-studio/depth-inspector.tsx and on DESIGN_SYSTEM tokens; status never by colour alone. D9: write the Studios section of DESIGN_SYSTEM (D1), then build the studio navigation (D4) on src/components/workspace/studio-bar.tsx, which you now own. Fix the naming clash: the top bar's Physical, Content and Output view switch and the studios Content and Output share words. Propose any change to app.tsx, canvas-header.tsx or studio-host.tsx to the Lead Architect instead of editing them. Check at 1280 and 1440 px on port 3101. Don't change exports."
```

### Content Engineering

```sh
cd ~/Play.Code/playground.pixel/agents/content-engineering && claude "You are the Content Engineering agent of Playground Pixel Lab. Follow docs/agents/START.md, but your task comes from docs/agents/SPRINT_3.md, which overrides your brief where they differ: read it fully, plus docs/architecture/DECISIONS.md entries on Depth Studio and docs/development/PERFORMANCE.md#depth-studio. Start from the base it gives. Task C6: extend Depth Studio, which you now own (src/engines/depth/** and src/modules/depth-studio/**), into a Micro Environment Studio: a living miniature environment inside a frosted acrylic box behind the LED wall. Keep the raw WebGL2 renderer and the off-axis window camera; no Three.js or other dependency. Add a new scene id next to the Emerald Chamber, with config sections for environment (depth, camera, proportions, interior surfaces, background, atmosphere), material (frosted acrylic opacity, translucency, roughness, simulated reflections, interior glow, diffusion, tint), vegetation (procedural ferns, tropical foliage, hanging plants, low vegetation, abstract botanical forms; quantity, scale, placement; stems and leaves bending in the wind), weather (wind direction, intensity, gusts, turbulence; rain intensity, direction, speed; local fog) and lighting (interior lights, colour, intensity, animated movement, highlights, ambient). Independent animation channels for plants, rain, light and atmosphere, all in whole cycles per loop so the loop is seamless; every frame a pure function of config and frame number; seeded randomness only. Use instancing and vertex-shader animation. First preset: Frosted Botanical Chamber, lush tropical plants, subtle wind, soft interior light, gentle reflections, optional rain; it must look like a premium installation, not a particle demo. Keep normalizeDepthConfig clamping every field, keep the source id depth-scene in source.ts, and save the scene in project.modules with id depth-studio through src/modules/module-data.ts. Unit tests for config, loop closure and determinism in tests/depth-engine.test.ts and tests/content-*.test.ts. Measure preview FPS and chunk size before and after, on port 3102, and record them in PERFORMANCE. Screenshots of the preset with and without rain go in your PR."
```

### LED Engineering

```sh
cd ~/Play.Code/playground.pixel/agents/led-engineering && claude "You are the LED Engineering agent of Playground Pixel Lab. Follow docs/agents/START.md, but your tasks come from docs/agents/SPRINT_3.md, which overrides your brief where they differ: read it fully, plus src/domain/engineering.ts, the contract you implement. Start from the base it gives. Tasks E5 and E6. E5: a processor library in src/engines/led/ with NovaStar models (start with current controllers such as the MCTRL and VX series), each value taken from NovaStar's own published specifications and cited as a SourceRef with URL and the date read; anything not published stays null and says so. Never invent or estimate a hardware value; if you can't reach a source, leave the model out and report it. Pure functions: assign project outputs to processors, assign screens to Ethernet ports, and compute total, width, height and per-port load against capacity, utilization and remaining capacity, with EngineeringFinding warnings for overloads and unsupported input sizes. E6: cabinet engineering per screen and in total (count, area, resolution, pitch, weight, maximum and typical power, supply voltage, refresh rate, indoor or outdoor), with integer units and stated assumptions; totals are null when any input is missing; electrical values carry a disclaimer that they are estimates, not a certified design. Specs for the cabinets a project uses are copied into project.modules with id engineering (through src/modules/module-data.ts, with your own parser), so a project stays self-contained; the library schema may gain supply voltage. Replace the body of summarizeEngineering in src/engines/led/summary.ts, keeping its signature. Build the Engineering Studio panel in src/modules/engineering/ and declare it in src/modules/engineering/module.ts; use Product Design's dashboard primitives once merged, existing fields until then. Tests in tests/led-*.test.ts for every formula and edge case. Record every source in docs/integrations/led-processors.md. Check on port 3103."
```

### Output Engineering

```sh
cd ~/Play.Code/playground.pixel/agents/output-engineering && claude "You are the Output Engineering agent of Playground Pixel Lab. Follow docs/agents/START.md, but your tasks come from docs/agents/SPRINT_3.md, which overrides your brief where they differ: read it fully. Start from the base it gives. Order: O6, O7, O8, O9, then O10 only if time allows. O6: replace the placeholder calibration test card in src/modules/output/module.ts (keep the id calibration-test-card) with a FrameSource built from pure primitives in src/engines/output/: per screen its name, resolution, centre crosshair, grid, safe areas, RGB, white and black patches, pixel-exact patterns, frame counter, a motion test and optional port labels read from FrameInput.context. Logo at the exact centre of each screen, aspect ratio kept, modes Center, Watermark and Off, decoded before playback. Ask the owner which Playground Studio logo file to use (candidates are in ~/Play.Code/brandplayground/assets/) before copying it into public/brand/; also accept a user-provided PNG or SVG; never redraw a logo. O7: full-screen output of one output at its exact pixel size and scale 1 on a second display, playing whichever source the Live preview plays, with content FPS and browser FPS shown separately; prove placement by sampling pixels. O8: deterministic PNG sequence export at exact output size for a frame range, written without loading every frame into memory, refusing sizes the GPU can't render without scaling; exporting twice must give identical files. O9: a NovaStar-oriented technical configuration report as PDF, plus CSV mapping data, PNG mapping diagram and JSON configuration, as ExportEntry values in src/exports/, reading ExportInput.engineering (fixtures until LED Engineering's summary lands); never call it a NovaStar configuration file. No new dependency without the owner's approval: prefer a dependency-free PDF and check that it opens in a standard viewer. O10: investigate MP4 H.264 with WebCodecs and write the findings in docs/integrations/video-encoding.md; claim MP4 only after a file has played in a standard player. Panel and exports declared in src/modules/output/module.ts. Tests in tests/output-*.test.ts. Check on port 3104, with a real second display for O7 if one is connected, and say if not."
```

## Status

Each lane edits only its own line.

- **Lead Architect:** L5 done in PR #12. L6 waits for lane PRs.
- **Product Design:** not started.
- **Content Engineering:** not started.
- **LED Engineering:** not started.
- **Output Engineering:** not started.
