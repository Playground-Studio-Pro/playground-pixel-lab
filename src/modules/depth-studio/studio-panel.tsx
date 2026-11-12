"use client";

import DepthInspector from "./depth-inspector";
import DepthPanel from "./depth-panel";

/** Depth Studio as a Content Studio panel: the viewport, with its controls where the inspector sits. */
export default function DepthStudioPanel() {
  return (
    <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_288px]">
      <div className="flex min-h-0 min-w-0 flex-col">
        <DepthPanel />
      </div>
      <DepthInspector />
    </div>
  );
}
