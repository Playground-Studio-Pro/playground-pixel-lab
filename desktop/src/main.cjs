const { app, BrowserWindow, protocol, net, ipcMain, dialog, session, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { validateText, safeName, assetPath, MAX_PROJECT_BYTES, DEBUG_SWITCHES, debugAccessViolations } = require('./security.cjs');
const { probeFFmpeg } = require('./native.cjs');
const { createWindowRegistry, trustedURLForRole } = require('./windows.cjs');
const { toDisplayInfo, debounce, DISPLAY_EVENT_DEBOUNCE_MS } = require('./displays.cjs');
// Distributed builds never allow remote debugging or the Node inspector: strip the switches, then refuse to start.
// Unpackaged development builds keep explicit debugging. Fuses in electron-builder.yml cover RunAsNode, NODE_OPTIONS and --inspect too.
if (app.isPackaged) {
  const violations = debugAccessViolations({ argv: process.argv, env: process.env, hasSwitch: name => app.commandLine.hasSwitch(name) });
  if (violations.length) {
    for (const name of DEBUG_SWITCHES) app.commandLine.removeSwitch(name);
    console.error(`Pixel Lab refuses to start: debugging is disabled in distributed builds (${violations.join(', ')}).`);
    process.exit(1);
  }
}
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const devURL = !app.isPackaged && process.env.PIXEL_LAB_DEV_URL;
if (devURL && !/^http:\/\/127\.0\.0\.1:\d+\/$/.test(devURL)) throw new Error('Development URL must be a numeric loopback origin');
const origin = devURL || 'app://pixellab/';
const smoke = !app.isPackaged && process.argv.includes('--smoke-test');
const windows = createWindowRegistry(origin);
const CONTROL = Object.freeze({ kind: 'control' });
let fileBusy = false;
app.setPath('userData', path.join(app.getPath('appData'), smoke ? 'Pixel Lab Desktop Smoke' : 'Pixel Lab Desktop'));
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
      window.once('ready-to-show', () => window.show());
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
    // Displays (Phase C D2). Renderers never see raw Display objects; the control window gets DisplayInfo only.
    const listDisplays = () => {
      const control = windows.control && !windows.control.isDestroyed() ? windows.control : null;
      const context = {
        platform: process.platform,
        primaryId: screen.getPrimaryDisplay().id,
        controlBounds: control ? control.getBounds() : null,
        outputOnDisplay: new Map(),   // filled once output windows exist (D5)
        dipToScreenRect: process.platform === 'win32' ? rect => screen.dipToScreenRect(null, rect) : undefined,
      };
      return screen.getAllDisplays().map(display => toDisplayInfo(display, context));
    };
    handler('output:list-displays', () => listDisplays());
    const pushDisplays = debounce(() => {
      const control = windows.control;
      if (control && !control.isDestroyed()) control.webContents.send('output:displays-changed', listDisplays());
    }, DISPLAY_EVENT_DEBOUNCE_MS);
    for (const name of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(name, pushDisplays);
    await createWindow();
    app.on('activate', () => { if (!windows.control) createWindow().catch(fail); });
    if (smoke) await require('./smoke.cjs')(windows.control, app);
  }).catch(fail);
}
function fail(error) { console.error(error); if (!smoke) dialog.showErrorBox('Pixel Lab desktop startup failed', String(error.message || error)); app.exit(1); }
app.on('window-all-closed', () => { if (process.platform !== 'darwin' || smoke) app.quit(); });
