const { app, BrowserWindow, protocol, net, ipcMain, dialog, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { assertSender, trustedURL, validateText, safeName, assetPath, MAX_PROJECT_BYTES } = require('./security.cjs');
const { probeFFmpeg } = require('./native.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const devURL = !app.isPackaged && process.env.PIXEL_LAB_DEV_URL;
if (devURL && !/^http:\/\/127\.0\.0\.1:\d+\/$/.test(devURL)) throw new Error('Development URL must be a numeric loopback origin');
const origin = devURL || 'app://pixellab/';
const smoke = !app.isPackaged && process.argv.includes('--smoke-test');
let window;
let fileBusy = false;
app.setPath('userData', path.join(app.getPath('appData'), smoke ? 'Pixel Lab Desktop Smoke' : 'Pixel Lab Desktop'));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
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
      window = new BrowserWindow({ width: 1440, height: 960, minWidth: 960, minHeight: 640, show: false, backgroundColor: '#07080F', webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: false,
      } });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => { if (!trustedURL(url, origin)) event.preventDefault(); });
      window.webContents.on('will-attach-webview', event => event.preventDefault());
      window.once('ready-to-show', () => window.show());
      window.on('closed', () => { window = null; });
      return window.loadURL(origin);
    }
    const handler = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
      if (!window) throw new Error('No desktop window');
      assertSender(event, window.webContents, origin);
      return fn(...args);
    });
    const withFileDialog = async fn => { if (fileBusy) throw new Error('A file dialog is already open'); fileBusy = true; try { return await fn(); } finally { fileBusy = false; } };
    handler('project:open', () => withFileDialog(async () => {
      const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'Pixel Lab project', extensions: ['json'] }] });
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
      const result = await dialog.showSaveDialog(window, { defaultPath: name, filters: [{ name: 'Pixel Lab project', extensions: ['json'] }] });
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
      if (!window || contents !== window.webContents || !trustedURL(contents.getURL(), origin) || !item.getURL().startsWith('blob:')) { event.preventDefault(); return; }
      item.setSaveDialogOptions({ title: 'Export Pixel Lab file' });
    });
    await createWindow();
    app.on('activate', () => { if (!window) createWindow().catch(fail); });
    if (smoke) await require('./smoke.cjs')(window, app);
  }).catch(fail);
}
function fail(error) { console.error(error); if (!smoke) dialog.showErrorBox('Pixel Lab desktop startup failed', String(error.message || error)); app.exit(1); }
app.on('window-all-closed', () => { if (process.platform !== 'darwin' || smoke) app.quit(); });
