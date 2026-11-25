/** How long an exported file is. Pure. Wall Build also offers its own build time plus a hold on the finished wall. */

export const EXPORT_SECONDS = [5, 10, 15, 20, 30, 60] as const;
/** At least 2 s: the last worker leaves during the first second after the build. */
export const HOLD_SECONDS = [2, 3, 5, 10, 15, 30] as const;
export const DEFAULT_HOLD_SECONDS = 3;
/** `validateVideoSettings` refuses anything longer. */
export const MAX_EXPORT_SECONDS = 600;

/** Wall Build's own duration. */
export const BUILD_TIME = "build";

export interface DurationChoice {
  /** `BUILD_TIME`, or a number of seconds as text. */
  readonly key: string;
  readonly holdSeconds: number;
}

export function exportSeconds(choice: DurationChoice, buildSeconds: number | null): number {
  if (choice.key === BUILD_TIME && buildSeconds !== null) return buildSeconds + choice.holdSeconds;
  return Number(choice.key);
}

export function durationProblem(seconds: number): string | null {
  return seconds > MAX_EXPORT_SECONDS ? `${seconds} s is longer than ${MAX_EXPORT_SECONDS} s, the longest file. Shorten the build time or the hold.` : null;
}

/** Why a Wall Build file of this length doesn't show the finished wall, or null. */
export function buildCutWarning(seconds: number, buildSeconds: number): string | null {
  if (seconds > buildSeconds) return null;
  if (seconds === buildSeconds) return `The build takes ${buildSeconds} s, so this file ends just before the last cabinet is placed.`;
  return `The build takes ${buildSeconds} s. This file ends after ${seconds} s, before the wall is finished.`;
}
