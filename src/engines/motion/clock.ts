import type { ContentFps } from "@/domain/motion";

/**
 * Playback clock. Content time advances with wall time × speed while playing, and holds while paused.
 * Pure: the caller passes the current time in milliseconds.
 */
export interface PlaybackClock {
  readonly playing: boolean;
  /** Wall time when content time was last anchored. */
  readonly anchorMs: number;
  /** Content time at the anchor. */
  readonly baseMs: number;
  readonly speed: number;
}

export const initialClock: PlaybackClock = { playing: false, anchorMs: 0, baseMs: 0, speed: 1 };

export function contentTime(clock: PlaybackClock, nowMs: number): number {
  return clock.playing ? clock.baseMs + Math.max(0, nowMs - clock.anchorMs) * clock.speed : clock.baseMs;
}

export function play(clock: PlaybackClock, nowMs: number): PlaybackClock {
  return clock.playing ? clock : { ...clock, playing: true, anchorMs: nowMs };
}

export function pause(clock: PlaybackClock, nowMs: number): PlaybackClock {
  return clock.playing ? { ...clock, playing: false, baseMs: contentTime(clock, nowMs), anchorMs: nowMs } : clock;
}

/** Back to frame 0, keeping play or pause. */
export function restart(clock: PlaybackClock, nowMs: number): PlaybackClock {
  return { ...clock, baseMs: 0, anchorMs: nowMs };
}

/** Changes speed without a jump: content time continues from where it is. */
export function setSpeed(clock: PlaybackClock, speed: number, nowMs: number): PlaybackClock {
  return { ...clock, speed, baseMs: contentTime(clock, nowMs), anchorMs: nowMs };
}

/**
 * The content frame shown at a content time. The frame number is the only input to a pattern,
 * so the same frame gives the same pixels whether the browser draws fast or slow.
 */
export function frameAt(contentMs: number, fps: ContentFps): number {
  // The tiny epsilon keeps exact boundaries (1000 ms at 30 fps) from landing a frame early through float error.
  return Math.max(0, Math.floor((contentMs * fps) / 1000 + 1e-9));
}

/** Content time at the start of a frame, so changing FPS keeps the same moment in the content. */
export function frameStartMs(frame: number, fps: ContentFps): number {
  return (frame * 1000) / fps;
}

/** Non-drop timecode, HH:MM:SS:FF. */
export function timecode(frame: number, fps: ContentFps): string {
  const ff = frame % fps;
  const totalSeconds = Math.floor(frame / fps);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}:${pad(ff)}`;
}
