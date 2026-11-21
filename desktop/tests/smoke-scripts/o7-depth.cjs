// O7: Depth Studio on the output window (PHYSICAL_OUTPUT 8.10). Hidden smoke runs only: nothing is shown.
//   npm --prefix desktop run test:smoke -- --smoke-script=desktop/tests/smoke-scripts/o7-depth.cjs
//
// 1. Festival Main Stage OUT 1 (Processor A, 3072 × 1920, cut from the 5120 × 1664 master) plays the Depth Studio
//    scene (tests/fixtures/depth-emerald-chamber.json, the normalized default) at 1:1: the report shows
//    depthMaxSize ≥ 5120 and no error; at frames 0, 37 and 150 the page's canvas equals the exporter's composition
//    (the testMode reference, O6) and the captured frame equals the canvas exactly. The three frames differ.
// 2. A lost WebGL context (WEBGL_lose_context through the testMode hook, as a GPU reset would) reports
//    GPU_UNAVAILABLE, keeps the output live with its last frame, and recovers on restore: the error clears and the
//    frame moves on.
// MASTER_TOO_LARGE with a fake limit is a unit test (tests/output-runtime.test.ts): the GPU's real limit here is
// above Festival's master, so it can't be forced in Electron without a hook that fakes the GPU.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

module.exports = async function o7Depth(api) {
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
  const projectText = fs.readFileSync(path.join(api.repoRoot, 'tests/fixtures/festival-main-stage.pixellab.json'), 'utf8');
  const out = JSON.parse(projectText).project.output.outputs[0];
  const settings = JSON.parse(fs.readFileSync(path.join(api.repoRoot, 'tests/fixtures/depth-emerald-chamber.json'), 'utf8'));
  const source = { id: 'depth-scene', settings };

  const HASH = `async (w, h) => { const d = document.querySelector('canvas').getContext('2d').getImageData(0, 0, w, h).data;
    const b = await crypto.subtle.digest('SHA-256', d); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }`;
  function captureHash(bitmap, stride, w, h) {
    const rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * stride + x) * 4, o = (y * w + x) * 4;
      rgba[o] = bitmap[i + 2]; rgba[o + 1] = bitmap[i + 1]; rgba[o + 2] = bitmap[i]; rgba[o + 3] = 255;
    }
    return crypto.createHash('sha256').update(rgba).digest('hex');
  }
  async function open(clock, revision = 1) {
    const session = { revision, projectText, outputId: out.id, source, clock };
    await control(`window.pixelLabDesktop.output.open(${JSON.stringify({ outputId: out.id, display: display.key, session })})`);
    const state = await until(() => { const s = api.outputs.status(out.id).state; return s === 'live' || s === 'failed' ? s : null; }, 8000, 'live');
    assert.equal(state, 'live', JSON.stringify(api.outputs.status(out.id).error));
    const window = api.windows.output(out.id);
    assert.equal(window.isVisible(), false, 'never shown');
    return window;
  }
  async function close() {
    await control(`window.pixelLabDesktop.output.close('${out.id}')`);
    await until(() => api.outputs.status(out.id).state === 'closed' && api.windows.outputIds().length === 0, 3000, 'closed');
  }

  // 1. 1:1 at three frames.
  const frames = [];
  for (const frame of [0, 37, 150]) {
    const window = await open({ state: 'paused', frame });
    const r = await until(() => { const x = api.outputs.status(out.id).render; return x && x.firstFrameDrawn && x.frame === frame && x.contentBoxDevicePx ? x : null; }, 5000, `frame ${frame} drawn`);
    assert.equal(r.errorCode, undefined, `no error (${r.error})`);
    assert.equal(r.sourceId, 'depth-scene');
    assert.deepEqual(r.masterPx, { width: 5120, height: 1664 });
    assert.ok(r.limits && r.limits.depthMaxSize >= 5120, `depthMaxSize ${r.limits && r.limits.depthMaxSize} ≥ 5120: 1:1, never scaled`);
    const ref = await window.webContents.executeJavaScript(`window.__pixelLabOutputReference(${frame})`);
    assert.ok(ref, 'reference hook (testMode)');
    const canvas = await window.webContents.executeJavaScript(`(${HASH})(${ref.visible.width}, ${ref.visible.height})`);
    let capture = null, attempts = 0;
    for (; attempts < 10; attempts++) {
      const image = await window.webContents.capturePage();
      assert.deepEqual(image.getSize(), D, 'capture is devicePx');
      capture = captureHash(image.toBitmap(), D.width, ref.visible.width, ref.visible.height);
      if (capture === canvas) break;
      await sleep(100);
    }
    frames.push({ frame, depthMaxSize: r.limits.depthMaxSize, visible: [ref.visible.width, ref.visible.height], canvasEqualsReference: canvas === ref.hash, captureEqualsCanvas: capture === canvas, captureAttempts: attempts + 1, hash: canvas.slice(0, 16) });
    await close();
  }
  for (const f of frames) {
    assert.ok(f.canvasEqualsReference, `frame ${f.frame}: page canvas === exporter reference`);
    if (display.scaleFactor !== 1) assert.ok(f.captureEqualsCanvas, `frame ${f.frame}: captured frame === canvas`);
  }
  assert.equal(new Set(frames.map(f => f.hash)).size, frames.length, 'the scene moves: three different frames');

  // 2. Lost context while playing, then restored.
  const window = await open({ state: 'playing', fps: 30, startFrame: 0, epochMs: performance.timeOrigin + performance.now() }, 1);
  await until(() => { const r = api.outputs.status(out.id).render; return r && r.firstFrameDrawn && r.frame > 5 ? r : null; }, 5000, 'playing');
  const lost = await window.webContents.executeJavaScript('window.__pixelLabOutputGpu.lose()');
  assert.equal(lost, true, 'WEBGL_lose_context available');
  const lostReport = await until(() => { const r = api.outputs.status(out.id).render; return r && r.errorCode === 'GPU_UNAVAILABLE' ? r : null; }, 5000, 'GPU_UNAVAILABLE reported');
  const statusWhileLost = api.outputs.status(out.id);
  await sleep(1200);
  const frozen = api.outputs.status(out.id).render.frame;
  await sleep(700);
  assert.equal(api.outputs.status(out.id).render.frame, frozen, 'last frame stays while the context is lost');
  assert.equal(api.outputs.status(out.id).state, 'live', 'still live while the context is lost');
  const restored = await window.webContents.executeJavaScript('window.__pixelLabOutputGpu.restore()');
  assert.equal(restored, true);
  const back = await until(() => { const r = api.outputs.status(out.id).render; return r && r.errorCode === undefined && r.frame > frozen ? r : null; }, 8000, 'recovered on restore');
  await close();

  return {
    display: { devicePx: D, scaleFactor: display.scaleFactor },
    frames,
    contextLoss: { reported: lostReport.errorCode, message: lostReport.error, stateWhileLost: statusWhileLost.state, frozenAtFrame: frozen, recoveredAtFrame: back.frame, errorAfterRestore: back.errorCode ?? null },
  };
};
