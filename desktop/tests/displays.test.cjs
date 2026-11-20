const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toDisplayInfo, devicePxOf, matchDisplay, reliableMatch, debounce } = require('../src/displays.cjs');

// Electron Display fixtures (only the fields displays.cjs reads).
const display = (id, label, bounds, scaleFactor = 1, extra = {}) => ({ id, label, bounds, scaleFactor, rotation: 0, displayFrequency: 60, internal: false, ...extra });
const builtIn = display(1, 'Built-in Retina Display', { x: 0, y: 0, width: 1512, height: 982 }, 2, { internal: true, displayFrequency: 120 });
const dell = display(7, 'DELL U2720Q', { x: 1512, y: 0, width: 1920, height: 1080 });
const mac = { platform: 'darwin', primaryId: 1 };
const winRect = rect => ({ x: rect.x, y: rect.y, width: rect.width * 1.25, height: rect.height * 1.25 }); // stand-in for screen.dipToScreenRect at 125 %

test('macOS 2× and 1× displays: device px, flags and context', () => {
  const control = { x: 100, y: 100, width: 1200, height: 800 };
  const a = toDisplayInfo(builtIn, { ...mac, controlBounds: control });
  assert.deepEqual(a.devicePx, { width: 3024, height: 1964 });
  assert.equal(a.devicePxExact, true);
  assert.equal(a.primary, true);
  assert.equal(a.internal, true);
  assert.equal(a.hostsControlWindow, true);
  assert.equal(a.refreshHz, 120);
  assert.deepEqual(a.key, { label: 'Built-in Retina Display', devicePx: { width: 3024, height: 1964 }, internal: true, electronId: 1 });
  const b = toDisplayInfo(dell, { ...mac, controlBounds: control, outputOnDisplay: new Map([[7, 'out-1']]) });
  assert.deepEqual(b.devicePx, { width: 1920, height: 1080 });
  assert.equal(b.primary, false);
  assert.equal(b.hostsControlWindow, false);
  assert.equal(b.hostsOutput, 'out-1');
  assert.deepEqual(b.boundsDip, { x: 1512, y: 0, width: 1920, height: 1080 });
});

test('Windows 125 %: 1920 × 1080 is exact, 1366 × 768 is not', () => {
  const full = devicePxOf(display(2, 'A', { x: 0, y: 0, width: 1536, height: 864 }, 1.25), 'win32', winRect);
  assert.deepEqual(full, { devicePx: { width: 1920, height: 1080 }, devicePxExact: true });
  // 1366 × 768 at 125 %: Windows reports 1093 × 614 DIP (rounded), 1093 × 1.25 = 1366.25.
  const odd = devicePxOf(display(3, 'B', { x: 0, y: 0, width: 1093, height: 614 }, 1.25), 'win32', () => ({ x: 0, y: 0, width: 1366, height: 768 }));
  assert.deepEqual(odd, { devicePx: { width: 1366, height: 768 }, devicePxExact: false });
  // 150 %: 1280 × 720 DIP → 1920 × 1080, exact.
  assert.deepEqual(devicePxOf(display(4, 'C', { x: 0, y: 0, width: 1280, height: 720 }, 1.5), 'win32', r => ({ ...r, width: r.width * 1.5, height: r.height * 1.5 })), { devicePx: { width: 1920, height: 1080 }, devicePxExact: true });
  // Without dipToScreenRect (non-Windows path) the product is rounded and flagged.
  assert.deepEqual(devicePxOf(display(5, 'D', { x: 0, y: 0, width: 1093, height: 614 }, 1.25), 'darwin'), { devicePx: { width: 1366, height: 768 }, devicePxExact: false });
});

test('rotation 90 follows the reported bounds; unknown values are normalised', () => {
  const portrait = toDisplayInfo(display(8, 'Portrait', { x: 0, y: 0, width: 1080, height: 1920 }, 1, { rotation: 90 }), mac);
  assert.equal(portrait.rotation, 90);
  assert.deepEqual(portrait.devicePx, { width: 1080, height: 1920 });
  const odd = toDisplayInfo(display(9, '', { x: 0, y: 0, width: 800, height: 600 }, 1, { rotation: 45, displayFrequency: 0, label: undefined }), mac);
  assert.equal(odd.rotation, 0);
  assert.equal(odd.refreshHz, 0);
  assert.equal(odd.label, '');
});

const info = (id, label, w, h, internal = false) => toDisplayInfo(display(id, label, { x: 0, y: 0, width: w, height: h }, 1, { internal }), { platform: 'darwin', primaryId: 1 });
const keyOf = d => d.key;

test('matching levels: id + label + size, then label + size', () => {
  const dellInfo = info(7, 'DELL U2720Q', 1920, 1080);
  const key = keyOf(dellInfo);
  assert.deepEqual(matchDisplay(key, [info(1, 'Built-in', 1512, 982, true), dellInfo]), { level: 1, candidates: [dellInfo] });
  const sameMonitorNewId = info(12, 'DELL U2720Q', 1920, 1080);
  assert.equal(matchDisplay(key, [sameMonitorNewId]).level, 2);
  assert.equal(matchDisplay(key, [info(7, 'DELL U2720Q', 3840, 2160)]).level, null, 'different size is not the same display');
  assert.equal(matchDisplay(key, [info(7, 'LG', 1920, 1080)]).level, null, 'different label');
  assert.equal(matchDisplay(key, [info(7, 'DELL U2720Q', 1920, 1080, true)]).level, null, 'internal never matches external');
});

test('D-2 reliable match: one candidate and no lookalike', () => {
  const key = keyOf(info(7, 'DELL U2720Q', 1920, 1080));
  const builtInInfo = info(1, 'Built-in', 1512, 982, true);
  // Same monitor back, same id.
  let r = reliableMatch(key, [builtInInfo, info(7, 'DELL U2720Q', 1920, 1080)]);
  assert.equal(r.level, 1); assert.equal(r.display.electronId, 7);
  // Same monitor back on another port: new id, level 2, still reliable.
  r = reliableMatch(key, [builtInInfo, info(15, 'DELL U2720Q', 1920, 1080)]);
  assert.equal(r.level, 2); assert.equal(r.display.electronId, 15);
  // Nothing matching.
  assert.deepEqual(reliableMatch(key, [builtInInfo]), { display: null, reason: 'none' });
  assert.deepEqual(reliableMatch(key, [builtInInfo, info(7, 'DELL U2720Q', 2560, 1440)]), { display: null, reason: 'none' }, 'same id, other mode');
});

test('D-2 identical twins are never reliable', () => {
  const key = keyOf(info(7, 'DELL U2720Q', 1920, 1080));
  // Both twins connected, the original keeps its id: level 1 has one candidate, but a lookalike exists.
  assert.deepEqual(reliableMatch(key, [info(7, 'DELL U2720Q', 1920, 1080), info(8, 'DELL U2720Q', 1920, 1080)]), { display: null, reason: 'ambiguous' });
  // Both twins with new ids: two level-2 candidates.
  assert.deepEqual(reliableMatch(key, [info(20, 'DELL U2720Q', 1920, 1080), info(21, 'DELL U2720Q', 1920, 1080)]), { display: null, reason: 'ambiguous' });
  // Only the other twin is connected: it looks the same, but that's the accepted limit of label + size (documented risk).
  assert.equal(reliableMatch(key, [info(8, 'DELL U2720Q', 1920, 1080)]).level, 2);
});

test('D-2 empty labels: a shared empty label is ambiguous, a single one is not', () => {
  const key = keyOf(info(30, '', 1920, 1080));
  assert.deepEqual(reliableMatch(key, [info(30, '', 1920, 1080), info(31, '', 1920, 1080)]), { display: null, reason: 'ambiguous' });
  assert.equal(reliableMatch(key, [info(30, '', 1920, 1080), info(31, '', 1280, 720)]).level, 1);
  // A lookalike that differs only in `internal` still counts as a lookalike.
  assert.deepEqual(reliableMatch(key, [info(30, '', 1920, 1080), info(32, '', 1920, 1080, true)]), { display: null, reason: 'ambiguous' });
});

test('debounce collapses a burst of display events into one call', () => {
  const timers = []; let now = 0;
  const fake = { setTimeout: (fn, ms) => { const t = { fn, at: now + ms, live: true }; timers.push(t); return t; }, clearTimeout: t => { t.live = false; } };
  const advance = ms => { now += ms; for (const t of timers) if (t.live && t.at <= now) { t.live = false; t.fn(); } };
  let calls = 0;
  const d = debounce(() => calls++, 250, fake);
  d(); advance(100); d(); advance(100); d(); advance(249);
  assert.equal(calls, 0);
  advance(1);
  assert.equal(calls, 1);
  d(); d.cancel(); advance(500);
  assert.equal(calls, 1);
});

test('colour space and depth: copied when Electron gives them, bounded, left out otherwise', () => {
  const srgb = '{primaries:BT709, transfer:SRGB, matrix:RGB, range:FULL}';
  const a = toDisplayInfo({ ...builtIn, colorSpace: srgb, colorDepth: 30 }, mac);
  assert.equal(a.colorSpace, srgb);
  assert.equal(a.colorDepth, 30);
  const none = toDisplayInfo(builtIn, mac);
  assert.equal('colorSpace' in none, false);
  assert.equal('colorDepth' in none, false);
  const bad = toDisplayInfo({ ...builtIn, colorSpace: '', colorDepth: 24.5 }, mac);
  assert.equal('colorSpace' in bad, false);
  assert.equal('colorDepth' in bad, false);
  assert.equal(toDisplayInfo({ ...builtIn, colorSpace: 'x'.repeat(600), colorDepth: -1 }, mac).colorSpace.length, 512);
  assert.equal('colorDepth' in toDisplayInfo({ ...builtIn, colorDepth: -1 }, mac), false);
});
