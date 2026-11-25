const { app, BrowserWindow, protocol, net, ipcMain, dialog, session, screen, powerSaveBlocker } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { validateText, safeName, assetPath, MAX_PROJECT_BYTES, DEBUG_SWITCHES, debugAccessViolations } = require('./security.cjs');
const { probeFFmpeg } = require('./native.cjs');
const { createWindowRegistry, trustedURLForRole, outputURL } = require('./windows.cjs');
const { createOutputWindow, outputTestMode } = require('./output-window.cjs');
const { isFullScreen, setFullScreen, destroyOutputWindow, leaveFullScreenOnClose } = require('./output-presentation.cjs');
const { OUTPUT_CHANNELS, OutputIpcError } = require('./output-ipc.cjs');
const { createOutputController, outputKeyAction } = require('./output-controller.cjs');
const { smokeMode, virtualDisplay, smokeScript, repoFile, VIRTUAL_DISPLAY_ID } = require('./smoke-mode.cjs');
const { toDisplayInfo, debounce, DISPLAY_EVENT_DEBOUNCE_MS } = require('./displays.cjs');
// Distributed builds never allow remote debugging or the Node inspector: strip the switches, then refuse to start.
// Unpackaged development builds keep explicit debugging. Fuses in electron-builder.yml cover RunAsNode, NODE_OPTIONS and --inspect too.
if (app.isPackaged) {
  const violations = debugAccessViolations({ argv: process.argv, env: process.env, hasSwitch: name => app.commandLine.hasSwitch(name) });
  if (violations.length) {
    for (const name of DEBUG_SWITCHES) app.commandLine.removeSwitch(name);
    console.error(`Pixel Lab refuses to start: debugging and display-scale switches are disabled in distributed builds (${violations.join(', ')}).`);
    process.exit(1);
  }
}
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const devURL = !app.isPackaged && process.env.PIXEL_LAB_DEV_URL;
if (devURL && !/^http:\/\/127\.0\.0\.1:\d+\/$/.test(devURL)) throw new Error('Development URL must be a numeric loopback origin');
const origin = devURL || 'app://pixellab/';
const smoke = !app.isPackaged && process.argv.includes('--smoke-test');
// Smoke runs only: whether output windows may be shown (two explicit keys) or stay hidden (default). null otherwise.
const smokeOutput = smokeMode({ isPackaged: app.isPackaged, argv: process.argv, env: process.env });
const hiddenSmoke = Boolean(smokeOutput && !smokeOutput.visible);
// Hidden smoke runs show no window at all: any window that appears is hidden again and fails the run.
const smokeViolations = [];
// Smoke runs only: what main sent to output windows, so the smoke checks messages without asking the page.
const smokeSent = [];
if (hiddenSmoke) {
  app.on('browser-window-created', (_event, window) => window.on('show', () => {
    smokeViolations.push(`a window was shown (${window.getTitle() || 'untitled'})`);
    if (!window.isDestroyed()) window.hide();
  }));
}
// Hidden smoke runs only: an integration script from the repository (--smoke-script=<path>), run after the checks.
const repoRoot = path.resolve(__dirname, '..', '..');
let smokeScriptPath = null;
try { smokeScriptPath = smokeScript(process.argv, smokeOutput, repoRoot); }
catch (error) { console.error(`Smoke script refused: ${error.message}`); process.exit(1); }
if (smokeOutput && smokeOutput.missingKey) {
  console.error('Visible output smoke refused: it needs both --smoke-output-visible and PIXELLAB_ALLOW_VISIBLE_OUTPUT=1, and the owner\'s permission. Run `npm run test:smoke` for the hidden run.');
  process.exit(1);
}
const windows = createWindowRegistry(origin);
const CONTROL = Object.freeze({ kind: 'control' });
let fileBusy = false;
// Smoke runs start from an empty profile of their own each time, so nothing one run imports or opens leaks into the next.
app.setPath('userData', smoke
  ? require('node:fs').mkdtempSync(path.join(app.getPath('temp'), 'pixel-lab-desktop-smoke-'))
  : path.join(app.getPath('appData'), 'Pixel Lab Desktop'));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const window = windows.control; if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    if (!devURL) {
      const root = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'web');
      await fs.access(path.join(root, 'index.html'));
      protocol.handle('app', async (request) => {
        try { return await net.fetch(pathToFileURL(assetPath(root, request.url)).href); }
        catch { return new Response('Not found', { status: 404 }); }
      });
    }
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, done) => done(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onHeadersReceived((details, done) => {
      const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'" + (devURL ? " 'unsafe-eval'" : '') + "; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'" + (devURL ? ' ws://127.0.0.1:*' : '') + "; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
      done({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
    });
    function createWindow() {
      const window = new BrowserWindow({ width: 1440, height: 960, minWidth: 960, minHeight: 640, show: false, backgroundColor: '#07080F', webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: false,
      } });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => { if (!trustedURLForRole(url, origin, 'control')) event.preventDefault(); });
      window.webContents.on('will-redirect', (event, url) => { if (!trustedURLForRole(url, origin, 'control')) event.preventDefault(); });
      window.webContents.on('will-attach-webview', event => event.preventDefault());
      window.once('ready-to-show', () => { if (!hiddenSmoke) window.show(); });   // hidden smoke runs never show it
      windows.setControl(window);
      window.on('closed', () => windows.clearControl(window));
      return window.loadURL(origin);
    }
    const handler = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
      if (!windows.control) throw new Error('No desktop window');
      windows.assertSender(event, CONTROL);
      return fn(...args);
    });
    const withFileDialog = async fn => { if (fileBusy) throw new Error('A file dialog is already open'); fileBusy = true; try { return await fn(); } finally { fileBusy = false; } };
    handler('project:open', () => withFileDialog(async () => {
      const result = await dialog.showOpenDialog(windows.control, { properties: ['openFile'], filters: [{ name: 'Pixel Lab project', extensions: ['json'] }] });
      if (result.canceled) return null;
      const file = await fs.open(result.filePaths[0], 'r');
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > MAX_PROJECT_BYTES) throw new Error('Project exceeds 16 MiB or is not a regular file');
        const buffer = Buffer.alloc(MAX_PROJECT_BYTES + 1);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        return { name: path.basename(result.filePaths[0]), text: validateText(buffer.subarray(0, bytesRead).toString('utf8')) };
      } finally { await file.close(); }
    }));
    handler('project:save', payload => withFileDialog(async () => {
      const text = validateText(payload?.text);
      const name = safeName(payload?.suggestedName);
      const result = await dialog.showSaveDialog(windows.control, { defaultPath: name, filters: [{ name: 'Pixel Lab project', extensions: ['json'] }] });
      if (result.canceled || !result.filePath) return null;
      await fs.writeFile(result.filePath, text, 'utf8');
      return { name: path.basename(result.filePath) };
    }));
    let probe;
    handler('ffmpeg:status', () => {
      const root = app.isPackaged ? path.join(process.resourcesPath, 'ffmpeg') : path.join(__dirname, '..', 'resources', 'ffmpeg', `${process.platform}-${process.arch}`);
      return probe ||= probeFFmpeg(root);
    });
    // Existing Blob downloads keep their native Save As flow without changing UI.
    session.defaultSession.on('will-download', (event, item, contents) => {
      if (!windows.control || windows.roleOf(contents)?.kind !== 'control' || !trustedURLForRole(contents.getURL(), origin, 'control') || !item.getURL().startsWith('blob:')) { event.preventDefault(); return; }
      item.setSaveDialogOptions({ title: 'Export Pixel Lab file' });
    });
    function openOutputWindow(outputId, display) {
      const window = createOutputWindow(BrowserWindow, { bounds: display.boundsDip, origin, isPackaged: app.isPackaged, testMode: outputTestMode({ isPackaged: app.isPackaged, argv: process.argv }) });
      try { windows.addOutput(outputId, window); } catch (error) { destroyOutputWindow(window, process.platform); throw error; }
      leaveFullScreenOnClose(window, process.platform);
      const contents = window.webContents;
      window.on('closed', () => { windows.removeOutput(outputId, window); outputs.onClosed(outputId); });
      if (smokeOutput && smokeOutput.visible) {
        // Dead-man switch for the interactive run: every visible output window closes after 20 s, whatever happens.
        const deadMan = setTimeout(() => destroyOutputWindow(window, process.platform), smokeOutput.deadManMs);
        window.on('closed', () => clearTimeout(deadMan));
      }
      contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => { if (isMainFrame && code !== -3) outputs.onLoadFailed(outputId, description); });
      contents.on('render-process-gone', (_event, details) => outputs.onRendererGone(outputId, details?.reason));
      // Esc runs here, in main, so it works even while the output renderer is hung (section 2).
      contents.on('before-input-event', (event, input) => {
        const action = outputKeyAction(input);
        if (!action) return;
        event.preventDefault();
        if (action === 'close') outputs.close(outputId);
      });
    }
    const isFull = window => isFullScreen(window, process.platform);
    const setFull = (window, on) => setFullScreen(window, on, process.platform);
    function showOutputWindow(outputId, display) {
      // Presentation hook: a hidden smoke run never shows, raises or full-screens an output window.
      if (hiddenSmoke) return;
      const window = windows.output(outputId);
      if (!window || window.isDestroyed()) return;
      const b = window.getBounds(), t = display.boundsDip;
      // Moving or resizing (metrics change, reconnect): leave full screen first so the new bounds apply.
      if (isFull(window) && (b.x !== t.x || b.y !== t.y || b.width !== t.width || b.height !== t.height)) setFull(window, false);
      window.setBounds(display.boundsDip);
      window.setAlwaysOnTop(true, 'screen-saver');
      // skipTransformProcessType: without it macOS briefly hides the app's windows and Dock icon on every call.
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
      if (!window.isVisible()) window.showInactive();   // never takes focus: the control window keeps the keyboard
      if (!isFull(window)) setFull(window, true);   // native vs simple full screen is decided in D6
    }
    // D7: display removed. Hidden at once, renderer kept; leaving full screen first so the OS has nothing to move.
    function hideOutputWindow(outputId) {
      // Presentation hook: a hidden smoke run never changes the window's presentation (it was never shown), so the
      // page keeps drawing as in a real run and its reports stay meaningful.
      if (hiddenSmoke) return;
      const window = windows.output(outputId);
      if (!window || window.isDestroyed()) return;
      if (isFull(window)) setFull(window, false);
      window.hide();
    }
    const sendToOutput = (outputId, channel, value) => {
      const window = windows.output(outputId);
      if (window && !window.isDestroyed()) window.webContents.send(channel, value);
      if (smoke) smokeSent.push({ outputId, channel, value });
    };
    const outputs = createOutputController({
      listDisplays: () => listDisplays(),
      openWindow: openOutputWindow,
      showWindow: showOutputWindow,
      closeWindow: outputId => destroyOutputWindow(windows.output(outputId), process.platform),   // leaves full screen first
      sendSession: (outputId, value) => sendToOutput(outputId, OUTPUT_CHANNELS.session, value),
      hideWindow: hideOutputWindow,
      sendClock: (outputId, clock) => sendToOutput(outputId, OUTPUT_CHANNELS.clock, clock),
      sendDisplay: (outputId, display) => sendToOutput(outputId, OUTPUT_CHANNELS.display, display),
      pushStatus: status => { const control = windows.control; if (control && !control.isDestroyed()) control.webContents.send(OUTPUT_CHANNELS.status, status); },
      blocker: powerSaveBlocker,
      reloadWindow: outputId => { const window = windows.output(outputId); if (window && !window.isDestroyed()) window.loadURL(outputURL(origin)).catch(() => {}); },
      // Main-side liveness probe (D8): a trivial script the renderer must run on its main thread. Nothing is exposed
      // to the page. A probe left unanswered for 2 s is abandoned; the 5 s rule counts from the last answer.
      probe: outputId => {
        const window = windows.output(outputId);
        if (!window || window.isDestroyed() || window.webContents.isCrashed()) return Promise.reject(new Error('no renderer'));
        let timer;
        return Promise.race([
          window.webContents.executeJavaScript('0', false),
          new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('probe timeout')), 2000); }),
        ]).finally(() => clearTimeout(timer));
      },
    });
    // Displays (Phase C D2). Renderers never see raw Display objects; the control window gets DisplayInfo only.
    const listDisplays = () => {
      const control = windows.control && !windows.control.isDestroyed() ? windows.control : null;
      const context = {
        platform: process.platform,
        primaryId: screen.getPrimaryDisplay().id,
        controlBounds: control ? control.getBounds() : null,
        outputOnDisplay: outputs.outputOnDisplay(),
        dipToScreenRect: process.platform === 'win32' ? rect => screen.dipToScreenRect(null, rect) : undefined,
      };
      const list = screen.getAllDisplays().map(display => toDisplayInfo(display, context));
      if (!hiddenSmoke) return list;
      // Hidden smoke runs only: a virtual display with a real one's geometry, where the output window opens unseen.
      const fake = virtualDisplay(list.find(d => d.primary) || list[0]);
      return [...list, { ...fake, hostsOutput: context.outputOnDisplay.get(VIRTUAL_DISPLAY_ID) ?? null }];
    };
    handler('output:list-displays', () => listDisplays());
    const pushDisplays = debounce(() => {
      outputs.onDisplaysChanged(listDisplays());   // D7: reconnects and metrics changes, after the burst settles
      const control = windows.control;
      if (control && !control.isDestroyed()) control.webContents.send('output:displays-changed', listDisplays());
    }, DISPLAY_EVENT_DEBOUNCE_MS);
    for (const name of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(name, pushDisplays);
    // A removal hides its output at once, without waiting for the debounce (D7 criterion: within 500 ms).
    screen.on('display-removed', () => outputs.onDisplaysChanged(listDisplays()));
    await createWindow();
    app.on('activate', () => { if (!windows.control) createWindow().catch(fail); });
    // Output windows (Phase C D4, D5). Created only here, from validated control-window IPC, and registered under their
    // outputId before the page can talk. The state machine lives in output-controller.cjs.
    const outputHandler = (channel, fn) => handler(channel, async (...args) => {
      try { return await fn(...args); }
      catch (error) {
        // The renderer only sees the message of a rejected invoke, so it carries the section 3 code first.
        if (error instanceof OutputIpcError) throw new Error(`${error.code}: ${error.message}`);
        throw error;
      }
    });
    outputHandler(OUTPUT_CHANNELS.open, payload => outputs.open(payload));
    outputHandler(OUTPUT_CHANNELS.close, target => { outputs.close(target); });
    outputHandler(OUTPUT_CHANNELS.statusAll, () => outputs.statusAll());
    outputHandler(OUTPUT_CHANNELS.update, (outputId, session) => outputs.update(outputId, session));
    outputHandler(OUTPUT_CHANNELS.retry, outputId => outputs.retry(outputId));
    outputHandler(OUTPUT_CHANNELS.resume, outputId => outputs.resume(outputId));
    // Messages from output windows. ipcMain.on can't answer, so an untrusted sender or a bad payload is dropped.
    const fromOutput = (channel, fn) => ipcMain.on(channel, (event, payload) => {
      const role = windows.roleOf(event.sender);
      if (role?.kind !== 'output') return;
      try { windows.assertSender(event, role); } catch { return; }
      fn(role.outputId, payload);
    });
    fromOutput(OUTPUT_CHANNELS.ready, outputId => outputs.onReady(outputId));
    fromOutput(OUTPUT_CHANNELS.report, (outputId, payload) => outputs.onReport(outputId, payload));
    app.on('before-quit', () => outputs.close('*'));
    // What an integration script gets (hidden smoke runs only; see desktop/README.md). It drives the app through the
    // control window's own IPC and UI; the one helper is importProjectFile, which feeds a repository file to the
    // editor's "Import project file" input, so the import runs the app's existing code path without a native dialog.
    async function runSmokeScript(file) {
      const api = {
        mode: smokeOutput, control: windows.control, windows, outputs, listDisplays, virtualDisplayId: VIRTUAL_DISPLAY_ID,
        outputURL: outputURL(origin), repoRoot,
        async importProjectFile(relative) {
          const target = repoFile(relative, repoRoot, ['.json']);
          const debug = windows.control.webContents.debugger;   // in-process, no port; exists only in this function
          debug.attach('1.3');
          try {
            const { root } = await debug.sendCommand('DOM.getDocument', { depth: 0 });
            const { nodeId } = await debug.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type="file"][aria-label="Import project file"]' });
            if (!nodeId) throw new Error('The "Import project file" input is not on screen');
            await debug.sendCommand('DOM.setFileInputFiles', { nodeId, files: [target] });
          } finally { debug.detach(); }
        },
      };
      const run = (await import(pathToFileURL(file).href)).default;
      if (typeof run !== 'function') throw new Error('A smoke script must export a default async function(api)');
      return run(api);
    }
    if (smoke) {
      const webRoot = path.join(__dirname, '..', 'web');
      await require('./smoke.cjs')(windows.control, app, {
        windows, outputs, powerSaveBlocker, outputURL: outputURL(origin), listDisplays, mode: smokeOutput, smokeViolations, sentToOutput: smokeSent,
        script: smokeScriptPath && (() => runSmokeScript(smokeScriptPath)),
        outputPageAvailable: async () => {
          if (!devURL) return fs.access(path.join(webRoot, 'output.html')).then(() => true, () => false);
          try { return (await net.fetch(outputURL(origin))).status === 200; } catch { return false; }
        },
      });
    }
  }).catch(fail);
}
function fail(error) { console.error(error); if (!smoke) dialog.showErrorBox('Pixel Lab desktop startup failed', String(error.message || error)); app.exit(1); }
app.on('window-all-closed', () => { if (process.platform !== 'darwin' || smoke) app.quit(); });
