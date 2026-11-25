// Live adjust (D-4): the Output panel's Live switch, driven like an operator would. Hidden smoke runs only.
//   PIXEL_LAB_WEB_ROOT=$PWD npm --prefix desktop run build:web
//   npm --prefix desktop run test:smoke -- --smoke-script=desktop/tests/smoke-scripts/live-adjust.cjs
//
// 1. Imports Pixel test, opens OUT 1 on the run's virtual display from the panel. Live is off: a nudge sends nothing.
// 2. Ticks Live: the current map goes out at once. A held arrow key (30 presses at 30 a second) is coalesced, the
//    last position lands, revisions go up by one, and the content clock is never reset.
// 3. Moves Wall B into Wall A: "Live paused" shows and nothing is sent; one move back out sends exactly one update.
// 4. Close: Live turns off.
// A test-only wrapper on window.pixelLabDesktop.output.update records each session the page sends and calls through.
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
  const sends = () => control('window.__liveSends.map(s => ({ revision: s.revision, at: s.at, x: s.x, clock: s.clock }))');
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
  await control(`(() => {
    if (window.__liveSends) return true;
    const out = window.pixelLabDesktop.output; const update = out.update.bind(out);
    window.__liveSends = [];
    out.update = (id, session) => {
      const p = JSON.parse(session.projectText).project;
      window.__liveSends.push({ revision: session.revision, at: performance.timeOrigin + performance.now(), x: p.content.regions.find(r => r.screenId === ${JSON.stringify(wallB)}).x, clock: session.clock });
      return update(id, session);
    };
    return true;
  })()`);
  const displays = await control('window.pixelLabDesktop.output.listDisplays()');
  const virtual = displays.find(d => d.electronId === api.virtualDisplayId);
  await choose('Monitor', virtual.label);
  assert.ok(await press('output-open'));
  await until(async () => (await text('output-state')) === 'Live', 5000, 'Live');
  const outputId = project.output.outputs[0].id;
  assert.equal(api.windows.output(outputId).isVisible(), false, 'never shown');
  assert.equal(await checked(), 'false', 'Live is off when an output opens');

  // Live off: a move sends nothing.
  await control(`(() => { const row = [...document.querySelectorAll('aside[aria-label="Project explorer"] *')].find(e => e.children.length === 0 && e.textContent.trim() === 'Wall B'); ${PRESS}(row.closest('button,[role=button],div')); return true; })()`);
  await key('ArrowRight');
  await sleep(300);
  assert.deepEqual(await sends(), [], 'no update with Live off');
  await key('ArrowLeft');
  await sleep(100);

  // 2. Live on: sends at once, then a held arrow key.
  const frameBefore = api.outputs.status(outputId).render.frame;
  assert.ok(await press('output-live-switch'));
  await until(async () => (await sends()).length === 1, 3000, 'first Live update');
  assert.equal(await checked(), 'true');
  const t0 = Date.now();
  for (let i = 0; i < 30; i++) { await key('ArrowRight'); await sleep(1000 / 30); }
  const heldMs = Date.now() - t0;
  await sleep(400);
  const run = (await sends()).slice(1);
  const last = run[run.length - 1];
  await until(() => { const s = api.outputs.status(outputId); return s.render && s.render.sessionRevision === last.revision && s.render.firstFrameDrawn; }, 3000, 'last revision drawn');
  const status = api.outputs.status(outputId);
  assert.equal(last.x, startX + 30, 'the last position lands');
  assert.ok(run.length <= Math.ceil(heldMs / 50) + 2, `coalesced: ${run.length} updates for 30 presses in ${heldMs} ms`);
  const all = await sends();
  all.forEach((s, i) => i && assert.equal(s.revision, all[i - 1].revision + 1, 'revisions go up by one'));
  const gaps = all.slice(1).map((s, i) => s.at - all[i].at);
  assert.ok(all.every(s => JSON.stringify(s.clock) === JSON.stringify(all[0].clock)), 'every update carries the same clock');
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
  const afterClose = (await sends()).length;
  await key('ArrowRight'); await sleep(300);
  assert.equal((await sends()).length, afterClose, 'nothing sent after Close');
  assert.equal(await exists('output-live-switch'), false, 'no Live switch while closed');

  return {
    heldArrow: { presses: 30, ms: heldMs, updates: run.length, lastX: last.x, expectedX: startX + 30, gapMs: { min: Math.min(...gaps.slice(1, run.length)), max: Math.max(...gaps.slice(1, run.length)) } },
    clock: { frameBefore, frameAfter: status.render.frame, sameClock: true },
    pause: { text: pausedText, stepsToOverlap: steps, sentWhilePaused: 0, sentWhenValid: 1 },
    revisions: all.map(s => s.revision),
  };
};
