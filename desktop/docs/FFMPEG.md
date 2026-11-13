# Native FFmpeg boundary

## Implemented

Main-process-only binary resolution for macOS arm64 and Windows x64. Development binaries live at `resources/ffmpeg/<platform>-<arch>/`; electron-builder copies the selected folder to `process.resourcesPath/ffmpeg` outside ASAR. No PATH search, automatic download or renderer-selected executable is supported. `execFile` runs only the fixed `-version` argument with shell disabled, hidden Windows console, 5 second timeout and 128 KiB output bound. A missing/failing binary yields a nonfatal availability result. The result is cached for the app session; restart after installing a binary.

This desktop package implements no native encoding or frame rendering. The existing application already has a separate WebCodecs MP4 pipeline; this design does not replace or modify it. No FFmpeg binary is supplied or redistributed. The existing engine is the sole frame producer.

## Proposed encoding integration (requires shared contract review)

1. Output Engineering supplies deterministic frames from the existing renderer/FrameSource, at export resolution and the selected content FPS. A frame is indexed by integer frame number, never browser animation timing. Resolve mapping and apply its existing validation once per export.
2. Main owns a job id, native Save As destination and a bounded child-process lifecycle. Renderer requests typed settings (dimensions, FPS, codec preset, frame count), never shell strings or paths. Validate safe integers, allowed content rates, maximum frame bytes, total duration and pixel formats before allocating.
3. Choose raw RGBA on stdin or a validated intermediate image sequence. Prefer a bounded transferable frame channel after measuring the cost; generic invoke with huge arrays should not be the production transport. At most a small measured number of frames may be in flight; honor stdin backpressure.
4. Build argv in main from an allowlist (rawvideo input, exact dimensions, content FPS, agreed codec/pixel format). Enforce even dimensions for codecs that require them rather than silently changing mapping pixels. FFmpeg must never read arbitrary URLs or renderer-controlled inputs.
5. Write to a job-specific temporary file beside the chosen destination. Rename only on a successful exit after output validation. Retain the previous destination on cancellation/failure. Track frame progress through a dedicated bounded progress channel, with typed errors and listener cleanup.
6. Cancellation terminates the owned process, escalates on a deadline, closes streams, deletes temporary output and releases buffers. Test disk full, permissions, process crash, malformed frames, closing the window and Windows file locks. Do not implement shell-based `taskkill` from renderer data.

NDI, screen capture, display routing and rendering changes are outside this POC.

## Binary acceptance

Record version, build configuration, source URL, SHA-256, platform/architecture, license notices and redistribution obligations. Select a codec/build policy with the product owner; do not assume every FFmpeg distribution has the same license. Test an arm64 executable on Apple Silicon and x64 executable on Windows 11. Preserve executable bits and include/sign nested macOS helpers before notarizing. Keep FFmpeg notices with resources. Release CI should reject absent or mismatched binaries when native encoding becomes a shipped feature; this foundation intentionally supports an unavailable state.
