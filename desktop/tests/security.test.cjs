const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { trustedURL, assertSender, validateText, safeName, assetPath, MAX_PROJECT_BYTES, debugAccessViolations } = require('../src/security.cjs');
const { ffmpegPath, probeFFmpeg } = require('../src/native.cjs');
test('IPC rejects foreign origins, ports and child frames', () => {
  const origin = 'http://127.0.0.1:3210/';
  for (const url of ['https://evil.test', 'http://localhost:3210/', 'http://127.0.0.1:3000/', 'file:///tmp/app.html', 'app://evil/']) assert.equal(trustedURL(url, origin), false);
  assert.equal(trustedURL(origin, origin), true);
  assert.equal(trustedURL('app://pixellab/', 'app://pixellab/'), true);
  const frame = { url: origin }; const wc = { mainFrame: frame };
  assert.doesNotThrow(() => assertSender({ sender: wc, senderFrame: frame }, wc, origin));
  assert.throws(() => assertSender({ sender: wc, senderFrame: { url: origin } }, wc, origin));
  assert.throws(() => assertSender({ sender: {}, senderFrame: frame }, wc, origin));
});
test('bounded project envelope and safe suggested filename', () => {
  const text = JSON.stringify({ format: 'playground-pixel-lab/project', project: {} });
  assert.equal(validateText(text), text);
  for (const value of ['{}', 'invalid', 'x'.repeat(MAX_PROJECT_BYTES + 1), null]) assert.throws(() => validateText(value));
  assert.equal(safeName('Show.pixellab.json'), 'Show.pixellab.json');
  for (const name of ['../Show.pixellab.json', 'C:\\a.pixellab.json', 'show.exe', 'a/b.pixellab.json']) assert.throws(() => safeName(name));
});
test('protocol confines files to static root including encoded traversal', () => {
  const root = path.resolve('fixture');
  assert.equal(assetPath(root, 'app://pixellab/'), path.join(root, 'index.html'));
  assert.equal(assetPath(root, 'app://pixellab/_next/a.js'), path.join(root, '_next/a.js'));
  for (const url of ['app://evil/a', 'app://pixellab/%2e%2e%2fsecret', 'app://pixellab/a%5csecret', 'app://pixellab/%00']) assert.throws(() => assetPath(root, url));
});
test('FFmpeg resolves only supported binaries, absent binary is nonfatal', async () => {
  assert.equal(ffmpegPath('/resource', 'win32', 'x64'), path.join('/resource', 'ffmpeg.exe'));
  assert.throws(() => ffmpegPath('/resource', 'linux', 'x64'));
  const status = await probeFFmpeg(path.resolve('nonexistent-binary-folder'));
  assert.equal(status.available, false);
});
test('packaging configuration validates against installed builder schema', async () => {
  const fs = require('node:fs');
  const yaml = require('js-yaml');
  const { validateConfiguration } = require('app-builder-lib/out/util/config/config');
  const { DebugLogger } = require('builder-util');
  const config = yaml.load(fs.readFileSync(path.join(__dirname, '../electron-builder.yml'), 'utf8'));
  await validateConfiguration(config, new DebugLogger());
  assert.deepEqual(config.mac.target[0].arch, ['arm64']);
  assert.deepEqual(config.win.target[0].arch, ['x64']);
  assert.equal(config.publish, null);
});
test('debugging switches and variables are detected for packaged builds', () => {
  const clean = { argv: ['/Applications/Pixel Lab.app/Contents/MacOS/Pixel Lab', '-psn_0_123'], env: { HOME: '/Users/x', PIXEL_LAB_DEV_URL: 'http://127.0.0.1:3210/' }, hasSwitch: () => false };
  assert.deepEqual(debugAccessViolations(clean), []);
  assert.deepEqual(debugAccessViolations(), []);
  for (const arg of ['--remote-debugging-port=9333', '--remote-debugging-pipe', '--inspect', '--inspect=9229', '--inspect-brk=0', '--inspect-port=9229', '--debug']) {
    assert.equal(debugAccessViolations({ ...clean, argv: [...clean.argv, arg] }).length, 1, arg);
  }
  assert.deepEqual(debugAccessViolations({ ...clean, hasSwitch: name => name === 'remote-debugging-port' }), ['--remote-debugging-port']);
  assert.deepEqual(debugAccessViolations({ ...clean, env: { ELECTRON_RUN_AS_NODE: '1' } }), ['ELECTRON_RUN_AS_NODE']);
  assert.deepEqual(debugAccessViolations({ ...clean, env: { NODE_OPTIONS: '--inspect' } }), ['NODE_OPTIONS']);
  assert.deepEqual(debugAccessViolations({ ...clean, env: { ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '' } }), []);
  // Look-alike names are not switches.
  assert.deepEqual(debugAccessViolations({ ...clean, argv: [...clean.argv, '--inspector-ui', 'remote-debugging-port=1', '--debugger'] }), []);
});
