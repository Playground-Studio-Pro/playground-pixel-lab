// Regression: after an output closes, its monitor must be free in the Output panel even if no screen event follows.
// Hidden smoke runs only (nothing is shown):
//   npm --prefix desktop run test:smoke -- --smoke-script=desktop/tests/smoke-scripts/reopen-display-list.cjs
//
// Opens on the run's virtual display through the panel, sends a display-metrics-changed while it's open (entering full
// screen does that on a real display), closes with Close and then with Esc, and checks each time, with no screen event
// after, that the panel's Open is enabled and that the output reopens and goes live. Also that status reports alone
// don't send the list.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { screen } = require('electron');

module.exports = async function reopenDisplayList(api) {
  assert.ok(api.mode && !api.mode.visible, 'hidden smoke run only');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const control = script => api.control.webContents.executeJavaScript(script);
  const until = async (predicate, ms, what) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await predicate(); if (v) return v; await sleep(25); } assert.fail(`timed out waiting for ${what}`); };
  const PRESS = `(el => { for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, button: 0, buttons: type.endsWith('down') ? 1 : 0, pointerType: 'mouse', isPrimary: true }));
  } })`;
  const press = testid => control(`(() => { const el = document.querySelector('[data-testid="${testid}"]'); if (!el || el.disabled) return false; ${PRESS}(el); return true; })()`);
  const exists = testid => control(`!!document.querySelector('[data-testid="${testid}"]')`);
  const disabled = testid => control(`(document.querySelector('[data-testid="${testid}"]') || {}).disabled === true`);
  const panelText = () => control(`(document.querySelector('[data-testid="output-controls"]') || {}).textContent || ''`);
  const trigger = label => `(() => { const l = [...document.querySelectorAll('label')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); return l && document.querySelector('[aria-labelledby="' + l.id + '"]'); })()`;
  const fixture = 'tests/fixtures/pixel-test.pixellab.json';
  const project = JSON.parse(fs.readFileSync(path.join(api.repoRoot, fixture), 'utf8')).project;
  const id = project.output.outputs[0].id;
  const state = () => api.outputs.status(id).state;

  await api.importProjectFile(fixture);
  await until(async () => (await control('document.body.innerText')).includes(project.meta.name) && (await exists('studio-output')), 10000, 'project open');
  assert.ok(await press('studio-output'));
  await until(() => exists('output-controls'), 5000, '"Send to a monitor"');
  await control(`window.__lists = []; window.pixelLabDesktop.output.onDisplays(d => window.__lists.push(d.map(x => [x.electronId, x.hostsOutput]))); 1`);
  const lists = () => control('window.__lists.slice()');
  const hosts = async () => { const l = (await lists()).at(-1); const row = l && l.find(([e]) => e === api.virtualDisplayId); return row ? row[1] : undefined; };
  const virtual = (await control('window.pixelLabDesktop.output.listDisplays()')).find(d => d.electronId === api.virtualDisplayId);
  assert.ok(virtual && virtual.label.includes('smoke (hidden'));
  await control(`${PRESS}(${trigger('Monitor')}); 1`);
  await until(() => control(`[...document.querySelectorAll('[role=option]')].some(o => o.textContent.includes(${JSON.stringify(virtual.label)}))`), 3000, 'the virtual monitor');
  await control(`${PRESS}([...document.querySelectorAll('[role=option]')].find(o => o.textContent.includes(${JSON.stringify(virtual.label)}))); 1`);
  await until(() => control(`(t => t && t.textContent.includes(${JSON.stringify(virtual.label)}))(${trigger('Monitor')})`), 3000, 'monitor chosen');
  const results = [];
  let screenEvents = 0;
  for (const name of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(name, () => { screenEvents += 1; });

  for (const how of ['Close', 'Esc']) {
    assert.equal(await disabled('output-open'), false, `${how}: Open enabled before opening (${await panelText()})`);
    assert.ok(await press('output-open'), 'Open pressed');
    await until(() => state() === 'live', 5000, 'live');
    const window = api.windows.output(id);
    assert.equal(window.isVisible(), false, 'never shown');
    // A work-area change while open, as entering full screen causes: the panel now holds a list saying it's occupied.
    screen.emit('display-metrics-changed', {}, screen.getPrimaryDisplay(), ['workArea']);
    await until(async () => (await hosts()) === id, 3000, 'a list with the output on its monitor');
    await sleep(600);   // the event's own list comes after the 250 ms debounce
    const before = (await lists()).length;
    await sleep(2200);   // several reports
    assert.equal((await lists()).length, before, 'reports alone never send the list');
    screenEvents = 0;
    if (how === 'Close') assert.ok(await press('output-close')); else window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await until(() => state() === 'closed' && api.windows.outputIds().length === 0, 3000, `${how} closes`);
    await sleep(1200);   // well past the 250 ms debounce
    const after = { how, screenEventsAfterClose: screenEvents, hostsOutput: await hosts(), openDisabled: await disabled('output-open'), saysBusy: (await panelText()).includes('already on that monitor') };
    results.push(after);
    assert.equal(after.screenEventsAfterClose, 0, 'no screen event after the close: the list came from the close itself');
    assert.equal(after.hostsOutput, null, `${how}: the monitor is free in the last list`);
    assert.equal(after.saysBusy, false, `${how}: no "Another output is already on that monitor"`);
    assert.equal(after.openDisabled, false, `${how}: Open enabled`);
  }
  assert.ok(await press('output-open'), 'reopen');
  await until(() => state() === 'live', 5000, 'live again');
  assert.equal(api.windows.output(id).isVisible(), false);
  assert.ok(await press('output-close'));
  await until(() => state() === 'closed', 3000, 'closed');
  return { results, reopened: true };
};
