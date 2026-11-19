import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { CONTENT_FPS } from "@/domain/motion";
import {
  MAX_OUTPUTS,
  OUTPUT_CHANNELS,
  OUTPUT_ERROR_CODES,
  OUTPUT_RENDER_ERROR_CODES,
  OUTPUT_STATES,
  SIZE_MATCHES,
} from "@/domain/physical-output";

// Desktop's main process is CommonJS and keeps its own copies of the contract's closed lists (it can't load
// TypeScript). This test keeps them equal to src/domain/physical-output.ts.
const require = createRequire(import.meta.url);
const ipc = require("../desktop/src/output-ipc.cjs");
const windows = require("../desktop/src/windows.cjs");

describe("desktop CJS lists match the physical output contract", () => {
  it("states, error codes, size matches and content rates", () => {
    expect(ipc.OUTPUT_STATES).toEqual([...OUTPUT_STATES]);
    expect(ipc.OUTPUT_ERROR_CODES).toEqual([...OUTPUT_ERROR_CODES]);
    expect(ipc.OUTPUT_RENDER_ERROR_CODES).toEqual([...OUTPUT_RENDER_ERROR_CODES]);
    expect(ipc.SIZE_MATCHES).toEqual([...SIZE_MATCHES]);
    expect(ipc.CONTENT_FPS).toEqual([...CONTENT_FPS]);
  });

  it("IPC channel names", () => {
    expect(ipc.OUTPUT_CHANNELS).toEqual(OUTPUT_CHANNELS);
  });

  it("output limit and id pattern", () => {
    expect(windows.MAX_OUTPUTS).toBe(MAX_OUTPUTS);
    expect(ipc.MAX_OUTPUTS).toBe(MAX_OUTPUTS);
    // OutputId: 1–64 characters of [A-Za-z0-9_-] (physical-output.ts, OutputId).
    for (const id of ["a", "out-1", "show_5", "A".repeat(64)]) expect(windows.validOutputId(id)).toBe(true);
    for (const id of ["", "A".repeat(65), "a b", "a.b", "a/b", "é"]) expect(windows.validOutputId(id)).toBe(false);
  });

  it("the channels main and the preload use exist in the contract", () => {
    const contract = new Set(Object.values(OUTPUT_CHANNELS));
    for (const name of ["output:list-displays", "output:displays-changed"]) expect(contract.has(name as never)).toBe(true);
  });
});
