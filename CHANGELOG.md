# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Desktop output keeps the display awake while held after a reconnect (paused frame on the monitor, waiting for Resume), not only while live, so the LED wall can't go black from display sleep. It is still released while the display is gone.
- Update output (desktop): the control window can send a new session to an open output, and the output window swaps to it without being closed or recreated. Refused while the output waits for its display or is held after a reconnect, so playback never restarts before Resume.
- Desktop output test mode (for O6): the output page sees `pixelLabOutput.testMode` as true only in an unpackaged `--smoke-test` run, so hidden-test-only helpers stay off in packaged builds and normal runs. Main sets it when it creates the window; the page can't change it.
- Output colour requirement: the output display's macOS profile must be sRGB IEC61966-2.1 for the LED processor to receive the MP4's exact RGB values (documented with a physical-session check). The hidden smoke test forces sRGB in Chromium so its pixel probes are deterministic; the app itself doesn't.
- Desktop output reconnect (Phase C, D7): unplugging the output's display hides the window at once and pauses it on the current frame; when the same display comes back and can be identified reliably, the output reappears paused and plays again only after Resume. Lookalike or ambiguous displays never take it over.
- Desktop smoke tests no longer put windows on screen: `test:smoke` runs the output window hidden on a virtual display, and the full-screen check is a separate `test:smoke:output` that needs two explicit keys (three for the laptop screen) and closes each window after 20 s.
- Desktop output window (Phase C, D5): the main process opens an output on a display and closes it with Close, Esc or quit, through validated IPC from the control window, with the open → live → closed states, full screen without taking focus and display sleep blocked only while live. Built-in display only so far, with a black stub page until the Output page lands.
- Desktop output failures (Phase C, D8): a crashed output renderer or a page that stops answering for 5 s marks the output failed and leaves a black or frozen window on the display instead of closing it; Retry reloads it with the same session, and a hung page that recovers goes back to live by itself.
- Desktop app (Electron, macOS Apple Silicon): built, launched and tested offline, with project autosave, project file import and export and MP4 export working inside it. `npm --prefix desktop run pack:mac` makes an unsigned `.app`. Results in `desktop/docs/TEST-RESULTS.md`. No Windows support claimed.
- Export MP4 in the Output Studio: Calibration test card or Depth Studio scene, for the master canvas, an output or a screen, at its exact size. Targets H.264 can't take at their own size are listed with the reason, never scaled. Frame rate, duration, progress and Cancel. Uses the browser H.264 exporter.
- Studios: a switch between Mapping, Content, Engineering and Output. Content, Engineering and Output show their modules' panels, loaded on first use, or an empty state. Depth Studio now lives in the Content Studio.
- Module sources in Live preview: the pattern menu also lists sources from modules. The Depth Studio scene and the calibration test card play across the mapped screens.
- Calibration test card in Live preview: Product Design's identification and calibration frames, built for the master canvas from the resolved mapping, with frame and logo (center, watermark, off) selects in the header.
- Saved module data: projects gain a `modules` section (schema 2), so a module's settings can autosave, undo and travel in the project file. Older files upgrade on open.
- Shared contracts for Sprint 3: the module registry, frame context and the engineering summary that reports read.
- Depth Studio, first milestone: a third canvas mode next to Mapping and Live preview. The Emerald Chamber scene turns a canvas or screen into a window onto a deep room, with ribs of light, a luminous back wall, a polished floor, fog, a light sweep and drifting leaves. It is framed for the master canvas or any screen at its exact aspect ratio, using the screen's physical size when known. Controls: depth, viewer position, particles, light, fog, palette, loop length, content rate and seed, with play, pause and scrub. The 15-second loop is deterministic by frame number. Rendered with WebGL2 and no new dependency. Not yet: saving, full-screen output and export.
- Aurora Gradient, a Live preview pattern: a moving multi-color field with palette presets, editable colors, flow speed and eight directions. It's deterministic by frame number and continuous across screens.
- Cabinet library outside projects: create, edit, duplicate and delete profiles, with supplier, model and optional data-sheet specs (power, weight, LED refresh rate, indoor or outdoor). It starts with the Yestech MG6S P2.6 Indoor. Custom cabinets saved earlier are copied in once.
- Motion Lab V1: a Live preview mode next to Mapping. Six deterministic test patterns (Content Flow, Moving Grid, Horizontal and Vertical Scan, RGB Color Cycle, Frame Counter) drawn across the mapped screens on the Physical, Content and Output views. Play, pause, restart, target content rate (24, 25, 30, 50, 60 fps), speed, measured browser preview rate, late and skipped frames. Shared, conflicting and stage overlaps marked without blocking the preview.
- Example gallery on the start screen: Festival Main Stage, Corporate Keynote, Motion Lab acceptance and a 500-screen stress test. Each opens as a new, editable project. The builders load on first use (1.5 KB gzip).
- Shared contracts for modules, rendering and exports, as types only, with a test showing today's code fits them. See `docs/architecture/CONTRACTS.md`.
- Parallel development setup: four studios, five agent lanes with file ownership, task dependencies and one brief per agent in `docs/agents/`.
- Festival Main Stage example project in `examples/`, a realistic six-screen show for demos and testing, kept in sync with its test fixture.
- Undo and redo for every project edit, with ⌘Z and ⇧⌘Z (Ctrl+Z and Ctrl+Y elsewhere) and toolbar buttons. Rapid arrow-key nudges undo as one step.
- GitHub Actions CI, pull request template and branch conventions.
- Documentation system, roadmap, design direction and performance budgets.
- Repeatable performance tooling in `scripts/perf`.

### Changed
- Inter and JetBrains Mono are bundled under `src/app/fonts/` (SIL OFL 1.1) and loaded with `next/font/local`, so builds no longer need network.
- Package renamed to `playground-pixel-lab`.
- `shadcn` moved to dev dependencies, which clears all 6 production audit findings.
- Session state moved from `.claude/SESSION.md` to a tracked `SESSION.md`.

### Fixed
- Desktop: closing an output no longer leaves macOS's menu bar and Dock hidden while Pixel Lab is in front.
- Desktop: after an output closes, its monitor can be opened again; the panel no longer says another output is already on it.
- Exported MP4s give AVFoundation (QuickTime, Resolume Arena on macOS) their real length and frame rate. Not yet replayed in Arena. Every MP4 exported before this reads as twice as long at half the frame rate there: export it again.
- `npm run typecheck` failed on a clean checkout, because route types were only generated by a build.
- At 1280 px wide, "Unsaved changes" pushed the toolbar until the master resolution overlapped the fit button.
- Live preview labels drew over each other where screens share a corner or a short band, such as a header sharing the top of a wall. Labels are now laid out together: they move aside, and are dropped when there's no room.
- A screen name, columns and rows typed in Add screen were lost after creating a new cabinet from that dialog.

## [0.1.0] - 2026-11-07

### Added
- Projects with local persistence, duplicate, import and export.
- Cabinet library with generic and custom profiles.
- Screen designer with zoom, pan, snapping, alignment, grouping and exact positioning.
- Separate physical, content and output layouts, with validation.
- PNG and SVG pixel maps, JSON manifest, technical report and Resolume preparation package.
