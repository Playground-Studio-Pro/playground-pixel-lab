export {};
declare global {
  interface Window {
    pixelLabDesktop?: {
      readonly version: 1;
      /** Pass returned text through shared parseProjectFile before updating state. */
      openProject(): Promise<{ name: string; text: string } | null>;
      saveProject(text: string, suggestedName: string): Promise<{ name: string } | null>;
      ffmpegStatus(): Promise<{ available: boolean; version?: string; reason?: string }>;
    };
  }
}
