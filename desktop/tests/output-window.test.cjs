const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { outputWindowOptions, createOutputWindow, outputTestMode, TEST_MODE_ARG } = require('../src/output-window.cjs');
const { assetPath } = require('../src/security.cjs');

test('output window options keep every restriction of the control window', () => {
  const o = outputWindowOptions({ bounds: { x: 1512, y: 0, width: 1920, height: 1080 }, isPackaged: true });
  assert.deepEqual([o.x, o.y, o.width, o.height], [1512, 0, 1920, 1080]);
  assert.equal(o.show, false);
  assert.equal(o.frame, false);
  assert.equal(o.backgroundColor, '#000000');
  const p = o.webPreferences;
  assert.equal(path.basename(p.preload), 'output-preload.cjs');
  assert.equal(p.contextIsolation, true);
  assert.equal(p.sandbox, true);
  assert.equal(p.nodeIntegration, false);
  assert.equal(p.webSecurity, true);
  assert.equal(p.webviewTag, false);
  assert.equal(p.backgroundThrottling, false);
  assert.equal(p.zoomFactor, 1);
  assert.equal(p.devTools, false, 'no DevTools in a packaged build');
  assert.equal(outputWindowOptions({ bounds: o, isPackaged: false }).webPreferences.devTools, true);
});

function fakeBrowserWindow() {
  const created = [];
  class FakeWindow {
    constructor(options) {
      this.options = options; this.loaded = null; this.handlers = {}; this.openHandler = null;
      this.webContents = {
        setWindowOpenHandler: fn => { this.openHandler = fn; },
        on: (name, fn) => { this.handlers[name] = fn; },
        setZoomFactor: () => {}, setVisualZoomLevelLimits: () => Promise.resolve(),
      };
      created.push(this);
    }
    loadURL(url) { this.loaded = url; return Promise.resolve(); }
  }
  return { FakeWindow, created };
}

for (const [origin, expected] of [['app://pixellab/', 'app://pixellab/output.html'], ['http://127.0.0.1:3210/', 'http://127.0.0.1:3210/output']]) {
  test(`output window loads only its allowlisted URL (${origin})`, () => {
    const { FakeWindow } = fakeBrowserWindow();
    const win = createOutputWindow(FakeWindow, { bounds: { x: 0, y: 0, width: 640, height: 360 }, origin, isPackaged: false });
    assert.equal(win.loaded, expected);
    assert.deepEqual(win.openHandler(), { action: 'deny' });
    for (const name of ['will-navigate', 'will-redirect']) {
      for (const url of [origin, 'https://evil.test/output.html', `${expected}?x=1`]) {
        let prevented = false;
        win.handlers[name]({ preventDefault: () => { prevented = true; } }, url);
        assert.equal(prevented, true, `${name} ${url}`);
      }
      let prevented = false;
      win.handlers[name]({ preventDefault: () => { prevented = true; } }, expected);
      assert.equal(prevented, false, `${name} to its own URL`);
    }
    let blocked = false;
    win.handlers['will-attach-webview']({ preventDefault: () => { blocked = true; } });
    assert.equal(blocked, true);
  });
}

test('the app:// handler serves output.html from the web root', () => {
  const root = path.resolve('fixture');
  assert.equal(assetPath(root, 'app://pixellab/output.html'), path.join(root, 'output.html'));
});

test('the output preload exposes only the output API', () => {
  const exposed = {}; const sent = []; const listeners = {};
  const electron = {
    contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } },
    ipcRenderer: { on: (ch, fn) => { listeners[ch] = fn; }, send: (...args) => sent.push(args) },
  };
  const original = Module._load;
  Module._load = function (request, ...rest) { return request === 'electron' ? electron : original.call(this, request, ...rest); };
  try {
    delete require.cache[require.resolve('../src/output-preload.cjs')];
    require('../src/output-preload.cjs');
  } finally { Module._load = original; }
  assert.deepEqual(Object.keys(exposed), ['pixelLabOutput']);
  const api = exposed.pixelLabOutput;
  assert.deepEqual(Object.keys(api).sort(), ['onClock', 'onDisplay', 'onSession', 'ready', 'report', 'testMode', 'version']);
  assert.equal(api.testMode, false, 'no test argument, no test mode');
  assert.equal(Object.isFrozen(api), true);
  let session = null;
  api.onSession(s => { session = s; });
  listeners['output:session']({}, { revision: 3 });
  assert.deepEqual(session, { revision: 3 });
  assert.throws(() => api.onClock('not a function'), TypeError);
  api.ready(); api.report({ frame: 1 });
  assert.deepEqual(sent, [['output:ready'], ['output:report', { frame: 1 }]]);
});

test('the stub page loads nothing from outside and stays black', () => {
  const html = fs.readFileSync(path.join(__dirname, '../resources/output-stub.html'), 'utf8');
  assert.doesNotMatch(html, /\b(src|href)\s*=/i, 'no external scripts, styles or images');
  assert.match(html, /background: #000/);
  assert.match(html, /cursor: none/);
});

test('test mode: false when packaged, false without --smoke-test, true in an unpackaged smoke run', () => {
  const smoke = ['electron', '.', '--smoke-test'];
  assert.equal(outputTestMode({ isPackaged: true, argv: smoke }), false);
  assert.equal(outputTestMode({ isPackaged: false, argv: ['electron', '.'] }), false);
  assert.equal(outputTestMode({ isPackaged: false, argv: ['electron', '.', '--smoke-testing'] }), false);
  assert.equal(outputTestMode({ isPackaged: false, argv: smoke }), true);
  const bounds = { x: 0, y: 0, width: 640, height: 360 };
  assert.deepEqual(outputWindowOptions({ bounds, isPackaged: false }).webPreferences.additionalArguments, []);
  assert.deepEqual(outputWindowOptions({ bounds, isPackaged: false, testMode: 'yes' }).webPreferences.additionalArguments, [], 'exactly true');
  assert.deepEqual(outputWindowOptions({ bounds, isPackaged: true, testMode: true }).webPreferences.additionalArguments, [], 'never packaged');
  const on = outputWindowOptions({ bounds, isPackaged: false, testMode: true }).webPreferences;
  assert.deepEqual(on.additionalArguments, [TEST_MODE_ARG]);
  assert.equal(on.sandbox, true); assert.equal(on.contextIsolation, true); assert.equal(on.nodeIntegration, false);
  const { FakeWindow } = fakeBrowserWindow();
  const win = createOutputWindow(FakeWindow, { bounds, origin: 'app://pixellab/', isPackaged: false, testMode: true });
  assert.equal(win.loaded, 'app://pixellab/output.html', 'no query: the URL is unchanged');
  assert.deepEqual(win.options.webPreferences.additionalArguments, [TEST_MODE_ARG]);
});

test('the output preload reads test mode only from the argument main adds', () => {
  const load = argv => {
    const exposed = {};
    const electron = { contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } }, ipcRenderer: { on: () => {}, send: () => {} } };
    const original = Module._load; const originalArgv = process.argv;
    Module._load = function (request, ...rest) { return request === 'electron' ? electron : original.call(this, request, ...rest); };
    process.argv = argv;
    try { delete require.cache[require.resolve('../src/output-preload.cjs')]; require('../src/output-preload.cjs'); }
    finally { Module._load = original; process.argv = originalArgv; }
    return exposed.pixelLabOutput;
  };
  assert.equal(load(['renderer', TEST_MODE_ARG]).testMode, true);
  assert.equal(load(['renderer', '--smoke-test']).testMode, false);
  assert.equal(load(['renderer']).testMode, false);
  const api = load(['renderer', TEST_MODE_ARG]);
  assert.throws(() => { 'use strict'; api.testMode = false; }, TypeError, 'frozen: the page cannot change it');
});
