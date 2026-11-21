// Output state machine (Phase C task D5, docs/architecture/PHYSICAL_OUTPUT.md sections 2 and 3).
// Pure: no Electron import. main.cjs passes in the window operations, the display list, the sleep blocker and the
// status push, and forwards window events (ready, report, load failure, closed) here.
//
// D5: closed → opening → live, opening → failed (LOAD_FAILED / OPEN_TIMEOUT), any → closed (Close, Esc, quit).
// D8: renderer gone or hung → failed (RENDERER_GONE / RENDERER_UNRESPONSIVE), hung → answering again → back,
// failed → retry → opening, and a first-frame timeout after ready.
// D7: display removed → waiting-display (hidden, clock paused); same display back with a reliable match (D-2) → held,
// shown on the paused frame; output:resume → live. Never automatic playback after a disconnect. Metrics changes
// re-place the window and send output:display.
// Update: output:update replaces the session of an open output without recreating its window (section 4). The page
// prepares it to the side and swaps when ready; the state stays as it is.
const {
  validateOpenRequest, validateSession, validateReport, outputIdOrAll, oneToOne, sizeMatchOf, OutputIpcError, MAX_OUTPUTS,
} = require('./output-ipc.cjs');
const { matchDisplay, reliableMatch } = require('./displays.cjs');

const OPEN_TIMEOUT_MS = 10000;        // section 2: no output:ready within 10 s → OPEN_TIMEOUT
const FIRST_FRAME_TIMEOUT_MS = 10000; // ready but no first frame within 10 s more → OPEN_TIMEOUT too
const PROBE_INTERVAL_MS = 1000;       // main asks the renderer for a trivial answer this often
const UNRESPONSIVE_MS = 5000;         // section 2: unresponsive for 5 s → RENDERER_UNRESPONSIVE
const MIN_REPORT_INTERVAL_MS = 450;   // section 3: at most 2 reports per second
const SLEEP_BLOCKER_TYPE = 'prevent-display-sleep';

/**
 * @param deps.listDisplays () => DisplayInfo[]
 * @param deps.openWindow (outputId, display) => void   creates the hidden window at display.boundsDip and loads the fixed URL
 * @param deps.showWindow (outputId, display) => void   places it on the display, full screen, shown inactive
 * @param deps.closeWindow (outputId) => void           destroys it; main then calls onClosed(outputId)
 * @param deps.sendSession (outputId, OutputWindowSession) => void
 * @param deps.pushStatus (OutputStatus) => void        to the control window
 * @param deps.blocker { start(type) => id, stop(id) }   Electron's powerSaveBlocker
 * @param deps.reloadWindow (outputId) => void          loads the fixed URL again (retry)
 * @param deps.probe (outputId) => Promise               settles when the renderer's main thread answers
 * @param deps.hideWindow (outputId) => void            leaves full screen and hides it, renderer kept (D7)
 * @param deps.sendClock (outputId, OutputClock) => void
 * @param deps.sendDisplay (outputId, DisplayInfo) => void
 * @param deps.sharedNow () => number                   performance.timeOrigin + performance.now(), the clock epochs use
 *
 * Hang detection uses main's own probe, not Electron's `unresponsive` event: measured on Electron 43, a page hung for
 * 25 s never raised `unresponsive`, with or without synthetic input, and an output window gets no real input.
 */
function createOutputController({
  listDisplays, openWindow, showWindow, closeWindow, sendSession, pushStatus, blocker,
  reloadWindow = () => {}, probe = () => new Promise(() => {}),
  hideWindow = () => {}, sendClock = () => {}, sendDisplay = () => {},
  sharedNow = () => performance.timeOrigin + performance.now(),
  timers = { setTimeout, clearTimeout }, now = Date.now, maxOutputs = MAX_OUTPUTS,
}) {
  const records = new Map();   // outputId → record
  let blockerId = null;

  // One blocker for every output, held while at least one is live or held (section 2, "Sleep"). Held keeps it: the
  // window is on the monitor showing the paused frame, and a sleeping display would black out the wall. Waiting-display
  // releases it: there is no monitor to keep awake.
  const keepsDisplayAwake = r => r.state === 'live' || r.state === 'held';
  function syncBlocker() {
    const awake = [...records.values()].some(keepsDisplayAwake);
    if (awake && blockerId === null) blockerId = blocker.start(SLEEP_BLOCKER_TYPE);
    else if (!awake && blockerId !== null) { blocker.stop(blockerId); blockerId = null; }
  }

  function statusOf(r) {
    const drawn = r.render && r.render.firstFrameDrawn ? r.render : null;
    return {
      outputId: r.outputId,
      state: r.state,
      display: r.state === 'waiting-display' ? null : r.display,
      sessionRevision: drawn ? drawn.sessionRevision : null,
      ...sizeMatchOf(drawn ? drawn.outputPx : null, r.display ? r.display.devicePx : null),
      reconnected: r.reconnected,
      render: r.render,
      error: r.renderError || r.oneToOneError || r.error,
    };
  }
  const closedStatus = (outputId, error = null) => ({
    outputId, state: 'closed', display: null, sessionRevision: null, sizeMatch: 'unknown', croppedPx: null, blackPx: null,
    reconnected: false, render: null, error,
  });
  const push = r => pushStatus(statusOf(r));
  const clearTimer = r => { if (r.timer !== null) { timers.clearTimeout(r.timer); r.timer = null; } };

  function fail(r, code, message) {
    if (r.state !== 'opening' && r.state !== 'live' && r.state !== 'held' && !(r.state === 'failed' && code === 'RENDERER_GONE')) return;
    r.reconnected = false;
    clearTimer(r);
    r.failedFrom = r.state === 'failed' ? r.failedFrom : r.state;
    r.state = 'failed';
    r.renderError = null;
    r.error = { code, message };
    showWindow(r.outputId, r.display);   // D-1: a black full-screen window, never the desktop
    syncBlocker();
    push(r);
  }

  // Section 5 item 4: the first report after live, until the page has observed its content box.
  function checkOneToOne(r, report) {
    if (r.oneToOne && r.oneToOne !== 'pending') return;
    const result = oneToOne(r.display, report);
    r.oneToOne = result.status;
    r.oneToOneError = result.status === 'error' ? { code: 'NOT_ONE_TO_ONE', message: result.problems.join('; ') } : null;
  }

  function goLive(r, report) {
    clearTimer(r);
    r.state = 'live';
    r.error = null;
    showWindow(r.outputId, r.display);
    syncBlocker();
    checkOneToOne(r, report);
    push(r);
  }

  // Every second: probe the renderer if no probe is pending, and fail a live output that hasn't answered for 5 s.
  function watch(r) {
    r.watchdog = timers.setTimeout(() => {
      if (records.get(r.outputId) !== r) return;
      if (!r.probing) {
        r.probing = true;
        Promise.resolve().then(() => probe(r.outputId)).then(() => { r.probing = false; alive(r); }, () => { r.probing = false; });
      }
      if (r.state === 'live' && now() - r.aliveAt >= UNRESPONSIVE_MS) {
        fail(r, 'RENDERER_UNRESPONSIVE', `The output page has not answered for ${Math.round((now() - r.aliveAt) / 1000)} s`);
      }
      watch(r);
    }, PROBE_INTERVAL_MS);
  }
  function alive(r) {
    if (records.get(r.outputId) !== r) return;
    r.aliveAt = now();
    // Section 2: responsive after a hang → back to live (the frozen frame starts moving again).
    if (r.state === 'failed' && r.error && r.error.code === 'RENDERER_UNRESPONSIVE' && r.failedFrom === 'live') {
      r.state = 'live';
      r.error = null;
      syncBlocker();
      push(r);
    }
  }

  // ── D7: displays ───────────────────────────────────────────────────────────
  const frameAt = (clock, t) => clock.state === 'paused' ? clock.frame : clock.startFrame + Math.max(0, Math.floor((t - clock.epochMs) * clock.fps / 1000));
  const sameRect = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  const geometryChanged = (a, b) => !sameRect(a.boundsDip, b.boundsDip) || a.scaleFactor !== b.scaleFactor
    || a.devicePx.width !== b.devicePx.width || a.devicePx.height !== b.devicePx.height || a.rotation !== b.rotation;
  const setClock = (r, clock) => { r.session = { ...r.session, clock }; sendClock(r.outputId, clock); };
  const sameError = (a, b) => (a && a.code) === (b && b.code);

  // Section 2, "Display removed": hide at once (or the OS moves the window onto the operator's screen), keep the
  // renderer, pause the clock at the frame on screen.
  function displayRemoved(r) {
    if (r.state === 'opening' || r.state === 'failed') {
      // Not covered by the state table: nothing is playing, so the output closes and the control window is told why.
      r.closeError = { code: 'DISPLAY_NOT_FOUND', message: `The output's display (${r.display.label || 'unnamed'}) was disconnected` };
      closeWindow(r.outputId);
      return;
    }
    if (r.state === 'live') {
      const clock = r.session.clock;
      r.pausedFrame = frameAt(clock, sharedNow());
      r.resumeFps = clock.state === 'playing' ? clock.fps : null;   // what resume restores; held keeps the earlier value
    }
    hideWindow(r.outputId);
    setClock(r, { state: 'paused', frame: r.pausedFrame });
    r.state = 'waiting-display';
    r.reconnected = false;
    r.error = null;
    syncBlocker();
    push(r);
  }

  // Section 2, "Display back", owner decision D-2: restore only on a reliable match, paused, and wait for resume.
  function tryReconnect(r, list) {
    const match = reliableMatch(r.key, list);
    const taken = match.display && [...records.values()].some(o => o !== r && o.state !== 'waiting-display' && o.display.electronId === match.display.electronId);
    let error = null;
    if (match.display && !taken && match.display.hostsControlWindow && !r.allowControlDisplay) {
      error = { code: 'CONTROL_DISPLAY', message: `${match.display.label || 'The display'} is back but shows the Pixel Lab window` };
    } else if (match.display && !taken) {
      r.display = match.display;
      r.key = match.display.key;
      r.oneToOne = null;
      r.oneToOneError = null;
      if (r.gone) {   // the renderer died while the display was away: back on its display, black, as failed
        r.state = 'failed';
        r.failedFrom = 'live';
        r.error = r.gone;
        r.gone = null;
        showWindow(r.outputId, r.display);
      } else {
        r.state = 'held';
        r.reconnected = true;
        r.error = null;
        showWindow(r.outputId, r.display);
        sendDisplay(r.outputId, r.display);
      }
      syncBlocker();
      push(r);
      return;
    } else if (taken || match.reason === 'ambiguous' || list.some(d => d.label && d.label === r.key.label)) {
      // Identical twins, a shared empty label, or the same name at another size: never guessed (D-2).
      error = { code: 'DISPLAY_AMBIGUOUS', message: `A display like ${r.key.label || 'the output display'} is connected, but it can't be identified reliably; pick the display again or close the output` };
    }
    if (!sameError(error, r.error)) { r.error = error; push(r); }
  }

  // Section 2, "Metrics changed": re-place, tell the page, re-run the 1:1 check. Never rescale content.
  function metricsChanged(r, current) {
    r.display = current;
    r.key = current.key;
    r.oneToOne = null;
    r.oneToOneError = null;
    if (r.state === 'live' || r.state === 'held' || r.state === 'failed') showWindow(r.outputId, current);
    if (r.sessionSent) sendDisplay(r.outputId, current);
    push(r);
  }

  return {
    /** output:open. Throws OutputIpcError with the section 3 code; returns the opening status. */
    open(payload) {
      const request = validateOpenRequest(payload);
      const id = request.outputId;
      if (records.has(id)) throw new OutputIpcError('ALREADY_OPEN', `Output ${id} is already open`);
      if (records.size >= maxOutputs) throw new OutputIpcError('TOO_MANY_OUTPUTS', `At most ${maxOutputs} output${maxOutputs === 1 ? '' : 's'} can be open`);
      // The key comes straight from output:list-displays, so it must match one display exactly (section 1, level 1).
      const { level, candidates } = matchDisplay(request.display, listDisplays());
      if (level !== 1 || candidates.length !== 1) throw new OutputIpcError('DISPLAY_NOT_FOUND', 'That display is no longer connected');
      const display = candidates[0];
      const busy = [...records.values()].find(r => r.state !== 'waiting-display' && r.display.electronId === display.electronId);
      if (busy) throw new OutputIpcError('DISPLAY_BUSY', `Output ${busy.outputId} is already on that display`);
      if (display.hostsControlWindow && request.allowControlDisplay !== true) throw new OutputIpcError('CONTROL_DISPLAY', 'That display shows the Pixel Lab window');
      const r = {
        outputId: id, state: 'opening', display, session: request.session, sessionSent: false,
        render: null, reportAt: -Infinity, error: null, renderError: null, oneToOne: null, oneToOneError: null, timer: null,
        aliveAt: now(), probing: false, watchdog: null, failedFrom: null,
        key: display.key, allowControlDisplay: request.allowControlDisplay === true, reconnected: false,
        pausedFrame: null, resumeFps: null, gone: null, closeError: null,
      };
      records.set(id, r);
      try { openWindow(id, display); } catch (error) { records.delete(id); throw error; }
      r.timer = timers.setTimeout(() => fail(r, 'OPEN_TIMEOUT', 'The output page did not report ready within 10 s'), OPEN_TIMEOUT_MS);
      watch(r);
      push(r);
      return statusOf(r);
    },

    /**
     * output:update. A new session for an open output, same window. Accepted in opening, live and failed; the revision
     * must go up (BAD_REQUEST); an output that isn't open, or '*', is UNKNOWN_OUTPUT. Main keeps it as the latest session (a retry re-sends it) and forwards it at once if the page already
     * has a session; otherwise output:ready sends it. Refused in waiting-display and held, so a new session can never
     * restart playback before output:resume (D-2). The state doesn't change: a session the page can't prepare comes
     * back as a report errorCode while the previous one keeps playing (section 2, "Renderer failure").
     */
    update(target, session) {
      const id = outputIdOrAll(target);
      if (id === '*') throw new OutputIpcError('UNKNOWN_OUTPUT', 'update takes one open output id, not "*"');
      validateSession(session, { expectedOutputId: id });
      const r = records.get(id);
      if (!r) throw new OutputIpcError('UNKNOWN_OUTPUT', `Output ${id} is not open`);
      if (r.state === 'waiting-display' || r.state === 'held') {
        throw new OutputIpcError('BAD_REQUEST', `Output ${id} is ${r.state}: resume it before updating`);
      }
      if (session.revision <= r.session.revision) {
        throw new OutputIpcError('BAD_REQUEST', `session.revision must be greater than ${r.session.revision}`);
      }
      r.session = session;
      if (r.sessionSent) {
        sendSession(id, { ...session, display: r.display });
        // Opening waits for a first frame of this revision; give the page the full first-frame time for it.
        if (r.state === 'opening') { clearTimer(r); r.timer = timers.setTimeout(() => fail(r, 'OPEN_TIMEOUT', 'The output page reported ready but drew no first frame within 10 s'), FIRST_FRAME_TIMEOUT_MS); }
      }
      return statusOf(r);
    },

    /** output:retry. Only from failed: one reload of the fixed URL; the latest session is re-sent on ready. */
    retry(target) {
      const id = outputIdOrAll(target);
      if (id === '*') throw new OutputIpcError('BAD_REQUEST', 'retry takes one output id');
      const r = records.get(id);
      if (!r || r.state !== 'failed') return this.status(id);
      clearTimer(r);
      Object.assign(r, {
        state: 'opening', sessionSent: false, render: null, reportAt: -Infinity, error: null, renderError: null,
        oneToOne: null, oneToOneError: null, aliveAt: now(), failedFrom: null, probing: false,
      });
      r.timer = timers.setTimeout(() => fail(r, 'OPEN_TIMEOUT', 'The output page did not report ready within 10 s'), OPEN_TIMEOUT_MS);
      reloadWindow(id);
      push(r);
      return statusOf(r);
    },

    /**
     * output:resume. Only from held (D-2): playback restarts from the paused frame with a new epoch, or stays paused
     * if the output was paused when its display went away.
     */
    resume(target) {
      const id = outputIdOrAll(target);
      if (id === '*') throw new OutputIpcError('BAD_REQUEST', 'resume takes one output id');
      const r = records.get(id);
      if (!r || r.state !== 'held') throw new OutputIpcError('NOT_RESUMABLE', `Output ${id} is not waiting to resume`);
      setClock(r, r.resumeFps
        ? { state: 'playing', fps: r.resumeFps, startFrame: r.pausedFrame, epochMs: sharedNow() }
        : { state: 'paused', frame: r.pausedFrame });
      r.state = 'live';
      r.reconnected = false;
      r.aliveAt = now();
      syncBlocker();
      push(r);
      return statusOf(r);
    },

    /**
     * The connected displays changed (main calls this at once on display-removed, and debounced on every screen event).
     * Idempotent: the same list twice changes nothing.
     */
    onDisplaysChanged(list) {
      for (const r of [...records.values()]) {
        if (records.get(r.outputId) !== r) continue;
        if (r.state === 'waiting-display') { tryReconnect(r, list); continue; }
        const current = list.find(d => d.electronId === r.display.electronId && d.label === r.display.label && d.internal === r.display.internal);
        if (!current) displayRemoved(r);
        else if (geometryChanged(r.display, current)) metricsChanged(r, current);
        else r.display = current;   // primary or hostsControlWindow may change; nothing to tell the page
      }
    },

    /** output:close. '*' closes every output; an unknown id does nothing. */
    close(target) {
      const id = outputIdOrAll(target);
      for (const outputId of id === '*' ? [...records.keys()] : [id]) if (records.has(outputId)) closeWindow(outputId);
    },

    statusAll() { return [...records.values()].map(statusOf); },
    status(outputId) { const r = records.get(outputId); return r ? statusOf(r) : closedStatus(outputId); },

    /** electronId → outputId, for DisplayInfo.hostsOutput. */
    outputOnDisplay() { return new Map([...records.values()].filter(r => r.state !== 'waiting-display').map(r => [r.display.electronId, r.outputId])); },
    sleepBlockerId() { return blockerId; },

    // ── Events from main ──────────────────────────────────────────────────────
    /** output:ready from the window registered under outputId: the page listens, so the session goes out. */
    onReady(outputId) {
      const r = records.get(outputId);
      if (!r || (r.state !== 'opening' && r.state !== 'live')) return;
      clearTimer(r);
      sendSession(outputId, { ...r.session, display: r.display });
      r.sessionSent = true;
      r.aliveAt = now();
      if (r.state === 'opening') r.timer = timers.setTimeout(() => fail(r, 'OPEN_TIMEOUT', 'The output page reported ready but drew no first frame within 10 s'), FIRST_FRAME_TIMEOUT_MS);
    },

    /** output:report. Returns false when dropped (rate limit or invalid payload). */
    onReport(outputId, payload) {
      const r = records.get(outputId);
      if (!r) return false;
      const t = now();
      if (t - r.reportAt < MIN_REPORT_INTERVAL_MS) return false;
      let report;
      try { report = validateReport(payload); } catch { return false; }
      r.reportAt = t;
      r.aliveAt = t;
      if (r.state === 'failed') { alive(r); if (r.state === 'failed') return true; }
      r.render = report;
      r.renderError = report.errorCode ? { code: report.errorCode, message: report.error || report.errorCode } : null;
      if (r.state === 'opening') {
        if (report.errorCode && !report.firstFrameDrawn) { r.renderError = null; fail(r, 'LOAD_FAILED', `${report.errorCode}: ${report.error || 'the output page could not prepare the session'}`); return true; }
        if (r.sessionSent && report.firstFrameDrawn && report.sessionRevision === r.session.revision) { goLive(r, report); return true; }
      } else if (r.state === 'live') checkOneToOne(r, report);
      push(r);
      return true;
    },

    /** did-fail-load on the output window's main frame. */
    onLoadFailed(outputId, description) {
      const r = records.get(outputId);
      if (r) fail(r, 'LOAD_FAILED', `The output page failed to load${description ? ` (${description})` : ''}`);
    },

    /** render-process-gone on the output window. The window stays, black (D-1); only retry or close leave failed. */
    onRendererGone(outputId, reason) {
      const r = records.get(outputId);
      if (!r) return;
      const error = { code: 'RENDERER_GONE', message: `The output renderer stopped${reason ? ` (${reason})` : ''}` };
      if (r.state === 'waiting-display') { r.gone = error; r.error = error; push(r); return; }   // shown as failed when the display is back
      fail(r, error.code, error.message);
    },

    /** The window is gone (Close, Esc, quit, or destroyed elsewhere). */
    onClosed(outputId) {
      const r = records.get(outputId);
      if (!r) return;
      clearTimer(r);
      if (r.watchdog !== null) { timers.clearTimeout(r.watchdog); r.watchdog = null; }
      records.delete(outputId);
      syncBlocker();
      pushStatus(closedStatus(outputId, r.closeError));
    },
  };
}

/** Esc on the output window closes it (section 2); zoom keys are swallowed. `input` is Electron's before-input-event Input. */
function outputKeyAction(input) {
  if (!input || input.type !== 'keyDown') return null;
  if (input.key === 'Escape' && !input.meta && !input.control && !input.alt && !input.shift) return 'close';
  if ((input.meta || input.control) && ['+', '=', '-', '_', '0'].includes(input.key)) return 'swallow';
  return null;
}

module.exports = {
  createOutputController, outputKeyAction, OPEN_TIMEOUT_MS, FIRST_FRAME_TIMEOUT_MS, PROBE_INTERVAL_MS, UNRESPONSIVE_MS,
  MIN_REPORT_INTERVAL_MS, SLEEP_BLOCKER_TYPE,
};
