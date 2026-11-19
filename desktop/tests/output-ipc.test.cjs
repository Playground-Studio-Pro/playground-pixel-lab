const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateDisplayKey, validateClock, validateSession, validateOpenRequest, validateReport, outputIdOrAll,
  oneToOne, sizeMatchOf, OutputIpcError, MAX_SETTINGS_BYTES,
} = require('../src/output-ipc.cjs');

const projectText = (outputs = [{ id: 'out-1' }]) => JSON.stringify({ format: 'playground-pixel-lab/project', project: { schemaVersion: 2, output: { outputs, slices: [] } } });
const clock = { state: 'playing', fps: 30, startFrame: 0, epochMs: 1795052190389.25 };
const session = (over = {}) => ({ revision: 1, projectText: projectText(), outputId: 'out-1', source: { id: 'calibration-test-card', settings: { mode: 'identification', logo: 'center' } }, clock, ...over });
const key = { label: 'DELL U2720Q', devicePx: { width: 1920, height: 1080 }, internal: false, electronId: 7 };
const request = (over = {}) => ({ outputId: 'out-1', display: key, session: session(), ...over });
const report = (over = {}) => ({
  sessionRevision: 1, firstFrameDrawn: true, frame: 12, devicePixelRatio: 1, viewportCss: { width: 1920, height: 1080 },
  canvasPx: { width: 1920, height: 1080 }, outputPx: { width: 1920, height: 1080 }, browserFps: 60, lateFrames: 0, skippedFrames: 0,
  contentBoxDevicePx: { width: 1920, height: 1080 }, ...over,
});
const code = (fn, expected) => assert.throws(fn, err => err instanceof OutputIpcError && err.code === expected, expected);

test('a well-formed open request passes, with or without allowControlDisplay', () => {
  assert.equal(validateOpenRequest(request()).outputId, 'out-1');
  assert.doesNotThrow(() => validateOpenRequest(request({ allowControlDisplay: true })));
});

test('BAD_REQUEST: unknown keys, wrong types, mismatched ids', () => {
  code(() => validateOpenRequest({ ...request(), extra: 1 }), 'BAD_REQUEST');
  code(() => validateOpenRequest(request({ allowControlDisplay: 'yes' })), 'BAD_REQUEST');
  code(() => validateOpenRequest(request({ outputId: '../x' })), 'BAD_REQUEST');
  code(() => validateOpenRequest(request({ session: session({ outputId: 'out-2' }) })), 'BAD_REQUEST');
  code(() => validateOpenRequest(null), 'BAD_REQUEST');
  code(() => validateOpenRequest([]), 'BAD_REQUEST');
  code(() => validateSession({ ...session(), display: {} }), 'BAD_REQUEST');
  code(() => validateSession(session({ revision: -1 })), 'BAD_REQUEST');
  code(() => validateSession(session({ revision: 1.5 })), 'BAD_REQUEST');
  code(() => validateSession(session({ revision: Number.MAX_SAFE_INTEGER + 1 })), 'BAD_REQUEST');
  code(() => validateSession(session({ source: { id: '', settings: null } })), 'BAD_REQUEST');
  code(() => validateSession(session({ source: { id: 'x'.repeat(201), settings: null } })), 'BAD_REQUEST');
  code(() => validateSession(session({ source: { id: 'x', settings: null, extra: 1 } })), 'BAD_REQUEST');
});

test('display keys are bounded', () => {
  assert.doesNotThrow(() => validateDisplayKey(key));
  assert.doesNotThrow(() => validateDisplayKey({ ...key, label: '' }));
  code(() => validateDisplayKey({ ...key, label: 'x'.repeat(201) }), 'BAD_REQUEST');
  code(() => validateDisplayKey({ ...key, devicePx: { width: 0, height: 1080 } }), 'BAD_REQUEST');
  code(() => validateDisplayKey({ ...key, devicePx: { width: 1920.5, height: 1080 } }), 'BAD_REQUEST');
  code(() => validateDisplayKey({ ...key, internal: 1 }), 'BAD_REQUEST');
  code(() => validateDisplayKey({ ...key, electronId: '7' }), 'BAD_REQUEST');
  code(() => validateDisplayKey({ ...key, scale: 2 }), 'BAD_REQUEST');
});

test('source settings must be plain JSON under 1 MiB', () => {
  assert.doesNotThrow(() => validateSession(session({ source: { id: 'depth-scene', settings: { a: [1, 2, { b: null }], c: 'x', d: true } } })));
  for (const settings of [new Date(), new Map(), new Uint8Array(2), { a: NaN }, { a: Infinity }, { a: () => 1 }, Object.create({ x: 1 }), { a: undefined }]) {
    code(() => validateSession(session({ source: { id: 'x', settings } })), 'BAD_REQUEST');
  }
  let deep = null; for (let i = 0; i < 70; i++) deep = [deep];
  code(() => validateSession(session({ source: { id: 'x', settings: deep } })), 'BAD_REQUEST');
  code(() => validateSession(session({ source: { id: 'x', settings: 'x'.repeat(MAX_SETTINGS_BYTES) } })), 'BAD_REQUEST');
  assert.doesNotThrow(() => validateSession(session({ source: { id: 'x', settings: 'x'.repeat(MAX_SETTINGS_BYTES - 2) } })));
});

test('PROJECT_INVALID and UNKNOWN_OUTPUT from the envelope check', () => {
  code(() => validateSession(session({ projectText: 'not json' })), 'PROJECT_INVALID');
  code(() => validateSession(session({ projectText: JSON.stringify({ format: 'other', project: {} }) })), 'PROJECT_INVALID');
  code(() => validateSession(session({ projectText: 42 })), 'PROJECT_INVALID');
  code(() => validateSession(session({ projectText: '"' + 'x'.repeat(16 * 1024 * 1024) + '"' })), 'PROJECT_INVALID');
  code(() => validateSession(session({ projectText: projectText([{ id: 'other' }]) })), 'UNKNOWN_OUTPUT');
  code(() => validateSession(session({ projectText: JSON.stringify({ format: 'playground-pixel-lab/project', project: {} }) })), 'UNKNOWN_OUTPUT');
});

test('clocks: playing and paused only, content rates only', () => {
  assert.doesNotThrow(() => validateClock(clock));
  assert.doesNotThrow(() => validateClock({ state: 'paused', frame: 1234 }));
  for (const bad of [
    { ...clock, fps: 29.97 }, { ...clock, fps: 120 }, { ...clock, startFrame: -1 }, { ...clock, epochMs: 0 }, { ...clock, epochMs: NaN },
    { ...clock, frame: 1 }, { state: 'paused', frame: 1.5 }, { state: 'paused' }, { state: 'stopped' }, null,
  ]) code(() => validateClock(bad), 'BAD_REQUEST');
});

test('output ids for close and clock accept "*"', () => {
  assert.equal(outputIdOrAll('*'), '*');
  assert.equal(outputIdOrAll('out-1'), 'out-1');
  code(() => outputIdOrAll('**'), 'BAD_REQUEST');
  code(() => outputIdOrAll(''), 'BAD_REQUEST');
});

test('reports: required fields, optional fields and their bounds', () => {
  assert.doesNotThrow(() => validateReport(report()));
  assert.doesNotThrow(() => validateReport(report({ contentBoxDevicePx: null })));
  assert.doesNotThrow(() => validateReport(report({
    error: 'x'.repeat(500), masterPx: { width: 5120, height: 1664 }, sourceId: 'pixel-grid', errorCode: 'MASTER_TOO_LARGE',
    cadence: { contentFps: 25, refreshHz: 60, measuredHz: 59.94, pattern: [3, 2, 3, 2, 2], even: false, repeated: 0 },
    limits: { maxCanvasSide: 32767, maxCanvasArea: 268435456, maxTextureSize: 16384, depthMaxSize: null },
  })));
  const missing = report(); delete missing.frame;
  for (const bad of [
    missing, report({ extra: 1 }), report({ devicePixelRatio: 0 }), report({ devicePixelRatio: 9 }), report({ browserFps: -1 }),
    report({ lateFrames: 0.5 }), report({ outputPx: { width: 0, height: 1 } }), report({ error: 'x'.repeat(501) }),
    report({ sourceId: 'x'.repeat(201) }), report({ errorCode: 'NOT_A_CODE' }), report({ errorCode: 'NOT_ONE_TO_ONE' }),
    report({ cadence: { contentFps: 30, refreshHz: 60, measuredHz: 60, pattern: new Array(241).fill(2), even: true, repeated: 0 } }),
    report({ cadence: { contentFps: 30, refreshHz: 60, measuredHz: 60, pattern: [2], even: true } }),
    report({ limits: { maxCanvasSide: 0, maxCanvasArea: 1, maxTextureSize: 1, depthMaxSize: null } }),
    report({ masterPx: { width: 1, height: 1, depth: 1 } }),
  ]) code(() => validateReport(bad), 'BAD_REQUEST');
});

const display = (over = {}) => ({ devicePx: { width: 1920, height: 1080 }, scaleFactor: 1, devicePxExact: true, ...over });

test('1:1: exact, pending, error and the inexact-scale warning', () => {
  assert.equal(oneToOne(display(), report()).status, 'exact');
  assert.equal(oneToOne(display(), report({ contentBoxDevicePx: null })).status, 'pending');
  // 2×: CSS viewport is half the device size.
  const hidpi = display({ devicePx: { width: 3840, height: 2160 }, scaleFactor: 2 });
  assert.equal(oneToOne(hidpi, report({ devicePixelRatio: 2, viewportCss: { width: 1920, height: 1080 }, canvasPx: { width: 3840, height: 2160 }, contentBoxDevicePx: { width: 3840, height: 2160 } })).status, 'exact');
  // Canvas sized in CSS px on a 2× display: the classic mistake.
  const wrong = oneToOne(hidpi, report({ devicePixelRatio: 2, viewportCss: { width: 1920, height: 1080 }, canvasPx: { width: 1920, height: 1080 }, contentBoxDevicePx: { width: 3840, height: 2160 } }));
  assert.equal(wrong.status, 'error'); assert.equal(wrong.code, 'NOT_ONE_TO_ONE'); assert.match(wrong.problems[0], /canvasPx 1920 × 1080, expected 3840 × 2160/);
  // Ratio mismatch is always an error.
  assert.equal(oneToOne(display(), report({ devicePixelRatio: 1.25 })).status, 'error');
  // Off by one on an exact display: error. On an inexact (fractional Windows) display: warning. Off by two: error.
  assert.equal(oneToOne(display(), report({ contentBoxDevicePx: { width: 1919, height: 1080 } })).status, 'error');
  const win = display({ devicePx: { width: 1366, height: 768 }, scaleFactor: 1.25, devicePxExact: false });
  const winReport = over => report({ devicePixelRatio: 1.25, viewportCss: { width: 1093, height: 614 }, canvasPx: { width: 1366, height: 768 }, contentBoxDevicePx: { width: 1366, height: 768 }, ...over });
  assert.equal(oneToOne(win, winReport()).status, 'exact', 'viewport 1093 × 1.25 = 1366.25 → 1366 and 614 × 1.25 = 767.5 → 768 match');
  assert.equal(oneToOne(win, winReport({ contentBoxDevicePx: { width: 1365, height: 768 } })).status, 'warning');
  assert.equal(oneToOne(win, winReport({ contentBoxDevicePx: { width: 1364, height: 768 } })).status, 'error');
});

test('size match per axis, never scaled', () => {
  const d = { width: 1920, height: 1080 };
  assert.deepEqual(sizeMatchOf({ width: 1920, height: 1080 }, d), { sizeMatch: 'exact', croppedPx: { right: 0, bottom: 0 }, blackPx: { right: 0, bottom: 0 } });
  assert.deepEqual(sizeMatchOf({ width: 1280, height: 720 }, d), { sizeMatch: 'smaller-than-display', croppedPx: { right: 0, bottom: 0 }, blackPx: { right: 640, bottom: 360 } });
  assert.deepEqual(sizeMatchOf({ width: 3072, height: 1920 }, d), { sizeMatch: 'larger-than-display', croppedPx: { right: 1152, bottom: 840 }, blackPx: { right: 0, bottom: 0 } });
  assert.deepEqual(sizeMatchOf({ width: 4608, height: 128 }, d), { sizeMatch: 'mixed', croppedPx: { right: 2688, bottom: 0 }, blackPx: { right: 0, bottom: 952 } });
  assert.deepEqual(sizeMatchOf(null, d), { sizeMatch: 'unknown', croppedPx: null, blackPx: null });
});
