// Output state machine (Phase C task D5, docs/architecture/PHYSICAL_OUTPUT.md sections 2 and 3).
// Pure: no Electron import. main.cjs passes in the window operations, the display list, the sleep blocker and the
// status push, and forwards window events (ready, report, load failure, closed) here.
//
// D5 covers closed → opening → live, opening → failed (LOAD_FAILED / OPEN_TIMEOUT), and any → closed (Close, Esc,
// quit). Disconnect and reconnect (waiting-display, held, resume) are D7; renderer crash and hang, and retry, are D8.
const {
  validateOpenRequest, validateReport, outputIdOrAll, oneToOne, sizeMatchOf, OutputIpcError, MAX_OUTPUTS,
} = require('./output-ipc.cjs');
const { matchDisplay } = require('./displays.cjs');

const OPEN_TIMEOUT_MS = 10000;        // section 2: no output:ready within 10 s → OPEN_TIMEOUT
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
 */
function createOutputController({
  listDisplays, openWindow, showWindow, closeWindow, sendSession, pushStatus, blocker,
  timers = { setTimeout, clearTimeout }, now = Date.now, maxOutputs = MAX_OUTPUTS,
}) {
  const records = new Map();   // outputId → record
  let blockerId = null;

  // One blocker for every output, held while at least one is live (section 2, "Sleep").
  function syncBlocker() {
    const anyLive = [...records.values()].some(r => r.state === 'live');
    if (anyLive && blockerId === null) blockerId = blocker.start(SLEEP_BLOCKER_TYPE);
    else if (!anyLive && blockerId !== null) { blocker.stop(blockerId); blockerId = null; }
  }

  function statusOf(r) {
    const drawn = r.render && r.render.firstFrameDrawn ? r.render : null;
    return {
      outputId: r.outputId,
      state: r.state,
      display: r.display,
      sessionRevision: drawn ? drawn.sessionRevision : null,
      ...sizeMatchOf(drawn ? drawn.outputPx : null, r.display ? r.display.devicePx : null),
      reconnected: false,
      render: r.render,
      error: r.renderError || r.oneToOneError || r.error,
    };
  }
  const closedStatus = outputId => ({
    outputId, state: 'closed', display: null, sessionRevision: null, sizeMatch: 'unknown', croppedPx: null, blackPx: null,
    reconnected: false, render: null, error: null,
  });
  const push = r => pushStatus(statusOf(r));
  const clearTimer = r => { if (r.timer !== null) { timers.clearTimeout(r.timer); r.timer = null; } };

  function fail(r, code, message) {
    if (r.state !== 'opening') return;
    clearTimer(r);
    r.state = 'failed';
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
      const busy = [...records.values()].find(r => r.display.electronId === display.electronId);
      if (busy) throw new OutputIpcError('DISPLAY_BUSY', `Output ${busy.outputId} is already on that display`);
      if (display.hostsControlWindow && request.allowControlDisplay !== true) throw new OutputIpcError('CONTROL_DISPLAY', 'That display shows the Pixel Lab window');
      const r = {
        outputId: id, state: 'opening', display, session: request.session, sessionSent: false,
        render: null, reportAt: -Infinity, error: null, renderError: null, oneToOne: null, oneToOneError: null, timer: null,
      };
      records.set(id, r);
      try { openWindow(id, display); } catch (error) { records.delete(id); throw error; }
      r.timer = timers.setTimeout(() => fail(r, 'OPEN_TIMEOUT', 'The output page did not report ready within 10 s'), OPEN_TIMEOUT_MS);
      push(r);
      return statusOf(r);
    },

    /** output:close. '*' closes every output; an unknown id does nothing. */
    close(target) {
      const id = outputIdOrAll(target);
      for (const outputId of id === '*' ? [...records.keys()] : [id]) if (records.has(outputId)) closeWindow(outputId);
    },

    statusAll() { return [...records.values()].map(statusOf); },
    status(outputId) { const r = records.get(outputId); return r ? statusOf(r) : closedStatus(outputId); },

    /** electronId → outputId, for DisplayInfo.hostsOutput. */
    outputOnDisplay() { return new Map([...records.values()].map(r => [r.display.electronId, r.outputId])); },
    sleepBlockerId() { return blockerId; },

    // ── Events from main ──────────────────────────────────────────────────────
    /** output:ready from the window registered under outputId: the page listens, so the session goes out. */
    onReady(outputId) {
      const r = records.get(outputId);
      if (!r || (r.state !== 'opening' && r.state !== 'live')) return;
      clearTimer(r);
      sendSession(outputId, { ...r.session, display: r.display });
      r.sessionSent = true;
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

    /** The window is gone (Close, Esc, quit, or destroyed elsewhere). */
    onClosed(outputId) {
      const r = records.get(outputId);
      if (!r) return;
      clearTimer(r);
      records.delete(outputId);
      syncBlocker();
      pushStatus(closedStatus(outputId));
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

module.exports = { createOutputController, outputKeyAction, OPEN_TIMEOUT_MS, MIN_REPORT_INTERVAL_MS, SLEEP_BLOCKER_TYPE };
