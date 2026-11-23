import type { FrameSource } from "@/preview/contract";
import type { drawWallBuild as Draw } from "./wall-build-draw";
import { useWallBuild } from "./wall-build-store";

/**
 * Wall Build as a `FrameSource`. The engine and the painting load on first use, so this stays small where
 * the registry is imported. Until they load, a frame is the plain background; `subscribe` then redraws it.
 * Anything that exports frames must wait for `prepareWallBuildSource` first.
 */

export const WALL_BUILD_SOURCE_ID = "wall-build";

let draw: typeof Draw | null = null;
let loading: Promise<void> | null = null;
const waiting = new Set<() => void>();

export function prepareWallBuildSource(): Promise<void> {
  loading ??= import("./wall-build-draw").then(
    (m) => {
      draw = m.drawWallBuild;
      waiting.forEach((onChange) => onChange());
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

export const wallBuildSource: FrameSource = {
  id: WALL_BUILD_SOURCE_ID,
  name: "Wall Build",
  draw(ctx, input, { scale }) {
    const { settings } = useWallBuild.getState();
    if (draw && input.context) {
      draw(ctx, input, scale, settings);
      return;
    }
    void prepareWallBuildSource().catch(() => undefined);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = settings.background;
    ctx.fillRect(0, 0, Math.ceil(input.width * scale), Math.ceil(input.height * scale));
  },
  subscribe(onChange) {
    waiting.add(onChange);
    const stop = useWallBuild.subscribe(onChange);
    return () => {
      waiting.delete(onChange);
      stop();
    };
  },
};
