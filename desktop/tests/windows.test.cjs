const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MAX_OUTPUTS, outputURL, trustedURLForRole, validOutputId, createWindowRegistry } = require('../src/windows.cjs');

// Minimal stand-ins for BrowserWindow / WebContents / WebFrameMain.
function fakeWindow(url) {
  const mainFrame = { url };
  const webContents = { mainFrame };
  return { webContents, mainFrame, destroyed: false, isDestroyed() { return this.destroyed; } };
}
const event = (win, frame = win.webContents.mainFrame) => ({ sender: win.webContents, senderFrame: frame });
const CONTROL = { kind: 'control' };
const OUT = id => ({ kind: 'output', outputId: id });

for (const origin of ['app://pixellab/', 'http://127.0.0.1:3210/']) {
  const controlURL = origin;
  const outURL = outputURL(origin);

  test(`output URL is fixed per mode (${origin})`, () => {
    assert.equal(outURL, origin === 'app://pixellab/' ? 'app://pixellab/output.html' : 'http://127.0.0.1:3210/output');
  });

  test(`URLs are allowed only for their own role (${origin})`, () => {
    assert.equal(trustedURLForRole(controlURL, origin, 'control'), true);
    assert.equal(trustedURLForRole(outURL, origin, 'output'), true);
    assert.equal(trustedURLForRole(outURL, origin, 'control'), false, 'control window must not show the output route');
    assert.equal(trustedURLForRole(controlURL, origin, 'output'), false, 'output window must not show the editor');
    for (const extra of ['?x=1', '#a']) assert.equal(trustedURLForRole(outURL + extra, origin, 'output'), false);
    for (const url of ['https://evil.test/output.html', 'http://localhost:3210/output', 'app://evil/output.html', 'file:///tmp/output.html', 'http://127.0.0.1:3000/output']) {
      assert.equal(trustedURLForRole(url, origin, 'output'), false, url);
      assert.equal(trustedURLForRole(url, origin, 'control'), false, url);
    }
    assert.equal(trustedURLForRole(controlURL, origin, 'other'), false);
  });

  test(`control channels reject output windows and output channels reject the control window (${origin})`, () => {
    const reg = createWindowRegistry(origin);
    const control = fakeWindow(controlURL);
    const out = fakeWindow(outURL);
    reg.setControl(control);
    reg.addOutput('out-1', out);
    assert.doesNotThrow(() => reg.assertSender(event(control), CONTROL));
    assert.doesNotThrow(() => reg.assertSender(event(out), OUT('out-1')));
    assert.throws(() => reg.assertSender(event(out), CONTROL), /Untrusted/);
    assert.throws(() => reg.assertSender(event(control), OUT('out-1')), /Untrusted/);
    assert.throws(() => reg.assertSender(event(out), OUT('out-2')), /Untrusted/, 'unregistered output id');
    assert.throws(() => reg.assertSender(event(out), OUT('../x')), /Untrusted/, 'invalid output id');
  });

  test(`sender checks require the main frame and a URL allowed for the role (${origin})`, () => {
    const reg = createWindowRegistry(origin);
    const control = fakeWindow(controlURL);
    reg.setControl(control);
    assert.throws(() => reg.assertSender(event(control, { url: controlURL }), CONTROL), 'child frame');
    assert.throws(() => reg.assertSender({ sender: control.webContents, senderFrame: null }, CONTROL));
    assert.throws(() => reg.assertSender({ sender: {}, senderFrame: control.webContents.mainFrame }, CONTROL), 'foreign contents');
    control.webContents.mainFrame.url = outURL;
    assert.throws(() => reg.assertSender(event(control), CONTROL), 'control window navigated to the output route');
    control.webContents.mainFrame.url = 'https://evil.test/';
    assert.throws(() => reg.assertSender(event(control), CONTROL));
  });
}

test('registry tracks roles, closed windows and the output limit', () => {
  const origin = 'app://pixellab/';
  const reg = createWindowRegistry(origin);
  assert.throws(() => reg.assertSender(event(fakeWindow(origin)), CONTROL), 'no control window yet');
  const control = fakeWindow(origin);
  reg.setControl(control);
  const out = fakeWindow(outputURL(origin));
  assert.deepEqual(reg.roleOf(control.webContents), { kind: 'control' });
  assert.equal(reg.roleOf(out.webContents), null);
  reg.addOutput('out-1', out);
  assert.deepEqual(reg.roleOf(out.webContents), { kind: 'output', outputId: 'out-1' });
  assert.equal(MAX_OUTPUTS, 1);
  assert.throws(() => reg.addOutput('out-1', fakeWindow(outputURL(origin))), /ALREADY_OPEN/);
  assert.throws(() => reg.addOutput('out-2', fakeWindow(outputURL(origin))), /TOO_MANY_OUTPUTS/);
  assert.throws(() => reg.addOutput('bad id', fakeWindow(outputURL(origin))), /Invalid output id/);
  // A destroyed window no longer authorises anything.
  out.destroyed = true;
  assert.throws(() => reg.assertSender(event(out), OUT('out-1')));
  assert.equal(reg.roleOf(out.webContents), null);
  reg.removeOutput('out-1', fakeWindow('x'));        // only the registered window can remove itself
  assert.deepEqual(reg.outputIds(), ['out-1']);
  reg.removeOutput('out-1', out);
  assert.deepEqual(reg.outputIds(), []);
  reg.clearControl(fakeWindow(origin));              // a stale window doesn't clear the current control
  assert.equal(reg.control, control);
  reg.clearControl(control);
  assert.equal(reg.control, null);
});

test('output ids follow the IPC contract', () => {
  for (const id of ['out-1', 'show_5', 'e4df64d0-1af7-4ab7-882c-e83397dc8bbe', 'a'.repeat(64)]) assert.equal(validOutputId(id), true, id);
  for (const id of ['', 'a'.repeat(65), 'a b', '../x', 'a/b', null, 7, {}]) assert.equal(validOutputId(id), false, String(id));
});
