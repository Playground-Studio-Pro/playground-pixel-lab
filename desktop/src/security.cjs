const path = require('node:path');
const MAX_PROJECT_BYTES = 16 * 1024 * 1024;
function trustedURL(value, origin) {
  try {
    const u = new URL(value);
    if (u.username || u.password) return false;
    if (origin === 'app://pixellab/') return u.protocol === 'app:' && u.host === 'pixellab';
    return u.protocol === 'http:' && u.hostname === '127.0.0.1' && u.origin === new URL(origin).origin;
  }
  catch { return false; }
}
function assertSender(event, contents, origin) {
  if (event.sender !== contents || !event.senderFrame || event.senderFrame !== contents.mainFrame || !trustedURL(event.senderFrame.url, origin)) throw new Error('Untrusted desktop IPC sender');
}
function validateText(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_PROJECT_BYTES) throw new Error('Project exceeds 16 MiB or is not text');
  const data = JSON.parse(text);
  if (data?.format !== 'playground-pixel-lab/project' || !data.project || typeof data.project !== 'object') throw new Error('Expected a Pixel Lab project file');
  // This is an envelope/size guard. The application must still call parseProjectFile.
  return text;
}
function safeName(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9 _.-]{1,100}\.pixellab\.json$/.test(value) || value.includes('..')) throw new Error('Invalid project filename');
  return value;
}
function assetPath(root, rawURL) {
  const u = new URL(rawURL);
  if (u.protocol !== 'app:' || u.host !== 'pixellab') throw new Error('Invalid app origin');
  const decoded = decodeURIComponent(u.pathname);
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').includes('..')) throw new Error('Invalid asset path');
  const file = path.resolve(root, '.' + (decoded === '/' ? '/index.html' : decoded));
  if (!file.startsWith(path.resolve(root) + path.sep)) throw new Error('Asset outside web root');
  return file;
}
// Debugging entry points a distributed build must refuse. Chromium switches and Node inspector flags.
const DEBUG_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe', 'remote-debugging-address', 'inspect', 'inspect-brk', 'inspect-port', 'inspect-publish-uid', 'debug', 'debug-brk'];
const DEBUG_ENV = ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS'];
// Pure: lists every debugging switch or variable present. main.cjs refuses to start a packaged app when this is non-empty.
function debugAccessViolations({ argv = [], env = {}, hasSwitch = () => false } = {}) {
  const found = new Set();
  for (const name of DEBUG_SWITCHES) {
    if (hasSwitch(name)) found.add(`--${name}`);
    for (const arg of argv) if (typeof arg === 'string' && (arg === `--${name}` || arg.startsWith(`--${name}=`))) found.add(`--${name}`);
  }
  for (const name of DEBUG_ENV) if (typeof env[name] === 'string' && env[name] !== '') found.add(name);
  return [...found];
}
module.exports = { MAX_PROJECT_BYTES, trustedURL, assertSender, validateText, safeName, assetPath, DEBUG_SWITCHES, debugAccessViolations };
