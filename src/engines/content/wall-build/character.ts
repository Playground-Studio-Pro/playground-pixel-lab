/**
 * Pitch, the worker of Wall Build: an original character, described as data.
 *
 * Pure and deterministic. `workerShapes` turns a pose, a height and colours into flat shapes in whole
 * pixels, relative to the point on the ground between the feet (x right, y down, so the worker is at
 * negative y). It draws nothing: `modules/content` draws these shapes on a canvas.
 *
 * The art is defined on an integer grid 256 units tall. At 128, 256 or 512 px it scales exactly; at any
 * other height every coordinate is rounded to a whole pixel. Cabinets are never scaled with the worker:
 * their size always comes from the mapping, and the hands adapt to it.
 */

import { isHexColor, outlineFor } from "./contrast";
import { DEFAULT_WORKER_COLORS, type WorkerColors } from "./settings";

export type { WorkerColors };

export type Point = readonly [x: number, y: number];

export type WorkerShape =
  | { readonly kind: "rect"; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly r: number; readonly fill: string }
  | { readonly kind: "poly"; readonly points: readonly Point[]; readonly fill: string }
  | { readonly kind: "disc"; readonly x: number; readonly y: number; readonly r: number; readonly fill: string }
  /** A line with round joins and ends: arms, legs and the microphone boom. */
  | { readonly kind: "line"; readonly points: readonly Point[]; readonly width: number; readonly fill: string }
  /** Starts at `from`; each curve is quadratic: control point, then end point. Closed. */
  | { readonly kind: "curve"; readonly from: Point; readonly curves: readonly (readonly [Point, Point])[]; readonly fill: string };

/** Height of the art grid, in units: ground to the top of the helmet. */
export const WORKER_UNITS = 256;

export const WORKER_POSE_IDS = ["stand", "carry-head", "carry-front", "place", "place-low"] as const;
export type WorkerPoseId = (typeof WORKER_POSE_IDS)[number];

/** Where the cabinet is held. `null`: nothing is held. */
export type Hold = "head" | "front" | "side" | null;

/** A pose, in art units, facing right. Near is the side closer to the viewer. */
export interface WorkerPose {
  readonly hold: Hold;
  /** How far the shoulders move forward of the hips. */
  readonly lean: number;
  /** How far the hips drop. */
  readonly drop: number;
  /** Half the distance between the shoulders. Narrower when the body turns sideways. */
  readonly shoulders: number;
  /** Hip and ankle positions, and which way the knees bend (1 forward, -1 back). */
  readonly farLeg: { readonly hip: number; readonly ankle: Point; readonly bend: 1 | -1 };
  readonly nearLeg: { readonly hip: number; readonly ankle: Point; readonly bend: 1 | -1 };
  /** Hands when nothing is held. Otherwise they go to the cabinet. */
  readonly farHand: Point;
  readonly nearHand: Point;
}

export const WORKER_POSES: Readonly<Record<WorkerPoseId, WorkerPose>> = {
  stand: {
    hold: null, lean: 0, drop: 0, shoulders: 36,
    farLeg: { hip: 14, ankle: [20, -12], bend: 1 },
    nearLeg: { hip: -14, ankle: [-22, -12], bend: 1 },
    farHand: [54, -70], nearHand: [-58, -70],
  },
  "carry-head": {
    hold: "head", lean: 0, drop: 4, shoulders: 42,
    farLeg: { hip: 10, ankle: [32, -12], bend: 1 },
    nearLeg: { hip: -10, ankle: [-34, -12], bend: 1 },
    farHand: [68, -242], nearHand: [-68, -242],
  },
  "carry-front": {
    hold: "front", lean: -4, drop: 6, shoulders: 34,
    farLeg: { hip: 10, ankle: [30, -12], bend: 1 },
    nearLeg: { hip: -10, ankle: [-32, -12], bend: 1 },
    farHand: [40, -110], nearHand: [-10, -110],
  },
  place: {
    hold: "side", lean: 26, drop: 26, shoulders: 24,
    farLeg: { hip: 10, ankle: [26, -12], bend: 1 },
    nearLeg: { hip: -10, ankle: [-50, -12], bend: 1 },
    farHand: [76, -128], nearHand: [76, -76],
  },
  "place-low": {
    hold: "side", lean: 34, drop: 46, shoulders: 24,
    farLeg: { hip: 8, ankle: [20, -12], bend: 1 },
    nearLeg: { hip: -12, ankle: [-52, -12], bend: 1 },
    farHand: [76, -52], nearHand: [76, -26],
  },
};

/**
 * Ankle positions through one walking cycle, facing right. The far leg is half a cycle behind.
 * On the ground a foot moves back about `WALK_STEP_UNITS` per step, so the feet don't slide.
 */
export const WALK_CYCLE: readonly Point[] = [
  [32, -12], [16, -12], [0, -12], [-18, -12], [-34, -14], [-18, -26], [4, -30], [24, -20],
];
export const WALK_STEP_UNITS = 17;

/** Fixed colours. Limbs are light, so they read on dark walls. The outline covers every other background. */
const INK = "#070A16";
const SHIRT = "#A9BAF5";
const SHIRT_FAR = "#8496DA";
const TROUSERS = "#AEB7CC";
const TROUSERS_FAR = "#8E98B2";
const BOOT = "#D09A6B";
const BOOT_FAR = "#B07D52";
/** The arm, leg and boot colours, for the contrast check. */
export const LIMB_COLORS = [SHIRT, SHIRT_FAR, TROUSERS, TROUSERS_FAR, BOOT, BOOT_FAR] as const;
const SOLE = "#E6EBF7";
const GLOVE = "#E6EBF7";
const GLOVE_FAR = "#BAC4DC";
const SHELL = "#DCE3F3";
const SHELL_SHADE = "#AEB9D4";
/** The screen face. Used by nothing else, so a test can find it. */
export const FACE = "#0B1024";
const PIXEL = "#5BE7FF";
const REFLECT = "#F4F8FF";
const BELT = "#1B2240";
const POUCH = "#A67B55";

/** `color` moved toward black (negative) or white (positive) by `percent`. Integer channels. */
export function shade(color: string, percent: number): string {
  const n = Number.parseInt(color.slice(1), 16);
  const target = percent < 0 ? 0 : 255;
  const mix = (v: number) => Math.round(v + ((target - v) * Math.abs(percent)) / 100);
  const channels = [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)];
  return `#${channels.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export interface WorkerInput {
  readonly pose: WorkerPoseId;
  /** Ground to helmet, in whole pixels. */
  readonly height: number;
  readonly colors?: WorkerColors;
  /** 1 faces right, -1 faces left. */
  readonly facing?: 1 | -1;
  /** The held cabinet's size in pixels, from the mapping. Ignored by poses that hold nothing. */
  readonly cabinet?: { readonly width: number; readonly height: number };
  /** `#RRGGBB` behind the worker. Chooses the outline that stands out from it. */
  readonly background?: string;
  /** Step of the walking cycle. Absent: the pose's own legs. */
  readonly step?: number;
  readonly blink?: boolean;
  /** How far above the feet a placed cabinet's bottom edge is, in pixels. */
  readonly lift?: number;
}

export interface WorkerDrawing {
  /** Draw these first. */
  readonly behind: readonly WorkerShape[];
  /** The held cabinet's rectangle, at its exact mapped size. Draw it between the two lists. */
  readonly cabinet: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
  /** Draw these last: the hands, in front of the cabinet. */
  readonly front: readonly WorkerShape[];
}

/** Elbow or knee between `a` and `b`, for two equal limb halves. `bend` picks the side. */
function joint(a: Point, b: Point, half: number, bend: 1 | -1): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const d2 = dx * dx + dy * dy;
  if (d2 === 0) return a;
  const d = Math.sqrt(d2);
  const side = (Math.sqrt(Math.max(0, half * half - d2 / 4)) * bend) / d;
  return [Math.round(a[0] + dx / 2 + dy * side), Math.round(a[1] + dy / 2 - dx * side)];
}

/** `b`, brought within `reach` of `a`. */
function within(a: Point, b: Point, reach: number): Point {
  const d = Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
  if (d <= reach) return b;
  return [Math.round(a[0] + ((b[0] - a[0]) * reach) / d), Math.round(a[1] + ((b[1] - a[1]) * reach) / d)];
}

const rect = (x: number, y: number, w: number, h: number, r: number, fill: string): WorkerShape => ({ kind: "rect", x, y, w, h, r, fill });
const disc = (x: number, y: number, r: number, fill: string): WorkerShape => ({ kind: "disc", x, y, r, fill });
const line = (points: readonly Point[], width: number, fill: string): WorkerShape => ({ kind: "line", points, width, fill });
const poly = (points: readonly Point[], fill: string): WorkerShape => ({ kind: "poly", points, fill });

/** Ink around a group, in units. Drawn under the whole group, so shapes inside it share one outline. */
const OUTLINE = 4;

/** Light or dark rim around the whole worker, in units beyond the ink. */
const RIM = 4;

function outlined(shapes: readonly WorkerShape[]): WorkerShape[] {
  return [...expanded(shapes, OUTLINE, INK), ...shapes];
}

/** Every shape grown by `by` units, in one colour. */
function expanded(shapes: readonly WorkerShape[], by: number, fill: string): WorkerShape[] {
  return shapes.map((s): WorkerShape => {
    if (s.kind === "rect") return { ...s, x: s.x - by, y: s.y - by, w: s.w + 2 * by, h: s.h + 2 * by, r: s.r + by, fill };
    if (s.kind === "disc") return { ...s, r: s.r + by, fill };
    if (s.kind === "line") return { ...s, width: s.width + 2 * by, fill };
    // Closed shapes: their edge as a thick line around them. The shape itself covers the middle.
    if (s.kind === "poly") return { kind: "line", points: [...s.points, s.points[0]], width: 2 * by, fill };
    return { kind: "line", points: flatten(s), width: 2 * by, fill };
  });
}

/** A curve's edge as points, for its outline. */
function flatten(s: Extract<WorkerShape, { kind: "curve" }>): Point[] {
  const points: Point[] = [s.from];
  let a = s.from;
  for (const [c, b] of s.curves) {
    for (let i = 1; i <= 8; i++) {
      const t = i / 8;
      const u = 1 - t;
      points.push([Math.round(u * u * a[0] + 2 * u * t * c[0] + t * t * b[0]), Math.round(u * u * a[1] + 2 * u * t * c[1] + t * t * b[1])]);
    }
    a = b;
  }
  return [...points, s.from];
}

const HIP_Y = -90;
const SHOULDER_Y = -150;
const LEG_HALF = 40;
const ARM_HALF = 50;
/** Where a placed cabinet's near edge is, in front of the worker. */
const SIDE_EDGE = 86;

/** The held cabinet, in pixels, and the hand positions in units. */
function grip(pose: WorkerPose, height: number, cabinet: { width: number; height: number }, lift: number) {
  const toPx = (u: number) => Math.round((u * height) / WORKER_UNITS);
  const toUnits = (v: number) => Math.round((v * WORKER_UNITS) / height);
  const { width, height: h } = cabinet;
  const halfW = toUnits(width / 2);
  if (pose.hold === "head") {
    const top = toPx(-252 + pose.drop);
    // Hands stay wide of the head, even under a narrow cabinet, so the arms never cross the face.
    const reach = Math.min(68, Math.max(58, halfW));
    const handY = -242 + pose.drop;
    return { rect: { x: -Math.floor(width / 2), y: top - h, width, height: h }, far: [reach, handY] as Point, near: [-reach, handY] as Point };
  }
  if (pose.hold === "front") {
    const bottom = toPx(-72 + pose.drop);
    const x = toPx(16) - Math.floor(width / 2);
    const handY = -78 + pose.drop;
    return { rect: { x, y: bottom - h, width, height: h }, far: [16 + Math.min(44, halfW - 4), handY] as Point, near: [16 - Math.min(44, halfW - 4), handY] as Point };
  }
  // Pushed into place from its side, standing on the same level as its bottom edge.
  const x = toPx(SIDE_EDGE);
  const tall = Math.min(160, toUnits(h));
  const hand = (percent: number): Point => [SIDE_EDGE - 10, -toUnits(lift) - Math.round((tall * percent) / 100)];
  return { rect: { x, y: -h - lift, width, height: h }, far: hand(80), near: hand(45) };
}

/** The poses that suit a cabinet: a tall one goes on the helmet, a short one is carried at the waist. */
export function cabinetPoses(height: number, cabinetHeight: number): { readonly carry: WorkerPoseId; readonly place: WorkerPoseId } {
  const units = (cabinetHeight * WORKER_UNITS) / height;
  return { carry: units < 96 ? "carry-front" : "carry-head", place: units < 104 ? "place-low" : "place" };
}

/** Where the held cabinet is, relative to the feet, in pixels. Null when the pose holds nothing. */
export function heldRect(input: Pick<WorkerInput, "pose" | "height" | "facing" | "cabinet" | "lift">): WorkerDrawing["cabinet"] {
  const pose = WORKER_POSES[input.pose];
  if (!pose.hold || !input.cabinet) return null;
  const { rect: held } = grip(pose, input.height, input.cabinet, input.lift ?? 0);
  return input.facing === -1 ? { ...held, x: -held.x - held.width } : held;
}

/** How far in front of the feet a placed cabinet's near edge is, in pixels. */
export function placeReach(height: number): number {
  return Math.round((SIDE_EDGE * height) / WORKER_UNITS);
}

function bootShapes(ankle: Point, near: boolean): WorkerShape[] {
  const [x, y] = ankle;
  return [rect(x - 16, y - 10, 30, 20, 6, near ? BOOT : BOOT_FAR), rect(x - 16, y - 4, 44, 14, 7, near ? BOOT : BOOT_FAR), rect(x - 16, y + 6, 46, 6, 2, SOLE)];
}

function legShapes(leg: WorkerPose["nearLeg"], drop: number, near: boolean): WorkerShape[] {
  const hip: Point = [leg.hip, HIP_Y + drop];
  const ankle = within(hip, leg.ankle, 2 * LEG_HALF);
  const bent = joint(hip, ankle, LEG_HALF, leg.bend);
  // A kneeling leg rests on the ground, never below it.
  const knee: Point = [bent[0], Math.min(bent[1], -14)];
  const color = near ? TROUSERS : TROUSERS_FAR;
  return [...outlined([line([hip, knee, [ankle[0], ankle[1] - 4]], 28, color)]), ...outlined(bootShapes(ankle, near))];
}

function armShapes(shoulder: Point, hand: Point, bend: 1 | -1, near: boolean): { arm: WorkerShape[]; glove: WorkerShape[] } {
  const wrist = within(shoulder, hand, 2 * ARM_HALF);
  const elbow = joint(shoulder, wrist, ARM_HALF, bend);
  return {
    arm: outlined([line([shoulder, elbow, wrist], 22, near ? SHIRT : SHIRT_FAR)]),
    glove: outlined([disc(wrist[0], wrist[1], 12, near ? GLOVE : GLOVE_FAR), disc(wrist[0] + 8, wrist[1] - 8, 6, near ? GLOVE : GLOVE_FAR)]),
  };
}

function torsoShapes(pose: WorkerPose, vest: string): WorkerShape[] {
  const { lean, drop, shoulders } = pose;
  const dark = shade(vest, -28);
  // Leaning shifts a point in proportion to its height above the hips.
  const at = (x: number, y: number): Point => [Math.round(x + (lean * (HIP_Y - y)) / (HIP_Y - SHOULDER_Y)), y + drop];
  const top = shoulders + 4;
  const waist = Math.max(26, shoulders - 6);
  const strip = (x: number, w: number): WorkerShape => poly([at(x, -158), at(x + w, -158), at(x + w, -100), at(x, -100)], REFLECT);
  const body = poly([at(-top + 8, -164), at(top - 8, -164), at(top, -152), at(waist, -86), at(-waist, -86), at(-top, -152)], vest);
  return [
    ...outlined([body]),
    // Shaded far side, shirt at the neck, zip.
    poly([at(waist - 8, -164), at(top - 8, -164), at(top, -152), at(waist, -86), at(waist - 12, -86)], dark),
    poly([at(-14, -164), at(16, -164), at(2, -138)], SHIRT_FAR),
    poly([at(0, -140), at(4, -140), at(4, -98), at(0, -98)], dark),
    // Reflective strips: two over the shoulders, one around the chest.
    strip(-waist + 6, 8),
    strip(waist - 14, 8),
    poly([at(-waist - 2, -126), at(waist + 2, -126), at(waist + 1, -114), at(-waist - 1, -114)], REFLECT),
    // Belt and tool pouch.
    ...outlined([poly([at(-waist - 1, -96), at(waist + 1, -96), at(waist + 1, -86), at(-waist - 1, -86)], BELT)]),
    ...outlined([rect(at(waist - 22, -96)[0], -98 + drop, 20, 24, 4, POUCH)]),
    rect(at(waist - 22, -96)[0], -98 + drop, 20, 8, 3, shade(POUCH, -25)),
  ];
}

/** Head, intercom headset and helmet. The face is a small LED panel with two lit pixels for eyes. */
function headShapes(pose: WorkerPose, helmet: string, blink: boolean): WorkerShape[] {
  const dx = pose.lean;
  const dy = pose.drop;
  const p = (x: number, y: number): Point => [x + dx, y + dy];
  const r = (x: number, y: number, w: number, h: number, radius: number, fill: string) => rect(x + dx, y + dy, w, h, radius, fill);
  const dark = shade(helmet, -24);
  const light = shade(helmet, 45);
  return [
    ...outlined([r(-36, -222, 76, 66, 20, SHELL)]),
    r(-36, -176, 76, 20, 14, SHELL_SHADE),
    r(-36, -190, 76, 20, 0, SHELL),
    r(-16, -210, 50, 48, 10, FACE),
    blink ? r(0, -190, 8, 4, 0, PIXEL) : r(0, -200, 8, 16, 0, PIXEL),
    blink ? r(20, -190, 8, 4, 0, PIXEL) : r(20, -200, 8, 16, 0, PIXEL),
    r(8, -172, 12, 4, 0, PIXEL),
    r(4, -176, 4, 4, 0, PIXEL),
    r(20, -176, 4, 4, 0, PIXEL),
    // Intercom headset.
    ...outlined([line([p(-26, -180), p(-20, -162), p(4, -156)], 4, BELT)]),
    disc(8 + dx, -156 + dy, 6, BELT),
    ...outlined([disc(-28 + dx, -188 + dy, 14, dark)]),
    disc(-28 + dx, -188 + dy, 7, BELT),
    // Helmet: dome, ridge, brim and a square lamp.
    ...outlined([
      { kind: "curve", from: p(-42, -216), curves: [[p(-42, -252), p(2, -252)], [p(44, -252), p(44, -216)], [p(0, -216), p(-42, -216)]], fill: helmet },
      r(-46, -220, 104, 10, 5, helmet),
    ]),
    { kind: "curve", from: p(-10, -221), curves: [[p(-12, -248), p(-4, -252)], [p(2, -253), p(8, -252)], [p(14, -238), p(12, -221)], [p(0, -221), p(-10, -221)]], fill: light },
    r(-46, -214, 104, 4, 2, dark),
    ...outlined([r(22, -244, 20, 18, 3, BELT)]),
    r(26, -240, 12, 10, 1, PIXEL),
  ];
}

/** Units to whole pixels, mirrored when facing left. */
function place(shape: WorkerShape, height: number, facing: 1 | -1): WorkerShape {
  const s = (u: number) => Math.round((u * height) / WORKER_UNITS) + 0;
  const size = (u: number) => Math.max(1, s(u));
  const pt = ([x, y]: Point): Point => [s(x) * facing + 0, s(y)];
  switch (shape.kind) {
    case "rect": {
      // Both edges are rounded, so neighbouring shapes still meet.
      const x0 = s(shape.x);
      const y0 = s(shape.y);
      const w = Math.max(1, s(shape.x + shape.w) - x0);
      const h = Math.max(1, s(shape.y + shape.h) - y0);
      return { ...shape, x: facing === 1 ? x0 : -x0 - w, y: y0, w, h, r: Math.min(s(shape.r), Math.floor(Math.min(w, h) / 2)) };
    }
    case "disc":
      return { ...shape, x: s(shape.x) * facing + 0, y: s(shape.y), r: size(shape.r) };
    case "poly":
      return { ...shape, points: shape.points.map(pt) };
    case "line":
      return { ...shape, points: shape.points.map(pt), width: size(shape.width) };
    case "curve":
      return { ...shape, from: pt(shape.from), curves: shape.curves.map(([c, b]) => [pt(c), pt(b)] as const) };
  }
}

/** The worker, as shapes in whole pixels around the point on the ground between its feet. */
export function workerShapes(input: WorkerInput): WorkerDrawing {
  const { height, facing = 1 } = input;
  if (!Number.isInteger(height) || height < 1) throw new Error("Worker height must be a whole number of pixels");
  const helmet = isHexColor(input.colors?.helmet) ? input.colors.helmet : DEFAULT_WORKER_COLORS.helmet;
  const vest = isHexColor(input.colors?.vest) ? input.colors.vest : DEFAULT_WORKER_COLORS.vest;
  const pose = WORKER_POSES[input.pose];
  const held = pose.hold && input.cabinet ? grip(pose, height, input.cabinet, input.lift ?? 0) : null;

  const shoulderY = SHOULDER_Y + pose.drop;
  const farShoulder: Point = [pose.shoulders - 2 + pose.lean, shoulderY];
  const nearShoulder: Point = [-pose.shoulders + 2 + pose.lean, shoulderY];
  const up = pose.hold === "head";
  const far = armShapes(farShoulder, held?.far ?? pose.farHand, up || pose.hold === "front" ? 1 : -1, false);
  const near = armShapes(nearShoulder, held?.near ?? pose.nearHand, -1, true);

  const cycle = WALK_CYCLE.length;
  const walk = (leg: WorkerPose["nearLeg"], offset: number) => (input.step === undefined ? leg : { ...leg, ankle: WALK_CYCLE[(((input.step + offset) % cycle) + cycle) % cycle] });
  const body = [
    ...legShapes(walk(pose.farLeg, cycle / 2), pose.drop, false),
    ...far.arm,
    ...legShapes(walk(pose.nearLeg, 0), pose.drop, true),
    ...torsoShapes(pose, vest),
    ...headShapes(pose, helmet, input.blink ?? false),
  ];
  const hands = [...far.glove, ...near.arm, ...near.glove];
  // Every edge of the worker has ink, so growing the ink alone gives the whole rim.
  const rim = expanded([...body, ...hands].filter((s) => s.fill === INK), RIM, outlineFor(input.background));
  const toPx = (shapes: readonly WorkerShape[]) => shapes.map((shape) => place(shape, height, facing));
  const cabinet = heldRect(input);
  return { behind: toPx([...rim, ...body]), cabinet, front: toPx(hands) };
}
