import { describe, expect, it, vi, afterEach } from 'vitest';
import { exportMp4, validateVideoSettings } from '@/modules/output/video-export';
import { mp4Header, mp4Fragment } from '@/modules/output/mp4';
const settings = { width: 1920, height: 1080, fps: 30, frames: 300 };
afterEach(() => vi.unstubAllGlobals());

describe('H.264 export', () => {
  it('accepts the 1080p acceptance configuration and rejects unsupported sizes', () => {
    expect(() => validateVideoSettings(settings)).not.toThrow();
    for (const patch of [{ width: 1919 }, { height: 0 }, { width: 8192 }, { fps: 29.97 }, { frames: 0 }, { frames: 18001 }]) {
      expect(() => validateVideoSettings({ ...settings, ...patch })).toThrow('Unsupported');
    }
  });
  it('writes ISO BMFF headers and fragment sample offsets', () => {
    const header = mp4Header(settings, new Uint8Array([1, 100, 0, 51, 255, 225, 0]));
    const text = new TextDecoder().decode(header);
    for (const tag of ['ftyp', 'moov', 'avc1', 'avcC', 'mvex']) expect(text).toContain(tag);
    const fragment = mp4Fragment(0, new Uint8Array([1, 2, 3]), true);
    const view = new DataView(fragment.buffer);
    const moofSize = view.getUint32(0);
    expect(view.getUint32(moofSize)).toBe(11);
    expect(new TextDecoder().decode(fragment.slice(moofSize + 4, moofSize + 8))).toBe('mdat');
    expect(() => mp4Header(settings, new Uint8Array())).toThrow('AVC');
  });
  it('encodes deterministic indices, reports progress and closes all frames', async () => {
    const draw = vi.fn(); const progress = vi.fn(); const close = vi.fn();
    const timestamps: number[] = [];
    const ctx = { save() {}, restore() {}, setTransform() {}, fillRect() {} };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx }) });
    vi.stubGlobal('VideoFrame', class {
      timestamp: number;
      constructor(_canvas: unknown, init: { timestamp: number }) { this.timestamp = init.timestamp; }
      close = close;
    });
    class Encoder {
      static isConfigSupported = vi.fn(async () => ({ supported: true }));
      state = 'configured';
      constructor(private callbacks: VideoEncoderInit) {}
      configure() {}
      encode(frame: VideoFrame) {
        timestamps.push(frame.timestamp);
        this.callbacks.output({ timestamp: frame.timestamp, byteLength: 4, type: 'key', copyTo: (b: Uint8Array) => b.set([0, 0, 0, 0]) } as unknown as EncodedVideoChunk,
          { decoderConfig: { codec: 'avc1.640033', description: new Uint8Array([1, 100, 0, 51, 255, 225, 0]) } });
      }
      async flush() {}
      close() { this.state = 'closed'; }
    }
    vi.stubGlobal('VideoEncoder', Encoder);
    const blob = await exportMp4({ ...settings, source: { id: 'test', name: 'test', draw }, input: { screens: [] }, onProgress: progress });
    expect(blob.type).toBe('video/mp4');
    expect(draw.mock.calls.map(c => c[1].frame)).toEqual(Array.from({ length: 300 }, (_, i) => i));
    expect(timestamps.at(-1)).toBe(9966667);
    expect(close).toHaveBeenCalledTimes(300);
    expect(progress).toHaveBeenLastCalledWith(300, 300);
    const during = new AbortController();
    await expect(exportMp4({ ...settings, source: { id: 'x', name: 'x', draw }, input: { screens: [] },
      signal: during.signal, onProgress: () => during.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(exportMp4({ ...settings, source: { id: 'x', name: 'x', draw: () => { throw new Error('Draw failed'); } },
      input: { screens: [] } })).rejects.toThrow('Draw failed');
    Encoder.isConfigSupported.mockResolvedValue({ supported: false });
    await expect(exportMp4({ ...settings, source: { id: 'x', name: 'x', draw }, input: { screens: [] } })).rejects.toThrow('unsupported');
    const controller = new AbortController(); controller.abort();
    await expect(exportMp4({ ...settings, source: { id: 'x', name: 'x', draw }, input: { screens: [] }, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
