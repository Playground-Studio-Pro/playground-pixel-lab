// Live adjust (D-4): the Output panel's Live switch, driven like an operator would. Hidden smoke runs only.
//   PIXEL_LAB_WEB_ROOT=$PWD npm --prefix desktop run build:web
//   npm --prefix desktop run test:smoke -- --smoke-script=desktop/tests/smoke-scripts/live-adjust.cjs
//
// 1. Imports Pixel test, opens OUT 1 on the run's virtual display from the panel. Live is off: a nudge sends nothing.
// 2. Ticks Live: the current map goes out at once. A held arrow key (30 presses at 30 a second) is coalesced, the
//    last position lands, revisions go up by one, and the content clock is never reset.
// 3. Moves Wall B into Wall A: "Live paused" shows and nothing is sent; one move back out sends exactly one update.
// 4. Close: Live turns off.
// Updates are observed in the hidden output page: a test-only wrapper on its JSON.parse records each project text the
// page parses (one per session it receives) and calls through, as desktop/tests/smoke-scripts/live-update-cost.cjs does.
// Revisions and frames come from main's status for the output.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = async function liveAdjust(api) {
  assert.ok(api.mode && !api.mode.visible, 'hidden smoke run only');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const control = script => api.control.webContents.executeJavaScript(script);
  const until = async (predicate, ms, what) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = await predicate(); if (v) return v; await sleep(20); }
    assert.fail(`timed out waiting for ${what}`);
  };
  const PRESS = `(el => { for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, button: 0, buttons: type.endsWith('down') ? 1 : 0, pointerType: 'mouse', isPrimary: true }));
  } })`;
  const press = testid => control(`(() => { const el = document.querySelector('[data-testid="${testid}"]'); if (!el) return false; ${PRESS}(el); return true; })()`);
  const text = testid => control(`(document.querySelector('[data-testid="${testid}"]') || {}).textContent || null`);
  const exists = testid => control(`!!document.querySelector('[data-testid="${testid}"]')`);
  const trigger = label => `(() => { const l = [...document.querySelectorAll('label')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); return l && document.querySelector('[aria-labelledby="' + l.id + '"]'); })()`;
  async function choose(label, includes) {
    await control(`(() => { const t = ${trigger(label)}; ${PRESS}(t); return true; })()`);
    await until(() => control(`[...document.querySelectorAll('[role=option]')].some(o => o.textContent.includes(${JSON.stringify(includes)}))`), 3000, `option "${includes}"`);
    await control(`(() => { const o = [...document.querySelectorAll('[role=option]')].find(x => x.textContent.includes(${JSON.stringify(includes)})); ${PRESS}(o); return true; })()`);
  }
  const key = (k, shift = false) => control(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, shiftKey: ${shift}, bubbles: true, cancelable: true })); 1`);
  let outputId = null;
  const page = script => api.windows.output(outputId).webContents.executeJavaScript(script);
  const hook = wallB => `(() => {
    if (window.__parsed) return true;
    window.__parsed = [];
    const parse = JSON.parse;
    JSON.parse = function (text, reviver) {
      const v = parse.call(this, text, reviver);
      if (typeof text === 'string' && v && v.project && v.project.content) window.__parsed.push(v.project.content.regions.find(r => r.screenId === ${JSON.stringify(wallB)}).x);
      return v;
    };
    return true;
  })()`;
  // Every project the page has parsed since the hook went in (the open session was parsed before it).
  const sends = async () => (await page('window.__parsed.slice()')).map(x => ({ x }));
  const checked = () => control(`(document.querySelector('[data-testid="output-live-switch"]') || {}).getAttribute?.('aria-checked') ?? null`);

  // 1. Project, Output studio, open on the virtual display.
  const fixture = 'tests/fixtures/pixel-test.pixellab.json';
  const project = JSON.parse(fs.readFileSync(path.join(api.repoRoot, fixture), 'utf8')).project;
  const wallB = project.physical.screens.find(s => s.name === 'Wall B').id;
  const startX = project.content.regions.find(r => r.screenId === wallB).x;
  await api.importProjectFile(fixture);
  await until(async () => (await control('document.body.innerText')).includes(project.meta.name) && (await exists('studio-output')), 10000, 'project open');
  assert.ok(await press('studio-output'));
  await until(() => exists('output-controls'), 5000, 'output controls');
  const displays = await control('window.pixelLabDesktop.output.listDisplays()');
  const virtual = displays.find(d => d.electronId === api.virtualDisplayId);
  await choose('Monitor', virtual.label);
  outputId = project.output.outputs[0].id;
  assert.ok(await press('output-open'));
  await until(async () => (await text('output-state')) === 'Live', 5000, 'Live');
  assert.equal(api.windows.output(outputId).isVisible(), false, 'never shown');
  assert.equal(await checked(), 'false', 'Live is off when an output opens');
  assert.equal(await page(hook(wallB)), true);

  // Live off: a move sends nothing.
  await control(`(() => { const row = [...document.querySelectorAll('aside[aria-label="Project explorer"] *')].find(e => e.children.length === 0 && e.textContent.trim() === 'Wall B'); ${PRESS}(row.closest('button,[role=button],div')); return true; })()`);
  await key('ArrowRight');
  await sleep(300);
  assert.deepEqual(await sends(), [], 'no update with Live off');
  await key('ArrowLeft');
  await sleep(100);

  // 2. Live on: sends at once, then a held arrow key.
  const frameBefore = api.outputs.status(outputId).render.frame;
  const revisionBefore = api.outputs.status(outputId).sessionRevision;
  assert.ok(await press('output-live-switch'));
  await until(async () => (await checked()) === 'true', 3000, 'Live switch on');
  await until(async () => (await sends()).length === 1, 3000, 'first Live update');
  assert.equal(await checked(), 'true');
  const t0 = Date.now();
  for (let i = 0; i < 30; i++) { await key('ArrowRight'); await sleep(1000 / 30); }
  const heldMs = Date.now() - t0;
  await sleep(400);
  const run = (await sends()).slice(1);
  const last = run[run.length - 1];
  // status.sessionRevision is the last revision the page drew; wait for the last update sent to be drawn.
  const sentCount = (await sends()).length;
  const status = await until(() => { const s = api.outputs.status(outputId); return s.sessionRevision === revisionBefore + sentCount && s.render && s.render.firstFrameDrawn ? s : null; }, 3000, 'last revision drawn');
  assert.equal(last.x, startX + 30, 'the last position lands');
  assert.ok(run.length <= Math.ceil(heldMs / 50) + 2, `coalesced: ${run.length} updates for 30 presses in ${heldMs} ms`);
  const all = await sends();
  // Main refuses a revision that doesn't go up, so one more revision per update means every one was accepted in order.
  assert.equal(status.sessionRevision, revisionBefore + all.length, 'one revision per update, none refused');
  assert.ok(status.render.frame >= frameBefore, 'the content carried on, never back to frame 0');
  assert.equal(status.state, 'live');

  // 3. Into Wall A: paused, nothing sent. Back out: exactly one update.
  let steps = 0;
  while (!(await exists('output-live-paused'))) { await key('ArrowLeft', true); steps++; await sleep(120); assert.ok(steps < 40, 'reached an overlap'); }
  await sleep(300);
  const atPause = (await sends()).length;
  const pausedText = await text('output-live-paused');
  await key('ArrowLeft', true); await sleep(200);
  await key('ArrowLeft', true); await sleep(200);
  assert.equal((await sends()).length, atPause, 'nothing sent while the mapping has an error');
  await key('ArrowRight', true); await sleep(200);
  await key('ArrowRight', true); await sleep(200);
  assert.equal((await sends()).length, atPause, 'still overlapping: nothing sent');
  await key('ArrowRight', true);
  await until(async () => (await sends()).length === atPause + 1, 2000, 'one update when valid again');
  await sleep(300);
  assert.equal((await sends()).length, atPause + 1, 'exactly one');
  assert.equal(await exists('output-live-paused'), false);

  // 4. Close turns Live off.
  assert.ok(await press('output-close'));
  await until(async () => (await text('output-state')) === 'Closed', 3000, 'Closed');
  await until(() => !api.windows.output(outputId), 3000, 'output window gone');
  assert.equal(await exists('output-live-switch'), false, 'no Live switch while closed');
  // A move after Close: Live is off, so nothing reaches main (no output, no error in the panel).
  await key('ArrowRight'); await sleep(300);
  assert.equal(api.outputs.status(outputId).state, 'closed');
  assert.equal(await exists('output-request-error'), false);

  return {
    heldArrow: { presses: 30, ms: heldMs, updates: run.length, lastX: last.x, expectedX: startX + 30 },
    clock: { frameBefore, frameAfter: status.render.frame },
    pause: { text: pausedText, stepsToOverlap: steps, sentWhilePaused: 0, sentWhenValid: 1 },
    revisions: { before: revisionBefore, after: status.sessionRevision, updates: all.length },
  };
};
