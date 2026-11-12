import type { FrameInput, FrameSource } from '@/preview/contract';
import { mp4Fragment, mp4Header, type Mp4Settings } from './mp4';

export interface VideoExportOptions extends Mp4Settings {
  source: FrameSource;
  /** Snapshot settings/media before calling; draw must not read changing UI state. */
  input: Omit<FrameInput, 'frame' | 'fps' | 'width' | 'height'>;
  signal?: AbortSignal;
  onProgress?: (encoded: number, total: number) => void;
  /** Preloaded origin-clean image, centered in master pixels. */
  logo?: { image: CanvasImageSource; width: number; height: number; opacity?: number };
}

export function validateVideoSettings(s: Mp4Settings): void {
  if (![s.width, s.height, s.fps, s.frames].every(Number.isSafeInteger) ||
      s.width < 2 || s.height < 2 || s.width % 2 || s.height % 2 ||
      s.width > 4096 || s.height > 4096 || s.width * s.height > 4096 * 2160 ||
      ![24, 25, 30, 50, 60].includes(s.fps) || s.frames < 1 || s.frames > s.fps * 600) {
    throw new Error('Unsupported export: use even dimensions up to 4096 per side / 8,847,360 pixels, 24/25/30/50/60 fps, and at most 10 minutes.');
  }
}

/** Bounded raw memory: one canvas/frame; flush every four submissions. Only compressed MP4 is retained. */
export async function exportMp4(options: VideoExportOptions): Promise<Blob> {
  validateVideoSettings(options);
  const { width, height, fps, frames, signal, logo } = options;
  const abort = () => signal?.throwIfAborted();
  abort();
  if (typeof VideoEncoder === 'undefined') throw new Error('H.264 export requires WebCodecs in a secure browser context.');
  if (logo && (!Number.isFinite(logo.width) || !Number.isFinite(logo.height) || logo.width <= 0 || logo.height <= 0 ||
      !Number.isFinite(logo.opacity ?? 1) || (logo.opacity ?? 1) < 0 || (logo.opacity ?? 1) > 1)) throw new Error('Invalid centered logo dimensions or opacity.');
  const config: VideoEncoderConfig = {
    codec: 'avc1.640033', width, height, framerate: fps,
    bitrate: Math.min(60_000_000, Math.max(2_000_000, width * height * fps * 0.18)),
    latencyMode: 'realtime', avc: { format: 'avc' },
  };
  const support = await VideoEncoder.isConfigSupported(config);
  abort();
  if (!support.supported) throw new Error(`H.264 encoding is unsupported at ${width}×${height}, ${fps} fps on this device.`);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Unable to allocate export canvas.');
  const parts: BlobPart[] = [];
  let count = 0;
  let failure: Error | undefined;
  let header = false;
  const encoder = new VideoEncoder({
    error: (error) => { failure = error; },
    output(chunk, metadata) {
      try {
        if (!header) {
          const description = metadata?.decoderConfig?.description;
          if (!description) throw new Error('Missing H.264 decoder configuration.');
          const avcc = ArrayBuffer.isView(description)
            ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
            : new Uint8Array(description);
          parts.push(new Blob([mp4Header(options, avcc) as Uint8Array<ArrayBuffer>]));
          header = true;
        }
        if (chunk.timestamp !== Math.round(count * 1_000_000 / fps)) throw new Error('Encoder reordered or dropped a frame.');
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        parts.push(new Blob([mp4Fragment(count, data, chunk.type === 'key') as Uint8Array<ArrayBuffer>]));
        count++;
        options.onProgress?.(count, frames);
      } catch (error) { failure = error instanceof Error ? error : new Error(String(error)); }
    },
  });
  const cancel = () => { if (encoder.state !== 'closed') encoder.close(); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    abort(); encoder.configure(config);
    for (let frame = 0; frame < frames; frame++) {
      abort(); if (failure) throw failure;
      ctx.save();
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
        options.source.draw(ctx, { ...options.input, frame, fps: fps as FrameInput['fps'], width, height }, { scale: 1, fontFamily: 'Arial, sans-serif' });
      } finally { ctx.restore(); }
      if (logo) {
        ctx.save();
        ctx.globalAlpha = logo.opacity ?? 1;
        ctx.drawImage(logo.image, (width - logo.width) / 2, (height - logo.height) / 2, logo.width, logo.height);
        ctx.restore();
      }
      const start = Math.round(frame * 1_000_000 / fps);
      const videoFrame = new VideoFrame(canvas, { timestamp: start, duration: Math.round((frame + 1) * 1_000_000 / fps) - start });
      try { encoder.encode(videoFrame, { keyFrame: frame % (fps * 2) === 0 }); }
      finally { videoFrame.close(); }
      if ((frame + 1) % 4 === 0) {
        await encoder.flush();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    await encoder.flush(); abort();
    if (failure) throw failure;
    if (!header || count !== frames) throw new Error(`Incomplete export: ${count}/${frames} frames.`);
    return new Blob(parts, { type: 'video/mp4' });
  } catch (error) { abort(); throw error; }
  finally {
    signal?.removeEventListener('abort', cancel);
    if (encoder.state !== 'closed') encoder.close();
    canvas.width = canvas.height = 0;
  }
}
