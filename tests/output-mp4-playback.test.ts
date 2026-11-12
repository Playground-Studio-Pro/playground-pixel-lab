import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { mp4Header, mp4Fragment } from '@/modules/output/mp4';

const available = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
it.skipIf(!available)('decodes all 300 1080p H.264 frames from the MP4 muxer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pixel-mp4-'));
  try {
    const raw = join(dir, 'source.h264');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-frames:v', '300', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-x264-params', 'aud=1:bframes=0', '-f', 'h264', raw]);
    const data = readFileSync(raw);
    const starts: { start: number; payload: number }[] = [];
    for (let i = 0; i < data.length - 3; i++) {
      if (data[i] === 0 && data[i + 1] === 0 && (data[i + 2] === 1 || (data[i + 2] === 0 && data[i + 3] === 1))) {
        const size = data[i + 2] === 1 ? 3 : 4;
        starts.push({ start: i, payload: i + size }); i += size - 1;
      }
    }
    const nals = starts.map((s, i) => data.subarray(s.payload, starts[i + 1]?.start ?? data.length));
    const sps = nals.find(n => (n[0] & 31) === 7)!;
    const pps = nals.find(n => (n[0] & 31) === 8)!;
    const avcc = Buffer.concat([Buffer.from([1, sps[1], sps[2], sps[3], 255, 225, sps.length >> 8, sps.length & 255]), sps, Buffer.from([1, pps.length >> 8, pps.length & 255]), pps]);
    const samples: Buffer[][] = [];
    for (const nal of nals) {
      if ((nal[0] & 31) === 9) samples.push([]);
      const size = Buffer.alloc(4); size.writeUInt32BE(nal.length);
      samples.at(-1)!.push(size, nal);
    }
    expect(samples).toHaveLength(300);
    const output = process.env.PIXEL_SAMPLE_MP4 ?? join(dir, 'sample.mp4');
    writeFileSync(output, Buffer.concat([mp4Header({ width: 1920, height: 1080, fps: 30, frames: 300 }, avcc),
      ...samples.map((s, i) => mp4Fragment(i, Buffer.concat(s), i === 0))]));
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', output], { encoding: 'utf8' }));
    expect(probe.streams).toHaveLength(1);
    expect(probe.streams[0]).toMatchObject({ codec_name: 'h264', width: 1920, height: 1080, r_frame_rate: '30/1', nb_read_frames: '300' });
    expect(Number(probe.format.duration)).toBe(10);
    execFileSync('ffmpeg', ['-v', 'error', '-i', output, '-f', 'null', '-']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 60000);
