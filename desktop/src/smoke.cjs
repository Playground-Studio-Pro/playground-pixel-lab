module.exports = async function smoke(window, app) {
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
  console.log('DESKTOP_SMOKE_PASS', JSON.stringify({ title: state.title, sandbox: true, isolated: true, indexedDB: storage, ffmpeg: status, displays: displays.map(d => ({ label: d.label, internal: d.internal, primary: d.primary, scaleFactor: d.scaleFactor, devicePx: d.devicePx, devicePxExact: d.devicePxExact, refreshHz: d.refreshHz, hostsControlWindow: d.hostsControlWindow })) }));
  app.exit(0);
};
