import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveMapping, type ResolvedMapping } from "@/engines/mapping";
import { validateProject } from "@/engines/validation";
import { buildExample } from "@/examples";
import { buildResolumeSetup, nativePresetSupport, type ResolumeRect, type ResolumeSetup } from "@/exports/resolume/adapter";
import { arenaIdBase, arenaNumber, buildArenaPreset, xmlAttribute } from "@/exports/resolume/arena-preset";
import { buildResolumePackage } from "@/exports/resolume/package";

/** A tiny parser for this XML: elements, attributes, the five entities and character references. */
interface Node { tag: string; attrs: Record<string, string>; children: Node[] }
const unescape = (v: string) => v.replace(/&(#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => (e[0] === "#" ? String.fromCharCode(Number(e.slice(1))) : { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e]!));
function parse(xml: string): Node {
  const root: Node = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  for (const [, close, tag, body, self] of xml.replace(/^<\?xml[^>]*\?>/, "").matchAll(/<(\/?)([\w]+)((?:\s+[\w]+="[^"]*")*)\s*(\/?)>/g)) {
    if (close) {
      expect(stack.pop()!.tag).toBe(tag);
      continue;
    }
    const node: Node = { tag, attrs: Object.fromEntries([...body.matchAll(/([\w]+)="([^"]*)"/g)].map(([, k, v]) => [k, unescape(v)])), children: [] };
    stack.at(-1)!.children.push(node);
    if (!self) stack.push(node);
  }
  expect(stack.length).toBe(1);
  return root.children[0];
}
const one = (n: Node, tag: string) => n.children.find((c) => c.tag === tag)!;
const all = (n: Node, tag: string) => n.children.filter((c) => c.tag === tag);
const vs = (n: Node) => all(n, "v").map((v) => [Number(v.attrs.x), Number(v.attrs.y)]);
/** Tags and attribute names in order, without values. */
const shape = (n: Node): unknown => [n.tag, Object.keys(n.attrs), n.children.map(shape)];
const maskIds = (xml: string) => xml.replace(/uniqueId="\d+"/g, 'uniqueId="#"');

const rect = (left: number, top: number, width: number, height: number): ResolumeRect => ({ left, top, width, height, centerX: left + width / 2, centerY: top + height / 2 });
const corners = (r: { x: number; y: number; width: number; height: number }) => [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height]];

const synthetic: ResolumeSetup = {
  composition: { width: 640, height: 360 },
  screens: [{ name: "Screen A", width: 320, height: 180, slices: [{ name: "Slice A", screenName: "Screen A", input: rect(10, 20, 200, 100), output: rect(30, 40, 200, 100) }] }],
};

/** HP Stage's slices: one 1920 × 1080 output, every slice where its content is. */
const HP: [string, number, number, number, number][] = [
  ["Header", 448, 24, 1024, 128], ["Centro", 480, 184, 960, 576], ["Cuchilla izq", 320, 216, 128, 512], ["Cuchilla der", 320, 216, 128, 512],
  ["Torre izq", 32, 88, 256, 768], ["Torre der", 1632, 88, 256, 768], ["DJ", 704, 792, 512, 128], ["Cinta", 64, 936, 1792, 128],
];
const hp: ResolumeSetup = {
  composition: { width: 1920, height: 1080 },
  screens: [{ name: "HP 1920x1080", width: 1920, height: 1080, slices: HP.map(([name, x, y, w, h]) => ({ name, screenName: "HP 1920x1080", input: rect(x, y, w, h), output: rect(x, y, w, h) })) }],
};

describe("Arena preset writer", () => {
  it("writes the shape Arena 7.28.1 saves, byte for byte apart from ids", () => {
    const fixture = readFileSync("tests/fixtures/arena-7.28.1-advanced-output-shape.xml", "utf8");
    const written = buildArenaPreset(synthetic, "Synthetic shape");
    expect(maskIds(written)).toBe(maskIds(fixture));
    expect(shape(parse(written))).toEqual(shape(parse(fixture)));
  });

  it("repeats that shape for every slice", () => {
    const fixture = parse(readFileSync("tests/fixtures/arena-7.28.1-advanced-output-shape.xml", "utf8"));
    const sliceShape = shape(one(one(one(one(one(fixture, "ScreenSetup"), "screens"), "Screen"), "layers"), "Slice"));
    const screen = one(one(one(parse(buildArenaPreset(hp, "HP")), "ScreenSetup"), "screens"), "Screen");
    expect(all(one(screen, "layers"), "Slice").map(shape)).toEqual(HP.map(() => sliceShape));
  });

  it("is byte-stable", () => {
    const a = buildArenaPreset(hp, "HP Stage");
    expect(buildArenaPreset(hp, "HP Stage")).toBe(a);
    expect(createHash("sha256").update(a).digest("hex")).toBe(createHash("sha256").update(buildArenaPreset(JSON.parse(JSON.stringify(hp)), "HP Stage")).digest("hex"));
    expect(a.endsWith("</XmlState>\n\n")).toBe(true);
    expect(a).not.toContain("\r");
  });

  it("writes HP Stage's values as tested", () => {
    const xml = buildArenaPreset(hp, "HP Stage");
    const screen = one(one(one(parse(xml), "ScreenSetup"), "screens"), "Screen");
    const slices = all(one(screen, "layers"), "Slice");
    expect(slices.map((s) => one(one(s, "Params"), "Param").attrs.value)).toEqual(HP.map(([n]) => n));
    expect(vs(one(slices[0], "InputRect"))).toEqual([[448, 24], [1472, 24], [1472, 152], [448, 152]]);
    expect(xml).toContain('<v x="789.3333333" y="66.66666667"/>');
    expect(xml).toContain('<v x="1258.666667" y="1021.333333"/>');
    expect(one(one(screen, "OutputDevice"), "OutputDeviceVirtual").attrs).toEqual({ name: "HP 1920x1080", deviceId: "VirtualHP 1920x1080", width: "1920", height: "1080" });
    // A virtual device only: nothing that names a display.
    expect(xml).not.toMatch(/OutputDevice(Display|Monitor)|displayId|monitor/i);
  });

  it("escapes names and keeps them exactly, accents included", () => {
    const name = `Pantalla "A" & <B> 'C' ñandú\tÉcran\nline`;
    const setup: ResolumeSetup = { ...synthetic, screens: [{ ...synthetic.screens[0], name, slices: [{ ...synthetic.screens[0].slices[0], name: `Slice <&> "x"` }] }] };
    const xml = buildArenaPreset(setup, `Show & "Co" <1>`);
    expect(xml).toContain('<XmlState name="Show &amp; &quot;Co&quot; &lt;1&gt;">');
    expect(xml).toContain("ñandú");
    const root = parse(xml);
    expect(root.attrs.name).toBe(`Show & "Co" <1>`);
    const screen = one(one(one(root, "ScreenSetup"), "screens"), "Screen");
    expect(screen.attrs.name).toBe(name);
    expect(one(one(screen, "OutputDevice"), "OutputDeviceVirtual").attrs.deviceId).toBe(`Virtual${name}`);
    expect(one(one(one(one(screen, "layers"), "Slice"), "Params"), "Param").attrs.value).toBe(`Slice <&> "x"`);
    expect(xmlAttribute("a\u0001b\u001Fc")).toBe("abc");
  });

  it("gives every Screen and Slice its own id, the same each time", () => {
    const ids = [...buildArenaPreset(hp, "HP").matchAll(/uniqueId="(\d+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(9);
    expect(new Set(ids).size).toBe(9);
    expect(ids.every((id) => id.length === 13)).toBe(true);
    expect(arenaIdBase("HP")).toBe(arenaIdBase("HP"));
    expect(arenaIdBase("HP")).not.toBe(arenaIdBase("HP 2"));
  });

  it("never rounds a number, and refuses one that isn't finite", () => {
    expect(arenaNumber(1472)).toBe("1472");
    expect(arenaNumber(1387.5)).toBe("1387.5");
    expect(arenaNumber(448 + 1024 / 3)).toBe("789.3333333");
    expect(() => arenaNumber(Number.NaN)).toThrow();
  });
});

/** Reads a preset back into the mapping's own terms. */
function readBack(mapping: ResolvedMapping, xml: string) {
  const setup = one(parse(xml), "ScreenSetup");
  const size = one(setup, "CurrentCompositionTextureSize").attrs;
  expect([Number(size.width), Number(size.height)]).toEqual([mapping.master.width, mapping.master.height]);
  return all(one(setup, "screens"), "Screen").map((screen) => ({
    name: screen.attrs.name,
    device: one(one(screen, "OutputDevice"), "OutputDeviceVirtual").attrs,
    slices: all(one(screen, "layers"), "Slice").map((s) => {
      const output = vs(one(s, "OutputRect"));
      const warper = one(s, "Warper");
      expect(vs(one(one(warper, "Homography"), "src"))).toEqual(output);
      expect(vs(one(one(warper, "Homography"), "dst"))).toEqual(output);
      expect(vs(one(one(warper, "BezierWarper"), "vertices"))).toHaveLength(16);
      return { name: one(one(s, "Params"), "Param").attrs.value, input: vs(one(s, "InputRect")), output };
    }),
  }));
}

describe("parse back equals the mapping", () => {
  for (const id of ["festival", "keynote", "motion-lab"] as const) {
    it(id, () => {
      const mapping = resolveMapping(buildExample(id));
      const screens = readBack(mapping, buildArenaPreset(buildResolumeSetup(mapping), id));
      const used = mapping.outputs.filter((o) => o.screenIds.length > 0);
      expect(screens.map((s) => [s.name, s.device.width, s.device.height])).toEqual(used.map((o) => [o.name, String(o.width), String(o.height)]));
      for (const [i, output] of used.entries()) {
        const expected = mapping.screens.filter((s) => s.outputId === output.outputId).map((s) => ({ name: s.name, input: corners(s.masterRect), output: corners(s.outputRect) }));
        expect(screens[i].slices).toEqual(expected);
      }
    });
  }
});

describe("in the Resolume package", () => {
  const fakePng = async () => new Blob(["png"]);
  const NOW = "2026-11-25T00:00:00.000Z";

  it("ships the preset marked as a test, with the README telling how to try it", async () => {
    const project = buildExample("keynote");
    const mapping = resolveMapping(project);
    const { files } = await buildResolumePackage(project, mapping, validateProject(project, mapping), NOW, fakePng);
    const preset = files.find((f) => f.path.endsWith(".xml"))!;
    expect(preset.path).toBe("corporate-keynote_arena-preset_TEST.xml");
    expect(preset.content).toBe(buildArenaPreset(buildResolumeSetup(mapping), "corporate-keynote_arena-preset_TEST"));
    const readme = files.find((f) => f.path === "README.md")!.content as string;
    expect(readme).toContain("## Arena preset (test)");
    expect(readme).toContain("First save your current Advanced Output setup");
    expect(readme).toContain("Arena 7.28.1");
    expect(readme).toContain("`~/Documents/Resolume Arena/Presets/Advanced Output/`");
    expect(readme).toContain("`Documents\\Resolume Arena\\Presets\\Advanced Output`, **not verified**");
    expect(readme).toContain("restart Arena");
    expect(readme).toContain("Never copy it over `Preferences/AdvancedOutput.xml`");
    expect(readme).toContain("## Setup");
    expect(readme).not.toContain("Not verified");
  });

  it("warns that several Screens aren't verified", async () => {
    const project = buildExample("festival");
    const mapping = resolveMapping(project);
    const { files } = await buildResolumePackage(project, mapping, validateProject(project, mapping), NOW, fakePng);
    expect(files.find((f) => f.path === "README.md")!.content).toContain("**Not verified: 2 Screens.**");
  });

  it("still doesn't claim native preset support", () => {
    expect(nativePresetSupport.status).toBe("unsupported");
  });
});
