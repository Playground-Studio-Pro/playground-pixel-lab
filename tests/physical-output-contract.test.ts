import { describe, expect, it } from "vitest";
import {
  MAX_OUTPUTS,
  OUTPUT_CHANNELS,
  OUTPUT_ERROR_CODES,
  OUTPUT_RENDER_ERROR_CODES,
  OUTPUT_SOURCE_IDS,
  OUTPUT_STATES,
  SIZE_MATCHES,
} from "@/domain/physical-output";

const unique = (list: readonly string[]) => new Set(list).size === list.length;

describe("physical output contract", () => {
  it("keeps every closed list free of duplicates", () => {
    for (const list of [OUTPUT_STATES, OUTPUT_ERROR_CODES, OUTPUT_RENDER_ERROR_CODES, OUTPUT_SOURCE_IDS, SIZE_MATCHES]) {
      expect(unique(list)).toBe(true);
    }
  });

  it("has the states, sources and limits approved for Alpha 0.1", () => {
    expect(OUTPUT_STATES).toContain("held");
    expect(OUTPUT_ERROR_CODES).toEqual(expect.arrayContaining(["DISPLAY_AMBIGUOUS", "NOT_RESUMABLE", "NOT_ONE_TO_ONE"]));
    expect([...OUTPUT_SOURCE_IDS]).toEqual(["calibration-test-card", "pixel-grid", "depth-scene"]);
    expect(MAX_OUTPUTS).toBe(1);
  });

  it("names every IPC channel once, under the output: prefix", () => {
    const channels = Object.values(OUTPUT_CHANNELS);
    expect(unique(channels)).toBe(true);
    for (const channel of channels) expect(channel).toMatch(/^output:[a-z-]+$/);
  });
});
