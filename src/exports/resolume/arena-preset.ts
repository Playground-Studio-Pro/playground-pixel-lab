import { orientationRadians, type ResolumeRect, type ResolumeSetup, type ResolumeSlice } from "./adapter";

/**
 * An Arena Advanced Output preset, as Arena 7.28.1 on macOS saves one. Pure and deterministic: the same setup and
 * name always give the same bytes.
 *
 * Tested once (2026-11-25, docs/integrations/RESOLUME.md): Arena loaded a file in this form with one Screen and
 * eight slices, and saved it back with every slice unchanged. Not tested: several Screens, other versions, Windows.
 * Each Screen's device is virtual, so loading the preset never opens a monitor, and no display id is written.
 */

export const ARENA_PRESET_VERSION = { major: 7, minor: 28, micro: 1, revision: 26535 } as const;

/** XML 1.0 can't hold these at all, even escaped. */
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/** An attribute value: markup escaped, and tab and line breaks kept as references so a parser doesn't fold them. */
export function xmlAttribute(value: string): string {
  return value
    .replace(FORBIDDEN, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/\t/g, "&#9;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;");
}

/**
 * Numbers as the tested file had them: whole pixels as they are, and the Bezier grid's thirds at 10 significant
 * digits (789.3333333). Never rounded to a pixel.
 */
export function arenaNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Can't write ${n} into an Arena preset.`);
  return String(Number.isInteger(n) ? n : +n.toPrecision(10));
}

/** 13 digits, like the ids Arena writes, from the preset's name, so the same project gives the same ids. */
export function arenaIdBase(seed: string): number {
  let hash = 0x811c9dc5;
  for (const char of seed) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return 1_700_000_000_000 + (hash % 90_000_000) * 1000;
}

type Point = readonly [number, number];

const corners = (r: ResolumeRect): Point[] => [
  [r.left, r.top],
  [r.left + r.width, r.top],
  [r.left + r.width, r.top + r.height],
  [r.left, r.top + r.height],
];

/** The 4 × 4 Bezier control grid Arena keeps for an unwarped slice, row by row from the top. */
const bezier = (r: ResolumeRect): Point[] => [0, 1, 2, 3].flatMap((j) => [0, 1, 2, 3].map((i): Point => [r.left + (r.width * i) / 3, r.top + (r.height * j) / 3]));

/**
 * Arena's `Flip` on a slice's Output params (UINT8). 0 none and 1 horizontal were seen in a file Arena 7.28.1 saved;
 * 2 (vertical) and 3 (both) follow the UI order and are NOT verified in Arena.
 */
export const ARENA_FLIP = { none: 0, h: 1, v: 2, hv: 3 } as const;
export const ARENA_FLIP_VERIFIED: readonly (keyof typeof ARENA_FLIP)[] = ["none", "h"];

/**
 * A rotated input: `orientation` in radians (positive clockwise on screen) and the four corners already turned about the
 * slice's centre, in composition pixels, as Arena writes them. Unrotated slices write exactly what they did before.
 */
function inputRect(slice: ResolumeSlice): { orientation: string; points: Point[] } {
  const turn = slice.rotation ?? 0;
  if (turn === 0 || !slice.inputCorners) return { orientation: "0", points: corners(slice.input) };
  return { orientation: arenaNumber(orientationRadians(turn)), points: slice.inputCorners.map((c): Point => [c.x, c.y]) };
}

export function buildArenaPreset(setup: ResolumeSetup, name: string): string {
  const lines: string[] = [];
  const line = (depth: number, text: string) => lines.push("\t".repeat(depth) + text);
  const points = (depth: number, list: readonly Point[]) => list.forEach(([x, y]) => line(depth, `<v x="${arenaNumber(x)}" y="${arenaNumber(y)}"/>`));
  const v = ARENA_PRESET_VERSION;
  let id = arenaIdBase(name);

  line(0, `<?xml version="1.0" encoding="utf-8"?>`);
  line(0, `<XmlState name="${xmlAttribute(name)}">`);
  line(1, `<versionInfo name="Resolume Arena" majorVersion="${v.major}" minorVersion="${v.minor}" microVersion="${v.micro}" revision="${v.revision}"/>`);
  line(1, `<ScreenSetup name="ScreenSetup">`);
  line(2, `<CurrentCompositionTextureSize width="${arenaNumber(setup.composition.width)}" height="${arenaNumber(setup.composition.height)}"/>`);
  line(2, `<screens>`);
  for (const screen of setup.screens) {
    const screenName = xmlAttribute(screen.name);
    line(3, `<Screen name="${screenName}" uniqueId="${id++}">`);
    line(4, `<Params name="Params">`);
    line(5, `<Param name="Name" T="STRING" default="" value="${screenName}"/>`);
    line(4, `</Params>`);
    line(4, `<guides>`);
    line(5, `<ScreenGuide name="ScreenGuide" type="0"/>`);
    line(5, `<ScreenGuide name="ScreenGuide" type="1"/>`);
    line(4, `</guides>`);
    line(4, `<layers>`);
    for (const slice of screen.slices) {
      const output = corners(slice.output);
      line(5, `<Slice uniqueId="${id++}">`);
      line(6, `<Params name="Common">`);
      line(7, `<Param name="Name" T="STRING" default="Layer" value="${xmlAttribute(slice.name)}"/>`);
      line(6, `</Params>`);
      // Mirror goes in the slice's Output params, written only when set so unmirrored slices are unchanged.
      const flip = slice.flip ?? "none";
      if (flip !== "none") {
        line(6, `<Params name="Output">`);
        line(7, `<Param name="Flip" T="UINT8" default="0" value="${ARENA_FLIP[flip]}"/>`);
        line(6, `</Params>`);
      }
      const input = inputRect(slice);
      line(6, `<InputRect orientation="${input.orientation}">`);
      points(7, input.points);
      line(6, `</InputRect>`);
      line(6, `<OutputRect orientation="0">`);
      points(7, output);
      line(6, `</OutputRect>`);
      line(6, `<Warper>`);
      line(7, `<BezierWarper controlWidth="4" controlHeight="4">`);
      line(8, `<vertices>`);
      points(9, bezier(slice.output));
      line(8, `</vertices>`);
      line(7, `</BezierWarper>`);
      line(7, `<Homography>`);
      line(8, `<src>`);
      points(9, output);
      line(8, `</src>`);
      line(8, `<dst>`);
      points(9, output);
      line(8, `</dst>`);
      line(7, `</Homography>`);
      line(6, `</Warper>`);
      line(5, `</Slice>`);
    }
    line(4, `</layers>`);
    line(4, `<OutputDevice>`);
    line(5, `<OutputDeviceVirtual name="${screenName}" deviceId="Virtual${screenName}" width="${arenaNumber(screen.width)}" height="${arenaNumber(screen.height)}"/>`);
    line(4, `</OutputDevice>`);
    line(3, `</Screen>`);
  }
  line(2, `</screens>`);
  line(1, `</ScreenSetup>`);
  line(0, `</XmlState>`);
  // Arena ends its own files with an empty line.
  return lines.join("\n") + "\n\n";
}
