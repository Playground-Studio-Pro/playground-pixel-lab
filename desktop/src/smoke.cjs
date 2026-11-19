module.exports = async function smoke(window, app, hooks = null) {
  const assert = require('node:assert/strict');
  const execute = script => window.webContents.executeJavaScript(script);
  const deadline = Date.now() + 30000;
  let state;
  do {
    state = await execute(`({ title: document.title, text: document.body.innerText, node: typeof process, require: typeof require, bridge: typeof window.pixelLabDesktop?.openProject })`);
    if (/New project|Create project/i.test(state.text)) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  assert.equal(state.title, 'Pixel Lab');
  assert.match(state.text, /New project|Create project/i);
  assert.equal(state.node, 'undefined');
  assert.equal(state.require, 'undefined');
  assert.equal(state.bridge, 'function');
  const status = await execute('window.pixelLabDesktop.ffmpegStatus()');
  assert.equal(typeof status.available, 'boolean');
  const displays = await execute('window.pixelLabDesktop.output.listDisplays()');
  assert.ok(Array.isArray(displays) && displays.length >= 1, 'at least one display');
  for (const d of displays) {
    assert.ok(Number.isSafeInteger(d.devicePx.width) && d.devicePx.width > 0 && Number.isSafeInteger(d.devicePx.height) && d.devicePx.height > 0);
    assert.equal(d.key.electronId, d.electronId);
    assert.ok([0, 90, 180, 270].includes(d.rotation));
  }
  assert.equal(displays.filter(d => d.primary).length, 1);
  const prefs = window.webContents.getLastWebPreferences();
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  const storage = await execute(`new Promise((resolve, reject) => { const r = indexedDB.open('desktop-smoke', 1); r.onerror = () => reject(r.error.message); r.onsuccess = () => { r.result.close(); indexedDB.deleteDatabase('desktop-smoke'); resolve(true); }; })`);
  assert.equal(storage, true);
  let output = 'not run';
  if (hooks) {
    if (await hooks.outputPageAvailable()) output = await smokeOutput(window, hooks, displays);
    else output = 'skipped: no output page at this origin yet (dev server has no /output until O4)';
  }
  if (hooks && hooks.mode && !hooks.mode.visible) {
    const { BrowserWindow } = require('electron');
    assert.deepEqual(hooks.smokeViolations, [], 'hidden run: no window was ever shown');
    assert.ok(BrowserWindow.getAllWindows().every(w => !w.isVisible()), 'hidden run: no window visible');
  }
  console.log('DESKTOP_SMOKE_PASS', JSON.stringify({ output, title: state.title, sandbox: true, isolated: true, indexedDB: storage, ffmpeg: status, displays: displays.map(d => ({ label: d.label, internal: d.internal, primary: d.primary, scaleFactor: d.scaleFactor, devicePx: d.devicePx, devicePxExact: d.devicePxExact, refreshHz: d.refreshHz, hostsControlWindow: d.hostsControlWindow })) }));
  app.exit(0);
};

// Phase C D4 + D5: open an output on the control window's display through the control window's own IPC, check the
// output page's isolation, then close it from the control window and, after hanging its renderer, with Esc.
const fs = require('node:fs');
const path = require('node:path');

async function smokeOutput(window, hooks, displays) {
  const assert = require('node:assert/strict');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const control = script => window.webContents.executeJavaScript(script);
  const { smokeTargetDisplay, smokeOpenRequest, visibleWarning } = require('./smoke-mode.cjs');
  const mode = hooks.mode;
  const visible = Boolean(mode && mode.visible);
  const display = smokeTargetDisplay(displays, mode);
  if (!display) return 'skipped: visible run without an external display (add --allow-control-display to use the control display)';
  if (visible) console.warn(visibleWarning(display));
  // A real project and valid frozen settings, so the run works with the stub and with Output's page (O4).
  const fixture = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'pixel-test.pixellab.json');
  const projectText = fs.readFileSync(fixture, 'utf8');
  const id = JSON.parse(projectText).project.output.outputs[0].id;
  const session = { revision: 1, projectText, outputId: id, source: { id: 'calibration-test-card', settings: { mode: 'identification', logo: 'off' } }, clock: { state: 'paused', frame: 0 } };
  const request = () => smokeOpenRequest({ outputId: id, display, session, mode });
  await control(`window.__outputStatuses = []; window.__unsubscribe = window.pixelLabDesktop.output.onStatus(s => window.__outputStatuses.push(s.state)); 1`);
  const statesSeen = () => control('window.__outputStatuses.slice()');
  const until = async (predicate, ms, what) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await predicate()) return Date.now(); await sleep(25); }
    const st = hooks.outputs.status(id);
    assert.fail(`timed out waiting for ${what} (state ${st.state}, error ${st.error ? st.error.code : null})`);
  };
  const stateOf = () => hooks.outputs.status(id).state;
  const blocking = () => { const b = hooks.outputs.sleepBlockerId(); return b !== null && hooks.powerSaveBlocker.isStarted(b); };
  const neverShown = () => { if (!visible) { const w = hooks.windows.output(id); assert.ok(!w || !w.isVisible(), 'hidden run: output window not visible'); assert.deepEqual(hooks.smokeViolations, []); } };

  // The control window's display is refused without allowControlDisplay (no window is created for a refusal).
  const controlDisplay = displays.find(d => d.hostsControlWindow);
  if (controlDisplay) {
    const refused = await control(`window.pixelLabDesktop.output.open(${JSON.stringify(smokeOpenRequest({ outputId: id, display: controlDisplay, session, mode: null }))}).then(() => 'opened', e => e.message)`);
    assert.match(refused, /CONTROL_DISPLAY/, 'control display refused without allowControlDisplay');
    assert.equal(stateOf(), 'closed');
  }
  const bad = await control(`window.pixelLabDesktop.output.open({ outputId: '${id}' }).then(() => 'opened', e => e.message)`);
  assert.match(bad, /BAD_REQUEST/);

  // 1. Open → live within 2 s, sleep blocked. Visible run: shown inactive, full screen on the display.
  const t0 = Date.now();
  const opening = await control(`window.pixelLabDesktop.output.open(${JSON.stringify(request())})`);
  assert.equal(opening.state, 'opening');
  assert.equal(blocking(), false, 'no sleep blocker while opening');
  const tLive = await until(() => stateOf() === 'live', 2000, 'live within 2 s');
  const out = hooks.windows.output(id);
  await sleep(300);   // let simple full screen settle before measuring bounds
  const bounds = out.getBounds();
  const live = { ms: tLive - t0, visible: out.isVisible(), focused: out.isFocused(), alwaysOnTop: out.isAlwaysOnTop(),
    simpleFullScreen: process.platform === 'darwin' ? out.isSimpleFullScreen() : null, bounds, blocking: blocking() };
  if (visible) {
    assert.equal(live.visible, true);
    assert.equal(live.focused, false, 'output window never takes focus');
    assert.equal(live.alwaysOnTop, true);
    if (process.platform === 'darwin') assert.equal(live.simpleFullScreen, true);
    assert.deepEqual(bounds, display.boundsDip, 'window covers the display bounds');
  } else {
    assert.equal(live.visible, false, 'hidden run: never shown');
    assert.equal(live.alwaysOnTop, false, 'hidden run: not on top');
    if (process.platform === 'darwin') assert.equal(live.simpleFullScreen, false, 'hidden run: not full screen');
    assert.deepEqual(bounds, display.boundsDip, 'created at the target display size');
  }
  assert.equal(live.blocking, true, 'sleep blocker held while live');
  const ext = await control(`window.pixelLabDesktop.output.status()`);
  assert.equal(ext.length, 1); assert.equal(ext[0].state, 'live'); assert.equal(ext[0].sessionRevision, 1);
  const again = await control(`window.pixelLabDesktop.output.open(${JSON.stringify(request())}).then(() => 'opened', e => e.message)`);
  assert.match(again, /ALREADY_OPEN/);

  // D4 isolation checks on the live output page.
  const run = script => out.webContents.executeJavaScript(script);
  const page = await run(`({ url: location.href, desktop: typeof window.pixelLabDesktop, node: typeof process, require: typeof require, api: window.pixelLabOutput ? Object.keys(window.pixelLabOutput).sort() : null, popup: String(window.open(location.origin)) })`);
  assert.equal(page.url, hooks.outputURL);
  assert.equal(page.desktop, 'undefined'); assert.equal(page.node, 'undefined'); assert.equal(page.require, 'undefined');
  assert.deepEqual(page.api, ['onClock', 'onDisplay', 'onSession', 'ready', 'report', 'version']);
  assert.equal(page.popup, 'null');
  const outPrefs = out.webContents.getLastWebPreferences();
  assert.equal(outPrefs.sandbox, true); assert.equal(outPrefs.contextIsolation, true); assert.equal(outPrefs.nodeIntegration, false);
  for (const target of [hooks.windows.origin, 'https://example.com/']) {
    await run(`location.href = ${JSON.stringify(target)}; 1`);
    await sleep(500);
    assert.equal(out.webContents.getURL(), hooks.outputURL, `navigation to ${target} blocked`);
  }
  const ev = { sender: out.webContents, senderFrame: out.webContents.mainFrame };
  assert.throws(() => hooks.windows.assertSender(ev, { kind: 'control' }), 'output window rejected on control channels');
  assert.doesNotThrow(() => hooks.windows.assertSender(ev, { kind: 'output', outputId: id }));
  const outFocused = out.isFocused();

  // 2. Close from the control window.
  await control(`window.pixelLabDesktop.output.close('${id}')`);
  await until(() => stateOf() === 'closed' && hooks.windows.outputIds().length === 0, 2000, 'close from the control window');
  assert.equal(blocking(), false, 'sleep blocker released after close');
  assert.equal(hooks.outputs.sleepBlockerId(), null);

  // 3. Reopen, hang the page with while(true){}, then Esc: handled in main, so it closes anyway.
  await control(`window.pixelLabDesktop.output.open(${JSON.stringify(request())})`);
  await until(() => stateOf() === 'live', 2000, 'live again');
  const hung = hooks.windows.output(id);
  hung.webContents.executeJavaScript('setTimeout(() => { for (;;) {} }, 0); 1').catch(() => {});
  await sleep(500);
  const hangCheck = await Promise.race([hung.webContents.executeJavaScript('1').then(() => 'answered'), sleep(500).then(() => 'hung')]);
  assert.equal(hangCheck, 'hung', 'output renderer is hung');
  const tEsc = Date.now();
  neverShown();
  hung.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await until(() => stateOf() === 'closed' && hooks.windows.outputIds().length === 0, 2000, 'Esc while hung');
  const escMs = Date.now() - tEsc;
  assert.equal(blocking(), false, 'sleep blocker released after Esc');
  await sleep(100);
  const states = await statesSeen();
  await control('window.__unsubscribe()');
  assert.deepEqual(states.filter((s, i) => s !== states[i - 1]), ['opening', 'live', 'closed', 'opening', 'live', 'closed'], 'status pushes');
  neverShown();
  return { mode: visible ? 'visible' : 'hidden (no window shown)', target: display.label, url: page.url, api: page.api, liveMs: live.ms, escWhileHungMs: escMs, focusedWhileLive: live.focused || outFocused, simpleFullScreen: live.simpleFullScreen, bounds, blockerWhileLive: live.blocking, states: [...new Set(states)] };
}
