// O5 pixel test (PHYSICAL_OUTPUT 8.8): the output window's real composited frame, captured with capturePage, against
// the exact RGB the pixel grid must put on each device pixel. Hidden smoke runs only: nothing is ever shown.
// From desktop/, Chromium switches before the app path (after it, only the first one is applied):
//   2×:  ./node_modules/.bin/electron --force-color-profile=srgb . --smoke-test --smoke-script=desktop/tests/smoke-scripts/o5-pixels.cjs
//   1×:  ./node_modules/.bin/electron --force-device-scale-factor=1 --force-color-profile=srgb . --smoke-test --smoke-script=desktop/tests/smoke-scripts/o5-pixels.cjs
// The 1× switch is refused by packaged builds; it exists only in this unpackaged test runner, as section 5 says.
// --force-color-profile=srgb: without it Chromium colour-manages the frame to the display's profile, and on the
// dev Mac's XDR display pure green (0, 255, 0) comes out as (1, 255, 0) — 255 probes off by one. The test is strict,
// so it fails without the switch: whether the shipped app forces sRGB is a Desktop decision (see the O5 PR).
//
// 1. Probe sets come from the app's own pixel-grid engine (src/engines/pixel-probes.ts), generated for this run's
//    display size by tests/output-pixel-probes.test.ts. Text boxes are skipped (anti-aliased glyphs).
// 2. Display space: the grid over the whole framebuffer. Master space: Pixel test OUT 1 (three slices at odd,
//    non-zero offsets). Each: capture size === devicePx (never resampled), every probe exact, and the page's report
//    says devicePixelRatio === scaleFactor, canvasPx === devicePx, contentBoxDevicePx === devicePx.
// 3. Mutation check: the same comparer must fail on the two broken outputs of 8.8, made from the real capture:
//    a canvas sized in CSS px and scaled up by CSS (only differs at a scale above 1), and smoothing on with a
//    0.5 px offset. A comparer that passes them would prove nothing.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

module.exports = async function o5Pixels(api) {
  assert.ok(api.mode && !api.mode.visible, 'hidden smoke run only');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const control = script => api.control.webContents.executeJavaScript(script);
  const until = async (predicate, ms, what) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = await predicate(); if (v) return v; await sleep(25); }
    assert.fail(`timed out waiting for ${what}`);
  };
  const displays = await control('window.pixelLabDesktop.output.listDisplays()');
  const display = displays.find(d => d.electronId === api.virtualDisplayId);
  assert.ok(display, 'virtual display listed in a hidden run');
  const { width: W, height: H } = display.devicePx;

  // 1. Probe sets for this display, from the app's engine.
  const file = path.join(os.tmpdir(), `pixel-lab-o5-probes-${process.pid}.json`);
  const gen = spawnSync('npx', ['vitest', 'run', 'tests/output-pixel-probes.test.ts'], {
    cwd: api.repoRoot, shell: true, encoding: 'utf8', env: { ...process.env, PIXEL_PROBES_OUT: file, PIXEL_PROBES_DISPLAYS: `${W}x${H}` },
  });
  assert.equal(gen.status, 0, `probe generation failed:\n${gen.stdout}\n${gen.stderr}`);
  const probeSets = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.rmSync(file, { force: true });

  /** Probes that reach the display: output px past its right or bottom edge are cropped, never shown. */
  const visible = probes => probes.filter(([x, y]) => x < W && y < H);
  /** Mismatched probes in a BGRA bitmap of size w × h. */
  function compare(bitmap, w, probes) {
    const bad = [];
    for (const [x, y, r, g, b] of visible(probes)) {
      const i = (y * w + x) * 4;
      if (bitmap[i + 2] !== r || bitmap[i + 1] !== g || bitmap[i] !== b) bad.push({ x, y, want: [r, g, b], got: [bitmap[i + 2], bitmap[i + 1], bitmap[i]] });
    }
    return bad;
  }

  async function capture(source, outputId, projectText) {
    const session = { revision: 1, projectText, outputId, source, clock: { state: 'paused', frame: 0 } };
    await control(`window.pixelLabDesktop.output.open(${JSON.stringify({ outputId, display: display.key, session })})`);
    const state = await until(() => { const s = api.outputs.status(outputId).state; return s === 'live' || s === 'failed' ? s : null; }, 5000, 'live');
    assert.equal(state, 'live', JSON.stringify(api.outputs.status(outputId).error));
    const window = api.windows.output(outputId);
    assert.equal(window.isVisible(), false, 'never shown');
    // The page reports its content box once Chromium has laid the canvas out.
    await until(() => api.outputs.status(outputId).render?.contentBoxDevicePx, 3000, 'contentBoxDevicePx in a report');
    await sleep(100);
    const image = await window.webContents.capturePage();
    const report = api.outputs.status(outputId).render;
    await control(`window.pixelLabDesktop.output.close('${outputId}')`);
    await until(() => api.outputs.status(outputId).state === 'closed' && api.windows.outputIds().length === 0, 3000, 'closed');
    const size = image.getSize();
    return { size, bitmap: image.toBitmap(), report };
  }

  function oneToOne(name, cap) {
    // Never resampled to compare: the capture must already be the display's device pixels.
    assert.deepEqual(cap.size, display.devicePx, `${name}: capture is devicePx`);
    assert.equal(cap.report.devicePixelRatio, display.scaleFactor, `${name}: devicePixelRatio === scaleFactor`);
    assert.deepEqual(cap.report.canvasPx, display.devicePx, `${name}: canvasPx === devicePx`);
    assert.deepEqual(cap.report.contentBoxDevicePx, display.devicePx, `${name}: contentBoxDevicePx === devicePx`);
  }

  const projectText = fs.readFileSync(path.join(api.repoRoot, 'tests/fixtures/pixel-test.pixellab.json'), 'utf8');
  const outputId = JSON.parse(projectText).project.output.outputs[0].id;
  const result = { display: { devicePx: display.devicePx, scaleFactor: display.scaleFactor }, display_space: null, master_space: null, mutations: null };

  // 2a. Display space.
  const dProbes = probeSets.displays[`${W}x${H}`];
  const d = await capture({ id: 'pixel-grid', settings: { space: 'display', motion: false } }, outputId, projectText);
  oneToOne('display space', d);
  const dBad = compare(d.bitmap, W, dProbes);
  result.display_space = { probes: dProbes.length, mismatched: dBad.length, firstMismatches: dBad.slice(0, 5) };

  // 2b. Master space: Pixel test OUT 1, cut from the master by the mapping.
  const m = probeSets.master['pixel-test/OUT 1'];
  const mc = await capture({ id: 'pixel-grid', settings: { space: 'master', motion: false } }, outputId, projectText);
  oneToOne('master space', mc);
  const mBad = compare(mc.bitmap, W, m.probes);
  result.master_space = { output: m.size, probes: visible(m.probes).length, croppedProbes: m.probes.length - visible(m.probes).length, mismatched: mBad.length, firstMismatches: mBad.slice(0, 5) };

  // 3. Mutation check, on the display-space capture.
  const s = display.scaleFactor;
  /** A canvas sized in CSS px, then scaled up by CSS: area-averaged down to CSS px, bilinear back up. */
  function cssScaled(src) {
    const cw = Math.round(W / s), ch = Math.round(H / s);
    const small = new Float64Array(cw * ch * 3);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) for (let c = 0; c < 3; c++) {
      let sum = 0, n = 0;
      for (let v = Math.floor(y * s); v < Math.min(H, Math.floor((y + 1) * s)); v++) for (let u = Math.floor(x * s); u < Math.min(W, Math.floor((x + 1) * s)); u++) { sum += src[(v * W + u) * 4 + c]; n++; }
      small[(y * cw + x) * 3 + c] = n ? sum / n : 0;
    }
    const out = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const fx = Math.min(cw - 1, Math.max(0, (x + 0.5) / s - 0.5)), fy = Math.min(ch - 1, Math.max(0, (y + 0.5) / s - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(cw - 1, x0 + 1), y1 = Math.min(ch - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
      for (let c = 0; c < 3; c++) {
        const p = (xx, yy) => small[(yy * cw + xx) * 3 + c];
        out[(y * W + x) * 4 + c] = Math.round((p(x0, y0) * (1 - ax) + p(x1, y0) * ax) * (1 - ay) + (p(x0, y1) * (1 - ax) + p(x1, y1) * ax) * ay);
      }
      out[(y * W + x) * 4 + 3] = 255;
    }
    return out;
  }
  /** Smoothing on with a 0.5 px offset: each pixel the mean of itself and its left, upper and upper-left neighbours. */
  function halfPixel(src) {
    const out = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      for (let c = 0; c < 3; c++) {
        const p = (xx, yy) => src[(Math.max(0, yy) * W + Math.max(0, xx)) * 4 + c];
        out[(y * W + x) * 4 + c] = Math.round((p(x, y) + p(x - 1, y) + p(x, y - 1) + p(x - 1, y - 1)) / 4);
      }
      out[(y * W + x) * 4 + 3] = 255;
    }
    return out;
  }
  const cssBad = s > 1 ? compare(cssScaled(d.bitmap), W, dProbes).length : null;
  const halfBad = compare(halfPixel(d.bitmap), W, dProbes).length;
  result.mutations = { cssScaledCanvas: cssBad === null ? 'n/a at scale 1 (identical to the correct build)' : cssBad, halfPixelSmoothing: halfBad };

  assert.equal(dBad.length, 0, `display space: ${dBad.length} mismatched probes, e.g. ${JSON.stringify(dBad.slice(0, 3))}`);
  assert.equal(mBad.length, 0, `master space: ${mBad.length} mismatched probes, e.g. ${JSON.stringify(mBad.slice(0, 3))}`);
  if (cssBad !== null) assert.ok(cssBad > 0, 'mutation (CSS-scaled canvas) must fail the comparer');
  assert.ok(halfBad > 0, 'mutation (0.5 px smoothing) must fail the comparer');
  return result;
};
