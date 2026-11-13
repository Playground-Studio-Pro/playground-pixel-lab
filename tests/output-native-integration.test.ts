import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NativeExporter } from '@/modules/output/native/exporter';
import { NATIVE_LIMITS, type FrameRows, type NativeVideoSpec } from '@/modules/output/native/contract';
function locate(name: string): string {
  const override = name === 'ffmpeg' ? process.env.PIXEL_FFMPEG : process.env.PIXEL_FFPROBE;
  if (override) return override;
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : '';
}
const tools = { ffmpeg: locate('ffmpeg'), ffprobe: locate('ffprobe') };
const installed = isAbsolute(tools.ffmpeg) && isAbsolute(tools.ffprobe);
const acceptance: NativeVideoSpec = { width: 1920, height: 1080, fps: 30, frames: 300, preset: 'prores422' };
/** Small deterministic fixture, not an alternate app renderer. One reusable row block at a time. */
async function* frames(spec: NativeVideoSpec, disposed?: () => void): AsyncGenerator<FrameRows> {
  const rowsPerChunk = Math.floor(NATIVE_LIMITS.maxChunkBytes / (spec.width * 4));
  const pixels = new Uint8Array(rowsPerChunk * spec.width * 4);
  try {
    for (let frame = 0; frame < spec.frames; frame++) {
      for (let y = 0; y < rowsPerChunk; y++) {
        for (let x = 0; x < spec.width; x++) {
          const i = (y * spec.width + x) * 4;
          pixels[i] = Math.floor(x * 255 / spec.width); pixels[i + 1] = frame % 256;
          pixels[i + 2] = 32; pixels[i + 3] = 255;
        }
      }
      for (let firstRow = 0; firstRow < spec.height; firstRow += rowsPerChunk) {
        const rows = Math.min(rowsPerChunk, spec.height - firstRow);
        yield { frame, firstRow, rows, rgba: pixels.subarray(0, rows * spec.width * 4) };
      }
    }
  } finally { disposed?.(); }
}

describe.skipIf(!installed)('native FFmpeg integration (no Electron)', () => {
  it('detects actual capabilities and verifies 300 native 1080p ProRes 422 frames', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pixel-native-prores-'));
    try {
      const exporter = new NativeExporter(tools);
      expect(await exporter.capabilities()).toMatchObject({ prores422: true, pngSequence: true });
      const events: string[] = [];
      const destination = join(dir, 'acceptance.mov');
      const result = await exporter.export({ spec: acceptance, destination, source: frames(acceptance), onProgress: p => events.push(p.phase) });
      expect(result.verifiedFrames).toBe(300);
      expect(await readdir(dir)).toEqual(['acceptance.mov']);
      expect(events).toContain('verifying'); expect(events.at(-1)).toBe('complete');
      // Exporter has already run ffprobe frame count, exact dimensions/rate/profile/duration checks and full strict decode.
      const probe = spawnSync(tools.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', destination], { encoding: 'utf8' });
      expect(probe.status).toBe(0);
      const metadata = JSON.parse(probe.stdout);
      expect(metadata.streams[0]).toMatchObject({ codec_name: 'prores', codec_tag_string: 'apcn', width: 1920, height: 1080, avg_frame_rate: '30/1' });
      expect(Number(metadata.format.duration)).toBe(10);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 120000);

  it('verifies 300 correctly numbered native 1080p PNG frames and manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pixel-native-png-'));
    try {
      const spec: NativeVideoSpec = { ...acceptance, preset: 'png-sequence' };
      const destination = join(dir, 'sequence');
      const result = await new NativeExporter(tools).export({ spec, destination, source: frames(spec) });
      expect(result.verifiedFrames).toBe(300);
      const files = (await readdir(destination)).sort();
      expect(files).toHaveLength(301);
      expect(files[0]).toBe('frame-000000.png'); expect(files[299]).toBe('frame-000299.png');
      expect(JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8'))).toMatchObject({ width: 1920, height: 1080, frames: 300, fps: 30, firstFrame: 0 });
      expect(await readdir(dir)).toEqual(['sequence']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 120000);

  it('supports an ultrawide frame without the browser H.264 width ceiling', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pixel-native-wide-'));
    try {
      const spec: NativeVideoSpec = { width: 15360, height: 64, fps: 30, frames: 2, preset: 'prores422' };
      await expect(new NativeExporter(tools).export({ spec, destination: join(dir, 'wide.mov'), source: frames(spec) })).resolves.toMatchObject({ verifiedFrames: 2 });
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 30000);

  it('cancels an active FFmpeg job, disposes the producer, cleans temporary output and unlocks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pixel-native-cancel-'));
    try {
      const controller = new AbortController(); let disposed = false;
      const exporter = new NativeExporter(tools);
      await expect(exporter.export({ spec: acceptance, destination: join(dir, 'cancelled.mov'),
        source: frames(acceptance, () => { disposed = true; }), signal: controller.signal,
        onProgress: progress => { if (progress.submittedFrames >= 3) controller.abort(); },
      })).rejects.toMatchObject({ name: 'AbortError' });
      expect(disposed).toBe(true); expect(await readdir(dir)).toEqual([]);
      const small: NativeVideoSpec = { ...acceptance, width: 8, height: 4, frames: 2 };
      await expect(exporter.export({ spec: small, destination: join(dir, 'retry.mov'), source: frames(small) })).resolves.toMatchObject({ verifiedFrames: 2 });
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 30000);
});
