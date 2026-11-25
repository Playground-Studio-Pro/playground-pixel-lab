# H.264 MP4 export infrastructure

Independent Output Engineering implementation. No dependency added and no shared contracts changed. `src/modules/output/video-export.ts` consumes the existing `FrameSource` at scale 1. `mp4.ts` writes fragmented ISO BMFF with an AVC video track, no audio. It never uses MediaRecorder or WebM.

## Every screen, one MP4 each (2026-11-25)

**For → Every screen (one MP4 each)** in the Output Studio exports each mapped screen as its own file at its exact pixel size, 1:1, for any exportable content. All files share one frame clock: frame N of each file is its screen's part of master frame N, so playing them together rebuilds the mapping. Screens that share master pixels get the same pixels.

- **Frozen once.** The source's settings, the project and the mapping are taken when Export is pressed, for the whole batch. Later edits don't reach it.
- **One screen after another.** One encoder and one master canvas are alive at a time (`batch-export.ts`). Progress shows the screen, i of n, and the total.
- **Delivery: one stored ZIP named for the project** (`<project>-<content>-screens-<fps>fps-<seconds>s.zip`). It's one download, so the desktop app shows one save dialog (`will-download` in `desktop/src/main.cjs` accepts `blob:` URLs from the control window), and a browser doesn't ask to allow several downloads. Nothing is compressed again (`stored-zip.ts`, no dependency): each finished MP4 is read back once in chunks for its CRC-32, which also checks it's complete, and the ZIP is a Blob that refers to the files without copying them. **Limit: 4 GB in all** (no ZIP64). Past it the export stops and saves nothing; the panel warns first when the encoder's target rate could get there. Chromium keeps large Blobs on disk when memory is short.
- **Names** are `<project>-<content>-<screen>-<w>x<h>-<fps>fps-<seconds>s.mp4`. Screens whose names give the same slug get `-2`, `-3`, never a name another screen has as its own.
- **Refused, never resized:** a screen H.264 can't take (odd size, over 4096 px a side or 8,847,360 pixels) or that the mapping can't place is listed with its reason before Export, and left out. If the device's encoder refuses a size, the whole batch fails naming the screen, and nothing is saved.
- **Cancel** stops at once and saves nothing. A failure does the same.
- **Wall Build** is exported here only (`export-sources.ts`). It isn't in `OUTPUT_SOURCE_IDS`, so it can't be sent to a monitor. Its own duration is the build time plus a hold of the finished wall (2 to 30 s, default 3 s); the panel warns when a duration ends before the last cabinet is placed.

Checked 2026-11-25 on HP Stage (8 screens, 23 s) and Festival Main Stage (5 files; the 4608 px Ribbon is listed and left out): `unzip -t` clean, every file at its size with 690 or 150 frames in ffprobe and AVFoundation (`avfoundation-check.swift`), full decode without errors. Decoded HP Stage frames 0, 300, 600 and 689 match Wall Build's engine to within 9 levels away from the workers. The two HP screens on the same pixels came out byte for byte the same; Festival's Center Wall and Header agree at 54 dB PSNR where they overlap. A settings change in the middle of the export didn't reach the files. Existing single-file exports (calibration on a screen, pixel grid on an output) gave the same bytes before and after.

## Duration in AVFoundation (fixed 2026-11-24)

Until this fix the init segment wrote the whole length in `mvhd`, `tkhd` and `mdhd` although every sample is in a fragment. AVFoundation adds the two, so QuickTime and Resolume Arena on macOS read **every exported MP4 as twice as long at half the frame rate** (30 fps and 10 s became 15 fps and 20 s; Arena 7.28.1). ffprobe and Chrome don't add them, so the checks below, which used only those, passed. **MP4s exported before the fix still carry the wrong header: export them again**, or remux with `ffmpeg -i old.mp4 -c copy new.mp4`, which doesn't touch the pictures.

Those three are now 0 and `mvex/mehd` holds the length. `ffprobe` alone isn't enough to accept an export. On a Mac, also run:

```sh
swift prototypes/output-video/avfoundation-check.swift downloaded.mp4
```

It must print the exported duration, frame rate and frame count. CI has no AVFoundation; `tests/output-mp4-duration.test.ts` checks the boxes there. Playback of the fixed file in Arena, and anything on Windows, hasn't been checked.

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

Pass integer `frames: 300`, `fps: 30`, dimensions 1920×1080, an AbortSignal and progress callback to `exportMp4`. Frame indices are exactly 0–299; timestamps use rounded microseconds and the fragments use exact FPS ticks. Sources must themselves be periodic over the selected frame count; encoding cannot make arbitrary animation seamless. The first frame is a keyframe. No mapping coordinates are computed by this pipeline. This master-image API does not export processor outputs; future output integration must use resolved mapping and the existing validation gate.

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
