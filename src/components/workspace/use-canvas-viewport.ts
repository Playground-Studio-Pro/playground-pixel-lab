"use client";

import { useEffect, type RefObject } from "react";
import { wheelViewport } from "@/engines/viewport";
import { useApp, zoomLimits } from "@/state/store";

/**
 * What every canvas mode shares: reporting its size, fitting a view the first time it's shown,
 * and wheel or trackpad zoom and pan. Each view keeps its own zoom and pan across modes.
 */
export function useCanvasViewport(containerRef: RefObject<HTMLDivElement | null>) {
  const view = useApp((s) => s.view);
  const viewport = useApp((s) => s.viewports[s.view]);
  const size = useApp((s) => s.canvasSize);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      useApp.getState().setCanvasSize(Math.floor(entry.contentRect.width), Math.floor(entry.contentRect.height));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef]);

  // Fit the first time a view is shown.
  useEffect(() => {
    if (!viewport && size.width > 0) useApp.getState().fit();
  }, [viewport, size.width, view]);

  // Wheel is attached natively: React's listener is passive and can't stop the page zooming.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const app = useApp.getState();
      const vp = app.viewports[app.view];
      if (!vp) return;
      const rect = el.getBoundingClientRect();
      app.setViewport(
        app.view,
        wheelViewport(
          vp,
          { deltaX: e.deltaX, deltaY: e.deltaY, zoom: e.ctrlKey || e.metaKey, x: e.clientX - rect.left, y: e.clientY - rect.top },
          zoomLimits.MIN_ZOOM[app.view],
          zoomLimits.MAX_ZOOM[app.view],
        ),
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [containerRef]);
}
