# Output Engineering Brief

**Objective:** the Output Studio. Getting pixels off the laptop and onto the wall: every export on one contract, full-screen output at each processor's exact size, then video files and NDI.

**Start:**
```sh
cd ~/Play.Code/pixel-lab-agents/output-engineering && claude "Eres el agente Output Engineering. Tu brief es docs/agents/output-engineering.md. Sigue docs/agents/START.md."
```

Worktree `~/Play.Code/pixel-lab-agents/output-engineering`, branch `feature/output-engineering`, dev port 3104.

Read first:
1. [README](README.md), especially file ownership.
2. [CONTRACTS](../architecture/CONTRACTS.md): the export and rendering contracts.
3. [OVERVIEW, Motion Lab](../architecture/OVERVIEW.md#motion-lab).
4. [RESOLUME](../integrations/RESOLUME.md) and [MODULES section 4](../product/MODULES.md#4-candidate-functional-modules).

## What you build on today

**Outputs.** `resolveMapping(project)` lists each output's size and screens. Each screen's `outputRect` is where it sits in its processor input, in pixels. Festival Main Stage has outputs of 3072 × 1920 and 4608 × 1408.

**Exports.**
- **Builders:** `exports/scene.ts` builds a renderer-neutral scene; `renderSvg` and `renderPng` draw it. `buildManifest`, `buildReport` and `buildResolumePackage` are pure. The rasterizer is injected.
- **Gate:** mapping exports are blocked while validation has errors (`exports/gate.ts`). The live preview never is.
- **Actions and menu:** `state/export-actions.ts` runs each export and downloads it. The Export menu is hard-coded in `components/workspace/top-bar.tsx`.

**Preview engine.** Motion Lab draws a `FrameSource` over the master canvas, then copies each screen's `masterRect` into its destination. In the Output view, the destination is the output layout. So a frame of the Output view at scale 1 is exactly what a processor input should receive.

**What doesn't exist yet:** full-screen output, encoding video, a native component, NDI.

## Tasks

| Id | Task | State | Depends on |
| --- | --- | --- | --- |
| O1 | Existing exports onto `ExportEntry`, byte-identical | ✅ Ready | — |
| O2 | Full-screen output to a second display, at one output's exact size | ⏸ | User approval; its Output Studio panel waits for L1 |
| O3 | No-code NDI test: capture the full-screen output with existing NDI tools | ⏸ | O2 |
| O4 | Video encode prototype: WebCodecs and an MP4 muxer | ⏸ | User approval to lift the video exclusion and add a dependency |
| O5 | NDI companion prototype | ⏸ | O3, NDI licence review, user decision |

### O1 Exports on the contract

- **What:** express each existing export as an `ExportEntry` in `src/exports/entries.ts`: Resolume package, PNG, SVG, manifest, report, project file.
- **Runner:** `export-actions.ts` gets one generic runner. It gates with `requiresValidMapping`, builds, zips several files, and downloads.
- **Menu:** keep the current menu working. When L1 lands, the menu reads entries from the registry. Until then, switching `top-bar.tsx` over is a small coordinated edit with Product Design.
- **Proof:** a test in `tests/output-entries.test.ts` shows each entry gives byte-identical files to today's functions, on Festival Main Stage. PNG uses an injected fake rasterizer.
- **No behaviour change:** same file names, same gating, same menu labels.

### O2 Full-screen output

After approval. This is also the recommended next Motion Lab step.
- **What:** open the preview of one output in a window you can move to a second display or a processor input, at exactly the output's pixel size and scale 1. Use the Fullscreen API.
- **Proof:** sampling pixels shows each screen's content lands on its `outputRect` exactly.
- **Metrics:** content FPS and browser FPS shown separately, as today.

### O3 to O5 NDI and video

- **O3:** with O2 running, capture it with NDI's screen capture or OBS with an NDI plugin. Check in Resolume or OBS that pixels arrive one to one. Write the findings in `docs/integrations/ndi.md`.
- **O4:** prototype under `prototypes/output-video/`. Measure:
  - encode speed against real time;
  - the maximum frame size per codec in Chrome and Safari;
  - file size;
  - the muxer's bundle cost.

  Encode at each output's size first, because that's the file a media server plays. Write the findings in `docs/integrations/video-encoding.md`.
- **O5:** only after O3 and the licence review. A localhost helper that republishes browser frames with the NDI SDK. Measure throughput: 1920 × 1080 RGBA at 60 fps is about 500 MB/s raw.

## Rules for this lane

- **Pixel accuracy.** Anything that represents a processor input must match the mapping exactly. Test it by sampling pixels.
- **Gate.** Processor-facing files are blocked while validation has errors.
- **No invented formats.** No Resolume presets until [RESOLUME](../integrations/RESOLUME.md) allows them.
- **Effects stay out of engines.** Encoding, windows, network and native calls live in `src/modules/output/` or `state`, never in `engines`.
- **Visible requirements.** Anything needing a native helper or the network says so and stays off until set up.
- **Measurements.** No claims about speed or quality without them. No new dependencies without the user's approval.

## Status

Not started. Update this section in your PRs.
