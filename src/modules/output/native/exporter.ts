/** Node-only native encoder service; independent of Electron and any IPC implementation. */
import { constants } from 'node:fs';
import { copyFile, link, lstat, mkdir, mkdtemp, open, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { abortable, checkAbort, NATIVE_LIMITS, NativeExportError, validateNativeSpec,
  type FrameRows, type NativeProgress, type NativeVideoSpec } from './contract';
import { runProcess, type ProcessResult, type ProcessRunner } from './process';

export interface NativeTools { readonly ffmpeg: string; readonly ffprobe: string }
export interface NativeCapabilities {
  readonly ffmpegVersion: string | null;
  readonly ffprobeVersion: string | null;
  readonly prores422: boolean;
  readonly pngSequence: boolean;
  readonly reasons: readonly string[];
}
export interface NativeExportRequest {
  readonly spec: NativeVideoSpec;
  /** Trusted host-selected absolute path. Must not exist. MOV file or PNG directory. */
  readonly destination: string;
  readonly source: AsyncIterable<FrameRows>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: NativeProgress) => void;
}
export interface NativeExportResult {
  readonly destination: string;
  readonly spec: NativeVideoSpec;
  readonly verifiedFrames: number;
}
const requireSuccess = (r: ProcessResult) => {
  if (r.code !== 0) throw new Error(`FFmpeg/ffprobe exited ${r.code}: ${r.stderr}`);
  return r.stdout;
};
function errorFor(error: unknown): Error {
  if (error instanceof NativeExportError || (error instanceof Error && error.name === 'AbortError')) return error;
  const e = error as NodeJS.ErrnoException;
  if (e?.code === 'ENOSPC' || /no space left|disk full|not enough space/i.test(e?.message ?? '')) {
    return new NativeExportError('DISK_FULL', 'The export ran out of disk space. Temporary output was removed.');
  }
  return new NativeExportError('PROCESS_FAILED', error instanceof Error ? error.message : String(error));
}
async function mustNotExist(path: string) {
  try { await lstat(path); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
  throw new NativeExportError('DESTINATION_EXISTS', 'Destination already exists; choose a new name.');
}
export function nativeEncodeArgs(spec: NativeVideoSpec, output: string): string[] {
  validateNativeSpec(spec);
  const args = ['-hide_banner', '-v', 'error', '-nostdin', '-n', '-f', 'rawvideo', '-pixel_format', 'rgba',
    '-video_size', `${spec.width}x${spec.height}`, '-framerate', String(spec.fps), '-i', 'pipe:0',
    '-map', '0:v:0', '-an', '-fps_mode', 'passthrough', '-threads', '2'];
  if (spec.preset === 'prores422') args.push('-c:v', 'prores_ks', '-profile:v', '2',
    // Identity geometry. Explicit full RGB to limited BT.709 matrix, retaining the sRGB transfer curve.
    '-vf', 'scale=iw:ih:in_range=full:out_range=limited:out_color_matrix=bt709',
    '-pix_fmt', 'yuv422p10le', '-color_range', 'tv', '-colorspace', 'bt709',
    '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-f', 'mov');
  else args.push('-c:v', 'png', '-pix_fmt', 'rgb24', '-start_number', '0', '-f', 'image2');
  return [...args, '-progress', 'pipe:1', '-nostats', output];
}

export class NativeExporter {
  private static active = false;
  private readonly tools: NativeTools;
  constructor(tools: NativeTools, private readonly run: ProcessRunner = runProcess) {
    if (!isAbsolute(tools.ffmpeg) || !isAbsolute(tools.ffprobe)) throw new Error('Native tools must be trusted absolute paths.');
    this.tools = { ...tools };
  }

  async capabilities(signal?: AbortSignal): Promise<NativeCapabilities> {
    const reasons: string[] = [];
    const inspect = async (path: string, args: string[]) => {
      try { return requireSuccess(await this.run(path, args, { signal, timeoutMs: 10000 })); }
      catch (error) { checkAbort(signal); reasons.push(error instanceof Error ? error.message : String(error)); return ''; }
    };
    const [ffmpeg, ffprobe, encoders, muxers, demuxers, prores, png] = await Promise.all([
      inspect(this.tools.ffmpeg, ['-version']), inspect(this.tools.ffprobe, ['-version']),
      inspect(this.tools.ffmpeg, ['-hide_banner', '-encoders']), inspect(this.tools.ffmpeg, ['-hide_banner', '-muxers']),
      inspect(this.tools.ffmpeg, ['-hide_banner', '-demuxers']),
      inspect(this.tools.ffmpeg, ['-hide_banner', '-h', 'encoder=prores_ks']),
      inspect(this.tools.ffmpeg, ['-hide_banner', '-h', 'encoder=png']),
    ]);
    const versions = ffmpeg.startsWith('ffmpeg version ') && ffprobe.startsWith('ffprobe version ');
    const raw = /^\s*D\s+rawvideo\s/m.test(demuxers);
    const prores422 = !!(versions && raw && /^\s*V[A-Z.]{5}\s+prores_ks\s/m.test(encoders) &&
      /^\s*E\s+mov\s/m.test(muxers) && /Supported pixel formats:.*\byuv422p10le\b/.test(prores));
    const pngSequence = !!(versions && raw && /^\s*V[A-Z.]{5}\s+png\s/m.test(encoders) &&
      /^\s*E\s+image2\s/m.test(muxers) && /Supported pixel formats:.*\brgb24\b/.test(png));
    if (!prores422) reasons.push('ProRes 422 requires ffmpeg/ffprobe, rawvideo, prores_ks/yuv422p10le and MOV.');
    if (!pngSequence) reasons.push('PNG sequence requires ffmpeg/ffprobe, rawvideo, png/rgb24 and image2.');
    return { ffmpegVersion: ffmpeg.split('\n')[0] || null, ffprobeVersion: ffprobe.split('\n')[0] || null, prores422, pngSequence, reasons };
  }

  async export(request: NativeExportRequest): Promise<NativeExportResult> {
    if (NativeExporter.active) throw new NativeExportError('BUSY', 'A native export is already active.');
    NativeExporter.active = true;
    // Copy settings before any await; callers cannot change timing/geometry mid-job.
    request = { ...request, spec: { ...request.spec } };
    const spec = request.spec;
    let staging: string | undefined;
    let ownedDestination = false;
    let committed = false;
    let submitted = 0, encoded = 0;
    const emit = (phase: NativeProgress['phase']) => {
      // UI listeners cannot break encoding or turn a published job into a failure.
      try { request.onProgress?.({ phase, submittedFrames: submitted, encodedFrames: encoded, totalFrames: spec.frames }); } catch { /* observer only */ }
    };
    try {
      validateNativeSpec(spec); checkAbort(request.signal);
      if (!isAbsolute(request.destination) || !basename(request.destination) || resolve(request.destination) !== request.destination) {
        throw new NativeExportError('INVALID_SETTINGS', 'Destination must be a normalized absolute host-selected path.');
      }
      await mustNotExist(request.destination);
      emit('preparing');
      const caps = await this.capabilities(request.signal);
      if (!(spec.preset === 'prores422' ? caps.prores422 : caps.pngSequence)) {
        throw new NativeExportError('UNSUPPORTED', caps.reasons.join(' '));
      }
      checkAbort(request.signal);
      staging = await mkdtemp(join(dirname(request.destination), '.pixel-native-'));
      const output = spec.preset === 'prores422' ? join(staging, 'video.mov') : join(staging, 'frame-%06d.png');
      let pending = '';
      const result = await this.run(this.tools.ffmpeg, nativeEncodeArgs(spec, output), {
        signal: request.signal,
        input: this.validatedFrames(request.source, spec, request.signal, () => { submitted++; emit('encoding'); }),
        onStdout: text => {
          pending += text;
          const lines = pending.split('\n'); pending = lines.pop()!.slice(-4096);
          for (const line of lines) {
            const match = /^frame=(\d+)\r?$/.exec(line);
            if (match) { encoded = Math.max(encoded, Math.min(spec.frames, Number(match[1]))); emit('encoding'); }
          }
        },
      });
      requireSuccess(result);
      if (submitted !== spec.frames) throw new NativeExportError('INVALID_FRAME', `Expected ${spec.frames} complete frames, received ${submitted}.`);
      checkAbort(request.signal); emit('verifying');
      await this.verify(staging, output, spec, request.signal);
      if (spec.preset === 'png-sequence') await writeFile(join(staging, 'manifest.json'), JSON.stringify({ version: 1, ...spec, firstFrame: 0, pattern: 'frame-%06d.png' }, null, 2));
      checkAbort(request.signal); emit('publishing');
      await mustNotExist(request.destination);
      if (spec.preset === 'prores422') {
        // Same-filesystem hard link publishes atomically and never overwrites an existing destination.
        await link(output, request.destination); ownedDestination = true;
      } else {
        // Reserve exclusively. The directory becomes consumable only when this promise resolves.
        await mkdir(request.destination); ownedDestination = true;
        for (const file of await readdir(staging)) {
          checkAbort(request.signal);
          await copyFile(join(staging, file), join(request.destination, file), constants.COPYFILE_EXCL);
        }
      }
      checkAbort(request.signal);
      committed = true; encoded = spec.frames; emit('complete');
      return { destination: request.destination, spec, verifiedFrames: spec.frames };
    } catch (error) {
      checkAbort(request.signal);
      if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') throw new NativeExportError('DESTINATION_EXISTS', 'Destination appeared during export; it was not overwritten.');
      throw errorFor(error);
    } finally {
      const cleanup: Promise<void>[] = [];
      if (ownedDestination && !committed) cleanup.push(rm(request.destination, { recursive: true, force: true }));
      if (staging) cleanup.push(rm(staging, { recursive: true, force: true }));
      const results = await Promise.allSettled(cleanup);
      NativeExporter.active = false;
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw new NativeExportError('IO_ERROR', `Temporary-output cleanup failed: ${String(failed.reason)}`);
    }
  }

  private async *validatedFrames(source: AsyncIterable<FrameRows>, spec: NativeVideoSpec, signal: AbortSignal | undefined, onFrame: () => void): AsyncGenerator<Uint8Array> {
    const iterator = source[Symbol.asyncIterator]();
    let frame = 0, row = 0;
    try {
      while (true) {
        const item = await abortable(iterator.next(), signal);
        if (item.done) break;
        const chunk = item.value;
        if (!chunk || frame >= spec.frames || chunk.frame !== frame || chunk.firstRow !== row || !Number.isSafeInteger(chunk.rows) ||
            chunk.rows < 1 || row + chunk.rows > spec.height || !(chunk.rgba instanceof Uint8Array) ||
            chunk.rgba.byteLength !== spec.width * chunk.rows * 4 || chunk.rgba.byteLength > NATIVE_LIMITS.maxChunkBytes) {
          throw new NativeExportError('INVALID_FRAME', `Invalid RGBA rows at frame ${frame}, row ${row}.`);
        }
        for (let i = 3; i < chunk.rgba.length; i += 4) if (chunk.rgba[i] !== 255) {
          throw new NativeExportError('INVALID_FRAME', 'Native V1 accepts opaque RGBA8 only; alpha export is not implemented.');
        }
        yield chunk.rgba;
        row += chunk.rows;
        if (row === spec.height) { frame++; row = 0; onFrame(); }
      }
      if (frame !== spec.frames || row !== 0) throw new NativeExportError('INVALID_FRAME', `Incomplete input: ${frame}/${spec.frames} frames.`);
    } finally { if (iterator.return) void iterator.return().catch(() => {}); }
  }

  private async verify(staging: string, output: string, spec: NativeVideoSpec, signal?: AbortSignal): Promise<void> {
    const input = spec.preset === 'prores422' ? ['-i', output] : ['-f', 'image2', '-framerate', String(spec.fps), '-start_number', '0', '-i', output];
    if (spec.preset === 'png-sequence') {
      const files = (await readdir(staging)).sort();
      const names = Array.from({ length: spec.frames }, (_, i) => `frame-${String(i).padStart(6, '0')}.png`);
      if (files.length !== names.length || files.some((f, i) => f !== names[i])) throw new NativeExportError('VERIFY_FAILED', 'PNG numbering/count verification failed.');
      for (const file of files) {
        checkAbort(signal);
        const handle = await open(join(staging, file), 'r');
        try {
          const bytes = Buffer.alloc(24); const { bytesRead } = await handle.read(bytes, 0, 24, 0);
          if (bytesRead !== 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
              bytes.readUInt32BE(16) !== spec.width || bytes.readUInt32BE(20) !== spec.height) {
            throw new NativeExportError('VERIFY_FAILED', `Wrong PNG dimensions/header: ${file}.`);
          }
        } finally { await handle.close(); }
      }
    }
    const report = requireSuccess(await this.run(this.tools.ffprobe, ['-v', 'error', ...input, '-count_frames', '-show_streams', '-show_format', '-of', 'json'], { signal, timeoutMs: 30 * 60 * 1000 }));
    const metadata = JSON.parse(report);
    const stream = metadata.streams?.[0];
    const rate = String(stream?.avg_frame_rate).split('/').map(Number);
    if (metadata.streams?.length !== 1 || stream.codec_name !== (spec.preset === 'prores422' ? 'prores' : 'png') ||
        stream.width !== spec.width || stream.height !== spec.height || Number(stream.nb_read_frames) !== spec.frames ||
        !rate[1] || rate[0] !== spec.fps * rate[1] || (spec.preset === 'prores422' &&
          (stream.codec_tag_string !== 'apcn' || stream.pix_fmt !== 'yuv422p10le' ||
            !Number.isFinite(Number(metadata.format?.duration)) || Math.abs(Number(metadata.format.duration) - spec.frames / spec.fps) > 0.001))) {
      throw new NativeExportError('VERIFY_FAILED', 'Encoded output did not match the requested codec, geometry, rate or frame count.');
    }
    // Independent strict full decode, not just a header/metadata check.
    requireSuccess(await this.run(this.tools.ffmpeg, ['-v', 'error', '-xerror', '-err_detect', 'explode', '-nostdin', ...input, '-map', '0:v:0', '-an', '-f', 'null', '-'], { signal }));
  }
}
