import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveMapping } from "@/engines/mapping";
import * as ops from "@/engines/project-ops";
import { buildResolumeGuide, buildResolumeSetup, type ResolumeSetup } from "@/exports/resolume/adapter";
import { ARENA_FLIP, ARENA_FLIP_VERIFIED, buildArenaPreset } from "@/exports/resolume/arena-preset";
import { threeScreenProject } from "./helpers";

/** The first <tag ...> block's attributes, and the <v> points inside it. */
function element(xml: string, open: RegExp): { attrs: Record<string, string>; points: { x: number; y: number }[] } | null {
  const m = open.exec(xml);
  if (!m) return null;
  const attrs = Object.fromEntries([...m[0].matchAll(/(\w[\w-]*)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
  const tag = m[0].match(/^<(\w+)/)![1];
  const end = xml.indexOf(`</${tag}>`, m.index);
  const body = end > 0 ? xml.slice(m.index, end) : "";
  return { attrs, points: [...body.matchAll(/<v x="([^"]+)" y="([^"]+)"\/>/g)].map((p) => ({ x: Number(p[1]), y: Number(p[2]) })) };
}

const fixture = readFileSync("tests/fixtures/arena-7.28.1-rotated-slice-shape.xml", "utf8");

function turned(flip: "h" | "v" | "hv" | "none", rotation = 45): ResolumeSetup {
  const t = (rotation * Math.PI) / 180;
  const [cx, cy, hw, hh] = [200, 100, 100, 50];
  const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([dx, dy]) => ({ x: cx + dx * Math.cos(t) - dy * Math.sin(t), y: cy + dx * Math.sin(t) + dy * Math.cos(t) }));
  const rect = { left: 100, top: 50, width: 200, height: 100, centerX: 200, centerY: 100 };
  return {
    composition: { width: 640, height: 360 },
    screens: [{ name: "Screen A", width: 640, height: 360, slices: [{ name: "Turned", screenName: "Screen A", input: rect, output: { ...rect, left: 0, top: 0, centerX: 100, centerY: 50 }, rotation, flip, inputCorners: corners }] }],
  };
}

describe("Arena preset: rotation and mirror (schema 3)", () => {
  it("writes the shape Arena saves: orientation 0.785398, corners turned about the centre within 0.01 px, Flip 1", () => {
    const xml = buildArenaPreset(turned("h"), "Turned");
    const ours = element(xml, /<InputRect [^>]*>/)!;
    const theirs = element(fixture, /<InputRect [^>]*>/)!;
    expect(Object.keys(ours.attrs)).toEqual(Object.keys(theirs.attrs));
    expect(ours.attrs.orientation).toBe("0.785398");
    ours.points.forEach((p, i) => {
      expect(Math.abs(p.x - theirs.points[i].x)).toBeLessThan(0.01);
      expect(Math.abs(p.y - theirs.points[i].y)).toBeLessThan(0.01);
    });
    const flipOurs = element(xml, /<Param name="Flip"[^>]*>/)!;
    const flipTheirs = element(fixture, /<Param name="Flip"[^>]*>/)!;
    expect(flipOurs.attrs).toEqual(flipTheirs.attrs);
    // Same nesting: Params name="Output" holds Flip, before InputRect.
    expect(xml.indexOf('<Params name="Output">')).toBeLessThan(xml.indexOf("<InputRect"));
    expect(xml.indexOf('<Param name="Flip"')).toBeGreaterThan(xml.indexOf('<Params name="Output">'));
  });

  it("writes vertical and both as 2 and 3, which aren't verified", () => {
    expect(element(buildArenaPreset(turned("v"), "V"), /<Param name="Flip"[^>]*>/)!.attrs.value).toBe("2");
    expect(element(buildArenaPreset(turned("hv"), "HV"), /<Param name="Flip"[^>]*>/)!.attrs.value).toBe("3");
    expect(ARENA_FLIP).toEqual({ none: 0, h: 1, v: 2, hv: 3 });
    expect(ARENA_FLIP_VERIFIED).toEqual(["none", "h"]);
  });

  it("leaves an unturned, unmirrored slice exactly as before: no Output params, orientation 0, its rectangle's corners", () => {
    const xml = buildArenaPreset(turned("none", 0), "Plain");
    expect(xml).not.toContain('<Params name="Output">');
    expect(element(xml, /<InputRect [^>]*>/)).toEqual({ attrs: { orientation: "0" }, points: [{ x: 100, y: 50 }, { x: 300, y: 50 }, { x: 300, y: 150 }, { x: 100, y: 150 }] });
  });

  it("from a project: the mapping's turn reaches the preset, and the guide marks vertical and both mirrors unverified", () => {
    const { project, ids } = threeScreenProject();
    const p = ops.setRegionFlip(ops.setRegionRotation(project, ids.left, 45), ids.left, "v");
    const setup = buildResolumeSetup(resolveMapping(p));
    const xml = buildArenaPreset(setup, "Project");
    expect(xml).toContain('<InputRect orientation="0.785398">');
    expect(xml).toContain('<Param name="Flip" T="UINT8" default="0" value="2"/>');
    const guide = buildResolumeGuide(p, setup, { masterPng: "m.png" });
    expect(guide).toMatch(/Flip 2 \(vertical\) and 3 \(both\).*not been verified in Arena/);
  });
});
