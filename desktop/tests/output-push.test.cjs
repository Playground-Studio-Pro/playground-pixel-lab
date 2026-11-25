const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sameOccupancy, createControlPush } = require('../src/output-push.cjs');
const { createOutputController, OPEN_TIMEOUT_MS } = require('../src/output-controller.cjs');
const { OUTPUT_CHANNELS } = require('../src/output-ipc.cjs');

test('same occupancy: same map, opened, closed, moved, another output', () => {
  const m = (...e) => new Map(e);
  assert.equal(sameOccupancy(m(), m()), true);
  assert.equal(sameOccupancy(m([2, 'A']), m([2, 'A'])), true);
  assert.equal(sameOccupancy(m([2, 'A'], [3, 'B']), m([3, 'B'], [2, 'A'])), true, 'order does not matter');
  assert.equal(sameOccupancy(m(), m([2, 'A'])), false, 'opened');
  assert.equal(sameOccupancy(m([2, 'A']), m()), false, 'closed, or waiting for its display');
  assert.equal(sameOccupancy(m([2, 'A']), m([3, 'A'])), false, 'moved');
  assert.equal(sameOccupancy(m([2, 'A']), m([2, 'B'])), false, 'another output');
});

// main's wiring: the real controller, the real push, a list built like main's.
const base = {
  key: { label: 'HP 27er', devicePx: { width: 1920, height: 1080 }, internal: false, electronId: 3 },
  electronId: 3, label: 'HP 27er', internal: false, primary: false, boundsDip: { x: 0, y: -1080, width: 1920, height: 1080 }, scaleFactor: 1,
  devicePx: { width: 1920, height: 1080 }, devicePxExact: true, rotation: 0, refreshHz: 60, hostsControlWindow: false, hostsOutput: null,
};
const request = {
  outputId: 'OUT1', display: base.key,
  session: { revision: 1, projectText: JSON.stringify({ format: 'playground-pixel-lab/project', project: { output: { outputs: [{ id: 'OUT1' }] } } }), outputId: 'OUT1', source: { id: 'pixel-grid', settings: {} }, clock: { state: 'paused', frame: 0 } },
};
const report = {
  sessionRevision: 1, firstFrameDrawn: true, frame: 0, devicePixelRatio: 1, viewportCss: { width: 1920, height: 1080 }, canvasPx: { width: 1920, height: 1080 },
  outputPx: { width: 1920, height: 1080 }, browserFps: 60, lateFrames: 0, skippedFrames: 0, contentBoxDevicePx: { width: 1920, height: 1080 },
};
function wired() {
  const got = []; const timers = new Map(); let next = 1, clock = 1000, connected = [base], control = true, calls = 0;
  let c;
  const list = () => connected.map(d => ({ ...d, hostsOutput: c.outputOnDisplay().get(d.electronId) ?? null }));
  const push = createControlPush({
    send: (channel, value) => { if (!control) return false; got.push([channel, value]); return true; },
    occupancy: () => c.outputOnDisplay(), listDisplays: list, channels: OUTPUT_CHANNELS,
  });
  c = createOutputController({
    listDisplays: list, openWindow: () => {}, showWindow: () => {}, closeWindow: id => c.onClosed(id), sendSession: () => {}, pushStatus: s => push.status(s),
    reloadWindow: () => {}, probe: () => new Promise(() => {}), blocker: { start: () => 1, stop: () => {} }, now: () => clock, sharedNow: () => clock,
    timers: { setTimeout: (fn, ms) => { timers.set(next, { fn, ms }); return next++; }, clearTimeout: h => timers.delete(h) },
  });
  const onDisplaysChanged = c.onDisplaysChanged.bind(c);
  c.onDisplaysChanged = l => { calls += 1; onDisplaysChanged(l); };
  return {
    c, push, got, tick: ms => { clock += ms; }, fire: ms => { for (const [h, t] of [...timers]) if (t.ms === ms) { timers.delete(h); t.fn(); } },
    /** What main does on a screen event, after the debounce. */
    screen(l) { connected = l; c.onDisplaysChanged(list()); push.displays(); },
    control(on) { control = on; }, controllerCalls: () => calls,
    lists: () => got.filter(([ch]) => ch === OUTPUT_CHANNELS.displaysChanged).map(([, v]) => v.map(d => d.hostsOutput)),
    /** hostsOutput of the HP in the last list the control window has. */
    last() { const l = this.lists().at(-1); return l ? l[0] : null; },
    live() { c.open(request); c.onReady('OUT1'); clock += 1000; c.onReport('OUT1', report); assert.equal(c.status('OUT1').state, 'live'); return this; },
  };
}

test('opening sends the list with the output on it, after the status; closing sends it free, with no screen event', () => {
  const t = wired().live();
  assert.deepEqual(t.got.slice(0, 2).map(([ch]) => ch), [OUTPUT_CHANNELS.status, OUTPUT_CHANNELS.displaysChanged]);
  assert.equal(t.last(), 'OUT1');
  t.c.close('OUT1');
  assert.equal(t.last(), null, 'free');
  assert.deepEqual(t.got.slice(-2).map(([ch]) => ch), [OUTPUT_CHANNELS.status, OUTPUT_CHANNELS.displaysChanged], 'status first');
  assert.equal(t.got.at(-2)[1].state, 'closed');
  assert.deepEqual(t.lists(), [['OUT1'], [null]]);
});

test('the reported bug: a screen event while open, then a close with none after', () => {
  const t = wired().live();
  t.screen([base]);
  assert.equal(t.last(), 'OUT1');
  t.c.close('OUT1');
  assert.equal(t.last(), null);
  t.live();
  assert.equal(t.last(), 'OUT1', 'reopened');
});

test('reports never send the list', () => {
  const t = wired().live();
  const n = t.lists().length, statuses = t.got.length;
  for (let i = 0; i < 50; i += 1) { t.tick(1000); t.c.onReport('OUT1', { ...report, frame: i }); }
  assert.equal(t.lists().length, n);
  assert.equal(t.got.length, statuses + 50);
});

test('Esc or ⌘W, quit, crash then close, hang then close, display lost while opening and while failed', () => {
  const ends = {
    'the window closed by itself': t => t.c.onClosed('OUT1'),
    'quit': t => t.c.close('*'),
    'crash, then close': t => { t.c.onRendererGone('OUT1', 'crashed'); assert.equal(t.last(), 'OUT1', 'a failed output still occupies its display'); t.c.close('OUT1'); },
    'hang, then close': t => { t.tick(60000); t.fire(1000); assert.equal(t.c.status('OUT1').state, 'failed'); t.c.close('OUT1'); },
  };
  for (const [why, end] of Object.entries(ends)) { const t = wired().live(); end(t); assert.equal(t.c.status('OUT1').state, 'closed', why); assert.equal(t.last(), null, why); }
  const opening = wired(); opening.c.open(request); opening.c.onDisplaysChanged([]);
  assert.equal(opening.last(), null, 'lost while opening');
  const failed = wired(); failed.c.open(request); failed.fire(OPEN_TIMEOUT_MS); assert.equal(failed.c.status('OUT1').state, 'failed'); failed.c.onDisplaysChanged([]);
  assert.equal(failed.last(), null, 'lost while failed');
});

test('waiting for its display frees it; held occupies it again; a moved id is sent', () => {
  const t = wired().live();
  t.c.onDisplaysChanged([]);
  assert.equal(t.c.status('OUT1').state, 'waiting-display');
  assert.deepEqual(t.lists(), [['OUT1'], [null]], 'sent at once, before the debounced screen push');
  const back = { ...base, electronId: 9, key: { ...base.key, electronId: 9 } };
  t.screen([back]);
  assert.equal(t.c.status('OUT1').state, 'held');
  assert.equal(t.last(), 'OUT1');
});

test('the screen push records what it sent, so the next status adds nothing', () => {
  const t = wired().live();
  t.screen([base]);
  const n = t.lists().length;
  t.tick(1000); t.c.onReport('OUT1', report);
  assert.equal(t.lists().length, n);
});

test('pushing never calls back into the controller', () => {
  const t = wired().live();
  t.c.close('OUT1');
  assert.equal(t.controllerCalls(), 0);
});

test('no control window: nothing is recorded as sent; the list it asks for later counts', () => {
  const t = wired().live();
  t.control(false);
  t.c.close('OUT1');
  t.control(true);
  t.push.listed();   // the new control window lists the displays: free
  const n = t.lists().length;
  t.live();
  assert.equal(t.lists().length, n + 1);
  assert.equal(t.last(), 'OUT1');
});

test('main pushes statuses and the list only through it', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  assert.match(source, /pushStatus: status => controlPush\.status\(status\)/);
  assert.match(source, /outputs\.onDisplaysChanged\(listDisplays\(\)\);[^\n]*\n\s+controlPush\.displays\(\);/);
  assert.doesNotMatch(source, /send\('output:displays-changed'/);
  const push = fs.readFileSync(path.join(__dirname, '..', 'src', 'output-push.cjs'), 'utf8');
  assert.doesNotMatch(push, /onDisplaysChanged/);
});
