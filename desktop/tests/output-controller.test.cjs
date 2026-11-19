const test = require('node:test');
const assert = require('node:assert/strict');
const { createOutputController, outputKeyAction, OPEN_TIMEOUT_MS } = require('../src/output-controller.cjs');

const builtIn = {
  key: { label: 'Built-in Retina Display', devicePx: { width: 3600, height: 2338 }, internal: true, electronId: 1 },
  electronId: 1, label: 'Built-in Retina Display', internal: true, primary: true,
  boundsDip: { x: 0, y: 0, width: 1800, height: 1169 }, scaleFactor: 2, devicePx: { width: 3600, height: 2338 },
  devicePxExact: true, rotation: 0, refreshHz: 120, hostsControlWindow: true, hostsOutput: null,
};
const external = {
  key: { label: 'DELL U2720Q', devicePx: { width: 1920, height: 1080 }, internal: false, electronId: 2 },
  electronId: 2, label: 'DELL U2720Q', internal: false, primary: false,
  boundsDip: { x: 1800, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, devicePx: { width: 1920, height: 1080 },
  devicePxExact: true, rotation: 0, refreshHz: 60, hostsControlWindow: false, hostsOutput: null,
};
const project = ids => JSON.stringify({ format: 'playground-pixel-lab/project', project: { output: { outputs: ids.map(id => ({ id })) } } });
const request = (outputId = 'OUT1', display = external, extra = {}) => ({
  outputId, display: display.key, ...extra,
  session: { revision: 3, projectText: project(['OUT1', 'OUT2']), outputId, source: { id: 'pixel-grid', settings: {} }, clock: { state: 'paused', frame: 0 } },
});
const report = (extra = {}) => ({
  sessionRevision: 3, firstFrameDrawn: true, frame: 0, devicePixelRatio: 1, viewportCss: { width: 1920, height: 1080 },
  canvasPx: { width: 1920, height: 1080 }, outputPx: { width: 1920, height: 1080 }, browserFps: 60, lateFrames: 0, skippedFrames: 0,
  contentBoxDevicePx: { width: 1920, height: 1080 }, ...extra,
});

function setup({ displays = [builtIn, external], maxOutputs } = {}) {
  const log = [];
  const statuses = [];
  const timers = new Map();
  let nextTimer = 1, clock = 1000, nextBlocker = 10;
  const started = new Set();
  const controller = createOutputController({
    listDisplays: () => displays,
    openWindow: (id, d) => log.push(['open', id, d.electronId]),
    showWindow: (id, d) => log.push(['show', id, d.electronId]),
    closeWindow: id => { log.push(['close', id]); controller.onClosed(id); },
    sendSession: (id, s) => log.push(['session', id, s.revision, s.display.electronId]),
    pushStatus: s => statuses.push(s),
    blocker: { start: type => { assert.equal(type, 'prevent-display-sleep'); const b = nextBlocker++; started.add(b); return b; }, stop: b => started.delete(b) },
    timers: { setTimeout: (fn, ms) => { const h = nextTimer++; timers.set(h, { fn, ms }); return h; }, clearTimeout: h => timers.delete(h) },
    now: () => clock,
    ...(maxOutputs ? { maxOutputs } : {}),
  });
  return {
    controller, log, statuses, timers, started,
    tick: ms => { clock += ms; },
    fireTimers: () => { for (const [h, t] of [...timers]) { timers.delete(h); t.fn(); } },
    codeOf: fn => { try { fn(); } catch (e) { return e.code; } return null; },
  };
}
const states = statuses => statuses.map(s => s.state);

test('open → opening → live: session after ready, live on the first drawn frame of that revision', () => {
  const t = setup();
  const opening = t.controller.open(request());
  assert.equal(opening.state, 'opening');
  assert.deepEqual(t.log, [['open', 'OUT1', 2]]);
  assert.equal(t.timers.size, 1);
  assert.equal([...t.timers.values()][0].ms, OPEN_TIMEOUT_MS);
  assert.equal(t.controller.sleepBlockerId(), null);
  // A report before the session went out doesn't make it live.
  assert.equal(t.controller.onReport('OUT1', report()), true);
  assert.equal(t.controller.status('OUT1').state, 'opening');
  t.controller.onReady('OUT1');
  assert.deepEqual(t.log.at(-1), ['session', 'OUT1', 3, 2]);
  assert.equal(t.timers.size, 0, 'ready clears the open timeout');
  t.tick(500);
  t.controller.onReport('OUT1', report({ sessionRevision: 2 }));   // an older revision isn't this session's first frame
  assert.equal(t.controller.status('OUT1').state, 'opening');
  t.tick(500);
  t.controller.onReport('OUT1', report({ firstFrameDrawn: false }));
  assert.equal(t.controller.status('OUT1').state, 'opening');
  t.tick(500);
  t.controller.onReport('OUT1', report());
  const live = t.controller.status('OUT1');
  assert.equal(live.state, 'live');
  assert.deepEqual(t.log.at(-1), ['show', 'OUT1', 2]);
  assert.equal(live.sessionRevision, 3);
  assert.equal(live.sizeMatch, 'exact');
  assert.equal(live.error, null);
  assert.equal(t.started.size, 1, 'sleep blocker held while live');
  assert.deepEqual([...new Set(states(t.statuses))], ['opening', 'live']);
  assert.deepEqual(t.controller.outputOnDisplay(), new Map([[2, 'OUT1']]));
});

test('close from the control window and Esc both end in closed and release the sleep blocker', () => {
  const t = setup();
  t.controller.open(request());
  t.controller.onReady('OUT1');
  t.controller.onReport('OUT1', report());
  assert.equal(t.started.size, 1);
  t.controller.close('OUT1');
  assert.deepEqual(t.log.at(-1), ['close', 'OUT1']);
  assert.equal(t.controller.status('OUT1').state, 'closed');
  assert.equal(t.statuses.at(-1).state, 'closed');
  assert.equal(t.started.size, 0);
  assert.equal(t.controller.sleepBlockerId(), null);
  assert.deepEqual(t.controller.statusAll(), []);
  // Closing again, or an unknown id, does nothing; '*' closes everything.
  t.controller.close('OUT1');
  t.controller.close('NOPE');
  t.controller.open(request());
  t.controller.close('*');
  assert.deepEqual(t.controller.statusAll(), []);
  assert.equal(t.codeOf(() => t.controller.close('bad id!')), 'BAD_REQUEST');
});

test('closing while opening clears the timeout; a closed output ignores late messages', () => {
  const t = setup();
  t.controller.open(request());
  t.controller.close('OUT1');
  assert.equal(t.timers.size, 0);
  t.controller.onReady('OUT1');
  assert.equal(t.controller.onReport('OUT1', report()), false);
  assert.equal(t.log.filter(l => l[0] === 'session').length, 0);
});

test('open refusals carry the section 3 codes and create no window', () => {
  const t = setup();
  assert.equal(t.codeOf(() => t.controller.open({ outputId: 'OUT1' })), 'BAD_REQUEST');
  assert.equal(t.codeOf(() => t.controller.open({ ...request(), extra: 1 })), 'BAD_REQUEST');
  const unknown = request('OUT9');
  assert.equal(t.codeOf(() => t.controller.open(unknown)), 'UNKNOWN_OUTPUT');
  const broken = request(); broken.session = { ...broken.session, projectText: '{' };
  assert.equal(t.codeOf(() => t.controller.open(broken)), 'PROJECT_INVALID');
  const gone = request('OUT1', { ...external, key: { ...external.key, electronId: 99 } });
  assert.equal(t.codeOf(() => t.controller.open(gone)), 'DISPLAY_NOT_FOUND', 'the key must match a connected display exactly');
  const resized = request('OUT1', { ...external, key: { ...external.key, devicePx: { width: 3840, height: 2160 } } });
  assert.equal(t.codeOf(() => t.controller.open(resized)), 'DISPLAY_NOT_FOUND');
  assert.equal(t.codeOf(() => t.controller.open(request('OUT1', builtIn))), 'CONTROL_DISPLAY');
  assert.equal(t.codeOf(() => t.controller.open(request('OUT1', builtIn, { allowControlDisplay: false }))), 'CONTROL_DISPLAY');
  assert.deepEqual(t.log, []);
  assert.deepEqual(t.statuses, []);
  // D-5: the control display only with the explicit toggle.
  assert.equal(t.controller.open(request('OUT1', builtIn, { allowControlDisplay: true })).state, 'opening');
  assert.equal(t.codeOf(() => t.controller.open(request('OUT1', builtIn, { allowControlDisplay: true }))), 'ALREADY_OPEN');
  assert.equal(t.codeOf(() => t.controller.open(request('OUT2', external))), 'TOO_MANY_OUTPUTS', 'MAX_OUTPUTS is 1');
});

test('DISPLAY_BUSY when another output is on that display (limit raised, as a test build would)', () => {
  const t = setup({ maxOutputs: 2 });
  t.controller.open(request('OUT1', external));
  assert.equal(t.codeOf(() => t.controller.open(request('OUT2', external))), 'DISPLAY_BUSY');
  assert.equal(t.controller.open(request('OUT2', builtIn, { allowControlDisplay: true })).state, 'opening');
  // One blocker for every live output, released with the last one.
  for (const id of ['OUT1', 'OUT2']) { t.controller.onReady(id); t.controller.onReport(id, report(id === 'OUT2' ? { devicePixelRatio: 2, viewportCss: { width: 1800, height: 1169 }, canvasPx: builtIn.devicePx, contentBoxDevicePx: builtIn.devicePx, outputPx: builtIn.devicePx } : {})); }
  assert.equal(t.started.size, 1);
  t.controller.close('OUT1');
  assert.equal(t.started.size, 1, 'still held: OUT2 is live');
  t.controller.close('OUT2');
  assert.equal(t.started.size, 0);
});

test('a window that fails to open leaves nothing behind', () => {
  const t = setup();
  const failing = createOutputController({
    listDisplays: () => [external], openWindow: () => { throw new Error('TOO_MANY_OUTPUTS'); }, showWindow() {}, closeWindow() {},
    sendSession() {}, pushStatus: s => t.statuses.push(s), blocker: { start: () => 1, stop() {} },
    timers: { setTimeout: () => 1, clearTimeout() {} },
  });
  assert.throws(() => failing.open(request()));
  assert.deepEqual(failing.statusAll(), []);
  assert.deepEqual(t.statuses, []);
});

test('opening → failed: OPEN_TIMEOUT, LOAD_FAILED, and a page error before any frame; the window stays shown black', () => {
  const timeout = setup();
  timeout.controller.open(request());
  timeout.fireTimers();
  let s = timeout.controller.status('OUT1');
  assert.equal(s.state, 'failed');
  assert.equal(s.error.code, 'OPEN_TIMEOUT');
  assert.deepEqual(timeout.log.at(-1), ['show', 'OUT1', 2], 'D-1: black full-screen window, not closed');
  assert.equal(timeout.started.size, 0, 'no sleep blocker when failed');

  const load = setup();
  load.controller.open(request());
  load.controller.onLoadFailed('OUT1', 'ERR_FILE_NOT_FOUND');
  s = load.controller.status('OUT1');
  assert.equal(s.state, 'failed');
  assert.equal(s.error.code, 'LOAD_FAILED');
  assert.match(s.error.message, /ERR_FILE_NOT_FOUND/);
  assert.equal(load.timers.size, 0);

  const page = setup();
  page.controller.open(request());
  page.controller.onReady('OUT1');
  page.controller.onReport('OUT1', report({ firstFrameDrawn: false, errorCode: 'MASTER_TOO_LARGE', error: 'Master 40000 px wide' }));
  s = page.controller.status('OUT1');
  assert.equal(s.state, 'failed');
  assert.equal(s.error.code, 'LOAD_FAILED');
  assert.equal(s.render.errorCode, 'MASTER_TOO_LARGE', "the page's code stays in render.errorCode");
  assert.match(s.error.message, /MASTER_TOO_LARGE/);
  // Failed is final for D5 (retry is D8): a later good report doesn't make it live.
  page.tick(1000);
  page.controller.onReport('OUT1', report());
  assert.equal(page.controller.status('OUT1').state, 'failed');
  page.controller.close('OUT1');
  assert.equal(page.controller.status('OUT1').state, 'closed');
});

test('live: page errors set and clear error; a 1:1 mismatch raises NOT_ONE_TO_ONE; size match is reported', () => {
  const t = setup();
  t.controller.open(request());
  t.controller.onReady('OUT1');
  t.controller.onReport('OUT1', report({ contentBoxDevicePx: null, outputPx: { width: 1280, height: 720 } }));
  let s = t.controller.status('OUT1');
  assert.equal(s.state, 'live');
  assert.equal(s.error, null, 'pending until the content box is observed');
  assert.equal(s.sizeMatch, 'smaller-than-display');
  assert.deepEqual(s.blackPx, { right: 640, bottom: 360 });
  t.tick(500);
  t.controller.onReport('OUT1', report({ errorCode: 'SOURCE_SETTINGS_INVALID', error: 'bad mode' }));
  s = t.controller.status('OUT1');
  assert.equal(s.state, 'live', 'the previous session keeps playing');
  assert.deepEqual(s.error, { code: 'SOURCE_SETTINGS_INVALID', message: 'bad mode' });
  t.tick(500);
  t.controller.onReport('OUT1', report());
  assert.equal(t.controller.status('OUT1').error, null, 'cleared by the next good report');

  const off = setup();
  off.controller.open(request());
  off.controller.onReady('OUT1');
  off.controller.onReport('OUT1', report({ devicePixelRatio: 2 }));
  s = off.controller.status('OUT1');
  assert.equal(s.state, 'live');
  assert.equal(s.error.code, 'NOT_ONE_TO_ONE');
  assert.match(s.error.message, /devicePixelRatio 2, expected 1/);
});

test('reports: rate limited to 2 per second and invalid payloads dropped', () => {
  const t = setup();
  t.controller.open(request());
  t.controller.onReady('OUT1');
  assert.equal(t.controller.onReport('OUT1', report({ firstFrameDrawn: false })), true);
  t.tick(100);
  assert.equal(t.controller.onReport('OUT1', report()), false, 'too soon');
  assert.equal(t.controller.status('OUT1').state, 'opening');
  t.tick(400);
  assert.equal(t.controller.onReport('OUT1', { ...report(), injected: true }), false, 'unknown key');
  assert.equal(t.controller.onReport('OUT1', report({ frame: -1 })), false);
  assert.equal(t.controller.onReport('OUT1', report()), true);
  assert.equal(t.controller.status('OUT1').state, 'live');
  assert.equal(t.controller.onReport('NOPE', report()), false);
});

test('Esc closes, zoom keys are swallowed, everything else passes', () => {
  assert.equal(outputKeyAction({ type: 'keyDown', key: 'Escape' }), 'close');
  assert.equal(outputKeyAction({ type: 'keyUp', key: 'Escape' }), null);
  assert.equal(outputKeyAction({ type: 'keyDown', key: 'Escape', meta: true }), null);
  for (const key of ['+', '=', '-', '0']) {
    assert.equal(outputKeyAction({ type: 'keyDown', key, meta: true }), 'swallow');
    assert.equal(outputKeyAction({ type: 'keyDown', key, control: true }), 'swallow');
  }
  assert.equal(outputKeyAction({ type: 'keyDown', key: '0' }), null);
  assert.equal(outputKeyAction({ type: 'keyDown', key: 'a' }), null);
  assert.equal(outputKeyAction(null), null);
});
