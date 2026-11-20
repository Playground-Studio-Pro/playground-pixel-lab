const test = require('node:test');
const assert = require('node:assert/strict');
const { createOutputController, outputKeyAction, OPEN_TIMEOUT_MS, PROBE_INTERVAL_MS, UNRESPONSIVE_MS } = require('../src/output-controller.cjs');

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

function setup({ displays = [builtIn, external], maxOutputs, probe } = {}) {
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
    reloadWindow: id => log.push(['reload', id]),
    hideWindow: id => log.push(['hide', id]),
    sendClock: (id, c) => log.push(['clock', id, c]),
    sendDisplay: (id, d) => log.push(['display', id, d.electronId, d.boundsDip.height]),
    sharedNow: () => clock,
    ...(probe ? { probe } : {}),
    ...(maxOutputs ? { maxOutputs } : {}),
  });
  return {
    controller, log, statuses, timers, started,
    tick: ms => { clock += ms; },
    /** Pending timers of one duration: the open / first-frame timeouts are 10 s, the watchdog 1 s. */
    pending: (ms = OPEN_TIMEOUT_MS) => [...timers.values()].filter(t => t.ms === ms).length,
    fireTimers: (ms = OPEN_TIMEOUT_MS) => { for (const [h, t] of [...timers]) if (t.ms === ms) { timers.delete(h); t.fn(); } },
    codeOf: fn => { try { fn(); } catch (e) { return e.code; } return null; },
  };
}
const states = statuses => statuses.map(s => s.state);

test('open → opening → live: session after ready, live on the first drawn frame of that revision', () => {
  const t = setup();
  const opening = t.controller.open(request());
  assert.equal(opening.state, 'opening');
  assert.deepEqual(t.log, [['open', 'OUT1', 2]]);
  assert.equal(t.pending(), 1);
  assert.equal(t.pending(PROBE_INTERVAL_MS), 1, 'watchdog running');
  assert.equal(t.controller.sleepBlockerId(), null);
  // A report before the session went out doesn't make it live.
  assert.equal(t.controller.onReport('OUT1', report()), true);
  assert.equal(t.controller.status('OUT1').state, 'opening');
  t.controller.onReady('OUT1');
  assert.deepEqual(t.log.at(-1), ['session', 'OUT1', 3, 2]);
  assert.equal(t.pending(), 1, 'ready swaps the open timeout for the first-frame timeout');
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
  assert.equal(t.timers.size, 0, 'timeout and watchdog cleared');
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
  assert.equal(load.pending(), 0);

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

// ── D8: failures ──────────────────────────────────────────────────────────────
const flush = () => new Promise(resolve => setImmediate(resolve));
function liveSetup(options) {
  const t = setup(options);
  t.controller.open(request());
  t.controller.onReady('OUT1');
  t.controller.onReport('OUT1', report());
  assert.equal(t.controller.status('OUT1').state, 'live');
  return t;
}
function controllableProbe() {
  const pending = [];
  return { pending, probe: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) };
}

test('renderer gone while live → failed, window kept and shown black, blocker released; only retry or close leave it', async () => {
  const p = controllableProbe();
  const t = liveSetup({ probe: p.probe });
  const shows = t.log.filter(l => l[0] === 'show').length;
  t.controller.onRendererGone('OUT1', 'crashed');
  const s = t.controller.status('OUT1');
  assert.equal(s.state, 'failed');
  assert.deepEqual(s.error, { code: 'RENDERER_GONE', message: 'The output renderer stopped (crashed)' });
  assert.equal(t.log.filter(l => l[0] === 'show').length, shows + 1, 'D-1: shown, not closed');
  assert.ok(!t.log.some(l => l[0] === 'close'));
  assert.equal(t.started.size, 0);
  assert.equal(t.statuses.at(-1).error.code, 'RENDERER_GONE', 'pushed at once');
  // An answer or a report doesn't revive a crashed renderer.
  t.tick(1000); t.fireTimers(PROBE_INTERVAL_MS); await flush();
  p.pending.forEach(x => x.resolve());
  await flush();
  t.tick(1000);
  t.controller.onReport('OUT1', report());
  assert.equal(t.controller.status('OUT1').state, 'failed');
});

test('renderer gone while opening → failed RENDERER_GONE', () => {
  const t = setup();
  t.controller.open(request());
  t.controller.onRendererGone('OUT1', 'oom');
  assert.equal(t.controller.status('OUT1').error.code, 'RENDERER_GONE');
  assert.equal(t.pending(), 0, 'open timeout cleared');
});

test('retry: one reload, the latest session re-sent on ready, then live again', () => {
  const t = liveSetup();
  t.controller.onRendererGone('OUT1', 'crashed');
  const retrying = t.controller.retry('OUT1');
  assert.equal(retrying.state, 'opening');
  assert.equal(retrying.error, null);
  assert.equal(retrying.render, null);
  assert.deepEqual(t.log.at(-1), ['reload', 'OUT1']);
  assert.equal(t.pending(), 1, 'open timeout restarted');
  t.controller.onReady('OUT1');
  assert.deepEqual(t.log.at(-1), ['session', 'OUT1', 3, 2]);
  t.tick(1000);
  t.controller.onReport('OUT1', report());
  assert.equal(t.controller.status('OUT1').state, 'live');
  assert.equal(t.started.size, 1);
  // A retry that fails again goes back to failed.
  t.controller.onRendererGone('OUT1');
  t.controller.retry('OUT1');
  t.fireTimers();
  assert.equal(t.controller.status('OUT1').error.code, 'OPEN_TIMEOUT');
});

test('retry outside failed changes nothing; "*" is refused', () => {
  const t = liveSetup();
  const reloads = () => t.log.filter(l => l[0] === 'reload').length;
  assert.equal(t.controller.retry('OUT1').state, 'live');
  assert.equal(t.controller.retry('OUT9').state, 'closed');
  assert.equal(reloads(), 0);
  assert.equal(t.codeOf(() => t.controller.retry('*')), 'BAD_REQUEST');
  assert.equal(t.codeOf(() => t.controller.retry('bad id!')), 'BAD_REQUEST');
});

test('ready but no first frame within 10 s → failed OPEN_TIMEOUT', () => {
  const t = setup();
  t.controller.open(request());
  t.controller.onReady('OUT1');
  t.fireTimers();
  const s = t.controller.status('OUT1');
  assert.equal(s.state, 'failed');
  assert.equal(s.error.code, 'OPEN_TIMEOUT');
  assert.match(s.error.message, /no first frame/);
});

test('hang: no answer for 5 s while live → RENDERER_UNRESPONSIVE; an answer brings it back to live', async () => {
  const p = controllableProbe();
  const t = liveSetup({ probe: p.probe });
  const step = async () => { t.tick(PROBE_INTERVAL_MS); t.fireTimers(PROBE_INTERVAL_MS); await flush(); };
  for (let i = 0; i < 4; i += 1) await step();
  assert.equal(t.controller.status('OUT1').state, 'live', '4 s without an answer is still live');
  assert.equal(p.pending.length, 1, 'one probe at a time');
  await step();
  let s = t.controller.status('OUT1');
  assert.equal(s.state, 'failed');
  assert.equal(s.error.code, 'RENDERER_UNRESPONSIVE');
  assert.equal(t.started.size, 0);
  assert.ok(!t.log.some(l => l[0] === 'close'), 'frozen frame stays on screen');
  p.pending.shift().resolve();
  await flush();
  s = t.controller.status('OUT1');
  assert.equal(s.state, 'live');
  assert.equal(s.error, null);
  assert.equal(t.started.size, 1);
  // Answers keep it live; so do reports.
  for (let i = 0; i < 10; i += 1) { await step(); p.pending.splice(0).forEach(x => x.resolve()); await flush(); }
  assert.equal(t.controller.status('OUT1').state, 'live');
  for (let i = 0; i < 10; i += 1) { await step(); t.controller.onReport('OUT1', report()); }
  assert.equal(t.controller.status('OUT1').state, 'live', 'reports count as answers');
});

test('a rejected probe (timeout) is retried, and Close works while unresponsive', async () => {
  const p = controllableProbe();
  const t = liveSetup({ probe: p.probe });
  const step = async () => { t.tick(PROBE_INTERVAL_MS); t.fireTimers(PROBE_INTERVAL_MS); await flush(); };
  await step();
  p.pending.shift().reject(new Error('probe timeout'));
  await flush();
  await step();
  assert.equal(p.pending.length, 1, 'a new probe after the rejected one');
  for (let i = 0; i < UNRESPONSIVE_MS / PROBE_INTERVAL_MS; i += 1) await step();
  assert.equal(t.controller.status('OUT1').error.code, 'RENDERER_UNRESPONSIVE');
  t.controller.close('OUT1');
  assert.equal(t.controller.status('OUT1').state, 'closed');
  assert.equal(t.timers.size, 0, 'watchdog stopped');
  p.pending.splice(0).forEach(x => x.resolve());
  await flush();
  assert.deepEqual(t.controller.statusAll(), []);
});

test('the watchdog never fails an opening output (the open timeouts cover it)', async () => {
  const p = controllableProbe();
  const t = setup({ probe: p.probe });
  t.controller.open(request());
  for (let i = 0; i < 8; i += 1) { t.tick(PROBE_INTERVAL_MS); t.fireTimers(PROBE_INTERVAL_MS); await flush(); }
  assert.equal(t.controller.status('OUT1').state, 'opening');
});

// ── D7: disconnect and reconnect (simulated displays) ────────────────────────
const playingRequest = (display = external, extra = {}) => {
  const r = request('OUT1', display, extra);
  return { ...r, session: { ...r.session, clock: { state: 'playing', fps: 30, startFrame: 100, epochMs: 1000 } } };
};
function liveOn(display = external, options = {}, extra = {}) {
  const t = setup(options);
  t.controller.open(playingRequest(display, extra));
  t.controller.onReady('OUT1');
  t.controller.onReport('OUT1', display === external ? report() : report({ devicePixelRatio: 2, viewportCss: { width: 1800, height: 1169 }, canvasPx: builtIn.devicePx, contentBoxDevicePx: builtIn.devicePx, outputPx: builtIn.devicePx }));
  assert.equal(t.controller.status('OUT1').state, 'live');
  return t;
}
const renumbered = (d, electronId) => ({ ...d, electronId, key: { ...d.key, electronId } });

test('display removed while live → waiting-display: hidden at once, clock paused at the frame on screen, no blocker', () => {
  const t = liveOn();
  t.tick(2000);   // 2 s at 30 fps from startFrame 100, epoch 1000 → clock time 3000 → frame 160
  t.controller.onDisplaysChanged([builtIn]);
  const s = t.controller.status('OUT1');
  assert.equal(s.state, 'waiting-display');
  assert.equal(s.display, null);
  assert.equal(s.reconnected, false);
  assert.deepEqual(t.log.slice(-2), [['hide', 'OUT1'], ['clock', 'OUT1', { state: 'paused', frame: 160 }]]);
  assert.equal(t.started.size, 0);
  assert.ok(!t.log.some(l => l[0] === 'close'), 'the window and its renderer are kept');
  assert.deepEqual(t.controller.outputOnDisplay(), new Map());
  // The same list again changes nothing (main calls this immediately and again after the debounce).
  const n = t.log.length;
  t.controller.onDisplaysChanged([builtIn]);
  assert.equal(t.log.length, n);
  // Nothing advances while the wall is dark: time passing doesn't change the paused frame.
  t.tick(60000);
  t.controller.onDisplaysChanged([builtIn]);
  assert.equal(t.controller.status('OUT1').state, 'waiting-display');
});

test('same display back (reliable match) → held on the paused frame, output:display sent, never playing by itself', () => {
  const t = liveOn();
  t.tick(2000);
  t.controller.onDisplaysChanged([builtIn]);
  t.tick(30000);
  const back = renumbered(external, 7);   // a dock or adapter can change Display.id: level 2 still matches
  t.controller.onDisplaysChanged([builtIn, back]);
  const s = t.controller.status('OUT1');
  assert.equal(s.state, 'held');
  assert.equal(s.reconnected, true);
  assert.equal(s.error, null);
  assert.equal(s.display.electronId, 7);
  assert.deepEqual(t.log.slice(-2), [['show', 'OUT1', 7], ['display', 'OUT1', 7, 1080]]);
  assert.equal(t.log.filter(l => l[0] === 'clock').length, 1, 'no clock change: still paused');
  assert.equal(t.started.size, 0, 'held is not live');
  assert.deepEqual(t.controller.outputOnDisplay(), new Map([[7, 'OUT1']]));
  // Time passes, displays settle: still held. Only resume plays.
  t.tick(60000);
  t.controller.onDisplaysChanged([builtIn, back]);
  for (let i = 0; i < 10; i += 1) { t.tick(1000); t.fireTimers(PROBE_INTERVAL_MS); }
  t.tick(1000);
  t.controller.onReport('OUT1', report());
  assert.equal(t.controller.status('OUT1').state, 'held');
});

test('resume: only from held; restarts from the paused frame with a new epoch and takes the blocker', () => {
  const t = liveOn();
  assert.equal(t.codeOf(() => t.controller.resume('OUT1')), 'NOT_RESUMABLE', 'live is not resumable');
  assert.equal(t.codeOf(() => t.controller.resume('OUT9')), 'NOT_RESUMABLE');
  assert.equal(t.codeOf(() => t.controller.resume('*')), 'BAD_REQUEST');
  t.tick(2000);
  t.controller.onDisplaysChanged([builtIn]);
  assert.equal(t.codeOf(() => t.controller.resume('OUT1')), 'NOT_RESUMABLE', 'waiting-display is not resumable');
  t.controller.onDisplaysChanged([builtIn, external]);
  t.tick(5000);
  const s = t.controller.resume('OUT1');
  assert.equal(s.state, 'live');
  assert.equal(s.reconnected, false);
  assert.deepEqual(t.log.at(-1), ['clock', 'OUT1', { state: 'playing', fps: 30, startFrame: 160, epochMs: 8000 }]);
  assert.equal(t.started.size, 1);
  // A second disconnect pauses at the new frame: 1 s after resume → 190.
  t.tick(1000);
  t.controller.onDisplaysChanged([builtIn]);
  assert.deepEqual(t.log.at(-1), ['clock', 'OUT1', { state: 'paused', frame: 190 }]);
});

test('an output paused when its display went away resumes paused', () => {
  const t = setup();
  t.controller.open(request());   // clock paused at frame 0
  t.controller.onReady('OUT1');
  t.controller.onReport('OUT1', report());
  t.controller.onDisplaysChanged([builtIn]);
  t.controller.onDisplaysChanged([builtIn, external]);
  t.controller.resume('OUT1');
  assert.deepEqual(t.log.at(-1), ['clock', 'OUT1', { state: 'paused', frame: 0 }]);
});

test('held, display removed again → waiting-display, keeps the paused frame and what resume restores', () => {
  const t = liveOn();
  t.tick(2000);
  t.controller.onDisplaysChanged([builtIn]);
  t.controller.onDisplaysChanged([builtIn, external]);
  t.tick(9000);
  t.controller.onDisplaysChanged([builtIn]);
  assert.equal(t.controller.status('OUT1').state, 'waiting-display');
  assert.deepEqual(t.log.at(-1), ['clock', 'OUT1', { state: 'paused', frame: 160 }]);
  t.controller.onDisplaysChanged([builtIn, external]);
  t.controller.resume('OUT1');
  assert.equal(t.log.at(-1)[2].state, 'playing');
  assert.equal(t.log.at(-1)[2].startFrame, 160);
});

test('identical twins, a shared empty label, or the same name at another size never take the output (DISPLAY_AMBIGUOUS)', () => {
  const t = liveOn();
  t.controller.onDisplaysChanged([builtIn]);
  const shows = () => t.log.filter(l => l[0] === 'show').length;
  const before = shows();
  // Two identical monitors, even though one still has the old id.
  t.controller.onDisplaysChanged([builtIn, external, renumbered(external, 8)]);
  let s = t.controller.status('OUT1');
  assert.equal(s.state, 'waiting-display');
  assert.equal(s.error.code, 'DISPLAY_AMBIGUOUS');
  assert.equal(shows(), before, 'nothing shown');
  // Same name, other size (a partial match).
  t.controller.onDisplaysChanged([builtIn, { ...external, devicePx: { width: 3840, height: 2160 }, key: { ...external.key, devicePx: { width: 3840, height: 2160 } } }]);
  assert.equal(t.controller.status('OUT1').error.code, 'DISPLAY_AMBIGUOUS');
  // A different monitor entirely: still waiting, no ambiguity to report.
  t.controller.onDisplaysChanged([builtIn, { ...renumbered(external, 9), label: 'LG 27UK850', key: { ...external.key, electronId: 9, label: 'LG 27UK850' } }]);
  s = t.controller.status('OUT1');
  assert.equal(s.state, 'waiting-display');
  assert.equal(s.error, null);
  assert.equal(shows(), before);
  // Twins with an empty label.
  const unnamed = { ...external, label: '', key: { ...external.key, label: '' } };
  const blank = setup({ displays: [builtIn, unnamed] });
  blank.controller.open(playingRequest(unnamed));
  blank.controller.onReady('OUT1');
  blank.controller.onReport('OUT1', report());
  assert.equal(blank.controller.status('OUT1').state, 'live');
  blank.controller.onDisplaysChanged([builtIn]);
  blank.controller.onDisplaysChanged([builtIn, renumbered(unnamed, 5), renumbered(unnamed, 6)]);
  assert.equal(blank.controller.status('OUT1').error.code, 'DISPLAY_AMBIGUOUS');
});

test('reconnect onto the control window display without the toggle → stays waiting with CONTROL_DISPLAY', () => {
  const t = liveOn();
  t.controller.onDisplaysChanged([builtIn]);
  t.controller.onDisplaysChanged([builtIn, { ...external, hostsControlWindow: true }]);
  const s = t.controller.status('OUT1');
  assert.equal(s.state, 'waiting-display');
  assert.equal(s.error.code, 'CONTROL_DISPLAY');
  const ok = liveOn(builtIn, {}, { allowControlDisplay: true });
  ok.controller.onDisplaysChanged([external]);
  ok.controller.onDisplaysChanged([builtIn, external]);
  assert.equal(ok.controller.status('OUT1').state, 'held');
});

test('removed while opening or failed → closed with DISPLAY_NOT_FOUND', () => {
  const opening = setup();
  opening.controller.open(request());
  opening.controller.onDisplaysChanged([builtIn]);
  assert.equal(opening.controller.status('OUT1').state, 'closed');
  assert.equal(opening.statuses.at(-1).error.code, 'DISPLAY_NOT_FOUND');
  assert.deepEqual(opening.timers.size, 0);
  const failed = liveOn();
  failed.controller.onRendererGone('OUT1', 'crashed');
  failed.controller.onDisplaysChanged([builtIn]);
  assert.equal(failed.statuses.at(-1).state, 'closed');
  assert.equal(failed.statuses.at(-1).error.code, 'DISPLAY_NOT_FOUND');
});

test('renderer gone while waiting-display → shown as failed when the display is back, not held', () => {
  const t = liveOn();
  t.controller.onDisplaysChanged([builtIn]);
  t.controller.onRendererGone('OUT1', 'crashed');
  assert.equal(t.controller.status('OUT1').state, 'waiting-display');
  assert.equal(t.controller.status('OUT1').error.code, 'RENDERER_GONE');
  t.controller.onDisplaysChanged([builtIn, external]);
  const s = t.controller.status('OUT1');
  assert.equal(s.state, 'failed');
  assert.equal(s.error.code, 'RENDERER_GONE');
  assert.deepEqual(t.log.at(-1), ['show', 'OUT1', 2], 'black on its display (D-1)');
  assert.equal(t.codeOf(() => t.controller.resume('OUT1')), 'NOT_RESUMABLE');
  assert.equal(t.controller.retry('OUT1').state, 'opening');
});

test('renderer gone while held → failed', () => {
  const t = liveOn();
  t.controller.onDisplaysChanged([builtIn]);
  t.controller.onDisplaysChanged([builtIn, external]);
  t.controller.onRendererGone('OUT1');
  assert.equal(t.controller.status('OUT1').state, 'failed');
  assert.equal(t.controller.status('OUT1').reconnected, false);
});

test('metrics changed on the display in use → re-placed, output:display sent, 1:1 re-checked; size match updated', () => {
  const t = liveOn();
  const scaled = { ...external, boundsDip: { ...external.boundsDip, width: 960, height: 540 }, scaleFactor: 2 };
  t.controller.onDisplaysChanged([builtIn, scaled]);
  let s = t.controller.status('OUT1');
  assert.equal(s.state, 'live');
  assert.deepEqual(t.log.slice(-2), [['show', 'OUT1', 2], ['display', 'OUT1', 2, 540]]);
  t.tick(1000);
  t.controller.onReport('OUT1', report());   // still dpr 1 and 1920 css: no longer 1:1 at scale 2
  s = t.controller.status('OUT1');
  assert.equal(s.error.code, 'NOT_ONE_TO_ONE');
  // Resolution change: devicePx (and the key) follow, so a later disconnect matches the new size.
  const bigger = { ...external, boundsDip: { ...external.boundsDip, width: 2560, height: 1440 }, devicePx: { width: 2560, height: 1440 }, key: { ...external.key, devicePx: { width: 2560, height: 1440 } } };
  t.controller.onDisplaysChanged([builtIn, bigger]);
  t.tick(1000);
  t.controller.onReport('OUT1', report({ viewportCss: { width: 2560, height: 1440 }, canvasPx: bigger.devicePx, contentBoxDevicePx: bigger.devicePx }));
  s = t.controller.status('OUT1');
  assert.equal(s.error, null);
  assert.equal(s.sizeMatch, 'smaller-than-display');
  assert.deepEqual(s.blackPx, { right: 640, bottom: 360 });
  t.controller.onDisplaysChanged([builtIn]);
  t.controller.onDisplaysChanged([builtIn, bigger]);
  assert.equal(t.controller.status('OUT1').state, 'held');
  // A primary or control-window change alone tells the page nothing.
  const n = t.log.length;
  t.controller.onDisplaysChanged([{ ...builtIn, primary: false }, { ...bigger, primary: true }]);
  assert.equal(t.log.length, n);
});

test('DISPLAY_BUSY ignores an output that is waiting for its display', () => {
  const t = liveOn(external, { maxOutputs: 2 });
  t.controller.onDisplaysChanged([builtIn]);
  t.controller.onDisplaysChanged([builtIn, renumbered(external, 4)]);   // ← reconnects; then away again
  t.controller.onDisplaysChanged([builtIn]);
  // A new output may take a display that matches nothing busy.
  assert.equal(t.controller.open(request('OUT2', builtIn, { allowControlDisplay: true })).state, 'opening');
});
