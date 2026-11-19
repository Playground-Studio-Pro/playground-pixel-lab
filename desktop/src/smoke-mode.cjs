// Smoke-test safety for the output window. Pure: no Electron import.
//
// `test:smoke` must never put a window on anyone's screen. By default its output part runs hidden: the output window
// is created with its normal webPreferences, loads the real page, gets a session and reports, but is never shown, put
// in full screen or kept on top, and it targets a virtual display that exists only in that run, so the request needs
// no allowControlDisplay. A visible run needs two explicit keys (a flag and an environment variable), and the control
// window's display needs a third. Visible output windows close by themselves after 20 s.
//
// None of this exists in a packaged build or a normal run: smokeMode() returns null unless !isPackaged && --smoke-test.

const VISIBLE_FLAG = '--smoke-output-visible';
const VISIBLE_ENV = 'PIXELLAB_ALLOW_VISIBLE_OUTPUT';
const CONTROL_DISPLAY_FLAG = '--allow-control-display';
const DEAD_MAN_MS = 20000;
const VIRTUAL_DISPLAY_ID = -424242;   // Electron display ids are positive; this one can't collide

/** @returns null outside an unpackaged smoke run; else { visible, allowControlDisplay, deadManMs } */
function smokeMode({ isPackaged, argv = [], env = {} }) {
  if (isPackaged || !argv.includes('--smoke-test')) return null;
  const visible = argv.includes(VISIBLE_FLAG) && env[VISIBLE_ENV] === '1';
  return Object.freeze({
    visible,
    // The flag without the environment variable: the run stops instead of quietly running hidden.
    missingKey: argv.includes(VISIBLE_FLAG) && !visible,
    allowControlDisplay: visible && argv.includes(CONTROL_DISPLAY_FLAG),
    deadManMs: visible ? DEAD_MAN_MS : null,
  });
}

/**
 * A display that exists only in a hidden smoke run, with the geometry of a real one so the page measures what it
 * would there. It hosts no control window, so opening on it needs no allowControlDisplay; nothing is ever shown on it.
 */
function virtualDisplay(real) {
  const label = 'Pixel Lab smoke (hidden, never shown)';
  return {
    ...real,
    key: { ...real.key, label, internal: false, electronId: VIRTUAL_DISPLAY_ID },
    electronId: VIRTUAL_DISPLAY_ID,
    label,
    internal: false,
    primary: false,
    hostsControlWindow: false,
    hostsOutput: null,
  };
}

/**
 * Which display the smoke opens on. Hidden: the virtual display. Visible: an external display if there is one, the
 * control window's display only with the third key; otherwise none (the run stops with a message).
 */
function smokeTargetDisplay(displays, mode) {
  if (!mode) return null;
  if (!mode.visible) return displays.find(d => d.electronId === VIRTUAL_DISPLAY_ID) || null;
  const real = displays.filter(d => d.electronId !== VIRTUAL_DISPLAY_ID);
  return real.find(d => !d.hostsControlWindow) || (mode.allowControlDisplay ? real.find(d => d.hostsControlWindow) || null : null);
}

/** The open request the smoke sends. allowControlDisplay appears only with the third key, never otherwise. */
function smokeOpenRequest({ outputId, display, session, mode }) {
  return {
    outputId,
    display: display.key,
    ...(mode && mode.visible && mode.allowControlDisplay ? { allowControlDisplay: true } : {}),
    session,
  };
}

function visibleWarning(display) {
  return `Pixel Lab smoke: VISIBLE output windows will open full screen on "${display.label || 'unnamed display'}" `
    + `(${display.devicePx.width} × ${display.devicePx.height} px). Esc or Close to close one; each closes by itself after ${DEAD_MAN_MS / 1000} s.`;
}

const path = require('node:path');
const SCRIPT_FLAG = '--smoke-script=';

/**
 * The file a hidden smoke run may use (an integration script, or a project to import): a path relative to the
 * repository root that stays inside it, outside node_modules, with one of the given extensions. Throws otherwise.
 */
function repoFile(value, repoRoot, extensions) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('Smoke file path is missing');
  const root = path.resolve(repoRoot);
  const target = path.resolve(root, value);
  if (!target.startsWith(root + path.sep)) throw new Error(`Smoke file must be inside the repository: ${value}`);
  if (target.split(path.sep).includes('node_modules')) throw new Error(`Smoke file can't be in node_modules: ${value}`);
  if (!extensions.includes(path.extname(target))) throw new Error(`Smoke file must end in ${extensions.join(' or ')}: ${value}`);
  return target;
}

/** --smoke-script=<path>: only in a hidden run (a visible run refuses it). Returns the resolved path or null. */
function smokeScript(argv, mode, repoRoot) {
  const arg = argv.find(a => a.startsWith(SCRIPT_FLAG));
  if (!arg || !mode) return null;
  if (mode.visible) throw new Error('--smoke-script runs only in the hidden smoke run');
  return repoFile(arg.slice(SCRIPT_FLAG.length), repoRoot, ['.cjs', '.mjs', '.js']);
}

module.exports = {
  repoFile, smokeScript,
  smokeMode, virtualDisplay, smokeTargetDisplay, smokeOpenRequest, visibleWarning,
  VISIBLE_FLAG, VISIBLE_ENV, CONTROL_DISPLAY_FLAG, DEAD_MAN_MS, VIRTUAL_DISPLAY_ID,
};
