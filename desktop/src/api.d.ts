export {};
// Mirrors DisplayInfo in src/domain/physical-output.ts (PR #21); switch to importing it once that is on main.
interface DesktopDisplayInfo {
  key: { label: string; devicePx: { width: number; height: number }; internal: boolean; electronId: number };
  electronId: number;
  label: string;
  internal: boolean;
  primary: boolean;
  boundsDip: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  devicePx: { width: number; height: number };
  devicePxExact: boolean;
  rotation: 0 | 90 | 180 | 270;
  refreshHz: number;
  hostsControlWindow: boolean;
  hostsOutput: string | null;
}
declare global {
  interface Window {
    pixelLabDesktop?: {
      readonly version: 1;
      /** Pass returned text through shared parseProjectFile before updating state. */
      openProject(): Promise<{ name: string; text: string } | null>;
      saveProject(text: string, suggestedName: string): Promise<{ name: string } | null>;
      ffmpegStatus(): Promise<{ available: boolean; version?: string; reason?: string }>;
      readonly output: {
        listDisplays(): Promise<DesktopDisplayInfo[]>;
        /** Called after display-added / removed / metrics-changed, debounced 250 ms. Returns an unsubscribe. */
        onDisplays(callback: (displays: DesktopDisplayInfo[]) => void): () => void;
      };
    };
  }
}
