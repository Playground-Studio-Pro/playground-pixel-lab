// Live adjust, step 1: what one output:update costs today, and what 30 updates a second do. Hidden smoke runs only.
//   npm --prefix desktop run build:web
//   npm --prefix desktop run test:smoke -- --smoke-script=desktop/tests/smoke-scripts/live-update-cost.cjs
// Optional: PIXELLAB_LIVE_N (default 40) sequential updates per case, PIXELLAB_LIVE_RATE_S (default 30) for the rate run.
//
// Projects: live-update-fixture.cjs, 8, 32 and 60 screens on a fixed 1920 × 1080 master and output. Each update moves
// screen 1 by 1 px (and back on the next one) and carries the same clock, as the panel's updateClock does.
//
// Times are on the shared clock (performance.timeOrigin + performance.now(), the same in every process; PHYSICAL_OUTPUT
// section 4). For each update:
//   t0     the control page, just before window.pixelLabDesktop.output.update()
//   ack    the invoke resolves: main validated the session and forwarded it
//   arrive the output page starts JSON.parse of that revision's project text (a test-only wrapper, see below)
//   paint  the output page starts painting the canvas after the swap (a test-only wrapper on fillRect)
//   drawn  paint + that paint's duration (the page's own __pixelLabOutputStats)
// "drawn" is the end of the page's work for that frame. The frame reaches the panel at the next vsync and the
// compositor after that: not measurable in a hidden window (no real vsync, no glass). Add about one refresh.
//
// The wrappers are installed with executeJavaScript in this hidden run only. They observe and call through; they
// change nothing the page does. In the rate run a paint is matched to the newest revision whose parse started before it:
// exact while a session is prepared before the next frame, which the sequential runs check (arrive → paint).
const path = require('node:path');
const assert = require('node:assert/strict');
const { liveProject, movedText, COUNTS } = require('./live-update-fixture.cjs');

const N = Number(process.env.PIXELLAB_LIVE_N) || 40;
const RATE_S = Number(process.env.PIXELLAB_LIVE_RATE_S) || 30;
const SOURCES = [
  { label: 'test card', id: 'calibration-test-card', settings: { mode: 'identification', logo: 'center' } },
  { label: 'pixel grid', id: 'pixel-grid', settings: { space: 'master', motion: false } },
];

const HOOK = `(() => {
  if (window.__live) return true;
  const now = () => performance.timeOrigin + performance.now();
  const L = window.__live = { parses: [], paints: [] };
  const parse = JSON.parse;
  JSON.parse = function (text, reviver) {
    if (typeof text === 'string' && text.startsWith('{\\n  "format": "playground-pixel-lab/project"')) {
      const t = now(); const v = parse.call(this, text, reviver); L.parses.push({ rev: v.project.meta.revision, t, ms: now() - t }); return v;
    }
    return parse.call(this, text, reviver);
  };
  const fill = CanvasRenderingContext2D.prototype.fillRect;
  CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
    const c = this.canvas;
    if (c && c.hasAttribute && c.hasAttribute('data-output') && x === 0 && y === 0 && w === c.width && h === c.height) {
      const t = now(); if (!L.paints.length || t - L.paints[L.paints.length - 1] > 1) L.paints.push(t);
    }
    return fill.call(this, x, y, w, h);
  };
  return true;
})()`;

module.exports = async function liveUpdateCost(api) {
  assert.ok(api.mode && !api.mode.visible, 'hidden smoke run only');
  const { app } = require('electron');
  const { validateSession } = require(path.join(api.repoRoot, 'desktop/src/output-ipc.cjs'));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const control = script => api.control.webContents.executeJavaScript(script);
  const until = async (predicate, ms, what) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = await predicate(); if (v) return v; await sleep(5); }
    assert.fail(`timed out waiting for ${what}`);
  };
  const pct = (list, p) => { if (!list.length) return null; const s = [...list].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10; };
  const summary = list => ({ p50: pct(list, 0.5), p95: pct(list, 0.95), max: pct(list, 1) });
  const sharedNow = () => performance.timeOrigin + performance.now();
  const rendererMiB = wc => { const m = app.getAppMetrics().find(x => x.pid === wc.getOSProcessId()); return m ? Math.round(m.memory.workingSetSize / 102.4) / 10 : null; };

  const displays = await control('window.pixelLabDesktop.output.listDisplays()');
  const display = displays.find(d => d.electronId === api.virtualDisplayId);
  assert.ok(display, 'virtual display listed in a hidden run');

  async function openOn(fixture, source, clock) {
    const session = { revision: 1, projectText: movedText(fixture, 1), outputId: fixture.outputId, source: { id: source.id, settings: source.settings }, clock };
    await control(`window.pixelLabDesktop.output.open(${JSON.stringify({ outputId: fixture.outputId, display: display.key, session })})`);
    const state = await until(() => { const s = api.outputs.status(fixture.outputId).state; return s === 'live' || s === 'failed' ? s : null; }, 10000, 'live');
    assert.equal(state, 'live', JSON.stringify(api.outputs.status(fixture.outputId).error));
    const window = api.windows.output(fixture.outputId);
    assert.equal(window.isVisible(), false, 'never shown');
    assert.equal(await window.webContents.executeJavaScript(HOOK), true);
    await window.webContents.executeJavaScript('window.__pixelLabOutputStats()');
    return window;
  }
  async function closeOutput(fixture) {
    await control(`window.pixelLabDesktop.output.close('${fixture.outputId}')`);
    await until(() => api.outputs.status(fixture.outputId).state === 'closed' && api.windows.outputIds().length === 0, 5000, 'closed');
  }
  const sessionOf = (fixture, source, revision, clock) => ({ revision, projectText: movedText(fixture, revision), outputId: fixture.outputId, source: { id: source.id, settings: source.settings }, clock });
  const sendTimed = session => control(`(async () => { const now = () => performance.timeOrigin + performance.now();
    const s = ${JSON.stringify(session)}; const t0 = now();
    await window.pixelLabDesktop.output.update(s.outputId, s); return [t0, now()]; })()`);

  // ── Main's share: validateSession (the same checks as output:open, incl. one JSON.parse of the project) ──────
  const mainValidate = {};
  for (const count of COUNTS) {
    const fixture = liveProject(count);
    const session = sessionOf(fixture, SOURCES[0], 2, { state: 'paused', frame: 0 });
    for (let i = 0; i < 20; i++) validateSession(session, { expectedOutputId: fixture.outputId });
    const ms = [];
    for (let i = 0; i < 200; i++) { const t = performance.now(); validateSession(session, { expectedOutputId: fixture.outputId }); ms.push(performance.now() - t); }
    mainValidate[count] = { projectBytes: Buffer.byteLength(session.projectText), ...summary(ms) };
  }

  // ── 1. Sequential: one update, wait for it on the canvas, a random pause, the next ─────────────────────────────
  const sequential = [];
  for (const count of COUNTS) {
    const fixture = liveProject(count);
    for (const source of SOURCES) {
      const clock = { state: 'paused', frame: 0 };   // paused: the page paints only when a new revision swaps in
      const window = await openOn(fixture, source, clock);
      const rows = [];
      for (let rev = 2; rev < 2 + 3 + N; rev++) {
        const before = await window.webContents.executeJavaScript('window.__live.paints.length');
        const [t0, ack] = await sendTimed(sessionOf(fixture, source, rev, clock));
        await until(() => window.webContents.executeJavaScript(`window.__live.paints.length > ${before}`), 3000, `revision ${rev} painted`);
        const live = await window.webContents.executeJavaScript(`(() => { const L = window.__live; return { paint: L.paints[L.paints.length - 1], parse: L.parses.filter(p => p.rev === ${rev}).pop() || null, stats: window.__pixelLabOutputStats() }; })()`);
        const paintMs = live.stats.paintMs[live.stats.paintMs.length - 1] ?? 0;
        if (rev >= 5) rows.push({ ack: ack - t0, arrive: live.parse ? live.parse.t - t0 : null, parseMs: live.parse ? live.parse.ms : null, paint: live.paint - t0, drawn: live.paint + paintMs - t0, paintMs });
        await sleep(20 + Math.random() * 40);
      }
      const status = api.outputs.status(fixture.outputId);
      assert.equal(status.state, 'live');
      assert.equal(status.error, null, JSON.stringify(status.error));
      await closeOutput(fixture);
      const of = k => rows.map(r => r[k]).filter(v => v !== null);
      sequential.push({ screens: count, source: source.label, updates: rows.length, ackMs: summary(of('ack')), arriveMs: summary(of('arrive')), parseMs: summary(of('parseMs')), paintStartMs: summary(of('paint')), drawnMs: summary(of('drawn')), paintMs: summary(of('paintMs')) });
    }
  }

  // ── 2. Rate: 30 updates a second for RATE_S seconds, sent without waiting, 60 screens ───────────────────────────
  const rate = [];
  const fixture60 = liveProject(60);
  for (const source of SOURCES) {
    const clock = { state: 'paused', frame: 0 };
    const window = await openOn(fixture60, source, clock);
    const memBefore = rendererMiB(window.webContents);
    const total = Math.round(RATE_S * 30);
    const sessions = Array.from({ length: total }, (_, i) => sessionOf(fixture60, source, i + 2, clock));
    await control(`window.__liveSessions = ${JSON.stringify(sessions)}`);
    const sent = await control(`new Promise(resolve => {
      const now = () => performance.timeOrigin + performance.now();
      const list = window.__liveSessions, out = [], errors = []; let i = 0, done = 0; const start = now();
      const tick = () => {
        while (i < list.length && now() >= start + i * (1000 / 30)) {
          const s = list[i++], t0 = now(); out.push({ rev: s.revision, t0 });
          window.pixelLabDesktop.output.update(s.outputId, s).then(() => { out.find(o => o.rev === s.revision).ack = now() - t0; }, e => errors.push(String(e && e.message || e))).finally(() => { if (++done === list.length) { delete window.__liveSessions; resolve({ out, errors }); } });
        }
        if (i < list.length) setTimeout(tick, Math.max(0, start + i * (1000 / 30) - now()));
      };
      tick();
    })`);
    await sleep(500);
    const live = await window.webContents.executeJavaScript('({ parses: window.__live.parses, paints: window.__live.paints, stats: window.__pixelLabOutputStats() })');
    const memAfter = rendererMiB(window.webContents);
    const status = api.outputs.status(fixture60.outputId);
    await closeOutput(fixture60);
    const t0 = new Map(sent.out.map(o => [o.rev, o.t0]));
    const firstT0 = sent.out[0].t0;
    const parses = live.parses.filter(p => t0.has(p.rev));
    const drawn = [];
    for (const paint of live.paints.filter(t => t > firstT0)) {
      const rev = parses.filter(p => p.t < paint).reduce((m, p) => Math.max(m, p.rev), -1);
      if (rev > 0 && !drawn.some(d => d.rev === rev)) drawn.push({ rev, latency: paint - t0.get(rev) });
    }
    const spanS = (sent.out[sent.out.length - 1].t0 - firstT0) / 1000;
    rate.push({
      screens: 60, source: source.label, seconds: Math.round(spanS * 10) / 10, sent: sent.out.length, sentPerSecond: Math.round((sent.out.length - 1) / spanS * 10) / 10,
      rejected: sent.errors.length, rejectedExample: sent.errors[0] || null,
      parsedByPage: parses.length, revisionsPainted: drawn.length, neverPainted: sent.out.length - drawn.length,
      ackMs: summary(sent.out.map(o => o.ack).filter(v => v !== undefined)), sendToPaintMs: summary(drawn.map(d => d.latency)),
      paintMs: summary(live.stats.paintMs), finalRevisionOnScreen: status.sessionRevision, lastSent: sent.out[sent.out.length - 1].rev,
      rendererMiB: { before: memBefore, after: memAfter }, statusError: status.error,
    });
  }

  // ── 3. Clock: a playing output keeps its frame through updates (1 a second, then 30 a second), 60 screens ──────
  const fps = 30;
  const epochMs = sharedNow();
  const playing = { state: 'playing', fps, startFrame: 0, epochMs };
  await openOn(fixture60, SOURCES[0], playing);
  const samples = [];
  let revision = 1, lastReport = null;
  const sample = () => {
    const s = api.outputs.status(fixture60.outputId);
    if (s.render && s.render !== lastReport) { lastReport = s.render; samples.push({ at: sharedNow(), frame: s.render.frame, rev: s.render.sessionRevision, skipped: s.render.skippedFrames, repeated: s.render.cadence ? s.render.cadence.repeated : null, late: s.render.lateFrames }); }
  };
  const phases = [{ name: 'no updates', seconds: 5, perSecond: 0 }, { name: '1 update a second', seconds: 10, perSecond: 1 }, { name: '30 updates a second', seconds: 10, perSecond: 30 }];
  const clockPhases = [];
  for (const phase of phases) {
    const from = samples.length, firstRev = revision;
    const end = Date.now() + phase.seconds * 1000;
    let next = Date.now();
    while (Date.now() < end) {
      if (phase.perSecond && Date.now() >= next) {
        revision++;
        const s = sessionOf(fixture60, SOURCES[0], revision, playing);
        void control(`window.pixelLabDesktop.output.update(${JSON.stringify(s.outputId)}, ${JSON.stringify(s)})`);
        next += 1000 / phase.perSecond;
      }
      sample();
      await sleep(phase.perSecond === 30 ? 5 : 20);
    }
    const got = samples.slice(from);
    // Expected frame at the moment main held the report is unknown to ±1 report interval; compare against the clock at
    // sampling time, which can only be ahead of the drawn frame. A restart would show as a drop to near 0.
    const behind = got.map(g => Math.floor((g.at - epochMs) * fps / 1000) - g.frame);
    clockPhases.push({
      phase: phase.name, reports: got.length, updatesSent: revision - firstRev,
      revisionsSeen: [...new Set(got.map(g => g.rev))].length,
      framesBehindClock: { min: Math.min(...behind), max: Math.max(...behind) },
      frameEverWentBack: got.some((g, i) => i > 0 && g.frame < got[i - 1].frame),
      skipped: got.reduce((n, g) => n + g.skipped, 0), repeated: got.reduce((n, g) => n + (g.repeated || 0), 0), late: got.reduce((n, g) => n + g.late, 0),
    });
  }
  const finalStatus = api.outputs.status(fixture60.outputId);
  assert.equal(finalStatus.state, 'live');
  await closeOutput(fixture60);

  return { display: { devicePx: display.devicePx, scaleFactor: display.scaleFactor, refreshHz: display.refreshHz }, n: N, mainValidate, sequential, rate, clock: { fps, phases: clockPhases, finalRevisionOnScreen: finalStatus.sessionRevision, lastSent: revision } };
};
