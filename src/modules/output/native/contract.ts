/** Export-owned boundary. No Electron, DOM, Node or shared-contract changes. */
export type NativePreset = 'prores422' | 'png-sequence';
export interface NativeVideoSpec {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frames: number;
  readonly preset: NativePreset;
}
/** Straight RGBA8, opaque alpha, top-down, tightly packed rows. Buffers remain owned until consumed. */
export interface FrameRows {
  readonly frame: number;
  readonly firstRow: number;
  readonly rows: number;
  readonly rgba: Uint8Array;
}
export interface NativeProgress {
  readonly phase: 'preparing' | 'encoding' | 'verifying' | 'publishing' | 'complete';
  readonly submittedFrames: number;
  readonly encodedFrames: number;
  readonly totalFrames: number;
}
/** Policy ceilings, not a promise every renderer/device supports these sizes. */
export const NATIVE_LIMITS = {
  maxSide: 16384, maxPixels: 33_554_432, maxChunkBytes: 1024 * 1024, maxSeconds: 600,
} as const;
export class NativeExportError extends Error {
  constructor(readonly code: 'INVALID_SETTINGS' | 'INVALID_FRAME' | 'BUSY' | 'UNSUPPORTED' |
    'DESTINATION_EXISTS' | 'PROCESS_FAILED' | 'DISK_FULL' | 'VERIFY_FAILED' | 'IO_ERROR', message: string) {
    super(message); this.name = 'NativeExportError';
  }
}
export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}
export function validateNativeSpec(s: NativeVideoSpec): void {
  if (!['prores422', 'png-sequence'].includes(s.preset) ||
      ![s.width, s.height, s.fps, s.frames].every(Number.isSafeInteger) ||
      s.width < 1 || s.height < 1 || s.width > NATIVE_LIMITS.maxSide || s.height > NATIVE_LIMITS.maxSide ||
      s.width * s.height > NATIVE_LIMITS.maxPixels || ![24, 25, 30, 50, 60].includes(s.fps) ||
      s.frames < 1 || s.frames > s.fps * NATIVE_LIMITS.maxSeconds ||
      (s.preset === 'prores422' && (s.width % 2 !== 0 || s.height % 2 !== 0))) {
    throw new NativeExportError('INVALID_SETTINGS', 'Unsupported native export size/rate/duration. ProRes 422 V1 requires even width and height; no resizing or padding is performed.');
  }
}
/** Race an uncooperative frame producer against cancellation, without leaving abort listeners behind. */
export async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  // Attach to the supplied promise even if already aborted: next() may already have rejected.
  if (!signal) return promise;
  let listener: () => void = () => {};
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      listener = () => reject(new DOMException('Export cancelled.', 'AbortError'));
      signal.addEventListener('abort', listener, { once: true });
      if (signal.aborted) listener();
    })]);
  } finally { signal.removeEventListener('abort', listener); }
}
