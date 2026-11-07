"use client";

import dynamic from "next/dynamic";
import { useMotion } from "@/state/motion-store";
import { CanvasHeader } from "./canvas-header";
import { WorkspaceCanvas } from "./workspace-canvas";

// Motion Lab loads on first use, so the editor doesn't pay for it.
const LivePreviewPanel = dynamic(() => import("@/components/motion/live-preview"), {
  ssr: false,
  loading: () => <main className="flex-1 bg-stage" aria-busy="true" />,
});

export function CanvasArea() {
  const mode = useMotion((s) => s.mode);
  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <CanvasHeader />
      {mode === "mapping" ? <WorkspaceCanvas /> : <LivePreviewPanel />}
    </div>
  );
}
