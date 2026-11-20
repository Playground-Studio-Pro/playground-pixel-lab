// Output window factory (Phase C task D4, docs/architecture/PHYSICAL_OUTPUT.md section 2).
// Creates the BrowserWindow with its own minimal preload, the fixed allowlisted URL and the same restrictions as the
// control window. Placement on a display, full screen, Esc and the state machine arrive with D5.
const path = require('node:path');
const { outputURL, trustedURLForRole } = require('./windows.cjs');

// Hidden-test-only marker for the output page (O6). Main adds it to the renderer's argv through additionalArguments,
// only in an unpackaged smoke run; the page can't set it. The preload turns it into pixelLabOutput.testMode.
const TEST_MODE_ARG = '--pixellab-output-test-mode';

/** Main's smoke condition: true only in an unpackaged --smoke-test run. */
function outputTestMode({ isPackaged, argv = [] }) {
  return !isPackaged && argv.includes('--smoke-test');
}

/** BrowserWindow options for an output window. Pure, so tests can check every security flag. */
function outputWindowOptions({ bounds, isPackaged, testMode = false }) {
  return {
    x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    show: false, frame: false, transparent: false, hasShadow: false,
    backgroundColor: '#000000',
    resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: true, skipTaskbar: true, focusable: true, enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'output-preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, webviewTag: false,
      backgroundThrottling: false,
      zoomFactor: 1, spellcheck: false, devTools: !isPackaged,
      additionalArguments: testMode === true && !isPackaged ? [TEST_MODE_ARG] : [],
    },
  };
}

/**
 * Creates an output window and loads its one URL. Returns the window; the caller registers it in the window registry
 * under its outputId before the page can talk to main.
 */
function createOutputWindow(BrowserWindow, { bounds, origin, isPackaged, testMode = false }) {
  const window = new BrowserWindow(outputWindowOptions({ bounds, isPackaged, testMode }));
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const guard = (event, url) => { if (!trustedURLForRole(url, origin, 'output')) event.preventDefault(); };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.on('did-finish-load', () => { contents.setZoomFactor(1); contents.setVisualZoomLevelLimits(1, 1).catch(() => {}); });
  const url = outputURL(origin);
  window.loadURL(url).catch(() => {});   // load failures surface through did-fail-load (D5 maps them to LOAD_FAILED)
  return window;
}

module.exports = { outputWindowOptions, createOutputWindow, outputTestMode, TEST_MODE_ARG };
