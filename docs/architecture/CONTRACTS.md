# Shared Contracts

The minimum every lane builds against, so four agents can work at once without waiting on each other. Written 2026-11-08 by the Lead Architect.

The contracts are **types only**, in three files. They don't change what the app does today. `tests/contracts.test.ts` shows that existing code fits them unchanged.

| Contract | File | Used by |
| --- | --- | --- |
| Module | `src/modules/contract.ts` | Every studio's features |
| Rendering | `src/preview/contract.ts` | Motion Lab preview, full-screen output, video, mockups |
| Export | `src/exports/contract.ts` | Every entry in the Export menu |

**Ownership.** The Lead Architect owns these files. A change goes through its own small PR, which every lane can see, before anyone builds on it. Adding an optional field is cheap. Renaming or removing one means updating every lane.

**Not a plugin framework.** Modules are listed in code at build time, as a static array. There's no runtime loading, lifecycle or event bus, and none should be added without a measured need.

## The product, in four studios

| Studio | What it's for | Built on today |
| --- | --- | --- |
| Mapping Studio | Screens, cabinets, canvases, outputs, pixel-exact mapping | The current editor: Physical, Content and Output views |
| Content Studio | Content made to each screen's size: templates, layouts, mockups, generated media | `exports/scene.ts`, Motion Lab patterns |
| Engineering Studio | The LED system: cabinet library, processors, ports, power, data-sheet values | `domain/cabinets.ts`, `engines/physical.ts` |
| Output Studio | Getting pixels out: exports, full-screen output, video, NDI, Resolume | `exports/`, `state/export-actions.ts` |

**Motion Lab** is the preview engine all four share. It's not a studio: it plays any `FrameSource` across the mapped screens.

## What every contract relies on

These rules come from [CLAUDE.md](../../CLAUDE.md) and the [OVERVIEW](OVERVIEW.md). They're what makes the contracts safe:

- **One source of coordinates.** `resolveMapping(project)` in `engines/mapping.ts` gives every screen's `masterRect`, `outputRect` and `stage`. Nothing else computes them.
- **One way to edit.** Project changes go through pure functions in `engines/project-ops.ts`, called through `edit()` in `state/store.ts`. That keeps autosave and undo working.
- **One gate.** `validateProject` decides what's valid. Exports for processors check it through `assertExportable`.
- **Named spaces.** `master`, `canvas` and `output` are integer pixels. `stage` is integer micrometres.

## Module contract

```ts
type StudioId = "mapping" | "content" | "engineering" | "output";

interface PixelLabModule {
  id: string;
  name: string;
  studio: StudioId;
  requires?: { network?: boolean; native?: boolean; secrets?: boolean };
  panel?: () => Promise<{ default: ComponentType }>;  // loaded on first use
  exports?: ExportEntry[];
  sources?: FrameSource[];
}
```

**Rules.**
- **Registry.** Modules are listed in one static file, `src/modules/registry.ts`. The Lead Architect creates it in task L1. Until then, build your module's parts and test them; wiring them into the shell waits for L1.
- **Folders.** A module lives in `src/modules/<id>/` for UI and effects, and `src/engines/<id>/` for pure calculation.
- **Mapping is read-only.** Modules read `resolveMapping` and the view model. They never compute mapping values.
- **State.** Module state that isn't saved lives in the module's own store, as `state/motion-store.ts` does. Saved data needs a `modules[id]` section in the project, which the Lead Architect adds in task L2 with a schema bump and migration. Don't add project fields yourself.
- **Requirements are visible.** A module needing network, a native helper or a secret says so and stays off until set up.
- **Bundle.** Panels load on first use. Each module records its chunk size in [PERFORMANCE](../development/PERFORMANCE.md).

## Rendering contract

```ts
interface FrameInput {
  frame: number; fps: ContentFps;
  width: number; height: number;   // master canvas, px
  screens: MotionScreen[];          // each screen's master region
}

interface FrameSource {
  id: string; name: string;
  draw(ctx: CanvasRenderingContext2D, input: FrameInput, options: { scale: number; fontFamily: string }): void;
  /** Optional: calls onChange when settings or loaded media outside FrameInput change the drawing. */
  subscribe?(onChange: () => void): () => void;
}
```

`subscribe` exists so a paused preview redraws when, for example, the test card's logo setting changes or its logo finishes loading. A consumer that exports frames must still wait for a source's media first: the calibration test card provides `prepareCalibrationSource()`.

**How a frame reaches a screen.** This is how Motion Lab works today, and every consumer follows it:

```
FrameSource.draw(frame N)  →  one master image  →  cut by each screen's masterRect
                                                     ├─ Live preview: into the current view's rectangles
                                                     ├─ Full-screen output and NDI: into outputRect, at scale 1
                                                     ├─ Video export: one master or output image per frame
                                                     └─ Mockup: into stage positions in the Physical view
```

**Rules.**
- **Determinism.** The same frame and input draw the same pixels. No clock, randomness or network in `draw`. Load media before playback.
- **Whole master.** A source draws the full master canvas once. Content then flows continuously across screens, and shared regions read identical pixels.
- **Pixel-exact outputs.** At scale 1, an output image must match the mapping exactly. Test it by sampling pixels, as `tests/motion.test.ts` does.
- **Three separate metrics.** Content FPS, browser preview FPS and LED refresh rate never stand in for each other.
- **Today's sources.** Motion Lab patterns fit the contract through `renderPattern` and `drawPattern`; see `tests/contracts.test.ts`. The adapter that registers them is part of L1.

## Export contract

```ts
interface ExportInput {
  project: Project; mapping: ResolvedMapping; issues: ValidationIssue[];
  generatedAt: string;                               // injected
  rasterize: (scene: PixelMapScene) => Promise<Blob>; // injected
}

interface ExportEntry {
  id: string;
  label: string;                  // "Mapping manifest (.json)"
  requiresValidMapping: boolean;  // processor-facing files
  build(input: ExportInput): Promise<ExportFile[]>;  // { path, content }
}
```

**Rules.**
- **Pure builders.** `build` takes everything it needs from its input. The browser parts (rasterizing, downloading, zipping) are injected or done by the caller in `state/export-actions.ts`.
- **Gate.** Anything a processor or media server reads sets `requiresValidMapping`, and calls `assertExportable`.
- **Exports never follow the theme.** Files look the same under every interface setting.
- **No invented formats.** Every format is one we can generate and test. Resolume presets wait for [RESOLUME](../integrations/RESOLUME.md).
- **Proof.** Moving an existing export onto the contract must give byte-identical files, checked by a test.

## Sprint 3 additions

Added 2026-11-12 in PR #12. The lane tasks that use them are in [SPRINT_3](../agents/SPRINT_3.md).

**Studios and registry.**
- `src/modules/catalog.ts` lists the four studios and every module source, as plain data. The shell imports only this, so the initial bundle doesn't grow.
- `src/modules/registry.ts` lists the modules. It's imported only by code that loads on first use: the studio host and the Live preview.
- Each lane declares its module in its own file: `depth-studio/module.ts`, `engineering/module.ts`, `output/module.ts`. Add panels, sources and exports there; nobody edits the registry. `tests/modules.test.ts` checks the catalog and the registry agree.
- A studio shows its modules' panels in the canvas and inspector columns, or an empty state.

**Saved module data.** `project.modules[id] = { version, data }`, from `SCHEMA_VERSION` 2.
- The project schema checks the envelope. Each module parses its own `data`, upgrading older versions of its own format, through `readModuleData(project, id, parse)` in `src/modules/module-data.ts`. Unreadable data reads as `null`, and the module uses its defaults.
- Write with `writeModuleData(id, version, data)`: it goes through `edit()`, so it autosaves and undoes. `data` must be plain JSON.
- A module writes only its own id.

**Frame context.** `FrameInput.context?: { project, mapping }`. Read-only. For sources that label what they draw, such as a test card printing names, resolutions and ports. The Live preview fills it.

## Engineering contract

`src/domain/engineering.ts`, types only. LED Engineering produces an `EngineeringSummary` with `summarizeEngineering(project, mapping)` in `src/engines/led/summary.ts`; the caller injects it into `ExportInput.engineering`, and reports only read it.

```ts
interface EngineeringSummary {
  processors: ProcessorUsage[];   // per processor: outputs, load size, pixels used and capacity, ports
  screens: ScreenEngineering[];   // per screen: cabinets, size, area, pixels, weight, power, voltage, refresh
  totals: EngineeringTotals;      // null where any input is missing
  findings: EngineeringFinding[]; // error, warning, info, with a stable code
  assumptions: Assumption[];
  sources: SourceRef[];           // manufacturer documents, with URL and the date read
  disclaimer: string;
}
```

**Rules.**
- Every hardware value comes from a cited manufacturer source. `null` means not stated, never zero.
- Integer units, named in each field: px, µm, mm², g, mW. Totals are null rather than partial.
- Electrical values are estimates, never a certified design, and the disclaimer travels with them.
- Pixel sizes come from `resolveMapping`, not from the summary's own arithmetic.

## Changing a contract

1. Open an issue or a short PR against the contract file, naming every lane it affects.
2. The Lead Architect merges it first, on its own.
3. Each lane merges `main` into its branch before building on it.
