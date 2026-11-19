import type { OutputControlApi } from "../../src/domain/physical-output";

declare global {
  interface Window {
    pixelLabDesktop?: {
      readonly version: 1;
      /** Pass returned text through shared parseProjectFile before updating state. */
      openProject(): Promise<{ name: string; text: string } | null>;
      saveProject(text: string, suggestedName: string): Promise<{ name: string } | null>;
      ffmpegStatus(): Promise<{ available: boolean; version?: string; reason?: string }>;
      /**
       * Physical output (Phase C). Grows to the whole OutputControlApi task by task; D5 adds open, close and status.
       * A rejected open or close carries the section 3 error code first in its message ("DISPLAY_BUSY: ...").
       */
      readonly output: Pick<OutputControlApi, "listDisplays" | "onDisplays" | "open" | "close" | "status" | "onStatus">;
    };
  }
}
