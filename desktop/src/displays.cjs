// Display detection, identity and the reliable-match rule (Phase C task D2, docs/architecture/PHYSICAL_OUTPUT.md
// sections 1 and 2, owner decision D-2). Pure: no Electron import; main.cjs passes Electron's Display objects in.
// The shape of DisplayInfo / DisplayKey mirrors src/domain/physical-output.ts (PR #21).

const ROTATIONS = new Set([0, 90, 180, 270]);
const MAX_COLOR_SPACE_CHARS = 512;

/**
 * Device-px framebuffer size of a display.
 * macOS: bounds × scaleFactor (1 or 2), exact. Windows: screen.dipToScreenRect when available; exact only when
 * bounds × scaleFactor is an integer on both axes (1920 × 1080 at 125 % → exact; 1366 × 768 at 125 % → not).
 */
function devicePxOf(display, platform, dipToScreenRect) {
  const { bounds, scaleFactor } = display;
  const w = bounds.width * scaleFactor;
  const h = bounds.height * scaleFactor;
  const exact = Number.isInteger(w) && Number.isInteger(h);
  if (platform === 'win32' && typeof dipToScreenRect === 'function') {
    const r = dipToScreenRect(bounds);
    return { devicePx: { width: Math.round(r.width), height: Math.round(r.height) }, devicePxExact: exact && r.width === w && r.height === h };
  }
  return { devicePx: { width: Math.round(w), height: Math.round(h) }, devicePxExact: exact };
}

function centreInside(rect, bounds) {
  if (!rect) return false;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return cx >= bounds.x && cx < bounds.x + bounds.width && cy >= bounds.y && cy < bounds.y + bounds.height;
}

/**
 * Electron Display → DisplayInfo.
 * @param context.platform process.platform
 * @param context.primaryId screen.getPrimaryDisplay().id
 * @param context.controlBounds the control window's bounds (DIP) or null
 * @param context.outputOnDisplay electronId → outputId currently shown there
 * @param context.dipToScreenRect Windows only: rect => screen.dipToScreenRect(null, rect)
 */
function toDisplayInfo(display, { platform, primaryId, controlBounds = null, outputOnDisplay = new Map(), dipToScreenRect } = {}) {
  const { devicePx, devicePxExact } = devicePxOf(display, platform, dipToScreenRect);
  const label = typeof display.label === 'string' ? display.label : '';
  const internal = display.internal === true;
  const b = display.bounds;
  return {
    key: { label, devicePx, internal, electronId: display.id },
    electronId: display.id,
    label,
    internal,
    primary: display.id === primaryId,
    boundsDip: { x: b.x, y: b.y, width: b.width, height: b.height },
    scaleFactor: display.scaleFactor,
    devicePx,
    devicePxExact,
    rotation: ROTATIONS.has(display.rotation) ? display.rotation : 0,
    refreshHz: Number.isFinite(display.displayFrequency) && display.displayFrequency > 0 ? display.displayFrequency : 0,
    hostsControlWindow: centreInside(controlBounds, b),
    hostsOutput: outputOnDisplay.get(display.id) ?? null,
    // Optional: Chromium's colour profile for the display (PHYSICAL_OUTPUT section 2, Colour). Left out when unknown.
    ...(typeof display.colorSpace === 'string' && display.colorSpace ? { colorSpace: display.colorSpace.slice(0, MAX_COLOR_SPACE_CHARS) } : {}),
    ...(Number.isSafeInteger(display.colorDepth) && display.colorDepth > 0 ? { colorDepth: display.colorDepth } : {}),
  };
}

const sameSize = (a, b) => a.width === b.width && a.height === b.height;
const sameLabelAndSize = (key, info) => info.label === key.label && sameSize(info.devicePx, key.devicePx);

/**
 * Section 1 matching: level 1 = same electronId, label and devicePx (and internal); level 2 = same label and devicePx
 * (and internal). Returns every candidate at the best level found, so callers can see ambiguity.
 */
function matchDisplay(key, list) {
  const level2 = list.filter(info => sameLabelAndSize(key, info) && info.internal === key.internal);
  const level1 = level2.filter(info => info.electronId === key.electronId);
  if (level1.length) return { level: 1, candidates: level1 };
  if (level2.length) return { level: 2, candidates: level2 };
  return { level: null, candidates: [] };
}

/**
 * Owner decision D-2: a match is reliable only when exactly one display matches at level 1 or 2 and no other
 * connected display shares that label and devicePx (identical twins, or two displays with the same empty label,
 * are never reliable, even when one of them still has the old electronId).
 * @returns {{ display: object, level: 1 | 2 } | { display: null, reason: 'none' | 'ambiguous' }}
 */
function reliableMatch(key, list) {
  const { level, candidates } = matchDisplay(key, list);
  if (!level) return { display: null, reason: 'none' };
  const lookalikes = list.filter(info => sameLabelAndSize(key, info));
  if (candidates.length !== 1 || lookalikes.length !== 1) return { display: null, reason: 'ambiguous' };
  return { display: candidates[0], level };
}

/** Trailing-edge debounce with injectable timers, for bursts of screen events (250 ms in main). */
function debounce(fn, ms, timers = { setTimeout, clearTimeout }) {
  let handle = null;
  const run = () => { handle = null; fn(); };
  const call = () => { if (handle !== null) timers.clearTimeout(handle); handle = timers.setTimeout(run, ms); };
  call.cancel = () => { if (handle !== null) timers.clearTimeout(handle); handle = null; };
  return call;
}

const DISPLAY_EVENT_DEBOUNCE_MS = 250;

module.exports = { toDisplayInfo, devicePxOf, matchDisplay, reliableMatch, debounce, DISPLAY_EVENT_DEBOUNCE_MS };
