// O8: measured limits and performance of the output window (PHYSICAL_OUTPUT 8.9, 8.10). Hidden smoke runs only.
//   npm --prefix desktop run test:smoke -- --smoke-script=desktop/tests/smoke-scripts/o8-limits.cjs
// Optional: PIXELLAB_O8_SECONDS (default 30) per measurement; PIXELLAB_O8_ONLY=limits for the canvas limits alone.
//
// Festival Main Stage OUT 1 (Processor A, 3072 × 1920): every frame draws the whole 5120 × 1664 master, then cuts
// the slices (O-1). For the calibration test card, the pixel grid (motion) and Depth Studio, at 30 and 60 fps:
// open → first frame (live), paint time and paint interval (the page's own record, testMode only), content frames
// drawn against those due, late and skipped frames and measured refresh from the reports, and the output renderer's
// and the GPU process's memory before opening and while live. Then the 2D canvas limits, in their own window.
//
// The window is hidden: Chromium still produces frames for it (backgroundThrottling off), but its refresh isn't a
// real display's vsync. Frame-rate numbers are this window's, not a panel's; O9 checks cadence on a real display.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');

const SECONDS = Number(process.env.PIXELLAB_O8_SECONDS) || 30;

module.exports = async function o8Limits(api) {
  assert.ok(api.mode && !api.mode.visible, 'hidden smoke run only');
  const { app } = require('electron');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const control = script => api.control.webContents.executeJavaScript(script);
  const until = async (predicate, ms, what) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = await predicate(); if (v) return v; await sleep(25); }
    assert.fail(`timed out waiting for ${what}`);
  };
  const sh = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8' }).trim(); } catch { return null; } };
  const displays = await control('window.pixelLabDesktop.output.listDisplays()');
  const display = displays.find(d => d.electronId === api.virtualDisplayId);
  assert.ok(display, 'virtual display listed in a hidden run');

  const gpu = await app.getGPUInfo('basic').catch(() => null);
  const environment = {
    model: sh('sysctl', ['-n', 'hw.model']), cpu: sh('sysctl', ['-n', 'machdep.cpu.brand_string']), memoryGiB: Math.round(os.totalmem() / 2 ** 30),
    macOS: sh('sw_vers', ['-productVersion']), electron: process.versions.electron, chrome: process.versions.chrome,
    gpu: gpu && gpu.gpuDevice ? gpu.gpuDevice.map(d => d.deviceString || `${d.vendorId}:${d.deviceId}`).filter(Boolean) : null,
    display: { devicePx: display.devicePx, scaleFactor: display.scaleFactor, refreshHz: display.refreshHz },
  };

  const projectText = fs.readFileSync(path.join(api.repoRoot, 'tests/fixtures/festival-main-stage.pixellab.json'), 'utf8');
  const out = JSON.parse(projectText).project.output.outputs[0];
  const depth = JSON.parse(fs.readFileSync(path.join(api.repoRoot, 'tests/fixtures/depth-emerald-chamber.json'), 'utf8'));
  const SOURCES = [
    { label: 'calibration test card', id: 'calibration-test-card', settings: { mode: 'identification', logo: 'center' } },
    { label: 'pixel grid', id: 'pixel-grid', settings: { space: 'master', motion: true } },
    { label: 'Depth Studio', id: 'depth-scene', settings: depth },
  ];

  /** Renderer memory of a webContents and the GPU process, in MiB, from app.getAppMetrics(). */
  function memory(webContents) {
    const metrics = app.getAppMetrics();
    const mib = kb => Math.round((kb / 1024) * 10) / 10;
    const pid = webContents ? webContents.getOSProcessId() : null;
    const renderer = pid ? metrics.find(m => m.pid === pid) : null;
    const gpuProc = metrics.find(m => m.type === 'GPU');
    return {
      rendererWorkingSetMiB: renderer ? mib(renderer.memory.workingSetSize) : null,
      rendererPeakWorkingSetMiB: renderer ? mib(renderer.memory.peakWorkingSetSize) : null,
      gpuWorkingSetMiB: gpuProc ? mib(gpuProc.memory.workingSetSize) : null,
      gpuPeakWorkingSetMiB: gpuProc ? mib(gpuProc.memory.peakWorkingSetSize) : null,
    };
  }
  const pct = (list, p) => { if (!list.length) return null; const s = [...list].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 100) / 100; };

  const runs = [];
  for (const source of process.env.PIXELLAB_O8_ONLY === 'limits' ? [] : SOURCES) {
    for (const fps of [30, 60]) {
      const before = memory(null);
      const t0 = Date.now();
      const epochMs = performance.timeOrigin + performance.now();
      const session = { revision: 1, projectText, outputId: out.id, source: { id: source.id, settings: source.settings }, clock: { state: 'playing', fps, startFrame: 0, epochMs } };
      await control(`window.pixelLabDesktop.output.open(${JSON.stringify({ outputId: out.id, display: display.key, session })})`);
      const state = await until(() => { const s = api.outputs.status(out.id).state; return s === 'live' || s === 'failed' ? s : null; }, 10000, 'live');
      assert.equal(state, 'live', JSON.stringify(api.outputs.status(out.id).error));
      const firstFrameMs = Date.now() - t0;
      const window = api.windows.output(out.id);
      assert.equal(window.isVisible(), false, 'never shown');
      await sleep(2000);   // warm up: caches, shaders, the GPU path
      await window.webContents.executeJavaScript('window.__pixelLabOutputStats()');
      const reports = [];
      let lastReport = null;
      const startFrame = api.outputs.status(out.id).render.frame;
      const tStart = Date.now();
      while (Date.now() - tStart < SECONDS * 1000) {
        await sleep(250);
        const r = api.outputs.status(out.id).render;
        if (r && r !== lastReport) { reports.push(r); lastReport = r; }
      }
      const elapsed = (Date.now() - tStart) / 1000;
      const stats = await window.webContents.executeJavaScript('window.__pixelLabOutputStats()');
      const endFrame = api.outputs.status(out.id).render.frame;
      const live = memory(window.webContents);
      await control(`window.pixelLabDesktop.output.close('${out.id}')`);
      await until(() => api.outputs.status(out.id).state === 'closed' && api.windows.outputIds().length === 0, 5000, 'closed');
      const due = Math.round(elapsed * fps);
      const drawn = stats.paintMs.length;
      const errors = [...new Set(reports.map(r => r.errorCode).filter(Boolean))];
      const late = reports.reduce((n, r) => n + r.lateFrames, 0);
      const skipped = reports.reduce((n, r) => n + r.skippedFrames, 0);
      const measuredHz = reports.map(r => r.cadence && r.cadence.measuredHz).filter(Boolean);
      runs.push({
        source: source.label, fps, firstFrameMs, seconds: Math.round(elapsed * 10) / 10,
        contentFrames: { due, drawn, advanced: endFrame - startFrame, heldPercent: Math.round((1000 * drawn) / due) / 10 },
        paintMs: { median: pct(stats.paintMs, 0.5), p99: pct(stats.paintMs, 0.99), max: pct(stats.paintMs, 1) },
        paintIntervalMs: { median: pct(stats.intervalsMs, 0.5), p99: pct(stats.intervalsMs, 0.99), max: pct(stats.intervalsMs, 1) },
        browserFps: pct(reports.map(r => r.browserFps), 0.5), measuredHz: pct(measuredHz, 0.5), lateFrames: late, skippedFrames: skipped,
        limits: lastReport && lastReport.limits, errors,
        memoryMiB: { before, live },
      });
    }
  }

  // 2D canvas limits, in their own window: a side and an area just at and just past Chromium's, with a pixel
  // round-trip in the far corner. 268 Mpx is about 1 GiB of RGBA; the window is closed right after.
  const limitSession = { revision: 1, projectText, outputId: out.id, source: { id: 'pixel-grid', settings: { space: 'master', motion: false } }, clock: { state: 'paused', frame: 0 } };
  await control(`window.pixelLabDesktop.output.open(${JSON.stringify({ outputId: out.id, display: display.key, session: limitSession })})`);
  await until(() => api.outputs.status(out.id).state === 'live', 10000, 'live for the canvas limits');
  const limitWindow = api.windows.output(out.id);
  const canvasLimits = await limitWindow.webContents.executeJavaScript(`(() => {
    const probe = (w, h) => {
      try {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const g = c.getContext('2d');
        if (!g) return { w, h, ok: false, why: 'no context' };
        g.fillStyle = '#0a0b0c'; g.fillRect(w - 1, h - 1, 1, 1);
        const p = [...g.getImageData(w - 1, h - 1, 1, 1).data.slice(0, 3)];
        const ok = p[0] === 10 && p[1] === 11 && p[2] === 12;
        c.width = 0; c.height = 0;
        return { w, h, ok, why: ok ? null : 'pixel round-trip ' + p.join(',') };
      } catch (e) { return { w, h, ok: false, why: String(e && e.message || e) }; }
    };
    // Side, with a height of 1 (area no object), then the area at Chromium's 268,435,456 px, then a square side.
    return [probe(32767, 1), probe(32768, 1), probe(65535, 1), probe(65536, 1), probe(131072, 1), probe(1048576, 1),
      probe(32767, 8192), probe(32767, 8193), probe(16384, 16384), probe(16385, 16384)];
  })()`);
  await control(`window.pixelLabDesktop.output.close('${out.id}')`);
  await until(() => api.outputs.status(out.id).state === 'closed' && api.windows.outputIds().length === 0, 5000, 'closed');

  return { environment, seconds: SECONDS, runs, canvasLimits };
};
