const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { destroyOutputWindow, leaveFullScreen, leaveFullScreenOnClose } = require('../src/output-presentation.cjs');
const { createOutputController, outputKeyAction, OPEN_TIMEOUT_MS } = require('../src/output-controller.cjs');

/** A window that logs, in order, what's done to it. presentation = what macOS would be hiding for the app. */
function fakeWindow({ platform = 'darwin', full = true, throws = null } = {}) {
  const log = [];
  const w = new EventEmitter();
  const own = platform === 'darwin';
  let destroyed = false, isFull = full;
  Object.defineProperty(w, 'presentation', { get: () => (isFull ? 5 : 0) });   // not cleared by destroy: that's the bug
  Object.assign(w, {
    log,
    isDestroyed: () => destroyed,
    isSimpleFullScreen: () => { assert.equal(destroyed, false, 'never asked after destroy'); assert.ok(own, 'simple full screen is macOS only'); return isFull; },
    isFullScreen: () => { assert.equal(destroyed, false); assert.ok(!own, 'native full screen not used on macOS'); return isFull; },
    setSimpleFullScreen: on => { if (throws) throw throws; assert.ok(own); isFull = on; log.push(`simple:${on}`); },
    setFullScreen: on => { if (throws) throw throws; assert.ok(!own); isFull = on; log.push(`full:${on}`); },
    destroy: () => { log.push('destroy'); destroyed = true; w.emit('closed'); },
  });
  return w;
}

test('close leaves simple full screen first on macOS, the platform\'s on Windows, then destroys, in the same tick', () => {
  const mac = fakeWindow();
  destroyOutputWindow(mac, 'darwin');
  assert.deepEqual(mac.log, ['simple:false', 'destroy']);
  assert.equal(mac.presentation, 0);
  const win = fakeWindow({ platform: 'win32' });
  destroyOutputWindow(win, 'win32');
  assert.deepEqual(win.log, ['full:false', 'destroy']);
});

test('a window never in full screen (hidden, opening, addOutput failure) is only destroyed', () => {
  const w = fakeWindow({ full: false });
  destroyOutputWindow(w, 'darwin');
  assert.deepEqual(w.log, ['destroy']);
});

test('missing or destroyed windows are left alone; a failure leaving full screen never stops the close', () => {
  assert.doesNotThrow(() => destroyOutputWindow(undefined, 'darwin'));
  assert.doesNotThrow(() => destroyOutputWindow(null, 'darwin'));
  const gone = fakeWindow();
  destroyOutputWindow(gone, 'darwin');
  destroyOutputWindow(gone, 'darwin');
  leaveFullScreen(gone, 'darwin');
  assert.deepEqual(gone.log, ['simple:false', 'destroy'], 'once');
  const original = console.error; console.error = () => {};
  try {
    const stuck = fakeWindow({ throws: new Error('no screen') });
    destroyOutputWindow(stuck, 'darwin');
    assert.deepEqual(stuck.log, ['destroy']);
  } finally { console.error = original; }
});

test('a close the system starts (⌘W) leaves full screen before the window goes', () => {
  const w = fakeWindow();
  leaveFullScreenOnClose(w, 'darwin');
  w.emit('close');
  assert.deepEqual(w.log, ['simple:false']);
  w.destroy();
  assert.deepEqual(w.log, ['simple:false', 'destroy']);
});

// Every close path that goes through the controller, with main's closeWindow.
const display = {
  key: { label: 'HP 27er', devicePx: { width: 1920, height: 1080 }, internal: false, electronId: 3 },
  electronId: 3, label: 'HP 27er', internal: false, primary: false, boundsDip: { x: 0, y: -1080, width: 1920, height: 1080 }, scaleFactor: 1,
  devicePx: { width: 1920, height: 1080 }, devicePxExact: true, rotation: 0, refreshHz: 60, hostsControlWindow: false, hostsOutput: null,
};
const request = {
  outputId: 'OUT1', display: display.key,
  session: { revision: 1, projectText: JSON.stringify({ format: 'playground-pixel-lab/project', project: { output: { outputs: [{ id: 'OUT1' }] } } }), outputId: 'OUT1', source: { id: 'pixel-grid', settings: {} }, clock: { state: 'paused', frame: 0 } },
};
const report = {
  sessionRevision: 1, firstFrameDrawn: true, frame: 0, devicePixelRatio: 1, viewportCss: { width: 1920, height: 1080 }, canvasPx: { width: 1920, height: 1080 },
  outputPx: { width: 1920, height: 1080 }, browserFps: 60, lateFrames: 0, skippedFrames: 0, contentBoxDevicePx: { width: 1920, height: 1080 },
};
function opened({ live = true } = {}) {
  const timers = new Map(); let next = 1, clock = 1000, window;
  const c = createOutputController({
    listDisplays: () => [display],
    openWindow: id => { window = fakeWindow({ full: false }); window.on('closed', () => c.onClosed(id)); },
    showWindow: () => { if (!window.isSimpleFullScreen()) window.setSimpleFullScreen(true); },
    hideWindow: () => leaveFullScreen(window, 'darwin'),
    closeWindow: () => destroyOutputWindow(window, 'darwin'),
    sendSession: () => {}, pushStatus: () => {}, reloadWindow: () => {}, probe: () => new Promise(() => {}),   // a page that never answers
    blocker: { start: () => 1, stop: () => {} }, now: () => clock, sharedNow: () => clock,
    timers: { setTimeout: (fn, ms) => { timers.set(next, { fn, ms }); return next++; }, clearTimeout: h => timers.delete(h) },
  });
  c.open(request);
  if (live) { c.onReady('OUT1'); c.onReport('OUT1', report); assert.equal(c.status('OUT1').state, 'live'); assert.equal(window.presentation, 5); }
  return { c, window, tick: ms => { clock += ms; }, fire: ms => { for (const [h, t] of [...timers]) if (t.ms === ms) { timers.delete(h); t.fn(); } } };
}
const closedClean = ({ c, window }, why) => {
  assert.equal(c.status('OUT1').state, 'closed', why);
  assert.equal(window.presentation, 0, `${why}: menu bar and Dock given back`);
  assert.deepEqual(window.log.slice(-2), window.log.includes('simple:true') ? ['simple:false', 'destroy'] : ['destroy'], why);
};

test('Close, Esc and app quit (close "*") while live', () => {
  for (const [why, target] of [['Close', 'OUT1'], ['quit', '*']]) { const t = opened(); t.c.close(target); closedClean(t, why); }
  const t = opened();
  assert.equal(outputKeyAction({ type: 'keyDown', key: 'Escape' }), 'close');
  t.c.close('OUT1');   // what main does with that action
  closedClean(t, 'Esc');
});

test('display lost while opening, and while failed after an open timeout', () => {
  const opening = opened({ live: false });
  opening.c.onDisplaysChanged([]);
  closedClean(opening, 'opening');
  const failed = opened({ live: false });
  failed.fire(OPEN_TIMEOUT_MS);
  assert.equal(failed.c.status('OUT1').state, 'failed');
  assert.equal(failed.window.presentation, 5, 'a failed output stays black and full screen (D-1)');
  failed.c.onDisplaysChanged([]);
  closedClean(failed, 'failed');
});

test('Close and Esc after a crash, and after a hang with a page that never answers', () => {
  const crash = opened();
  crash.c.onRendererGone('OUT1', 'crashed');
  assert.equal(crash.window.presentation, 5, 'kept full screen while failed (D-1)');
  crash.c.close('OUT1');
  closedClean(crash, 'crash');
  const hang = opened();
  hang.tick(60000); hang.fire(1000);
  assert.equal(hang.c.status('OUT1').state, 'failed');
  hang.c.close('OUT1');
  closedClean(hang, 'hang');
});

test('Close while waiting for the display and while held', () => {
  const waiting = opened();
  waiting.c.onDisplaysChanged([]);
  assert.equal(waiting.c.status('OUT1').state, 'waiting-display');
  assert.equal(waiting.window.presentation, 0, 'hidden: already left full screen');
  waiting.c.close('OUT1');
  assert.equal(waiting.window.presentation, 0);
  assert.equal(waiting.c.status('OUT1').state, 'closed');
  const held = opened();
  held.c.onDisplaysChanged([]); held.c.onDisplaysChanged([display]);
  assert.equal(held.c.status('OUT1').state, 'held');
  held.c.close('OUT1');
  closedClean(held, 'held');
});

test('main has no other way to destroy an output window', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  assert.doesNotMatch(source, /\.destroy\(\)/, 'every destroy goes through destroyOutputWindow');
  assert.match(source, /closeWindow: outputId => destroyOutputWindow\(/);
  assert.match(source, /catch \(error\) \{ destroyOutputWindow\(window, process\.platform\); throw error; \}\s+leaveFullScreenOnClose\(/);
  assert.match(source, /setTimeout\(\(\) => destroyOutputWindow\(window, process\.platform\), smokeOutput\.deadManMs\)/);
  assert.match(source, /app\.on\('before-quit', \(\) => outputs\.close\('\*'\)\)/);
});
