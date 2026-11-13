/**
 * GLSL for the Infinite Particle Room. Fixed source: nothing from a scene config is ever spliced into
 * shader text, only passed as uniforms.
 *
 * Everything is a function of world position and the loop phase, so a frame depends on nothing but the
 * config and the frame number. All animated terms use whole turns per loop.
 */

const COMMON = /* glsl */ `
precision highp float;

uniform vec3 uRoom;        // width, height, depth in metres
uniform vec3 uEye;
uniform vec3 uBg;          // palette, linear light
uniform vec3 uMid;
uniform vec3 uAccent;
uniform float uLight;
uniform vec2 uSweepDir;    // cos, sin of the sweep direction
uniform float uSweepWidth;
uniform float uPhase;      // 0 to 1 through the loop
uniform float uFog;
uniform float uRingSpacing;

const float TAU = 6.28318530718;

// Signed distance along the room to the nearest ring of light.
float ringDz(float z) {
  return (fract(-z / uRingSpacing) - 0.5) * uRingSpacing;
}

vec3 ringColor() {
  return mix(uMid, uAccent, 0.22);
}

vec3 backLightColor() {
  return uMid * 1.0 + uAccent * 0.18;
}

// The band of light crossing the room. It starts and ends fully outside, so the loop has no seam.
float sweepBand(vec3 p) {
  float q = p.x * uSweepDir.x + (-p.z - 0.5 * uRoom.z) * uSweepDir.y;
  float reach = 0.5 * (uRoom.x * abs(uSweepDir.x) + uRoom.z * abs(uSweepDir.y));
  float sigma = max(uSweepWidth * reach, 0.05);
  float centre = mix(-reach - 4.0 * sigma, reach + 4.0 * sigma, uPhase);
  float x = (q - centre) / sigma;
  return exp(-0.5 * x * x);
}

// Light arriving from the luminous back wall.
float backLight(vec3 p, vec3 n) {
  vec3 l = vec3(0.0, 0.0, -uRoom.z + 0.4) - p;
  float r = length(l);
  float ndl = max(dot(n, l / r), 0.0) * 0.8 + 0.2;
  return ndl / (1.0 + 0.16 * r + 0.022 * r * r);
}

vec3 fogColor(vec3 p) {
  vec3 dir = normalize(p - uEye);
  vec3 toBack = normalize(vec3(0.0, 0.0, -uRoom.z) - uEye);
  float glow = pow(max(dot(dir, toBack), 0.0), 40.0);
  return uBg * 1.5 + uMid * 0.016 + backLightColor() * uLight * 0.2 * glow;
}

// Fog builds only along the part of the sight line that is inside the room.
vec3 applyFog(vec3 color, vec3 p) {
  float inside = clamp(-p.z / (uEye.z - p.z), 0.0, 1.0);
  float f = 1.0 - exp(-uFog * length(p - uEye) * inside);
  return mix(color, fogColor(p), f);
}

vec3 toDisplay(vec3 c) {
  // Filmic curve: highlights roll off instead of clipping on the wall.
  c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
  return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
}
`;

export const ROOM_VERTEX = /* glsl */ `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in float aKind;
uniform mat4 uViewProj;
out vec3 vPos;
out vec3 vNormal;
out float vKind;
void main() {
  vPos = aPos;
  vNormal = aNormal;
  vKind = aKind;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;

export const ROOM_FRAGMENT = /* glsl */ `#version 300 es
${COMMON}
uniform float uGrid;       // grid opacity, 0 hides it
uniform float uRibHalf;    // half the width of a rib along the room
in vec3 vPos;
in vec3 vNormal;
in float vKind;            // 0 room surface, 1 rib
out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Anti-aliased line at every whole value of c. It fades out before it can alias.
float gridLine(float c, float halfWidth) {
  float w = fwidth(c);
  float d = abs(fract(c - 0.5) - 0.5);
  float line = 1.0 - smoothstep(halfWidth, halfWidth + w * 1.5, d);
  return line * (1.0 - smoothstep(0.25, 0.6, w));
}

vec3 backEmission(vec2 xy) {
  vec2 q = xy / (0.5 * uRoom.xy);
  vec2 d = abs(q) - vec2(0.46, 0.6);
  float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  float core = 1.0 - smoothstep(-0.03, 0.04, sd);
  float halo = exp(-max(sd, 0.0) * 5.0);
  // Brightest low in the centre, like light rising from a doorway, and divided by slim mullions.
  float well = 0.42 + 0.58 * exp(-dot(q - vec2(0.0, -0.2), q - vec2(0.0, -0.2)) * 2.6);
  float mullion = 1.0 - 0.55 * gridLine(q.x * 5.4 + 0.5, 0.035);
  return backLightColor() * uLight * (core * 1.05 * well * mullion + halo * 0.16);
}

// Light given off by the surface at a point: the back wall's portal and the rings.
vec3 emission(vec3 p, vec3 n) {
  if (n.z > 0.5 && p.z < -uRoom.z + 0.01) return backEmission(p.xy);
  float dz = abs(ringDz(p.z));
  float strip = 1.0 - smoothstep(0.022, 0.04, dz);
  return ringColor() * uLight * (strip * 1.7 + exp(-dz / 0.16) * 0.1);
}

// Where a ray from inside the room leaves it, and the inward normal there.
vec3 roomExit(vec3 o, vec3 d, out vec3 n) {
  vec3 lo = vec3(-0.5 * uRoom.x, -0.5 * uRoom.y, -uRoom.z);
  vec3 hi = vec3(0.5 * uRoom.x, 0.5 * uRoom.y, 0.0);
  vec3 sd = mix(vec3(-1.0), vec3(1.0), step(0.0, d));
  vec3 dd = sd * max(abs(d), vec3(1e-5));
  vec3 t = max((lo - o) / dd, (hi - o) / dd);
  float tm = min(t.x, min(t.y, t.z));
  n = tm == t.x ? vec3(-sd.x, 0.0, 0.0) : (tm == t.y ? vec3(0.0, -sd.y, 0.0) : vec3(0.0, 0.0, -sd.z));
  return o + dd * tm;
}

void main() {
  vec3 p = vPos;
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uEye - p);
  bool rib = vKind > 0.5;
  bool isFloor = !rib && n.y > 0.5;
  bool isBack = !rib && n.z > 0.5;
  float dz = ringDz(p.z);
  float adz = abs(dz);

  // Surface coordinates: u runs across the surface, w runs into the room.
  float u = abs(n.x) > 0.5 ? p.y : p.x;
  float across = abs(n.x) > 0.5 ? uRoom.y : uRoom.x;
  vec2 panelSize = vec2(across / max(1.0, floor(across / 1.5 + 0.5)), uRoom.z > 0.0 ? uRingSpacing : 1.0);
  vec2 pc = isBack ? (p.xy + 0.5 * uRoom.xy) / vec2(uRoom.x / max(1.0, floor(uRoom.x / 1.5 + 0.5)), uRoom.y / max(1.0, floor(uRoom.y / 1.5 + 0.5)))
                   : vec2((u + 0.5 * across) / panelSize.x, -p.z / panelSize.y);

  // Material: dark emerald panels with seams, each panel a slightly different tone.
  vec3 albedo = uBg * 4.0 + uMid * 0.035;
  if (!rib) {
    float tone = 0.82 + 0.36 * hash(floor(pc) + (isBack ? 91.0 : n.x * 17.0 + n.y * 43.0));
    float seam = max(gridLine(pc.x, 0.006), gridLine(pc.y, 0.006));
    albedo *= tone * (1.0 - 0.6 * seam);
  } else {
    albedo *= 0.7;
  }

  // Corners gather shadow. That darkening is a large part of why the box reads as a room.
  vec3 edge = vec3(0.5 * uRoom.x - abs(p.x), 0.5 * uRoom.y - abs(p.y), uRoom.z + p.z);
  vec3 open = vec3(1.0) - step(vec3(0.004), edge) * (1.0 - smoothstep(vec3(0.0), vec3(0.75), edge)) * 0.5;
  float ao = open.x * open.y * open.z;
  if (!rib && !isFloor && !isBack) ao *= mix(0.62, 1.0, smoothstep(uRibHalf, uRibHalf + 0.35, adz));

  // Light.
  float ringNear = exp(-adz / 0.4) * (isFloor ? 1.0 : 0.3) * (1.0 - 0.7 * abs(n.z));
  float ringFill = exp(-adz / 1.3) * 0.3;
  float band = sweepBand(p);
  float ripple = 0.5 + 0.5 * (0.6 * sin(p.x * 1.7 + p.z * 0.9 + TAU * 2.0 * uPhase) * sin(p.z * 1.3 - p.y * 2.1 - TAU * 3.0 * uPhase + 1.3)
                              + 0.4 * sin((p.x + p.y) * 1.1 + p.z * 0.6 + TAU * uPhase + 4.1));
  float graze = pow(1.0 - max(dot(n, v), 0.0), 2.0);

  vec3 light = vec3(0.07 + 0.03 * n.y)
    + backLightColor() * uLight * 2.8 * backLight(p, n)
    + ringColor() * uLight * 1.4 * (ringNear + ringFill * 0.6)
    + uAccent * uLight * band * (1.6 + 3.2 * ripple);
  vec3 color = albedo * light * ao;

  // The sweep rakes across surfaces: strongest where the surface is seen at a shallow angle.
  color += uAccent * uLight * band * graze * (0.1 + 0.45 * ripple) * ao;

  // Depth grid, one line per metre.
  if (uGrid > 0.0 && !rib) {
    vec2 gc = isBack ? p.xy : vec2(u, p.z);
    float g = max(gridLine(gc.x, 0.004), gridLine(gc.y, 0.004));
    color += uMid * g * uGrid * (0.03 + 0.14 * (ringFill + backLight(p, n) * 2.0)) * ao;
  }

  // Emissive: the strip of light on each rib and across the floor, and the back wall's portal.
  if (rib ? abs(n.z) < 0.5 : (isFloor || isBack)) color += emission(p, n) * (isBack ? 1.0 : 1.0 + 0.6 * band);

  // Polished surfaces mirror the lights. A slight ripple in the normal keeps the mirror from looking synthetic.
  if (!rib && !isBack) {
    vec3 nr = normalize(n + 0.004 * vec3(sin(p.x * 1.3 + p.z * 0.7), sin(p.z * 1.1 + p.x * 0.5), sin(p.z * 0.9 - p.x * 0.6)) * (1.0 - abs(n)));
    vec3 hitN;
    vec3 hit = roomExit(p + n * 0.002, reflect(-v, nr), hitN);
    vec3 seen = hit.z > -0.001 ? vec3(0.0) : emission(hit, hitN);
    float travelled = length(hit - p);
    seen = mix(seen, fogColor(hit), 1.0 - exp(-uFog * travelled));
    float fresnel = 0.035 + 0.965 * pow(1.0 - max(dot(nr, v), 0.0), 5.0);
    color += seen * fresnel * (isFloor ? 0.8 : 0.14);
  }

  color = toDisplay(applyFog(color, p));
  // Static dither, so dark gradients don't band on the wall. It depends on the pixel only, never on time.
  color += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(color, 1.0);
}
`;

export const PARTICLE_VERTEX = /* glsl */ `#version 300 es
${COMMON}
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aBase;    // position 0 to 1, size
layout(location = 2) in vec4 aSway;    // amplitude, phase offset
layout(location = 3) in vec4 aTurns;   // sway turns, spin turns
layout(location = 4) in vec4 aLook;    // tint, opacity, drift, fall
uniform mat4 uViewProj;
uniform float uSpeed;
uniform float uSize;
out vec2 vUv;
out vec3 vWorld;
out float vTint;
out float vAlpha;

// Mirrors particleState in engines/depth/particles.ts.
vec4 turns(vec4 base) {
  return floor(base * uSpeed + 0.5);
}

void main() {
  vec3 swayTurns = turns(aTurns).xyz;
  float spinTurns = turns(aTurns).w;
  vec2 driftTurns = turns(aLook).zw;
  vec3 sway = aSway.xyz * sin(TAU * (swayTurns * uPhase + aSway.w + vec3(0.0, 1.0, 2.0) / 3.0));
  float x = fract(aBase.x + driftTurns.x * uPhase + sway.x);
  float y = fract(aBase.y + driftTurns.y * uPhase + sway.y);
  float z = clamp(aBase.z + sway.z, 0.02, 0.98);
  float fade = smoothstep(0.0, 0.05, x) * smoothstep(1.0, 0.95, x) * smoothstep(0.0, 0.05, y) * smoothstep(1.0, 0.95, y);

  vec3 centre = vec3((x - 0.5) * uRoom.x, (y - 0.5) * uRoom.y, -z * uRoom.z);
  float angle = TAU * (spinTurns * uPhase + aSway.w * 3.7);
  // A leaf turning in the air: it narrows as it tumbles edge-on.
  float tumble = mix(0.45, 1.0, abs(cos(TAU * (swayTurns.x * uPhase * 0.5 + aLook.x))));
  vec2 c = aCorner * vec2(0.7 * tumble, 1.0);
  vec2 rotated = vec2(c.x * cos(angle) - c.y * sin(angle), c.x * sin(angle) + c.y * cos(angle));
  vec3 world = centre + vec3(rotated * aBase.w * uSize * 0.075, 0.0);

  vUv = aCorner;
  vWorld = world;
  vTint = aLook.x;
  vAlpha = aLook.y * fade;
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

export const PARTICLE_FRAGMENT = /* glsl */ `#version 300 es
${COMMON}
uniform float uOpacity;
in vec2 vUv;
in vec3 vWorld;
in float vTint;
in float vAlpha;
out vec4 outColor;

void main() {
  // A leaf: the overlap of two circles, pointed at both ends.
  float d = length(vec2(abs(vUv.x) + 0.6, vUv.y));
  float shape = 1.0 - smoothstep(1.02, 1.16, d);
  if (shape <= 0.0) discard;
  float body = 1.0 - smoothstep(0.6, 1.16, d);
  float midrib = 1.0 - smoothstep(0.0, 0.09, abs(vUv.x));

  float band = sweepBand(vWorld);
  float ring = exp(-abs(ringDz(vWorld.z)) / 0.9);
  vec3 tint = mix(uMid, uAccent, vTint * 0.55);
  vec3 light = vec3(0.2)
    + backLightColor() * uLight * 3.0 * backLight(vWorld, vec3(0.0, 0.0, 1.0))
    + ringColor() * uLight * 0.9 * ring
    + uAccent * uLight * band * 3.0;
  vec3 color = tint * light * (0.55 + 0.45 * body + 0.25 * midrib);

  color = toDisplay(applyFog(color, vWorld));
  float alpha = shape * vAlpha * uOpacity * (0.5 + 0.35 * body);
  outColor = vec4(color * alpha, alpha);
}
`;
