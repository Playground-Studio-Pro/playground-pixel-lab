// Window registry and role-based IPC sender checks (Phase C task D1, docs/architecture/PHYSICAL_OUTPUT.md).
// Pure: no Electron import. main.cjs owns the BrowserWindows and registers them here.
const { trustedURL } = require('./security.cjs');

const MAX_OUTPUTS = 1;                         // Alpha 0.1 runs one output (section 6)
const OUTPUT_ID = /^[A-Za-z0-9_-]{1,64}$/;     // VideoOutput.id as carried over IPC (section 3)

/** The one URL an output window may show: app://pixellab/output.html packaged, <dev origin>/output in development. */
function outputURL(origin) {
  return origin === 'app://pixellab/' ? 'app://pixellab/output.html' : new URL('output', origin).href;
}

/** Whether a frame URL is allowed for a window role. Same origin for both; the output route belongs only to output windows. */
function trustedURLForRole(value, origin, role) {
  if (!trustedURL(value, origin)) return false;
  let u;
  try { u = new URL(value); } catch { return false; }
  const output = new URL(outputURL(origin));
  const isOutputRoute = u.pathname === output.pathname;
  if (role === 'control') return !isOutputRoute;
  if (role === 'output') return isOutputRoute && !u.search && !u.hash;
  return false;
}

function validOutputId(id) { return typeof id === 'string' && OUTPUT_ID.test(id); }

function createWindowRegistry(origin) {
  let control = null;
  const outputs = new Map();   // outputId → window
  const contentsOf = win => (win && !win.isDestroyed?.() ? win.webContents : null);
  return {
    origin,
    get control() { return control; },
    setControl(win) { control = win; },
    clearControl(win) { if (control === win) control = null; },
    outputIds() { return [...outputs.keys()]; },
    output(id) { return outputs.get(id) || null; },
    addOutput(id, win) {
      if (!validOutputId(id)) throw new Error('Invalid output id');
      if (outputs.has(id)) throw new Error('ALREADY_OPEN');
      if (outputs.size >= MAX_OUTPUTS) throw new Error('TOO_MANY_OUTPUTS');
      outputs.set(id, win);
    },
    removeOutput(id, win) { if (outputs.get(id) === win) outputs.delete(id); },
    /** The role a WebContents plays, or null when it belongs to no registered window. */
    roleOf(contents) {
      if (contents && contents === contentsOf(control)) return { kind: 'control' };
      for (const [outputId, win] of outputs) if (contents && contents === contentsOf(win)) return { kind: 'output', outputId };
      return null;
    },
    /** Throws unless the IPC event comes from the main frame of the window registered for `role`, at a URL allowed for that role. */
    assertSender(event, role) {
      const win = role.kind === 'control' ? control : role.kind === 'output' && validOutputId(role.outputId) ? outputs.get(role.outputId) : null;
      const contents = contentsOf(win);
      if (!contents || event.sender !== contents || !event.senderFrame || event.senderFrame !== contents.mainFrame || !trustedURLForRole(event.senderFrame.url, origin, role.kind)) {
        throw new Error('Untrusted desktop IPC sender');
      }
    },
  };
}

module.exports = { MAX_OUTPUTS, outputURL, trustedURLForRole, validOutputId, createWindowRegistry };
