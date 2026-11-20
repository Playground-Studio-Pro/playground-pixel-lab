// O4 integration check for the real output page (PHYSICAL_OUTPUT 8.10). Hidden smoke runs only: nothing is shown.
//   npm --prefix desktop run test:smoke -- --smoke-script=desktop/tests/smoke-scripts/o4-output-page.cjs
//
// 1. Page = MP4, frame 0. Imports a project through the editor's own "Import project file" input, chooses the
//    output in the Output studio's MP4 panel, and hashes the panel's export preview: frame 0 drawn by the export
//    itself. Then opens the same output, source and settings in a hidden output window on the run's virtual display
//    and hashes the same area of its canvas. They must be equal.
//      Pixel test OUT 1 (1920 × 1080): calibration test card and pixel grid. Required.
//      Festival Main Stage, Processor A (3072 × 1920): test card. The large master, for O8.
//    Frames other than 0 are covered by the browser comparison in #38; the export preview only draws frame 0.
// 2. Corporate Keynote OUT 1 (4224 × 1536, over H.264's 4096, so no export preview): the 1:1 report
//    (devicePixelRatio === scaleFactor, canvasPx === devicePx, outputPx 4224 × 1536), black outside the output,
//    and the time from open to the first frame (live) over several runs.
// contentBoxDevicePx is recorded, not asserted: a hidden window may never be laid out for it.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const RUNS = 5;

module.exports = async function o4OutputPage(api) {
  assert.ok(api.mode && !api.mode.visible, 'hidden smoke run only');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const control = script => api.control.webContents.executeJavaScript(script);
  const until = async (predicate, ms, what) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = await predicate(); if (v) return v; await sleep(25); }
    assert.fail(`timed out waiting for ${what}`);
  };
  const read = file => fs.readFileSync(path.join(api.repoRoot, file), 'utf8');
  const displays = await control('window.pixelLabDesktop.output.listDisplays()');
  const display = displays.find(d => d.electronId === api.virtualDisplayId);
  assert.ok(display, 'virtual display listed in a hidden run');

  // ── Control window helpers: the editor's own controls, by their accessible names ──────────────────────────────
  // Base UI controls open on pointer events; a plain click() isn't enough.
  const PRESS = `(el => { for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, button: 0, buttons: type.endsWith('down') ? 1 : 0, pointerType: 'mouse', isPrimary: true }));
  } })`;
  const openStudio = id => control(`(() => { const t = document.querySelector('[data-testid="studio-${id}"]'); if (!t) return false; ${PRESS}(t); return true; })()`);
  /** Chooses an option in a labelled SelectField. Returns the trigger's text afterwards. */
  async function choose(label, startsWith) {
    const opened = await control(`(() => {
      const l = [...document.querySelectorAll('label')].find(x => x.textContent.trim() === ${JSON.stringify(label)});
      const t = l && document.querySelector('[aria-labelledby="' + l.id + '"]');
      if (!t) return false; ${PRESS}(t); return true; })()`);
    assert.ok(opened, `select "${label}" found`);
    await until(() => control(`[...document.querySelectorAll('[role=option]')].some(o => o.textContent.trim().startsWith(${JSON.stringify(startsWith)}))`), 3000, `option "${startsWith}"`);
    await control(`(() => { const o = [...document.querySelectorAll('[role=option]')].find(x => x.textContent.trim().startsWith(${JSON.stringify(startsWith)})); ${PRESS}(o); return true; })()`);
    return until(() => control(`(() => { const l = [...document.querySelectorAll('label')].find(x => x.textContent.trim() === ${JSON.stringify(label)});
      const t = l && document.querySelector('[aria-labelledby="' + l.id + '"]'); const v = t && t.textContent.trim(); return v && v.startsWith(${JSON.stringify(startsWith)}) ? v : null; })()`), 3000, `"${label}" set to "${startsWith}"`);
  }
  const HASH = `async (ctx, w, h) => { const d = ctx.getImageData(0, 0, w, h).data; const b = await crypto.subtle.digest('SHA-256', d);
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }`;
  /** The export preview's frame 0, once drawn at the target's size and stable across two reads. */
  async function previewHash(w, h) {
    const once = () => control(`(async () => { const c = document.querySelector('[data-testid="export-preview"]');
      if (!c || c.width !== ${w} || c.height !== ${h}) return null;
      const g = c.getContext('2d'); if (![...g.getImageData(0, 0, ${w}, ${h}).data].some((v, i) => i % 4 !== 3 && v)) return null;
      return (${HASH})(g, ${w}, ${h}); })()`);
    let previous = null;
    return until(async () => { await sleep(150); const now = await once(); const stable = now && now === previous; previous = now; return stable ? now : null; }, 10000, `export preview ${w} × ${h} drawn`);
  }

  // ── Output window helpers ───────────────────────────────────────────────────────────────────────────────────
  async function openOutput(projectText, outputId, source) {
    const session = { revision: 1, projectText, outputId, source, clock: { state: 'paused', frame: 0 } };
    const t0 = Date.now();
    await control(`window.pixelLabDesktop.output.open(${JSON.stringify({ outputId, display: display.key, session })})`);
    const state = await until(() => { const s = api.outputs.status(outputId).state; return s === 'live' || s === 'failed' ? s : null; }, 5000, 'live');
    const firstFrameMs = Date.now() - t0;
    const status = api.outputs.status(outputId);
    assert.equal(state, 'live', `live (got ${state}: ${JSON.stringify(status.error)})`);
    const window = api.windows.output(outputId);
    assert.equal(window.isVisible(), false, 'output window never shown');
    return { firstFrameMs, status, window };
  }
  const outputHash = (window, w, h) => window.webContents.executeJavaScript(`(${HASH})(document.querySelector('canvas').getContext('2d'), ${w}, ${h})`);
  async function closeOutput(outputId) {
    await control(`window.pixelLabDesktop.output.close('${outputId}')`);
    await until(() => api.outputs.status(outputId).state === 'closed' && api.windows.outputIds().length === 0, 3000, 'closed');
  }

  const result = { display: { devicePx: display.devicePx, scaleFactor: display.scaleFactor, refreshHz: display.refreshHz }, hashes: [], keynote: null };

  // ── 1. Page = MP4, frame 0 ──────────────────────────────────────────────────────────────────────────────────
  const cases = [
    { file: 'tests/fixtures/pixel-test.pixellab.json', target: 'OUT 1', sources: [
      { id: 'calibration-test-card', settings: { mode: 'identification', logo: 'center' }, content: 'Calibration test card' },
      { id: 'pixel-grid', settings: { space: 'master', motion: true }, content: 'Pixel grid' },
    ] },
    { file: 'tests/fixtures/festival-main-stage.pixellab.json', target: 'OUT 1', sources: [
      { id: 'calibration-test-card', settings: { mode: 'identification', logo: 'center' }, content: 'Calibration test card' },
    ] },
  ];
  for (const c of cases) {
    const projectText = read(c.file);
    const project = JSON.parse(projectText).project;
    await api.importProjectFile(c.file);
    await until(async () => (await control('document.body.innerText')).includes(project.meta.name) && (await control(`!!document.querySelector('[data-testid="studio-output"]')`)), 10000, `${project.meta.name} open in the editor`);
    assert.ok(await openStudio('output'), 'Output studio tab');
    await until(() => control(`!!document.querySelector('[data-testid="output-studio"]')`), 5000, 'Output studio');
    const output = project.output.outputs[0];
    const forText = await choose('For', c.target);
    const size = /(\d+) × (\d+)/.exec(forText).slice(1).map(Number);
    for (const s of c.sources) {
      await choose('Content', s.content);
      // The panel's test card settings are the editor's defaults (identification, logo center); the session matches.
      const reference = await previewHash(size[0], size[1]);
      const { firstFrameMs, status, window } = await openOutput(projectText, output.id, { id: s.id, settings: s.settings });
      const page = await outputHash(window, size[0], size[1]);
      result.hashes.push({ project: project.meta.name, output: output.name, size, source: s.id, frame: 0, equal: page === reference, page: page.slice(0, 16), mp4: reference.slice(0, 16), firstFrameMs, contentBoxDevicePx: status.render.contentBoxDevicePx });
      await closeOutput(output.id);
      assert.equal(page, reference, `${project.meta.name} ${output.name} ${s.id} frame 0: output window === export preview`);
    }
  }

  // ── 2. Corporate Keynote OUT 1: 1:1 report, black outside, first-frame latency ─────────────────────────────
  const keynoteText = read('tests/fixtures/corporate-keynote.pixellab.json');
  const keynote = JSON.parse(keynoteText).project;
  const outId = keynote.output.outputs[0].id;
  const latencies = [];
  let first = null;
  for (let i = 0; i < RUNS; i++) {
    const { firstFrameMs, status, window } = await openOutput(keynoteText, outId, { id: 'calibration-test-card', settings: { mode: 'identification', logo: 'center' } });
    latencies.push(firstFrameMs);
    if (i === 0) {
      const r = status.render;
      assert.equal(r.devicePixelRatio, display.scaleFactor, 'devicePixelRatio === scaleFactor');
      assert.deepEqual(r.canvasPx, display.devicePx, 'canvasPx === devicePx');
      assert.deepEqual(r.outputPx, { width: 4224, height: 1536 }, 'outputPx 4224 × 1536');
      const vis = { width: Math.min(4224, display.devicePx.width), height: Math.min(1536, display.devicePx.height) };
      const black = await window.webContents.executeJavaScript(`(() => { const c = document.querySelector('canvas'); const g = c.getContext('2d');
        const px = (x, y) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)];
        const probes = [];
        if (${vis.height} < c.height) probes.push([0, ${vis.height}], [Math.floor(c.width / 2), c.height - 1], [c.width - 1, c.height - 1]);
        if (${vis.width} < c.width) probes.push([${vis.width}, 0], [c.width - 1, 0]);
        return { probes: probes.length, allBlack: probes.every(([x, y]) => px(x, y).every(v => v === 0)), inside: px(1, 1) }; })()`);
      assert.equal(black.allBlack, true, 'black outside the output');
      first = { devicePixelRatio: r.devicePixelRatio, scaleFactor: display.scaleFactor, canvasPx: r.canvasPx, devicePx: display.devicePx, outputPx: r.outputPx,
        sizeMatch: status.sizeMatch, croppedPx: status.croppedPx, blackPx: status.blackPx, contentBoxDevicePx: r.contentBoxDevicePx, blackProbes: black.probes, error: status.error };
    }
    await closeOutput(outId);
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  result.keynote = { ...first, firstFrameMs: latencies, medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: sorted[sorted.length - 1] };
  return result;
};
