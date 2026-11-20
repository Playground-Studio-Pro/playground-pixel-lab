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
  // Colour profile reaches the renderer (PHYSICAL_OUTPUT section 2, Colour). Under test:smoke's switch it reads sRGB.
  for (const d of displays) assert.ok(typeof d.colorSpace === 'string' && d.colorSpace.length > 0 && Number.isSafeInteger(d.colorDepth), `colorSpace and colorDepth for ${d.label}`);
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
  let script = 'not run';
  if (hooks && hooks.script) script = await hooks.script();
  if (hooks && hooks.mode && !hooks.mode.visible) {
    const { BrowserWindow } = require('electron');
    assert.deepEqual(hooks.smokeViolations, [], 'hidden run: no window was ever shown');
    assert.ok(BrowserWindow.getAllWindows().every(w => !w.isVisible()), 'hidden run: no window visible');
  }
  console.log('DESKTOP_SMOKE_PASS', JSON.stringify({ output, script, title: state.title, sandbox: true, isolated: true, indexedDB: storage, ffmpeg: status, displays: displays.map(d => ({ label: d.label, internal: d.internal, primary: d.primary, scaleFactor: d.scaleFactor, devicePx: d.devicePx, devicePxExact: d.devicePxExact, refreshHz: d.refreshHz, hostsControlWindow: d.hostsControlWindow, colorSpace: d.colorSpace, colorDepth: d.colorDepth })) }));
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
  await control(`window.__outputStatuses = []; window.__unsubscribe = window.pixelLabDesktop.output.onStatus(s => window.__outputStatuses.push(s.state + (s.error ? ':' + s.error.code : ''))); 1`);
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
  const page = await run(`({ url: location.href, desktop: typeof window.pixelLabDesktop, node: typeof process, require: typeof require, api: window.pixelLabOutput ? Object.keys(window.pixelLabOutput).sort() : null, testMode: window.pixelLabOutput && window.pixelLabOutput.testMode, popup: String(window.open(location.origin)) })`);
  assert.equal(page.url, hooks.outputURL);
  assert.equal(page.desktop, 'undefined'); assert.equal(page.node, 'undefined'); assert.equal(page.require, 'undefined');
  assert.deepEqual(page.api, ['onClock', 'onDisplay', 'onSession', 'ready', 'report', 'testMode', 'version']);
  assert.equal(page.testMode, true, 'smoke run: pixelLabOutput.testMode is true');
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

  // D8: renderer crash → failed (black, kept) → retry → live; a hang → RENDERER_UNRESPONSIVE → answers again → live;
  // Esc while failed from a hang; Close after a crash.
  await control(`window.__outputStatuses = []; window.__unsubscribe = window.pixelLabDesktop.output.onStatus(s => window.__outputStatuses.push(s.state + (s.error ? ':' + s.error.code : ''))); 1`);
  const errorOf = () => hooks.outputs.status(id).error?.code || null;
  const openLive = async () => { await control(`window.pixelLabDesktop.output.open(${JSON.stringify(request())})`); await until(() => stateOf() === 'live', 2000, 'live'); return hooks.windows.output(id); };
  const hangFor = (win, ms) => win.webContents.executeJavaScript(`setTimeout(() => { const end = Date.now() + ${ms}; while (Date.now() < end) {} }, 0); 1`);
  let win = await openLive();
  const tCrash = Date.now();
  win.webContents.forcefullyCrashRenderer();
  await until(() => stateOf() === 'failed' && errorOf() === 'RENDERER_GONE', 1000, 'RENDERER_GONE within 1 s');
  const crash = { ms: Date.now() - tCrash, kept: !win.isDestroyed(), shown: win.isVisible(), blocking: blocking() };
  assert.equal(crash.kept, true, 'D-1: the crashed window is kept, black');
  assert.equal(crash.shown, visible, visible ? 'D-1: still on screen' : 'hidden run: still not shown');
  neverShown();
  assert.equal(crash.blocking, false);
  const notFailed = await control(`window.pixelLabDesktop.output.retry('nope')`);
  assert.equal(notFailed.state, 'closed', 'retry of an output that is not open changes nothing');
  const tRetry = Date.now();
  const retrying = await control(`window.pixelLabDesktop.output.retry('${id}')`);
  assert.equal(retrying.state, 'opening');
  await until(() => stateOf() === 'live', 2000, 'retry → live within 2 s');
  const retryMs = Date.now() - tRetry;
  assert.equal(blocking(), true);
  assert.equal(win.webContents.getURL(), hooks.outputURL);

  const tHang = Date.now();
  await hangFor(win, 8000);
  // The criterion is "not before 5 s"; the upper bound is generous because main's 1 s watchdog slips on a loaded machine.
  await until(() => stateOf() === 'failed' && errorOf() === 'RENDERER_UNRESPONSIVE', 9000, 'RENDERER_UNRESPONSIVE');
  const unresponsiveMs = Date.now() - tHang;
  assert.ok(unresponsiveMs >= 5000 && unresponsiveMs < 9000, `unresponsive after ${unresponsiveMs} ms`);
  assert.equal(win.isVisible(), visible, visible ? 'frozen frame stays on screen' : 'hidden run: still not shown');
  neverShown();
  assert.equal(blocking(), false);
  await until(() => stateOf() === 'live', 6000, 'back to live once the page answers');
  const recoverMs = Date.now() - tHang;
  assert.equal(errorOf(), null);
  assert.equal(blocking(), true);

  await hangFor(win, 15000);
  await until(() => stateOf() === 'failed' && errorOf() === 'RENDERER_UNRESPONSIVE', 9000, 'unresponsive again');
  neverShown();
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await until(() => stateOf() === 'closed' && hooks.windows.outputIds().length === 0, 2000, 'Esc while failed');

  win = await openLive();
  win.webContents.forcefullyCrashRenderer();
  await until(() => stateOf() === 'failed', 1000, 'crashed again');
  await control(`window.pixelLabDesktop.output.close('${id}')`);
  await until(() => stateOf() === 'closed' && hooks.windows.outputIds().length === 0, 2000, 'Close after a crash');
  assert.equal(blocking(), false);
  await sleep(100);
  const d8States = await statesSeen();
  await control('window.__unsubscribe()');
  assert.deepEqual(d8States.filter((s, i) => s !== d8States[i - 1]), [
    'opening', 'live', 'failed:RENDERER_GONE', 'opening', 'live', 'failed:RENDERER_UNRESPONSIVE', 'live',
    'failed:RENDERER_UNRESPONSIVE', 'closed', 'opening', 'live', 'failed:RENDERER_GONE', 'closed',
  ], 'D8 status pushes');
  const d8 = { crashToFailedMs: crash.ms, retryToLiveMs: retryMs, hangToUnresponsiveMs: unresponsiveMs, hangEndToLiveMs: recoverMs - 8000 };

  // D7 (simulated display lists; the real unplug is for the monitor session): removed → waiting-display, clock paused;
  // a lookalike → DISPLAY_AMBIGUOUS; same display back → held on the paused frame; resume → live. Works with any output
  // page: it checks the frame the page reports drawing (status.render.frame) and the messages main sent it.
  const sharedNow = () => performance.timeOrigin + performance.now();
  const playing = { ...request(), session: { ...request().session, clock: { state: 'playing', fps: 30, startFrame: 0, epochMs: sharedNow() } } };
  await control(`window.pixelLabDesktop.output.open(${JSON.stringify(playing)})`);
  await until(() => stateOf() === 'live', 5000, 'live (D7)');
  win = hooks.windows.output(id);
  const drawnFrame = () => hooks.outputs.status(id).render?.frame ?? null;
  const lastSent = channel => [...hooks.sentToOutput].reverse().find(m => m.outputId === id && m.channel === channel)?.value ?? null;
  // Frames reported over `ms` (the page reports every 500 ms): what it actually drew in that window.
  const framesOver = async ms => { const seen = new Set(); const end = Date.now() + ms; while (Date.now() < end) { seen.add(drawnFrame()); await sleep(100); } return [...seen]; };
  const advancing = async what => { const a = drawnFrame(); await until(() => drawnFrame() !== null && a !== null && drawnFrame() > a, 3000, what); return drawnFrame(); };
  await advancing('frames advancing while live');
  const real = hooks.listDisplays();
  const tRemove = Date.now();
  hooks.outputs.onDisplaysChanged(real.filter(d => d.electronId !== display.electronId));
  const removed = { ms: Date.now() - tRemove, state: stateOf(), visible: win.isVisible(), blocking: blocking(), display: hooks.outputs.status(id).display };
  assert.equal(removed.state, 'waiting-display');
  assert.equal(removed.visible, false, 'hidden at once');
  assert.equal(removed.blocking, false);
  assert.equal(removed.display, null);
  const paused = lastSent('output:clock');
  assert.equal(paused?.state, 'paused', 'main sent a paused clock');
  assert.ok(paused.frame >= 1, `paused on a frame after playing, got ${paused.frame}`);
  await sleep(700);   // the page applies the clock and reports at least once
  const whileWaiting = await framesOver(1200);
  assert.deepEqual(whileWaiting, [paused.frame], `the page draws the paused frame while waiting, saw ${whileWaiting}`);
  const twin = { ...display, electronId: 999999, key: { ...display.key, electronId: 999999 }, hostsControlWindow: false, primary: false };
  hooks.outputs.onDisplaysChanged([...real.filter(d => d.electronId !== display.electronId), twin, { ...display, electronId: 999998, key: { ...display.key, electronId: 999998 }, hostsControlWindow: false, primary: false }]);
  assert.equal(stateOf(), 'waiting-display');
  assert.equal(errorOf(), 'DISPLAY_AMBIGUOUS', 'identical twins never take the output');
  assert.equal(win.isVisible(), false);
  const sentBefore = hooks.sentToOutput.length;
  const tBack = Date.now();
  hooks.outputs.onDisplaysChanged(real);
  await sleep(300);
  const held = { ms: Date.now() - tBack - 300, state: stateOf(), status: hooks.outputs.status(id), visible: win.isVisible(), focused: win.isFocused(),
    bounds: win.getBounds(), simpleFullScreen: process.platform === 'darwin' ? win.isSimpleFullScreen() : null, blocking: blocking() };
  assert.equal(held.state, 'held');
  assert.equal(held.status.reconnected, true);
  assert.equal(held.status.error, null);
  assert.equal(held.visible, visible, visible ? 'shown again on its display' : 'hidden run: still not shown');
  assert.equal(held.focused, false); assert.equal(held.blocking, false);
  assert.deepEqual(held.bounds, display.boundsDip);
  if (process.platform === 'darwin') assert.equal(held.simpleFullScreen, visible);
  neverShown();
  const reconnectMessages = hooks.sentToOutput.slice(sentBefore).filter(m => m.outputId === id);
  assert.deepEqual(reconnectMessages.map(m => m.channel), ['output:display'], 'reconnect sends output:display and no clock');
  assert.deepEqual(reconnectMessages[0].value.boundsDip, display.boundsDip);
  const whileHeld = await framesOver(1200);
  assert.deepEqual(whileHeld, [paused.frame], `the frame does not advance while held, saw ${whileHeld}`);
  assert.equal(stateOf(), 'held', 'never resumes by itself');
  const resumed = await control(`window.pixelLabDesktop.output.resume('${id}')`);
  assert.equal(resumed.state, 'live');
  assert.equal(resumed.reconnected, false);
  const after = lastSent('output:clock');
  assert.equal(after.state, 'playing'); assert.equal(after.startFrame, paused.frame); assert.equal(after.fps, 30);
  const resumedFrame = await advancing('frames advancing again after resume');
  assert.ok(resumedFrame > paused.frame, `drawn frame ${resumedFrame} after resume, paused at ${paused.frame}`);
  assert.equal(blocking(), true);
  assert.match(await control(`window.pixelLabDesktop.output.resume('${id}').then(() => 'resumed', e => e.message)`), /NOT_RESUMABLE/);
  // Metrics change on the display in use: output:display sent with the new geometry, still live, then back. The window's
  // own bounds can't follow a simulated size (simple full screen fills the real screen); that's checked on the monitor.
  const shrunk = { ...display, boundsDip: { ...display.boundsDip, height: display.boundsDip.height - 100 } };
  hooks.outputs.onDisplaysChanged(real.map(d => (d.electronId === display.electronId ? shrunk : d)));
  await sleep(400);
  const metrics = { sent: lastSent('output:display')?.boundsDip, state: stateOf(), visible: win.isVisible() };
  assert.deepEqual(metrics.sent, shrunk.boundsDip); assert.equal(metrics.state, 'live'); assert.equal(metrics.visible, visible);
  hooks.outputs.onDisplaysChanged(real);
  await sleep(400);
  assert.deepEqual(lastSent('output:display')?.boundsDip, display.boundsDip);
  assert.deepEqual(win.getBounds(), display.boundsDip);
  await control(`window.pixelLabDesktop.output.close('${id}')`);
  await until(() => stateOf() === 'closed' && hooks.windows.outputIds().length === 0, 2000, 'close (D7)');
  neverShown();
  const d7 = { removeToHiddenMs: removed.ms, pausedFrame: paused.frame, framesWhileWaiting: whileWaiting, framesWhileHeld: whileHeld, reconnectToHeldMs: held.ms, resumedClock: after, drawnAfterResume: resumedFrame };

  return { mode: visible ? 'visible' : 'hidden (no window shown)', target: display.label, d7, d8, url: page.url, api: page.api, liveMs: live.ms, escWhileHungMs: escMs, focusedWhileLive: live.focused || outFocused, simpleFullScreen: live.simpleFullScreen, bounds, blockerWhileLive: live.blocking, states: [...new Set(states)] };
}
