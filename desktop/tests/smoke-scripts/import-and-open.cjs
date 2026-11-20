// Example integration script for the hidden smoke run (not a unit test: node --test doesn't load this folder).
//   npm --prefix desktop run test:smoke -- --smoke-script=desktop/tests/smoke-scripts/import-and-open.cjs
// It imports a real project through the editor's own "Import project file" input, then opens the output hidden,
// through the control window's IPC, on the virtual display. Nothing is shown on screen.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = async function importAndOpen(api) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const control = script => api.control.webContents.executeJavaScript(script);
  const until = async (predicate, ms, what) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await predicate()) return Date.now(); await sleep(25); }
    assert.fail(`timed out waiting for ${what}`);
  };
  const fixture = 'tests/fixtures/pixel-test.pixellab.json';
  const projectText = fs.readFileSync(path.join(api.repoRoot, fixture), 'utf8');
  const project = JSON.parse(projectText).project;

  // (1) Import through the app's existing path: the file input's change handler → importProject(text).
  await api.importProjectFile(fixture);
  // The start screen (which may list the project from an earlier run) gives way to the editor with it open.
  await until(async () => { const text = await control('document.body.innerText'); return text.includes(project.meta.name) && !/New project|Create project/i.test(text); }, 10000, 'the imported project open in the editor');

  // (2) Open the output through the control window's IPC, on the hidden run's virtual display.
  const displays = await control('window.pixelLabDesktop.output.listDisplays()');
  const display = displays.find(d => d.electronId === api.virtualDisplayId);
  assert.ok(display, 'virtual display listed in a hidden run');
  const outputId = project.output.outputs[0].id;
  const request = { outputId, display: display.key, session: { revision: 1, projectText, outputId, source: { id: 'calibration-test-card', settings: { mode: 'identification', logo: 'off' } }, clock: { state: 'paused', frame: 0 } } };
  const t0 = Date.now();
  await control(`window.pixelLabDesktop.output.open(${JSON.stringify(request)})`);
  const tLive = await until(() => api.outputs.status(outputId).state === 'live', 5000, 'live');
  const status = api.outputs.status(outputId);
  const window = api.windows.output(outputId);
  assert.equal(window.isVisible(), false);
  await control(`window.pixelLabDesktop.output.close('${outputId}')`);
  await until(() => api.outputs.status(outputId).state === 'closed', 2000, 'closed');
  return { imported: project.meta.name, outputId, firstFrameMs: tLive - t0, devicePixelRatio: status.render.devicePixelRatio, scaleFactor: display.scaleFactor, canvasPx: status.render.canvasPx, devicePx: display.devicePx };
};
