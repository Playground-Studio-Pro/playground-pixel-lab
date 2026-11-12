# H.264 MP4 export infrastructure

Independent Output Engineering implementation. No dependency added and no shared contracts changed. `src/modules/output/video-export.ts` consumes the existing `FrameSource` at scale 1. `mp4.ts` writes fragmented ISO BMFF with an AVC video track, no audio. It never uses MediaRecorder or WebM.

## Browser verification

From the output-engineering worktree:

```sh
./node_modules/.bin/vite --host 127.0.0.1 --port 3104
```

Open http://127.0.0.1:3104/prototypes/output-video/index.html in a browser with WebCodecs H.264 encoding. Click **Export MP4**. Optionally select a local logo first. Check progress reaches 300/300, browser metadata reads 1920×1080 and 10 seconds, and the video plays repeatedly with the loop control. Download it. Start another export and press **Cancel**; it must stop without a completed download. A static synthetic source provides an exactly seamless loop without duplicating Calibration Test Card.

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
