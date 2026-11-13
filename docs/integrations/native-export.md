# Native export V1 — Output Engineering

ProRes 422 MOV and opaque PNG sequences using a reusable Node service, outside Electron. Browser H.264 is unchanged. No runtime dependency was added. Native IPC, dialogs, executable distribution, packaging and UI integration are not implemented here and remain Desktop Engineering's responsibility.

## Entry points and ownership boundary

| File | Environment | API |
| --- | --- | --- |
| `src/modules/output/native/contract.ts` | Portable | `NativeVideoSpec`, `FrameRows`, `NativeProgress`, limits, validation/errors |
| `src/modules/output/native/canvas-frames.ts` | Renderer | `canvasFrames(...)`: existing `FrameSource` → async RGBA row producer |
| `src/modules/output/native/exporter.ts` | Node host only | `new NativeExporter({ffmpeg,ffprobe})`, `.capabilities(signal?)`, `.export(request)` |
| `src/modules/output/native/process.ts` | Node host only | Bounded child-process transport; injectable runner for fault tests |

Do not import Node files into the Next/browser bundle or renderer preload. Desktop must bundle/transpile the TypeScript host entry with its own native process. There are no Electron imports. One process-wide lock rejects a second active `NativeExporter.export` even across instances. Capability probes do not occupy that lock.

`NativeVideoSpec` contains `{ preset: 'prores422' | 'png-sequence', width, height, fps, frames }`. All numeric fields are safe integers. ProRes V1 policy requires even width and height; PNG accepts odd dimensions. Neither preset scales, pads, duplicates or drops frames. A conversion filter for ProRes uses identity geometry (`scale=iw:ih`) only to specify the RGB→YUV matrix/range.

`FrameRows` is `{ frame, firstRow, rows, rgba: Uint8Array }`. Bytes are tightly packed RGBA8 with alpha 255, straight, top-to-bottom, left-to-right, no stride padding. The service checks exact length `width * rows * 4`, order, frame/row bounds, opacity and a 1 MiB block maximum. Indices begin at zero; the source must terminate after exactly `frames` frames. Buffers cannot be mutated/reused until consumption acknowledges the block. The source must respond to the same cancellation signal. An uncooperative pending producer cannot hold the child process/job open, but remains responsible for its own external resources.

`export` takes `{ spec, destination, source: AsyncIterable<FrameRows>, signal?, onProgress? }` and resolves `{ destination, spec, verifiedFrames }` only after verification and publication. Settings and request fields are snapshotted before asynchronous work. `destination` is a normalized absolute path selected by the trusted host, not supplied directly by renderer messages. It must not exist. V1 intentionally refuses overwrite.

Progress has separate `submittedFrames` and `encodedFrames`, `totalFrames`, and phase `preparing | encoding | verifying | publishing | complete`. Submitted means written into the pipe, not saved to disk. `complete` follows verification/publication, not just FFmpeg's progress=end. Observer exceptions do not interrupt encoding. Abort rejects with `AbortError`. Other failures have `NativeExportError.code`, including `INVALID_SETTINGS`, `INVALID_FRAME`, `BUSY`, `UNSUPPORTED`, `DESTINATION_EXISTS`, `PROCESS_FAILED`, `DISK_FULL`, `VERIFY_FAILED` and `IO_ERROR`.

## Desktop integration contract — proposed, not implemented IPC

The native host receives job settings, checks capabilities, obtains a native destination and starts one service call. The renderer gets a host-owned job ID. Desktop provides a bounded binary channel; do not send a full movie or queue full-size frames through generic invoke calls.

Proposed messages are `start(spec) → jobId`, `writeRows(jobId, frame, firstRow, rows, bytes) → acknowledgement`, `finish(jobId)`, `cancel(jobId)`, plus progress/error/completion events. This is a proposal for Desktop review, not a change to `window.pixelLabDesktop`, `FrameSource`, or any shared UI/IPC file. Use one block credit initially and acknowledge only after the generator resumes past its yield (the child stdin write has consumed it). Reject stale IDs, non-owner senders and writes after finish/cancel. Copy or transfer ownership of each buffer until acknowledged; the web producer must not outrun native backpressure.

Desktop wraps its incoming channel as `AsyncIterable<FrameRows>` for the service. Finish closes that iterable; cancel/window-close aborts the shared controller and closes the channel so pending reads unblock. The same signal must cancel asset preparation and renderer production. Clean listeners/job handles after every outcome. Do not let the renderer choose executable paths, filesystem paths, arbitrary codecs or FFmpeg argument arrays.

Host-side example (source is Desktop's ordered binary-channel adapter):

```ts
const exporter = new NativeExporter({ ffmpeg: approvedFfmpegPath, ffprobe: approvedFfprobePath });
const caps = await exporter.capabilities(signal);
if (!caps.prores422) throw new Error(caps.reasons.join(' '));
const result = await exporter.export({
  spec: { preset: 'prores422', width: 1920, height: 1080, fps: 30, frames: 300 },
  destination: chosenNewMovPath,
  source: incomingRows,
  signal,
  onProgress: sendTypedProgress,
});
```

Renderer-side producer (no duplicate rendering logic):

```ts
const rows = canvasFrames({
  source: preparedFrozenTargetSource,
  input: { screens /* plus existing context after integration */ },
  spec,
  signal,
  assertExactRendering: assertSourceAndMasterSupported,
});
// For each row block: transfer to Desktop's channel and await native consumption acknowledgement.
```

Lead Architect's in-progress `createCalibrationSource`, `createDepthSource` and `targetSource` can feed this adapter after their integration. Prepare fonts/logos and freeze settings first, apply the existing mapping gate, and use resolved screen/master/output coordinates. The required `assertExactRendering` callback must check internal source/master buffers too: even a small output may require a huge master. Canvas allocation/readback is checked by the adapter, but it cannot detect a source secretly rendering smaller, a lost GPU context, missing media, or a source that deliberately returns black. The source owner must surface those failures. No changes to their renderer or contracts were made.

## Encoding and verification

- Capabilities query both trusted executables, the actual FFmpeg encoder/muxer/demuxer lists and each encoder's supported pixel formats. Missing ffprobe, ProRes encoder or required muxer means unavailable, even when FFmpeg itself runs. Production never searches PATH or downloads binaries; Desktop supplies approved absolute paths. Tests may discover local tools on PATH.
- Input is raw RGBA at the exact dimensions and selected content rate. No wall clock or preview FPS is used. Each pipe frame occupies `width * height * 4` bytes; duration is `frames / fps`.
- ProRes: `prores_ks`, profile 2 (standard 422), `yuv422p10le`, MOV. RGB full-range is converted using the BT.709 matrix to limited-range YUV; the sRGB transfer curve is retained/tagged. Conversion from RGBA8 does not create original 10-bit precision. Native player color/gamma behavior is unverified.
- PNG: opaque RGB24, `frame-000000.png` through `frame-000299.png` for acceptance. `manifest.json` records dimensions, FPS, total frames and numbering. Individual PNGs do not carry sequence timing.
- The service writes in a unique `.pixel-native-*` sibling staging directory. No result is published on malformed input, failed process exit, abort or verification failure. Both raw buffering and process logs are bounded.
- MOV verification requires exactly one ProRes/apcn stream, yuv422p10le, exact dimensions, average FPS, decoded frame count and duration (1 ms tolerance for container decimals). Every PNG header and the complete sequence numbering/count are checked. ffprobe counts decoded frames, then FFmpeg independently strictly decodes the entire output (`-xerror -err_detect explode`) for both presets.
- A new MOV is published using a same-filesystem hard link: atomic, without replacing a destination created during encoding. PNG publication exclusively reserves a new directory and copies verified files with COPYFILE_EXCL; the directory is consumable only after export resolves. Cancellation/failure during publication removes the job-owned destination.
- Cancel sends SIGTERM to the owned child and escalates to SIGKILL after two seconds if necessary. Probe timeout is 10 seconds; encode/verification process timeout is 30 minutes. Timed-out, failed or cancelled children are reaped. Cleanup attempts both the job-owned incomplete destination and staging directory; a cleanup failure is explicitly reported, not silently treated as success. Prior destinations are never removed.

## Limits and unverified behavior

V1 policy: maximum 16384 per side, 33,554,432 pixels; rates 24/25/30/50/60; maximum 600 seconds. These are host policy ceilings, not guaranteed renderer/GPU/codec/filesystem capabilities. Unsupported settings fail explicitly. FFmpeg can still reject device/build-specific combinations; its diagnostic is returned, with no resizing fallback. No HAP, alpha, fractional frame rates, tiling, audio, overwrite, resume, disk-space reservation, multi-job queue or IPC implementation.

The adapter retains one exact-size canvas plus at most a row block; sources may allocate their own master/GPU surfaces. Only RGBA8 opaque is supported. Large source/master buffers remain renderer-limited. A 15360×64 ProRes fixture is tested; 15360×1080, maximum-policy dimensions and the live GPU/application path are not validated here. No claim of real-time encoding or throughput is made.

MOV publication requires same-filesystem hard links. Filesystems without hard-link support fail explicitly rather than falling back to unsafe overwrite; exFAT/network volumes are unverified. PNG publication temporarily requires staging plus destination storage and is not a single atomic directory rename. File visibility during publishing is not a completion signal. Hard shutdown/power loss can leave staging/incomplete output; automatic crash recovery is out of scope.

Executed on local macOS arm64, FFmpeg/ffprobe 8.1.1. Windows termination, file locking/Unicode destinations, bundled binaries, macOS packaging/signing, external media-server playback, and actual full-device disk exhaustion are unverified. Disk-full mapping/cleanup is tested by an injected process failure with ENOSPC diagnostics; no disk was filled. FFmpeg redistributable selection, licenses and packaging belong to Desktop Engineering. Full decoding at the end adds I/O and export time deliberately.

## Validation

```sh
npm run typecheck
npm run lint
npm test
npm run build -- --webpack
# Focused native tests:
npm test -- tests/output-native.test.ts tests/output-native-integration.test.ts
```

Integration tests require local FFmpeg and ffprobe; otherwise they explicitly skip. `PIXEL_FFMPEG` and `PIXEL_FFPROBE` may specify test executable paths. Test outputs live in unique temporary directories and are deleted after assertions.

Coverage: real 1920×1080 ProRes 422, 300 frames at 30 fps/10 s; real 300-frame 1920×1080 PNG sequence with numbering/header/manifest validation; full ffprobe/decode verification; ultrawide 15360×64 ProRes; real encoding cancellation/source disposal/cleanup/retry; real child-process exit; codec absence; invalid/incomplete/out-of-order/nonopaque frames; process-wide job exclusion; destination preservation/races; verification failure; simulated disk full; blocked producer cancellation/timeouts; reusable canvas source rendering exact indices at scale 1.

Validated on 2026-11-13 in `feature/output-engineering`: typecheck PASS; lint PASS; all 263 tests in 20 files PASS (18 new native tests, none skipped locally); production build `npm run build -- --webpack` PASS. The process-failure/disk-full injection exercises a temporary output and verifies deletion. Real-device disk exhaustion was intentionally not induced. No shared files, Desktop Engineering files, other worktrees or existing browser exporter files were edited.
