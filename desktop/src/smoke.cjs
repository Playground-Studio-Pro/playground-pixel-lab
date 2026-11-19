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
    if (await hooks.outputPageAvailable()) {
      const out = hooks.openOutputWindow('smoke-output', { x: 0, y: 0, width: 640, height: 360 });
      const run = script => out.webContents.executeJavaScript(script);
      const until = Date.now() + 15000;
      while (Date.now() < until && !(hooks.outputRecord('smoke-output')?.ready && hooks.outputRecord('smoke-output')?.report)) await new Promise(r => setTimeout(r, 100));
      const record = hooks.outputRecord('smoke-output');
      assert.ok(record?.ready, 'output page reported ready');
      assert.ok(record?.report, 'output report accepted by main');
      const page = await run(`({ url: location.href, desktop: typeof window.pixelLabDesktop, node: typeof process, require: typeof require, api: window.pixelLabOutput ? Object.keys(window.pixelLabOutput).sort() : null, popup: String(window.open(location.origin)) })`);
      assert.equal(page.url, hooks.outputURL);
      assert.equal(page.desktop, 'undefined');
      assert.equal(page.node, 'undefined');
      assert.equal(page.require, 'undefined');
      assert.deepEqual(page.api, ['onClock', 'onDisplay', 'onSession', 'ready', 'report', 'version']);
      assert.equal(page.popup, 'null');
      const outPrefs = out.webContents.getLastWebPreferences();
      assert.equal(outPrefs.sandbox, true); assert.equal(outPrefs.contextIsolation, true); assert.equal(outPrefs.nodeIntegration, false);
      for (const target of [hooks.windows.origin, 'https://example.com/']) {
        await run(`location.href = ${JSON.stringify(target)}; 1`);
        await new Promise(r => setTimeout(r, 500));
        assert.equal(out.webContents.getURL(), hooks.outputURL, `navigation to ${target} blocked`);
      }
      const ev = { sender: out.webContents, senderFrame: out.webContents.mainFrame };
      assert.throws(() => hooks.windows.assertSender(ev, { kind: 'control' }), 'output window rejected on control channels');
      assert.doesNotThrow(() => hooks.windows.assertSender(ev, { kind: 'output', outputId: 'smoke-output' }));
      out.destroy();
      await new Promise(r => setTimeout(r, 200));
      assert.deepEqual(hooks.windows.outputIds(), []);
      output = { url: page.url, api: page.api, report: record.report.sourceId || 'page' };
    } else output = 'skipped: no output page at this origin yet (dev server has no /output until O4)';
  }
  console.log('DESKTOP_SMOKE_PASS', JSON.stringify({ output, title: state.title, sandbox: true, isolated: true, indexedDB: storage, ffmpeg: status, displays: displays.map(d => ({ label: d.label, internal: d.internal, primary: d.primary, scaleFactor: d.scaleFactor, devicePx: d.devicePx, devicePxExact: d.devicePxExact, refreshHz: d.refreshHz, hostsControlWindow: d.hostsControlWindow })) }));
  app.exit(0);
};
