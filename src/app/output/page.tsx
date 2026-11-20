"use client";

import { useEffect, useRef } from "react";
import type { OutputWindowApi } from "@/domain/physical-output";
import { depthMaxSize } from "@/modules/depth-studio/source";
import { browserRuntimeEnv, installOutputReference, OutputRuntime } from "@/modules/output/output-runtime";

/**
 * The output window's page (PHYSICAL_OUTPUT 8.1), exported as output.html. One canvas and nothing else: no
 * interface, no cursor, no text of its own. Everything it measures goes to the control window in reports.
 * Without the output preload (a normal browser) it stays black and logs one line.
 */

// Scoped to this page: it renders only on output.html.
const OUTPUT_CSS = `
html, body { margin: 0; padding: 0; background: #000; overflow: hidden; cursor: none; user-select: none; }
canvas[data-output] { display: block; position: fixed; left: 0; top: 0; image-rendering: pixelated; }
`;

/** One console line per page load, even when React runs the effect twice in development. */
let warned = false;

declare global {
  interface Window {
    pixelLabOutput?: OutputWindowApi;
  }
}

export default function OutputPage() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const api = window.pixelLabOutput;
    if (!api) {
      if (!warned) console.log("Pixel Lab output: no output preload, staying black.");
      warned = true;
      return;
    }
    const runtime = new OutputRuntime(browserRuntimeEnv(depthMaxSize));
    runtime.start(api, canvas.current!);
    // Hidden smoke runs only: a read-only reference of the MP4 exporter's frame N (O6). Absent without the flag.
    const removeReference = installOutputReference(window, api, runtime);
    return () => {
      removeReference();
      runtime.stop();
    };
  }, []);
  return (
    <>
      <style>{OUTPUT_CSS}</style>
      <canvas ref={canvas} data-output="" width={1} height={1} />
    </>
  );
}
