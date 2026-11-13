import type { FrameInput, FrameSource } from '@/preview/contract';
import { abortable, checkAbort, NATIVE_LIMITS, validateNativeSpec, type FrameRows, type NativeVideoSpec } from './contract';

/** Browser-side frame producer only. The source/assets must already be prepared and immutable. */
export async function* canvasFrames(options: {
  source: FrameSource;
  input: Omit<FrameInput, 'frame' | 'width' | 'height' | 'fps'>;
  spec: NativeVideoSpec;
  signal?: AbortSignal;
  /** Must reject if the SOURCE/master cannot render exactly (including any internal GPU surface). */
  assertExactRendering: () => void | Promise<void>;
}): AsyncGenerator<FrameRows> {
  const { spec, signal } = options;
  validateNativeSpec(spec); checkAbort(signal);
  await abortable(Promise.resolve(options.assertExactRendering()), signal); checkAbort(signal);
  const canvas = document.createElement('canvas');
  try {
    canvas.width = spec.width; canvas.height = spec.height;
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!ctx || canvas.width !== spec.width || canvas.height !== spec.height) throw new Error('Unable to allocate exact native export canvas.');
    // Detect an unusable allocation before drawing. No preview scaling fallback.
    ctx.fillStyle = '#fff'; ctx.fillRect(spec.width - 1, spec.height - 1, 1, 1);
    if (ctx.getImageData(spec.width - 1, spec.height - 1, 1, 1).data[0] !== 255) throw new Error('Native export canvas exceeds this device limit.');
    const rowsPerChunk = Math.max(1, Math.floor(NATIVE_LIMITS.maxChunkBytes / (spec.width * 4)));
    for (let frame = 0; frame < spec.frames; frame++) {
      checkAbort(signal);
      ctx.save();
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, spec.width, spec.height);
        options.source.draw(ctx, { ...options.input, width: spec.width, height: spec.height, fps: spec.fps as FrameInput['fps'], frame },
          { scale: 1, fontFamily: 'Arial, sans-serif' });
      } finally { ctx.restore(); }
      for (let firstRow = 0; firstRow < spec.height; firstRow += rowsPerChunk) {
        checkAbort(signal);
        const rows = Math.min(rowsPerChunk, spec.height - firstRow);
        const pixels = ctx.getImageData(0, firstRow, spec.width, rows).data;
        yield { frame, firstRow, rows, rgba: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength) };
      }
      // Give cancel/UI events a chance even when transport resolves immediately.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  } finally { canvas.width = canvas.height = 0; }
}
