import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveMapping } from "@/engines/mapping";
import { GRID_COLORS, masterGridRegions } from "@/engines/pixel-grid";
import { displayProbes, masterProbes, type Probe } from "@/engines/pixel-probes";
import { videoTargets } from "@/engines/video-targets";
import { pixelTestProject } from "./fixtures/pixel-test";

const at = (probes: readonly Probe[], x: number, y: number) => probes.find((p) => p.x === x && p.y === y)?.rgb;

function pixelTestOut1() {
  const mapping = resolveMapping(pixelTestProject());
  const target = videoTargets(mapping).find((t) => t.kind === "output")!;
  return { mapping, target, probes: masterProbes(target, masterGridRegions(mapping.screens)) };
}

describe("pixel probes for the Electron pixel tests (PHYSICAL_OUTPUT 8.8, O5)", () => {
  it("display space: edges, corner markers and every checker pixel, inside the framebuffer, deterministic", () => {
    const probes = displayProbes(3600, 2338);
    expect(probes.length).toBeGreaterThan(2000);
    for (const p of probes) expect(p.x >= 0 && p.y >= 0 && p.x < 3600 && p.y < 2338).toBe(true);
    expect(at(probes, 0, 0)).toEqual(GRID_COLORS.white);
    expect(at(probes, 1, 1)).toEqual(GRID_COLORS.black);
    expect(at(probes, 3599, 2337)).toEqual(GRID_COLORS.white);
    expect(at(probes, 5, 5)).toEqual(GRID_COLORS.red);
    expect(displayProbes(3600, 2338)).toEqual(probes);
    expect(displayProbes(1800, 1169).length).toBeGreaterThan(2000);
  });

  it("master space: each slice's corners land at its output position; outside the slices is black", () => {
    const { mapping, target, probes } = pixelTestOut1();
    for (const s of mapping.screens) {
      const { x, y } = s.outputRect;
      const { width: w, height: h } = s.masterRect;
      expect(at(probes, x, y), s.name).toEqual(GRID_COLORS.white);
      expect(at(probes, x + w - 1, y + h - 1), s.name).toEqual(GRID_COLORS.white);
      expect(at(probes, x + 1, y + 1), s.name).toEqual(GRID_COLORS.black);
      expect(at(probes, x + 5, y + 5), s.name).toEqual(GRID_COLORS.red);
    }
    // Wall A starts at output (13, 7): the pixel before it is black.
    expect(at(probes, 12, 7)).toEqual([0, 0, 0]);
    expect(probes.every((p) => p.x < target.width && p.y < target.height)).toBe(true);
  });

  // Writes the probe sets the hidden smoke script reads (desktop/tests/smoke-scripts/o5-pixels.cjs), for the display
  // sizes of the run: PIXEL_PROBES_OUT=<file> PIXEL_PROBES_DISPLAYS=3600x2338,1800x1169 npx vitest run <this file>.
  it.runIf(Boolean(process.env.PIXEL_PROBES_OUT))("writes probe sets for the smoke script", () => {
    const pack = (probes: readonly Probe[]) => probes.map((p) => [p.x, p.y, ...p.rgb]);
    const displays = Object.fromEntries(
      (process.env.PIXEL_PROBES_DISPLAYS ?? "").split(",").filter(Boolean).map((s) => {
        const [w, h] = s.split("x").map(Number);
        return [s, pack(displayProbes(w, h))];
      }),
    );
    const { target, probes } = pixelTestOut1();
    writeFileSync(process.env.PIXEL_PROBES_OUT!, JSON.stringify({ displays, master: { "pixel-test/OUT 1": { size: [target.width, target.height], probes: pack(probes) } } }));
  });
});
