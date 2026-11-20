// O6: output window === the MP4 exporter's composition, at frames other than 0 and on outputs wider than 4096 px.
// Hidden smoke runs only (nothing is shown). From desktop/, Chromium switches before the app path:
//   ./node_modules/.bin/electron --force-color-profile=srgb . --smoke-test --smoke-script=desktop/tests/smoke-scripts/o6-frames.cjs
// (--force-color-profile=srgb until Desktop's main sets it; see O5.)
//
// For each output, source and frame N: opens the output paused at N on the hidden run's virtual display, captures the
// window's composited frame (capturePage, device px), and hashes the area that reaches the display. The reference is
// the page's test-only hook, present only when the output preload sets testMode (hidden smoke runs, never packaged):
// a fresh createOutputSource → targetSource of the same session at frame N on an off-screen canvas — the exporter's
// path — hashed over the same area. They must be equal.
//
// Limit: this proves the output window shows exactly the exporter's composition at frame N. It says nothing about
// H.264 encoding, which O2 covers with a tolerance (up to 4096 px, H.264's limit).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const FRAMES = [0, 1, 150, 299];   // first, second, middle and last of a 10 s file at 30 fps
const CASES = [
  { file: 'tests/fixtures/corporate-keynote.pixellab.json', output: 0, label: 'Corporate Keynote OUT 1' },
  { file: 'tests/fixtures/festival-main-stage.pixellab.json', output: 1, label: 'Festival Main Stage Processor B' },
];
const SOURCES = [
  { id: 'calibration-test-card', settings: { mode: 'identification', logo: 'center' } },
  { id: 'pixel-grid', settings: { space: 'master', motion: true } },
];

module.exports = async function o6Frames(api) {
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
  const D = display.devicePx;

  /** SHA-256 of the top-left w × h of a BGRA bitmap, as RGBA rows (the order getImageData returns). */
  function captureHash(bitmap, stride, w, h) {
    const rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * stride + x) * 4, o = (y * w + x) * 4;
      rgba[o] = bitmap[i + 2]; rgba[o + 1] = bitmap[i + 1]; rgba[o + 2] = bitmap[i]; rgba[o + 3] = 255;
    }
    return crypto.createHash('sha256').update(rgba).digest('hex');
  }

  const results = [];
  for (const c of CASES) {
    const projectText = fs.readFileSync(path.join(api.repoRoot, c.file), 'utf8');
    const out = JSON.parse(projectText).project.output.outputs[c.output];
    for (const source of SOURCES) {
      for (const frame of FRAMES) {
        const session = { revision: 1, projectText, outputId: out.id, source, clock: { state: 'paused', frame } };
        await control(`window.pixelLabDesktop.output.open(${JSON.stringify({ outputId: out.id, display: display.key, session })})`);
        const state = await until(() => { const s = api.outputs.status(out.id).state; return s === 'live' || s === 'failed' ? s : null; }, 5000, 'live');
        assert.equal(state, 'live', JSON.stringify(api.outputs.status(out.id).error));
        const window = api.windows.output(out.id);
        assert.equal(window.isVisible(), false, 'never shown');
        await until(() => api.outputs.status(out.id).render?.frame === frame, 3000, `frame ${frame} drawn`);
        await sleep(100);
        const hasHook = await window.webContents.executeJavaScript(`typeof window.__pixelLabOutputReference === 'function'`);
        assert.ok(hasHook, 'the reference hook needs the output preload\'s testMode (hidden smoke runs only)');
        const ref = await window.webContents.executeJavaScript(`window.__pixelLabOutputReference(${frame})`);
        const image = await window.webContents.capturePage();
        const size = image.getSize();
        assert.deepEqual(size, D, 'capture is the display\'s device pixels');
        const page = captureHash(image.toBitmap(), size.width, ref.visible.width, ref.visible.height);
        const report = api.outputs.status(out.id).render;
        await control(`window.pixelLabDesktop.output.close('${out.id}')`);
        await until(() => api.outputs.status(out.id).state === 'closed' && api.windows.outputIds().length === 0, 3000, 'closed');
        results.push({ output: c.label, size: [ref.width, ref.height], visible: [ref.visible.width, ref.visible.height], source: source.id, frame, reportedFrame: report.frame, equal: page === ref.hash, hash: page.slice(0, 16), reference: ref.hash.slice(0, 16) });
      }
    }
  }
  const failed = results.filter(r => !r.equal);
  assert.equal(failed.length, 0, `output window !== exporter at: ${JSON.stringify(failed)}`);
  // Different frames really differ (the content moves), so equality isn't trivially one picture.
  for (const c of CASES) for (const s of SOURCES) {
    const hashes = new Set(results.filter(r => r.output === c.label && r.source === s.id).map(r => r.hash));
    assert.equal(hashes.size, FRAMES.length, `${c.label} ${s.id}: every frame is a different picture`);
  }
  return { display: { devicePx: D, scaleFactor: display.scaleFactor }, compared: results.length, results };
};
