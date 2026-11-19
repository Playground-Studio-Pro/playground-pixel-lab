// IPC validation for physical output (Phase C task D3, docs/architecture/PHYSICAL_OUTPUT.md sections 3 and 5).
// Pure: no Electron import. Main is CommonJS and can't load the app's TypeScript, so shapes are checked by hand here.
// The closed lists below mirror src/domain/physical-output.ts; tests/desktop-contract-parity.test.ts keeps them equal.
const { MAX_PROJECT_BYTES } = require('./security.cjs');
const { MAX_OUTPUTS, validOutputId } = require('./windows.cjs');

const OUTPUT_STATES = Object.freeze(['closed', 'opening', 'live', 'waiting-display', 'held', 'failed']);
const OUTPUT_ERROR_CODES = Object.freeze([
  'BAD_REQUEST', 'UNTRUSTED_SENDER', 'UNKNOWN_OUTPUT', 'DISPLAY_NOT_FOUND', 'DISPLAY_BUSY', 'CONTROL_DISPLAY',
  'ALREADY_OPEN', 'TOO_MANY_OUTPUTS', 'PROJECT_INVALID', 'LOAD_FAILED', 'OPEN_TIMEOUT', 'RENDERER_GONE',
  'RENDERER_UNRESPONSIVE', 'DISPLAY_AMBIGUOUS', 'NOT_RESUMABLE', 'NOT_ONE_TO_ONE',
]);
const OUTPUT_RENDER_ERROR_CODES = Object.freeze([
  'PROJECT_INVALID', 'UNKNOWN_OUTPUT', 'SOURCE_UNKNOWN', 'SOURCE_SETTINGS_INVALID', 'ASSET_MISSING',
  'GPU_UNAVAILABLE', 'MASTER_TOO_LARGE', 'DRAW_FAILED',
]);
const SIZE_MATCHES = Object.freeze(['exact', 'smaller-than-display', 'larger-than-display', 'mixed', 'unknown']);
const OUTPUT_CHANNELS = Object.freeze({
  listDisplays: 'output:list-displays', open: 'output:open', update: 'output:update', clock: 'output:clock',
  close: 'output:close', retry: 'output:retry', resume: 'output:resume', statusAll: 'output:status-all',
  status: 'output:status', displaysChanged: 'output:displays-changed', session: 'output:session',
  display: 'output:display', ready: 'output:ready', report: 'output:report',
});
const CONTENT_FPS = Object.freeze([24, 25, 30, 50, 60]);   // src/domain/motion.ts

const MAX_SETTINGS_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_LABEL = 200;
const MAX_SOURCE_ID = 200;
const MAX_ERROR_TEXT = 500;
const MAX_CADENCE_PATTERN = 240;
const MAX_DEVICE_PIXEL_RATIO = 8;
const MAX_FPS = 1000;

class OutputIpcError extends Error {
  constructor(code, message) { super(message); this.name = 'OutputIpcError'; this.code = code; }
}
const bad = message => new OutputIpcError('BAD_REQUEST', message);

// ── Primitive checks ─────────────────────────────────────────────────────────
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
function object(value, name, required, optional = []) {
  if (!isPlainObject(value)) throw bad(`${name} must be an object`);
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) throw bad(`${name}.${key} is not allowed`);
  for (const key of required) if (!(key in value)) throw bad(`${name}.${key} is missing`);
  return value;
}
function int(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw bad(`${name} must be an integer from ${min} to ${max}`);
  return value;
}
function num(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER, exclusiveMin = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || (exclusiveMin && value === min) || value > max) throw bad(`${name} must be a number in range`);
  return value;
}
function str(value, name, { min = 0, max }) {
  if (typeof value !== 'string' || value.length < min || value.length > max) throw bad(`${name} must be a string of ${min}–${max} characters`);
  return value;
}
function bool(value, name) { if (typeof value !== 'boolean') throw bad(`${name} must be a boolean`); return value; }
function size(value, name, min = 1) {
  object(value, name, ['width', 'height']);
  int(value.width, `${name}.width`, { min }); int(value.height, `${name}.height`, { min });
  return value;
}
function outputId(value, name = 'outputId') { if (!validOutputId(value)) throw bad(`${name} must match [A-Za-z0-9_-]{1,64}`); return value; }
function outputIdOrAll(value) { return value === '*' ? value : outputId(value); }

/** Plain JSON only: what structured clone may carry beyond JSON (Dates, Maps, typed arrays, -0, NaN) is refused. */
function jsonValue(value, name, depth = 0) {
  if (depth > MAX_JSON_DEPTH) throw bad(`${name} is nested too deeply`);
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw bad(`${name} has a non-finite number`); return; }
  if (Array.isArray(value)) { value.forEach((v, i) => jsonValue(v, `${name}[${i}]`, depth + 1)); return; }
  if (isPlainObject(value)) { for (const [k, v] of Object.entries(value)) jsonValue(v, `${name}.${k}`, depth + 1); return; }
  throw bad(`${name} is not plain JSON`);
}

// ── Contract shapes ──────────────────────────────────────────────────────────
function validateDisplayKey(value, name = 'display') {
  object(value, name, ['label', 'devicePx', 'internal', 'electronId']);
  str(value.label, `${name}.label`, { max: MAX_LABEL });
  size(value.devicePx, `${name}.devicePx`);
  bool(value.internal, `${name}.internal`);
  if (!Number.isSafeInteger(value.electronId)) throw bad(`${name}.electronId must be an integer`);
  return value;
}

function validateClock(value, name = 'clock') {
  if (!isPlainObject(value)) throw bad(`${name} must be an object`);
  if (value.state === 'playing') {
    object(value, name, ['state', 'fps', 'startFrame', 'epochMs']);
    if (!CONTENT_FPS.includes(value.fps)) throw bad(`${name}.fps must be one of ${CONTENT_FPS.join(', ')}`);
    int(value.startFrame, `${name}.startFrame`);
    num(value.epochMs, `${name}.epochMs`, { min: 0, exclusiveMin: true });
  } else if (value.state === 'paused') {
    object(value, name, ['state', 'frame']);
    int(value.frame, `${name}.frame`);
  } else throw bad(`${name}.state must be playing or paused`);
  return value;
}

/**
 * What main can check of a project without the app's parser: size, JSON, envelope, and that the output exists.
 * Deep validation is the control window's (validateProject) and the output page's (section 3).
 */
function checkProjectText(projectText, id) {
  if (typeof projectText !== 'string' || Buffer.byteLength(projectText, 'utf8') > MAX_PROJECT_BYTES) throw new OutputIpcError('PROJECT_INVALID', 'Project text is missing or over 16 MiB');
  let data;
  try { data = JSON.parse(projectText); } catch { throw new OutputIpcError('PROJECT_INVALID', 'Project text is not JSON'); }
  if (data?.format !== 'playground-pixel-lab/project' || !isPlainObject(data.project)) throw new OutputIpcError('PROJECT_INVALID', 'Expected a Pixel Lab project file');
  const outputs = data.project.output?.outputs;
  if (!Array.isArray(outputs) || !outputs.some(o => o && o.id === id)) throw new OutputIpcError('UNKNOWN_OUTPUT', `Output ${id} is not in the project`);
}

function validateSession(value, { expectedOutputId } = {}) {
  object(value, 'session', ['revision', 'projectText', 'outputId', 'source', 'clock']);
  int(value.revision, 'session.revision');
  outputId(value.outputId, 'session.outputId');
  if (expectedOutputId !== undefined && value.outputId !== expectedOutputId) throw bad('session.outputId must equal the request outputId');
  object(value.source, 'session.source', ['id', 'settings']);
  str(value.source.id, 'session.source.id', { min: 1, max: MAX_SOURCE_ID });
  jsonValue(value.source.settings, 'session.source.settings');
  if (Buffer.byteLength(JSON.stringify(value.source.settings), 'utf8') > MAX_SETTINGS_BYTES) throw bad('session.source.settings is over 1 MiB');
  validateClock(value.clock, 'session.clock');
  checkProjectText(value.projectText, value.outputId);
  return value;
}

function validateOpenRequest(value) {
  object(value, 'request', ['outputId', 'display', 'session'], ['allowControlDisplay']);
  outputId(value.outputId);
  validateDisplayKey(value.display);
  if ('allowControlDisplay' in value) bool(value.allowControlDisplay, 'request.allowControlDisplay');
  validateSession(value.session, { expectedOutputId: value.outputId });
  return value;
}

function validateCadence(value) {
  object(value, 'report.cadence', ['contentFps', 'refreshHz', 'measuredHz', 'pattern', 'even', 'repeated']);
  if (!CONTENT_FPS.includes(value.contentFps)) throw bad('report.cadence.contentFps is not a content rate');
  num(value.refreshHz, 'report.cadence.refreshHz', { max: MAX_FPS });
  num(value.measuredHz, 'report.cadence.measuredHz', { max: MAX_FPS });
  if (!Array.isArray(value.pattern) || value.pattern.length > MAX_CADENCE_PATTERN) throw bad(`report.cadence.pattern must have at most ${MAX_CADENCE_PATTERN} entries`);
  value.pattern.forEach((n, i) => int(n, `report.cadence.pattern[${i}]`, { min: 0, max: MAX_FPS }));
  bool(value.even, 'report.cadence.even');
  int(value.repeated, 'report.cadence.repeated');
}

function validateReport(value) {
  const required = ['sessionRevision', 'firstFrameDrawn', 'frame', 'devicePixelRatio', 'viewportCss', 'canvasPx', 'outputPx', 'browserFps', 'lateFrames', 'skippedFrames'];
  const optional = ['error', 'contentBoxDevicePx', 'masterPx', 'sourceId', 'errorCode', 'cadence', 'limits'];
  object(value, 'report', required, optional);
  int(value.sessionRevision, 'report.sessionRevision');
  bool(value.firstFrameDrawn, 'report.firstFrameDrawn');
  int(value.frame, 'report.frame');
  num(value.devicePixelRatio, 'report.devicePixelRatio', { min: 0, exclusiveMin: true, max: MAX_DEVICE_PIXEL_RATIO });
  size(value.viewportCss, 'report.viewportCss', 0);
  size(value.canvasPx, 'report.canvasPx', 0);
  size(value.outputPx, 'report.outputPx');
  num(value.browserFps, 'report.browserFps', { max: MAX_FPS });
  int(value.lateFrames, 'report.lateFrames');
  int(value.skippedFrames, 'report.skippedFrames');
  if ('error' in value) str(value.error, 'report.error', { max: MAX_ERROR_TEXT });
  if ('contentBoxDevicePx' in value && value.contentBoxDevicePx !== null) size(value.contentBoxDevicePx, 'report.contentBoxDevicePx', 0);
  if ('masterPx' in value) size(value.masterPx, 'report.masterPx');
  if ('sourceId' in value) str(value.sourceId, 'report.sourceId', { max: MAX_SOURCE_ID });
  if ('errorCode' in value && !OUTPUT_RENDER_ERROR_CODES.includes(value.errorCode)) throw bad('report.errorCode is not a known code');
  if ('cadence' in value) validateCadence(value.cadence);
  if ('limits' in value) {
    object(value.limits, 'report.limits', ['maxCanvasSide', 'maxCanvasArea', 'maxTextureSize', 'depthMaxSize']);
    int(value.limits.maxCanvasSide, 'report.limits.maxCanvasSide', { min: 1 });
    int(value.limits.maxCanvasArea, 'report.limits.maxCanvasArea', { min: 1 });
    int(value.limits.maxTextureSize, 'report.limits.maxTextureSize', { min: 1 });
    if (value.limits.depthMaxSize !== null) int(value.limits.depthMaxSize, 'report.limits.depthMaxSize', { min: 1 });
  }
  return value;
}

// ── 1:1 and size match (section 5) ───────────────────────────────────────────

/**
 * Section 5 item 4. `pending` until the page has observed its content box; `exact` when every measure equals the
 * display; `warning` for ±1 px per axis on a display whose devicePx was rounded (devicePxExact false); else `error`
 * (NOT_ONE_TO_ONE). Each failing check names measured and expected values.
 */
function oneToOne(display, report) {
  const expected = display.devicePx;
  const problems = [];
  let worst = 0;   // largest per-axis difference in device px
  const compare = (name, measured) => {
    const dw = Math.abs(measured.width - expected.width);
    const dh = Math.abs(measured.height - expected.height);
    if (dw || dh) { worst = Math.max(worst, dw, dh); problems.push(`${name} ${measured.width} × ${measured.height}, expected ${expected.width} × ${expected.height}`); }
  };
  const ratioOk = Math.abs(report.devicePixelRatio - display.scaleFactor) < 1e-9;
  if (!ratioOk) problems.push(`devicePixelRatio ${report.devicePixelRatio}, expected ${display.scaleFactor}`);
  compare('canvasPx', report.canvasPx);
  compare('viewport', { width: Math.round(report.viewportCss.width * report.devicePixelRatio), height: Math.round(report.viewportCss.height * report.devicePixelRatio) });
  const box = report.contentBoxDevicePx;
  if (box) compare('contentBoxDevicePx', box);
  if (!ratioOk || (problems.length && (display.devicePxExact || worst > 1))) return { status: 'error', code: 'NOT_ONE_TO_ONE', problems };
  if (problems.length) return { status: 'warning', problems };
  if (!box) return { status: 'pending', problems };
  return { status: 'exact', problems };
}

/** How an output of outputPx sits on a display of devicePx: drawn at 0,0 at scale 1, never scaled (sections 5 and 8.3). */
function sizeMatchOf(outputPx, devicePx) {
  if (!outputPx || !devicePx) return { sizeMatch: 'unknown', croppedPx: null, blackPx: null };
  const croppedPx = { right: Math.max(0, outputPx.width - devicePx.width), bottom: Math.max(0, outputPx.height - devicePx.height) };
  const blackPx = { right: Math.max(0, devicePx.width - outputPx.width), bottom: Math.max(0, devicePx.height - outputPx.height) };
  const larger = croppedPx.right > 0 || croppedPx.bottom > 0;
  const smaller = blackPx.right > 0 || blackPx.bottom > 0;
  const sizeMatch = larger && smaller ? 'mixed' : larger ? 'larger-than-display' : smaller ? 'smaller-than-display' : 'exact';
  return { sizeMatch, croppedPx, blackPx };
}

module.exports = {
  OUTPUT_STATES, OUTPUT_ERROR_CODES, OUTPUT_RENDER_ERROR_CODES, SIZE_MATCHES, OUTPUT_CHANNELS, CONTENT_FPS, MAX_OUTPUTS,
  MAX_SETTINGS_BYTES, OutputIpcError,
  validateDisplayKey, validateClock, validateSession, validateOpenRequest, validateReport, outputIdOrAll,
  oneToOne, sizeMatchOf,
};
