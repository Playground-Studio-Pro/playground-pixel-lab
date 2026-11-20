const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  smokeMode, virtualDisplay, smokeTargetDisplay, smokeOpenRequest, visibleWarning, VIRTUAL_DISPLAY_ID, DEAD_MAN_MS,
} = require('../src/smoke-mode.cjs');
const { validateOpenRequest } = require('../src/output-ipc.cjs');

const builtIn = {
  key: { label: 'Built-in Retina Display', devicePx: { width: 3600, height: 2338 }, internal: true, electronId: 1 },
  electronId: 1, label: 'Built-in Retina Display', internal: true, primary: true,
  boundsDip: { x: 0, y: 0, width: 1800, height: 1169 }, scaleFactor: 2, devicePx: { width: 3600, height: 2338 },
  devicePxExact: true, rotation: 0, refreshHz: 120, hostsControlWindow: true, hostsOutput: null,
};
const external = {
  ...builtIn, key: { ...builtIn.key, label: 'DELL U2720Q', devicePx: { width: 1920, height: 1080 }, internal: false, electronId: 2 },
  electronId: 2, label: 'DELL U2720Q', internal: false, primary: false, boundsDip: { x: 1800, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1, devicePx: { width: 1920, height: 1080 }, hostsControlWindow: false,
};
const ON = { PIXELLAB_ALLOW_VISIBLE_OUTPUT: '1' };
const smoke = ['electron', '.', '--smoke-test'];

test('no smoke mode in a packaged build or a normal run, whatever the flags', () => {
  const all = [...smoke, '--smoke-output-visible', '--allow-control-display'];
  assert.equal(smokeMode({ isPackaged: true, argv: all, env: ON }), null);
  assert.equal(smokeMode({ isPackaged: false, argv: ['electron', '.', '--smoke-output-visible', '--allow-control-display'], env: ON }), null);
  assert.equal(smokeMode({ isPackaged: false, argv: ['electron', '.'], env: {} }), null);
});

test('test:smoke is hidden by default; visible needs both keys; the control display needs a third', () => {
  const hidden = smokeMode({ isPackaged: false, argv: smoke, env: {} });
  assert.deepEqual({ ...hidden }, { visible: false, missingKey: false, allowControlDisplay: false, deadManMs: null });
  // One key alone is not enough, and the flag alone is refused rather than run hidden.
  assert.equal(smokeMode({ isPackaged: false, argv: smoke, env: ON }).visible, false);
  const flagOnly = smokeMode({ isPackaged: false, argv: [...smoke, '--smoke-output-visible'], env: {} });
  assert.equal(flagOnly.visible, false);
  assert.equal(flagOnly.missingKey, true);
  assert.equal(smokeMode({ isPackaged: false, argv: [...smoke, '--smoke-output-visible'], env: { PIXELLAB_ALLOW_VISIBLE_OUTPUT: 'true' } }).visible, false, 'exactly "1"');
  // The third key does nothing without the other two.
  assert.equal(smokeMode({ isPackaged: false, argv: [...smoke, '--allow-control-display'], env: ON }).allowControlDisplay, false);
  const visible = smokeMode({ isPackaged: false, argv: [...smoke, '--smoke-output-visible'], env: ON });
  assert.deepEqual({ ...visible }, { visible: true, missingKey: false, allowControlDisplay: false, deadManMs: DEAD_MAN_MS });
  assert.equal(DEAD_MAN_MS, 20000);
  assert.equal(smokeMode({ isPackaged: false, argv: [...smoke, '--smoke-output-visible', '--allow-control-display'], env: ON }).allowControlDisplay, true);
});

test('the smoke request never carries allowControlDisplay without the third key', () => {
  const session = { revision: 1 };
  for (const argv of [smoke, [...smoke, '--allow-control-display'], [...smoke, '--smoke-output-visible']]) {
    for (const env of [{}, ON]) {
      const mode = smokeMode({ isPackaged: false, argv, env });
      const request = smokeOpenRequest({ outputId: 'OUT1', display: builtIn, session, mode });
      assert.equal('allowControlDisplay' in request, false, `${argv.join(' ')} ${JSON.stringify(env)}`);
    }
  }
  assert.equal('allowControlDisplay' in smokeOpenRequest({ outputId: 'OUT1', display: builtIn, session, mode: null }), false);
  const third = smokeMode({ isPackaged: false, argv: [...smoke, '--smoke-output-visible', '--allow-control-display'], env: ON });
  assert.equal(smokeOpenRequest({ outputId: 'OUT1', display: builtIn, session, mode: third }).allowControlDisplay, true);
});

test('hidden runs target the virtual display: a real geometry, no control window, an id no real display has', () => {
  const fake = virtualDisplay(builtIn);
  assert.equal(fake.electronId, VIRTUAL_DISPLAY_ID);
  assert.equal(fake.key.electronId, VIRTUAL_DISPLAY_ID);
  assert.ok(VIRTUAL_DISPLAY_ID < 0);
  assert.equal(fake.hostsControlWindow, false);
  const { matchDisplay } = require('../src/displays.cjs');
  assert.deepEqual(matchDisplay(fake.key, [builtIn, fake]), { level: 1, candidates: [fake] }, 'its key finds it, and only it');
  assert.equal(fake.primary, false);
  assert.deepEqual(fake.devicePx, builtIn.devicePx);
  assert.deepEqual(fake.boundsDip, builtIn.boundsDip);
  assert.equal(fake.scaleFactor, 2);
  const hidden = smokeMode({ isPackaged: false, argv: smoke, env: {} });
  assert.equal(smokeTargetDisplay([builtIn, external, fake], hidden), fake, 'never a real display, even an external one');
  assert.equal(smokeTargetDisplay([builtIn, external], hidden), null);
});

test('visible runs prefer an external display; the control display only with the third key', () => {
  const visible = smokeMode({ isPackaged: false, argv: [...smoke, '--smoke-output-visible'], env: ON });
  const third = smokeMode({ isPackaged: false, argv: [...smoke, '--smoke-output-visible', '--allow-control-display'], env: ON });
  const fake = virtualDisplay(builtIn);
  assert.equal(smokeTargetDisplay([builtIn, external, fake], visible), external);
  assert.equal(smokeTargetDisplay([builtIn, fake], visible), null, 'laptop only: nothing without the third key');
  assert.equal(smokeTargetDisplay([builtIn, fake], third), builtIn);
  assert.equal(smokeTargetDisplay([builtIn, external], third), external, 'external still preferred');
  assert.match(visibleWarning(external), /VISIBLE output .*DELL U2720Q.*1920 × 1080.*Esc or Close.*20 s/);
});

test('the smoke session is a real project with valid test card settings, accepted by main', () => {
  const projectText = fs.readFileSync(path.join(__dirname, '..', '..', 'tests', 'fixtures', 'pixel-test.pixellab.json'), 'utf8');
  const outputId = JSON.parse(projectText).project.output.outputs[0].id;
  const session = { revision: 1, projectText, outputId, source: { id: 'calibration-test-card', settings: { mode: 'identification', logo: 'off' } }, clock: { state: 'paused', frame: 0 } };
  const fake = virtualDisplay(builtIn);
  const request = smokeOpenRequest({ outputId, display: fake, session, mode: smokeMode({ isPackaged: false, argv: smoke, env: {} }) });
  assert.doesNotThrow(() => validateOpenRequest(request));
});

test('package scripts: test:smoke has no visible flag; test:smoke:output does not set the environment key itself', () => {
  const { scripts } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(scripts['test:smoke'], 'electron . --smoke-test');
  assert.match(scripts['test:smoke:output'], /--smoke-output-visible/);
  assert.doesNotMatch(scripts['test:smoke:output'], /PIXELLAB_ALLOW_VISIBLE_OUTPUT|--allow-control-display/);
  for (const [name, value] of Object.entries(scripts)) if (name !== 'test:smoke:output') assert.doesNotMatch(value, /--smoke-output-visible|PIXELLAB_ALLOW_VISIBLE_OUTPUT/, name);
});

test('integration scripts and imported files: only from inside the repository, only in a hidden run', () => {
  const { repoFile, smokeScript } = require('../src/smoke-mode.cjs');
  const root = path.join(__dirname, '..', '..');
  assert.equal(repoFile('tests/fixtures/pixel-test.pixellab.json', root, ['.json']), path.join(root, 'tests/fixtures/pixel-test.pixellab.json'));
  for (const bad of ['../outside.json', '/etc/passwd.json', 'desktop/node_modules/x/evil.json', 'tests/fixtures/pixel-test.ts', '', 'a\0.json']) {
    assert.throws(() => repoFile(bad, root, ['.json']), undefined, JSON.stringify(bad));
  }
  const hidden = smokeMode({ isPackaged: false, argv: smoke, env: {} });
  const script = '--smoke-script=desktop/tests/smoke-scripts/import-and-open.cjs';
  assert.equal(smokeScript([...smoke, script], hidden, root), path.join(root, 'desktop/tests/smoke-scripts/import-and-open.cjs'));
  assert.equal(smokeScript(smoke, hidden, root), null);
  assert.equal(smokeScript([...smoke, script], null, root), null, 'no smoke run, no script');
  const visible = smokeMode({ isPackaged: false, argv: [...smoke, '--smoke-output-visible', script], env: ON });
  assert.throws(() => smokeScript([...smoke, '--smoke-output-visible', script], visible, root), /hidden/);
  assert.throws(() => smokeScript([...smoke, '--smoke-script=../../etc/x.cjs'], hidden, root), /inside the repository/);
  assert.equal(smokeMode({ isPackaged: true, argv: [...smoke, script], env: {} }), null, 'packaged: no smoke mode, so no script');
});
