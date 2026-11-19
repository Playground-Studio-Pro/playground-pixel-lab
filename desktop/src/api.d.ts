import type { OutputControlApi } from "../../src/domain/physical-output";

declare global {
  interface Window {
    pixelLabDesktop?: {
      readonly version: 1;
      /** Pass returned text through shared parseProjectFile before updating state. */
      openProject(): Promise<{ name: string; text: string } | null>;
      saveProject(text: string, suggestedName: string): Promise<{ name: string } | null>;
      ffmpegStatus(): Promise<{ available: boolean; version?: string; reason?: string }>;
      /** Physical output (Phase C). Grows to the whole OutputControlApi as D3–D5 land; displays only so far. */
      readonly output: Pick<OutputControlApi, "listDisplays" | "onDisplays">;
    };
  }
}
