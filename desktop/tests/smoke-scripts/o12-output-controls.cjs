// O12 integration check: the Output studio's "Send to a monitor" controls, driven like an operator would.
// Hidden smoke runs only (nothing is shown):
//   npm --prefix desktop run test:smoke -- --smoke-script=desktop/tests/smoke-scripts/o12-output-controls.cjs
//
// 1. Imports Pixel test through the editor's "Import project file" input and opens the Output studio.
// 2. The monitor list shows every display; the default is never the one showing Pixel Lab. Choosing that one shows
//    the "Cover this screen" box and keeps Open disabled until it's ticked. This script never ticks it.
// 3. Chooses the run's virtual display (checked by label before Open), presses Open, sees Live with the Esc hint
//    and the fit line, checks the session main received, presses Update output (revision 2 drawn, still live, the
//    frame carrying on from where it was, no colour warning since test:smoke reports sRGB), then presses Close.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = async function o12OutputControls(api) {
  assert.ok(api.mode && !api.mode.visible, 'hidden smoke run only');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const control = script => api.control.webContents.executeJavaScript(script);
  const until = async (predicate, ms, what) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = await predicate(); if (v) return v; await sleep(25); }
    assert.fail(`timed out waiting for ${what}`);
  };
  const PRESS = `(el => { for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, button: 0, buttons: type.endsWith('down') ? 1 : 0, pointerType: 'mouse', isPrimary: true }));
  } })`;
  const press = testid => control(`(() => { const el = document.querySelector('[data-testid="${testid}"]'); if (!el) return false; ${PRESS}(el); return true; })()`);
  const text = testid => control(`(document.querySelector('[data-testid="${testid}"]') || {}).textContent || null`);
  const exists = testid => control(`!!document.querySelector('[data-testid="${testid}"]')`);
  const disabled = testid => control(`(document.querySelector('[data-testid="${testid}"]') || {}).disabled === true`);
  const trigger = label => `(() => { const l = [...document.querySelectorAll('label')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); return l && document.querySelector('[aria-labelledby="' + l.id + '"]'); })()`;
  async function choose(label, includes) {
    assert.ok(await control(`(() => { const t = ${trigger(label)}; if (!t) return false; ${PRESS}(t); return true; })()`), `select "${label}"`);
    await until(() => control(`[...document.querySelectorAll('[role=option]')].some(o => o.textContent.includes(${JSON.stringify(includes)}))`), 3000, `option "${includes}"`);
    await control(`(() => { const o = [...document.querySelectorAll('[role=option]')].find(x => x.textContent.includes(${JSON.stringify(includes)})); ${PRESS}(o); return true; })()`);
    return until(() => control(`(() => { const t = ${trigger(label)}; const v = t && t.textContent.trim(); return v && v.includes(${JSON.stringify(includes)}) ? v : null; })()`), 3000, `"${label}" set`);
  }
  const optionsOf = async label => {
    await control(`(() => { const t = ${trigger(label)}; ${PRESS}(t); return true; })()`);
    const list = await until(async () => { const o = await control(`[...document.querySelectorAll('[role=option]')].map(o => o.textContent.trim())`); return o.length ? o : null; }, 3000, `${label} options`);
    await control(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1`);
    await until(async () => !(await control(`document.querySelectorAll('[role=option]').length`)), 3000, `${label} closed`);
    return list;
  };

  // 1. Project and Output studio.
  const fixture = 'tests/fixtures/pixel-test.pixellab.json';
  const project = JSON.parse(fs.readFileSync(path.join(api.repoRoot, fixture), 'utf8')).project;
  await api.importProjectFile(fixture);
  await until(async () => (await control('document.body.innerText')).includes(project.meta.name) && (await exists('studio-output')), 10000, 'project open');
  assert.ok(await press('studio-output'));
  await until(() => exists('output-controls'), 5000, '"Send to a monitor" in the Output studio');

  // 2. Monitor list and the control window's own monitor.
  const displays = await control('window.pixelLabDesktop.output.listDisplays()');
  const own = displays.find(d => d.hostsControlWindow);
  const virtual = displays.find(d => d.electronId === api.virtualDisplayId);
  const monitorOptions = await optionsOf('Monitor');
  assert.equal(monitorOptions.length, displays.length, 'every display listed');
  const defaultMonitor = await control(`${trigger('Monitor')}.textContent.trim()`);
  assert.ok(!defaultMonitor.includes('shows Pixel Lab'), `default monitor isn't the one showing Pixel Lab (${defaultMonitor})`);
  let ownChecks = null;
  if (own) {
    await choose('Monitor', own.label);
    const box = await until(() => exists('cover-control-display'), 3000, 'cover-this-screen box');
    ownChecks = { box, openDisabled: await disabled('output-open'), boxText: await text('cover-control-display') };
    assert.equal(ownChecks.openDisabled, true, 'Open disabled on the Pixel Lab monitor until the box is ticked');
  }

  // 3. Open on the virtual display, through the panel.
  const chosen = await choose('Monitor', virtual.label);
  assert.ok(chosen.includes('smoke (hidden'), `only the hidden run's virtual display (${chosen})`);
  assert.equal(await exists('cover-control-display'), false, 'no cover box on another monitor');
  assert.equal(await disabled('output-open'), false, 'Open enabled');
  const t0 = Date.now();
  assert.ok(await press('output-open'));
  await until(async () => (await text('output-state')) === 'Live', 5000, 'Live in the panel');
  const liveMs = Date.now() - t0;
  const outputId = project.output.outputs[0].id;
  const status = api.outputs.status(outputId);
  assert.equal(status.state, 'live');
  assert.equal(status.display.electronId, api.virtualDisplayId, 'opened on the virtual display');
  assert.equal(api.windows.output(outputId).isVisible(), false, 'never shown');
  const live = { badge: await text('output-state'), message: await text('output-message'), fit: await text('output-fit'), esc: await text('output-esc-hint'), sizeMatch: status.sizeMatch, render: { sourceId: status.render.sourceId, canvasPx: status.render.canvasPx, outputPx: status.render.outputPx } };
  assert.equal(live.esc, 'Esc closes the output.');
  assert.ok(live.fit, 'fit line shown');

  // Update while live: the panel sends the next revision, keeping the clock; main forwards it and the page draws it.
  const before = api.outputs.status(outputId);
  assert.equal(await disabled('output-update'), false, 'Update output enabled while live');
  assert.equal(await exists('output-colour-warning'), false, 'no colour warning: test:smoke reports an sRGB profile');
  assert.ok(await press('output-update'));
  const updated = await until(() => { const s = api.outputs.status(outputId); return s.sessionRevision === 2 && s.render && s.render.sessionRevision === 2 && s.render.firstFrameDrawn ? s : null; }, 5000, 'revision 2 drawn');
  assert.equal(updated.state, 'live', 'still live after the update');
  const updateResult = { revisionBefore: before.sessionRevision, revisionAfter: updated.sessionRevision, frameBefore: before.render.frame, frameAfter: updated.render.frame, error: await text('output-request-error') };
  assert.ok(updateResult.frameAfter >= updateResult.frameBefore, 'the update kept playing on, not from frame 0');

  // Close from the panel.
  assert.ok(await press('output-close'));
  await until(async () => (await text('output-state')) === 'Closed', 3000, 'Closed in the panel');
  await until(() => api.outputs.status(outputId).state === 'closed' && api.windows.outputIds().length === 0, 3000, 'window closed');
  return { monitorOptions, defaultMonitor, ownMonitor: ownChecks, chosen, liveMs, live, update: updateResult, afterClose: { badge: await text('output-state'), esc: await exists('output-esc-hint') } };
};
