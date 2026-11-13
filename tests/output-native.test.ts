import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeExporter, nativeEncodeArgs } from '@/modules/output/native/exporter';
import { NATIVE_LIMITS, validateNativeSpec, type FrameRows, type NativeVideoSpec } from '@/modules/output/native/contract';
import { runProcess, type ProcessRunner } from '@/modules/output/native/process';
import { canvasFrames } from '@/modules/output/native/canvas-frames';
const spec: NativeVideoSpec = { width: 8, height: 4, fps: 30, frames: 2, preset: 'prores422' };
const tools = { ffmpeg: '/trusted/ffmpeg', ffprobe: '/trusted/ffprobe' };
const dirs: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function directory() { const dir = await mkdtemp(join(tmpdir(), 'pixel-native-unit-')); dirs.push(dir); return dir; }
async function* frames(s = spec): AsyncGenerator<FrameRows> {
  for (let frame = 0; frame < s.frames; frame++) {
    const rgba = new Uint8Array(s.width * s.height * 4).fill(255);
    yield { frame, firstRow: 0, rows: s.height, rgba };
  }
}
function fakeRunner(options: { encodeFailure?: string; badProbe?: boolean; noCodec?: boolean } = {}): ProcessRunner {
  return async (executable, args, config) => {
    let stdout = '';
    if (args.includes('-version')) stdout = `${executable.endsWith('ffprobe') ? 'ffprobe' : 'ffmpeg'} version test`;
    else if (args.includes('-encoders')) stdout = options.noCodec ? '' : ' VFS... prores_ks Apple ProRes\n VF...D png PNG';
    else if (args.includes('-muxers')) stdout = ' E mov QuickTime\n E image2 images';
    else if (args.includes('-demuxers')) stdout = ' D rawvideo raw';
    else if (args.includes('-h')) stdout = 'Supported pixel formats: yuv422p10le rgb24';
    else if (config?.input) {
      await writeFile(args.at(-1)!, 'temporary output');
      if (options.encodeFailure) return { code: 1, stdout: '', stderr: options.encodeFailure };
      for await (const _chunk of config.input) { void _chunk; }
      config.onStdout?.('fra'); config.onStdout?.('me=2\nprogress=end\n');
    } else if (args.includes('-show_streams')) stdout = JSON.stringify({
      streams: [{ codec_name: 'prores', codec_tag_string: 'apcn', pix_fmt: 'yuv422p10le', width: options.badProbe ? 10 : 8,
        height: 4, nb_read_frames: '2', avg_frame_rate: '30/1' }], format: { duration: String(2 / 30) },
    });
    return { code: 0, stdout, stderr: '' };
  };
}

describe('native presets and boundaries', () => {
  it('rejects invalid settings and preserves exact geometry in argv', () => {
    for (const patch of [{ width: 9 }, { width: 0 }, { width: 16386 }, { width: 16384, height: 4096 }, { fps: 29.97 }, { frames: 18001 }, { preset: 'hap' }]) {
      expect(() => validateNativeSpec({ ...spec, ...patch } as NativeVideoSpec)).toThrow('Unsupported');
    }
    expect(() => validateNativeSpec({ ...spec, width: 15360, height: 1080 })).not.toThrow();
    expect(() => validateNativeSpec({ ...spec, preset: 'png-sequence', width: 9, height: 3 })).not.toThrow();
    const args = nativeEncodeArgs(spec, '/safe/output.mov');
    expect(args).toContain('8x4'); expect(args).toContain('prores_ks'); expect(args).not.toContain('-s');
    expect(args).not.toContain('-r'); expect(args).toContain('passthrough');
  });
  it('probes the actual required codec, muxer and pixel-format capabilities', async () => {
    expect(await new NativeExporter(tools, fakeRunner()).capabilities()).toMatchObject({ prores422: true, pngSequence: true });
    expect(await new NativeExporter(tools, fakeRunner({ noCodec: true })).capabilities()).toMatchObject({ prores422: false, pngSequence: false });
    expect(await new NativeExporter(tools, async () => { throw new Error('Missing binary'); }).capabilities()).toMatchObject({ prores422: false, pngSequence: false });
  });
  it('does not allocate output or consume frames for an unsupported preset', async () => {
    const dir = await directory(); const next = vi.fn();
    await expect(new NativeExporter(tools, fakeRunner({ noCodec: true })).export({ spec, destination: join(dir, 'out.mov'), source: { [Symbol.asyncIterator]: () => ({ next }) } })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(next).not.toHaveBeenCalled(); expect(await readdir(dir)).toEqual([]);
  });
  it('publishes only after verification, reports complete, and releases the lock', async () => {
    const dir = await directory(); const progress = vi.fn(); const exporter = new NativeExporter(tools, fakeRunner());
    const destination = join(dir, 'out.mov');
    expect(await exporter.export({ spec, destination, source: frames(), onProgress: progress })).toMatchObject({ verifiedFrames: 2, destination });
    expect(progress).toHaveBeenLastCalledWith({ phase: 'complete', submittedFrames: 2, encodedFrames: 2, totalFrames: 2 });
    expect(await readdir(dir)).toEqual(['out.mov']);
    await expect(exporter.export({ spec, destination: join(dir, 'second.mov'), source: frames() })).resolves.toMatchObject({ verifiedFrames: 2 });
  });
  it('preserves existing destinations', async () => {
    const dir = await directory(); const destination = join(dir, 'out.mov'); await writeFile(destination, 'existing');
    await expect(new NativeExporter(tools, fakeRunner()).export({ spec, destination, source: frames() })).rejects.toMatchObject({ code: 'DESTINATION_EXISTS' });
    expect(await readFile(destination, 'utf8')).toBe('existing'); expect(await readdir(dir)).toEqual(['out.mov']);
  });
  it('cleans up process failure, simulated disk full and verification failure', async () => {
    for (const [options, code] of [
      [{ encodeFailure: 'Encoder crashed' }, 'PROCESS_FAILED'],
      [{ encodeFailure: 'No space left on device' }, 'DISK_FULL'],
      [{ badProbe: true }, 'VERIFY_FAILED'],
    ] as const) {
      const dir = await directory();
      await expect(new NativeExporter(tools, fakeRunner(options)).export({ spec, destination: join(dir, 'out.mov'), source: frames() })).rejects.toMatchObject({ code });
      expect(await readdir(dir)).toEqual([]);
    }
  });
  it('preserves a destination created by another process during verification', async () => {
    const dir = await directory(); const destination = join(dir, 'out.mov');
    const runner = fakeRunner();
    const raced: ProcessRunner = async (executable, args, options) => {
      if (args.includes('-show_streams')) await writeFile(destination, 'new owner');
      return runner(executable, args, options);
    };
    await expect(new NativeExporter(tools, raced).export({ spec, destination, source: frames() })).rejects.toMatchObject({ code: 'DESTINATION_EXISTS' });
    expect(await readFile(destination, 'utf8')).toBe('new owner'); expect(await readdir(dir)).toEqual(['out.mov']);
  });
  it('accepts only complete, ordered, bounded, opaque RGBA rows', async () => {
    const good = { frame: 0, firstRow: 0, rows: 4, rgba: new Uint8Array(128).fill(255) };
    const malformed = [
      [good], [good, { ...good, frame: 1 }, { ...good, frame: 2 }],
      [{ ...good, frame: 1 }], [{ ...good, firstRow: 1 }], [{ ...good, rows: 0 }],
      [{ ...good, rgba: new Uint8Array(127) }], [{ ...good, rgba: new Uint8Array(128) }],
      [{ ...good, rows: 5 }],
    ];
    for (const chunks of malformed) {
      const dir = await directory();
      const source = (async function* () { yield* chunks; })();
      await expect(new NativeExporter(tools, fakeRunner()).export({ spec, destination: join(dir, 'out.mov'), source })).rejects.toMatchObject({ code: 'INVALID_FRAME' });
      expect(await readdir(dir)).toEqual([]);
    }
  });
  it('enforces one active job across service instances and supports cancellation', async () => {
    const dir = await directory(); const controller = new AbortController();
    const running = new NativeExporter(tools, fakeRunner()).export({ spec, destination: join(dir, 'a.mov'), source: frames(), signal: controller.signal });
    await expect(new NativeExporter(tools, fakeRunner()).export({ spec, destination: join(dir, 'b.mov'), source: frames() })).rejects.toMatchObject({ code: 'BUSY' });
    controller.abort(); await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('Node process transport', () => {
  it('reports an actual child-process failure without shell execution', async () => {
    expect(await runProcess(process.execPath, ['-e', 'process.stderr.write("controlled failure"); process.exit(7)'])).toMatchObject({ code: 7, stderr: 'controlled failure' });
  });
  it('does not hang when an encoder dies while waiting for source rows', async () => {
    const source = { async *[Symbol.asyncIterator]() { await new Promise(() => {}); yield new Uint8Array(); } };
    await expect(runProcess(process.execPath, ['-e', 'setTimeout(()=>{process.stderr.write("controlled encoder crash");process.exit(9)},30)'],
      { input: source })).rejects.toThrow('controlled encoder crash');
    await expect(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'],
      { input: source, timeoutMs: 30 })).rejects.toThrow('timed out');
  });
  it('times out and cancels a blocked producer without hanging', async () => {
    const controller = new AbortController();
    const source = { async *[Symbol.asyncIterator]() { await new Promise(() => {}); yield new Uint8Array(); } };
    const running = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { input: source, signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    await expect(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 30 })).rejects.toThrow('timed out');
  });
});

describe('existing renderer adapter', () => {
  it('renders deterministic frame indices at scale 1 and releases the canvas', async () => {
    const canvas = { width: 0, height: 0, getContext: () => ctx };
    const ctx = { save() {}, restore() {}, setTransform() {}, fillRect() {}, getImageData(_x: number, _y: number, width: number, height: number) {
      return { data: new Uint8ClampedArray(width * height * 4).fill(255) };
    } };
    vi.stubGlobal('document', { createElement: () => canvas });
    const draw = vi.fn(); const exact = vi.fn();
    const output: FrameRows[] = [];
    for await (const chunk of canvasFrames({ source: { id: 'test', name: 'test', draw }, input: { screens: [] }, spec, assertExactRendering: exact })) output.push(chunk);
    expect(draw.mock.calls.map(call => call[1].frame)).toEqual([0, 1]);
    expect(draw.mock.calls[0][2].scale).toBe(1); expect(exact).toHaveBeenCalledOnce();
    expect(output).toHaveLength(2); expect(output.every(c => c.rgba.length <= NATIVE_LIMITS.maxChunkBytes)).toBe(true);
    expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
  });
  it('refuses a source/device that cannot render at native resolution', async () => {
    const generator = canvasFrames({ source: { id: 'test', name: 'test', draw() {} }, input: { screens: [] }, spec,
      assertExactRendering: () => { throw new Error('Master exceeds GPU limit'); } });
    await expect(generator.next()).rejects.toThrow('GPU limit');
  });
});
