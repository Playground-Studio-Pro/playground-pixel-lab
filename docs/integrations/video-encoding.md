# H.264 MP4 export infrastructure

Independent Output Engineering implementation. No dependency added and no shared contracts changed. `src/modules/output/video-export.ts` consumes the existing `FrameSource` at scale 1. `mp4.ts` writes fragmented ISO BMFF with an AVC video track, no audio. It never uses MediaRecorder or WebM.

## Browser verification

From the output-engineering worktree:

```sh
./node_modules/.bin/vite --host 127.0.0.1 --port 3104
```

Open http://127.0.0.1:3104/prototypes/output-video/index.html in a browser with WebCodecs H.264 encoding. Click **Export animated MP4**. Optionally select a local logo first and configure its width/opacity. Leave **Show diagnostic frame counter** unchecked for the seamless-loop demonstration. Check progress reaches 300/300, browser metadata reads 1920×1080 and 10 seconds, and the video plays repeatedly with the loop control. Download it. Start another export and press **Cancel**; it must stop without a completed download. The prototype-only animated test card has horizontal/vertical cosine scans, a true center crosshair, RGB and grayscale references, and a rotating loop-phase indicator. Its default state has no resetting counter. `calibrationMotion` normalizes the frame modulo 300 before evaluating motion, making frame 300 exactly equal to frame 0; frames 0–299 are exported. The optional diagnostic counter deliberately resets from 299 to 0. This demonstration does not copy or replace the shared Calibration Test Card renderer.

```sh
ffprobe -v error -count_frames -show_streams -show_format -of json downloaded.mp4
ffmpeg -v error -i downloaded.mp4 -f null -
```

Expect one H.264 stream, 1920×1080, 30/1 fps, 300 decoded frames, 10 seconds, no audio and no decode errors.

## Integration dependency

Read-only inspected Lead Architect branch `integration/calibration-live-preview` at `e2f1707`. Its `FrameSource` retains `draw` and adds optional context/subscription. No branch was combined. Calibration is unavailable in this checkout. Integration must call `prepareCalibrationSource()` first and provide a source with settings frozen for the export, plus the resolved screens/context. The current calibration source reads mutable UI state during draw; the owner must supply a snapshot adapter before production integration. Do not advertise Calibration export as delivered yet.

Pass integer `frames: 300`, `fps: 30`, dimensions 1920×1080, an AbortSignal and progress callback to `exportMp4`. Frame indices are exactly 0–299; timestamps use rounded microseconds and MP4 duration uses exact FPS ticks. Sources must themselves be periodic over the selected frame count; encoding cannot make arbitrary animation seamless. The first frame is a keyframe. No mapping coordinates are computed by this pipeline. This master-image API does not export processor outputs; future output integration must use resolved mapping and the existing validation gate.

## Limits and verification

Even dimensions only, maximum 4096 per side and 8,847,360 pixels, 24/25/30/50/60 fps, maximum ten minutes. H.264 High level 5.1 support is queried for the exact size/rate before canvas allocation; unsupported devices fail explicitly. No automatic downscaling or format fallback. Encoding errors, missing AVC configuration, reordered/dropped frames, canvas errors and aborts reject the export. Cancellation closes the encoder immediately. Raw storage is bounded to one canvas and at most four submitted frames; compressed fragments remain in memory until download. Very large exports may therefore exhaust compressed-output memory.

Automated tests cover configuration, sample offsets, deterministic indices, progress, cleanup and cancellation. An optional FFmpeg integration test generates 300 actual 1080p AVC frames, muxes with this implementation, verifies metadata/frame count using ffprobe and decodes the entire result. It skips explicitly if FFmpeg/ffprobe are unavailable. Set `PIXEL_SAMPLE_MP4=/tmp/pixel-output-1080p.mp4` when running that test to retain a synthetic sample. This verifies the muxer with real AVC, not device WebCodecs behavior or the Calibration renderer.


## Animated prototype verification (2026-11-12)

Real Chrome headless verification used the existing browser prototype and the unchanged `exportMp4` encoder. The generated `/tmp/pixel-animated-calibration.mp4` was verified with ffprobe: H.264, 1920×1080, 30/1 fps, 300 decoded frames, 10.000000 seconds, one video stream and no audio. File size: 1,121,767 bytes. FFmpeg decoded the full file without errors. Chrome loaded the metadata and played from 9.8 seconds through the loop boundary to 0.54 seconds without pausing. Cancellation returned AbortError. A decoded frame at index 75 was visually inspected.

Pixel comparison on a CPU canvas (`willReadFrequently`, to avoid switching raster backends during readback) gave exact equality for frame 0 vs 300. Mean absolute component difference over all RGBA pixels: 299→0 = 1.05150, 0→1 = 1.05143. This checks continuous motion across the seam, not identical consecutive frames. H.264 compression can introduce small pixel differences; encoded frame 299 is intentionally not a duplicate of frame 0.

Reproduce the browser check without installing packages: start the Vite server above, launch a separate temporary Chrome profile with remote debugging, then run:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-first-run --no-default-browser-check --user-data-dir=/tmp/pixel-output-chrome-verification --remote-debugging-port=9314 about:blank
# In another terminal:
node prototypes/output-video/verify-browser.mjs
```

The check connects only to the temporary browser, compares loop pixels, exports through the actual button, saves the MP4 under `/tmp`, verifies browser playback across the seam and tests cancellation. `PIXEL_ORIGIN`, `PIXEL_CDP` and `PIXEL_SAMPLE_MP4` override its local endpoints/output path. Close that temporary Chrome process when finished. Run `npm test -- tests/output-calibration.test.ts` for the deterministic rendering and geometry checks.

Typecheck, lint and all 245 tests pass. Production build with `npm run build -- --webpack` passes. No encoder, shared-contract, mapping, PNG-export or other-agent files were changed for this prototype update.

## Integration handoff to Lead Architect

- **Entry points:** `exportMp4(options): Promise<Blob>` and `validateVideoSettings(settings)` in `src/modules/output/video-export.ts`; `VideoExportOptions` carries the `FrameSource`, input snapshot, dimensions, fps, frame count, optional preloaded centered logo, AbortSignal and progress callback. `src/modules/output/mp4.ts` is the internal AVC muxer; reuse it through `exportMp4`, not a second encoder. Reference caller: `prototypes/output-video/main.ts`.
- **Real Calibration source:** await `prepareCalibrationSource()` from the integration branch, then obtain an immutable source snapshot from its owner: freeze mode, logo selection, fonts/media and mapping for all 300 frames. The current `calibrationSource` reads `useCalibrationSource.getState()` during draw and its preparation tolerates asset failures; confirm required media loaded before exporting. Use the existing `drawCalibration` renderer through that adapter; do not ship the prototype source as the app's Calibration renderer. Pass resolved master screens and `input.context: { project, mapping }` after integration of the existing Lead Architect contract. `VideoExportOptions.input` derives from `FrameInput`, so the optional context will flow through without an exporter contract change. Select a 1920×1080 master for the acceptance case; do not resize mapping coordinates to force a different master to fit.
- **Output Studio action:** add **Export MP4** to the existing Output module panel, load the encoder on demand, snapshot inputs on click, and call the existing validation gate for mapping/media-server exports. Pass 1920×1080, fps 30 and frames 300 initially. Show `onProgress(encoded,total)`, disable duplicate starts, connect Cancel to `AbortController.abort()`, and abort on panel disposal. Download the returned Blob with an `.mp4` name and release the object URL. Surface support/size/media/encoding errors. The current `ExportEntry` does not carry progress/cancellation; keep that interaction in the panel/controller rather than changing shared contracts implicitly. Registry/shell edits belong to Lead Architect/Product Design.
- **Limits:** secure-context WebCodecs plus exact H.264 High 5.1 configuration support; no fallback encoder, audio or backend. Even sizes ≤4096 per side and ≤8,847,360 pixels; fps 24/25/30/50/60, ≤10 minutes. Raw-frame memory is bounded; compressed MP4 remains in RAM. No processor-output crop/composition adapter exists yet: use `resolveMapping` and pixel-placement tests when adding it. Rendering must be deterministic and periodic; disable resetting counters for seamless mode. H.264 is lossy and RGB references are visual checks, not a guarantee of pixel-identical codec output. Safari, hardware media servers and larger resolutions are unverified.
- **Acceptance:** preserve existing PNG/mapping exports; test source snapshot stability while controls change, support errors, progress, cancellation and the downloaded file in the actual application. The validated prototype is ready; in-app wiring is the next milestone.

Final repository validation:

```sh
npm run typecheck
npm run lint
npm test
npm run build -- --webpack
```

Webpack is the verified production-build path in this environment; default Turbopack previously failed on a sandbox port permission. Both builders may need network access to download the application's Inter font. No source/config workaround was applied.

MP4-specific and browser validation (Vite and the isolated debugging Chrome above must be running):

```sh
npm test -- tests/output-video.test.ts tests/output-mp4-playback.test.ts tests/output-calibration.test.ts
node prototypes/output-video/verify-browser.mjs
ffprobe -v error -count_frames -show_streams -show_format -of json /tmp/pixel-animated-calibration.mp4
ffmpeg -v error -i /tmp/pixel-animated-calibration.mp4 -f null -
```

## Stop checkpoint — 2026-11-12

Completed implementation commit: `57227483a0b62b17e9db94134f144af621877a40` on `feature/output-engineering`, following encoder commit `6402f00c1e37011b2d3affd0a0b3ebaec4ff0af4`. Final validation before that commit: typecheck PASS; lint PASS; 245/245 tests PASS; production Webpack build PASS. Real Chrome export, loop-boundary playback and cancellation PASS; ffprobe confirmed H.264, 1920×1080, 30 fps, exactly 300 frames, 10 seconds and no audio; full FFmpeg decode PASS.

The integration instructions, exact commands and known limitations are above. Next milestone, only when explicitly resumed: wire the existing encoder to a prepared, immutable real Calibration source and expose Export MP4 in Output Studio. No additional encoder or prototype redesign is needed. Work is stopped; no branch combinations, push, shared-contract edits or other-worktree modifications were performed. This final checkpoint is documentation only; implementation and validation results are unchanged.
