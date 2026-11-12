/**
 * Seeded particles for depth scenes.
 *
 * Every particle is decided by the seed and its index alone, so raising the count adds particles
 * without moving the ones already there. Motion is a pure function of the loop phase: each particle
 * completes a whole number of turns per loop, which is what closes the loop exactly.
 *
 * `particleState` is the reference for the vertex shader in `modules/depth-studio/shaders.ts`. The two
 * must stay in step; the tests here pin the maths.
 */

export const MAX_PARTICLES = 5000;
/** Floats per particle in the instance buffer. */
export const PARTICLE_STRIDE = 16;

// Layout of one particle, in floats:
//  0–2  base position, 0 to 1 across the room's width, height and depth
//  3    size
//  4–6  sway amplitude, as a fraction of the room
//  7    phase offset, 0 to 1
//  8–10 sway turns per loop, whole numbers
//  11   spin turns per loop, whole number
//  12   tint, 0 to 1
//  13   opacity
//  14   lateral drift, whole room-widths per loop
//  15   fall, whole room-heights per loop

/** Small, fast, well-distributed PRNG. Deterministic across engines, unlike `Math.random`. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildParticles(seed: number, count = MAX_PARTICLES): Float32Array {
  const data = new Float32Array(count * PARTICLE_STRIDE);
  for (let i = 0; i < count; i++) {
    // One generator per particle, so particle i never depends on how many others exist.
    const r = mulberry32((seed * 0x9e3779b1 + i * 0x85ebca6b) >>> 0);
    const o = i * PARTICLE_STRIDE;
    const pick = (values: readonly number[]) => values[Math.floor(r() * values.length)];
    data[o] = r();
    data[o + 1] = r();
    data[o + 2] = r();
    // Mostly small, with a few large leaves.
    data[o + 3] = 0.55 + 1.25 * r() ** 2.2;
    data[o + 4] = 0.01 + 0.035 * r();
    data[o + 5] = 0.01 + 0.03 * r();
    data[o + 6] = 0.005 + 0.02 * r();
    data[o + 7] = r();
    data[o + 8] = pick([1, 1, 2, 2, 3]);
    data[o + 9] = pick([1, 1, 2, 3]);
    data[o + 10] = pick([1, 1, 2]);
    data[o + 11] = pick([-2, -1, -1, 1, 1, 2]);
    data[o + 12] = r();
    data[o + 13] = 0.45 + 0.55 * r();
    data[o + 14] = pick([0, 1, 1, 1]);
    data[o + 15] = pick([0, 0, 0, -1]);
  }
  return data;
}

const TAU = Math.PI * 2;
const fract = (x: number) => x - Math.floor(x);
/** Turns per loop at a speed: always whole, so any speed still closes the loop. */
const turns = (base: number, speed: number) => Math.floor(base * speed + 0.5);
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface ParticleState {
  /** Position, 0 to 1 across the room's width, height and depth. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Spin angle, radians. */
  readonly angle: number;
  /** 0 at the room's edges, where drifting particles wrap unseen. */
  readonly fade: number;
}

export function particleState(data: Float32Array, index: number, phase: number, speed: number): ParticleState {
  const o = index * PARTICLE_STRIDE;
  const p0 = data[o + 7];
  const sway = (axis: number) => data[o + 4 + axis] * Math.sin(TAU * (turns(data[o + 8 + axis], speed) * phase + p0 + axis / 3));
  const x = fract(data[o] + turns(data[o + 14], speed) * phase + sway(0));
  const y = fract(data[o + 1] + turns(data[o + 15], speed) * phase + sway(1));
  const z = Math.min(0.98, Math.max(0.02, data[o + 2] + sway(2)));
  const edge = (v: number) => smoothstep(0, 0.05, v) * smoothstep(1, 0.95, v);
  return { x, y, z, angle: TAU * (turns(data[o + 11], speed) * phase + p0 * 3.7), fade: edge(x) * edge(y) };
}
