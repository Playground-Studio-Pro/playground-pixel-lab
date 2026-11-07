import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it } from "vitest";
import { useMotion } from "@/state/motion-store";
import { useApp } from "@/state/store";
import { motionLabProject } from "./helpers";
import { serializeProject } from "@/persistence/schema";

describe("Motion Lab playback state", () => {
  beforeAll(async () => {
    await useApp.getState().init();
    await useApp.getState().importProject(serializeProject(motionLabProject().project));
  });

  it("never touches the project, its history or its save state", () => {
    const before = useApp.getState();
    const motion = useMotion.getState();
    motion.setMode("live");
    motion.setPattern("grid");
    motion.setFps(50);
    motion.setSpeed(2);
    motion.togglePlay();
    motion.restart();
    motion.setShowOverlaps(false);
    motion.setMode("mapping");
    const after = useApp.getState();
    expect(after.project).toBe(before.project);
    expect(after.mapping).toBe(before.mapping);
    expect(after.history).toBe(before.history);
    expect(after.saveStatus).toBe(before.saveStatus);
  });

  it("starts playing once the opened preview is ready, and pauses when it closes", () => {
    const motion = useMotion.getState();
    motion.setMode("live");
    // Not before the preview can draw: no frames may pass unseen while it loads.
    expect(useMotion.getState().clock.playing).toBe(false);
    useMotion.getState().startPendingPlayback();
    expect(useMotion.getState().clock.playing).toBe(true);
    useMotion.getState().startPendingPlayback();
    expect(useMotion.getState().autoplayPending).toBe(false);
    motion.setMode("mapping");
    expect(useMotion.getState().clock.playing).toBe(false);
  });

  it("resets measured statistics when playback changes", () => {
    const epoch = useMotion.getState().statsEpoch;
    useMotion.getState().restart();
    useMotion.getState().setFps(24);
    expect(useMotion.getState().statsEpoch).toBe(epoch + 2);
  });
});
