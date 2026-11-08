# Functional Modules Lane Brief

**Objective:** modules that turn a mapped show into content and signal: quick videos and stage mockups for pitching ideas, NDI output, and AI video generation sized to every screen.

Read first:
1. [README](README.md), especially the rules and file ownership.
2. [MODULES sections 3 and 4](../product/MODULES.md#3-module-contract).
3. [OVERVIEW, Motion Lab](../architecture/OVERVIEW.md#motion-lab).

## What you build on today

**Every pixel position you need already exists.** Read it; never recompute it.
- **Single source:** `resolveMapping(project)` in `engines/mapping.ts` returns, for each screen:
  - `masterRect`, where its content sits in the master canvas, in pixels;
  - `outputRect`, where it sits in its processor output, in pixels;
  - `stage`, where it hangs physically, in micrometres.
- **Master and outputs:** `mapping.master` holds the master size, and `mapping.outputs` lists each output's size and screens.
- **Example:** Festival Main Stage has a 5120 × 1664 master, outputs of 3072 × 1920 and 4608 × 1408, and screens from 512 × 256 up to 4608 × 128.

**How Motion Lab turns content into screens.** This is the model to reuse.
1. **Patterns:** a pattern is a pure function, `renderPattern(id, { frame, fps, width, height, screens })` in `engines/motion/patterns.ts`. It returns primitives in master pixels and has no canvas or clock.
2. **Drawing:** `preview/draw-pattern.ts` draws those primitives once per frame to an off-screen master image.
3. **Placement:** `preview/live-renderer.ts` copies each screen's `masterRect` into its place in the current view.
   - **Shared regions:** these read identical pixels.
   - **Output view:** it shows exactly the processor output layout.
4. **Time:** the frame number comes from a clock in `engines/motion/clock.ts`. The same frame always gives the same pixels.

So a video of the Output view is a sequence of exactly what a processor input should receive.

**Exports.**
- `exports/scene.ts` builds a renderer-neutral scene, and PNG and SVG draw it.
- The Export menu is in `components/workspace/top-bar.tsx`, with actions in `state/export-actions.ts`.
- Mapping exports are blocked while validation has errors (`exports/gate.ts`). The live preview never is.

**What doesn't exist yet:**
- encoding video or images per frame;
- a native component;
- network access, secrets, a backend;
- a module registry. Today a feature is wired into the shell by hand.

## How to get there

Start with prototypes that answer the risky questions, before building inside the app. Keep each in `prototypes/<name>/` or on its own branch, with a short findings note in `docs/integrations/<name>.md`.

### 1. Quick video and mockups

Needs approval to lift the Phase 2 exclusion on video encoding.

**Prototype.**
- Encode Motion Lab frames with WebCodecs `VideoEncoder` and an MP4 muxer.
- Measure on Festival Main Stage:
  - encode speed against real time;
  - the maximum frame size each codec accepts in Chrome and Safari;
  - file size;
  - the bundle cost of the muxer.
- Encode the Output view at each output's size first. That's the file a media server plays.

**Then build in the app:**
- an "Export video" entry;
- duration, fps and source (master, a canvas, or an output);
- progress, with encoding off the main thread where possible.

**Content per screen:** layouts as pure primitive lists, like patterns, then sliced through the mapping. Inputs are image, logo, text and color.

**Mockup:** a still, then a video, of the Physical view. It already composites screens at their stage positions.

### 2. NDI output

Browsers can't send NDI.

**Test first, without code**, once full-screen output exists:
- capture the full-screen preview with existing NDI tools;
- check in Resolume or OBS that pixels arrive one to one at the output size.

**Prototype a local companion:**
- the browser sends frames to localhost, through a WebSocket or WebRTC;
- a native helper republishes them with the NDI SDK.
- Measure throughput: 1920 × 1080 RGBA at 60 fps is about 500 MB/s raw.

**Before committing to any NDI route:**
- review the NDI SDK licence and branding terms;
- decide between a companion and a desktop shell.

### 3. Video generation

**Design the adapter before choosing a provider.** A small interface: request, poll, result. No provider SDK in the app; providers sit behind the adapter.

**Sizes:**
- generate at the master canvas aspect, or per canvas;
- crop, scale and slice through the mapping, so content flows across screens;
- state any upscaling. Extreme ratios, such as the 36:1 Ribbon, need tiling or wide generation.

**Decisions to bring to the user:**
- whether each user brings their own key, stored locally, or a backend proxy is set up, which arrives before Phase 5;
- which provider;
- cost per generation and content rights;
- how generated media is stored and how big it can get.

## Rules specific to this lane

- **Pixel accuracy:** frames that represent a processor input (Output view, NDI, video per output) must be pixel-exact to the mapping. Test them by sampling pixels, as `motion.test.ts` does for continuity.
- **Pure functions:** content generation is pure. Encoding, network and native calls stay in `src/modules/<name>/` or in `state`, never in `engines`.
- **Project data:** a module that saves data in the project needs the core lane's `modules[id]` schema section. Ask for it; don't add fields yourself.
- **Visible requirements:** anything needing network, a native helper or a key says so in the UI, and stays off until set up.
- **Bundle:** load on first use, and record the chunk size in PERFORMANCE.
- **Measurements:** no claims about speed or quality without them.

## Status

Not started. Update this section in your PRs.
