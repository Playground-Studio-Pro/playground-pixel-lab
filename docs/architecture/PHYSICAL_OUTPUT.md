# Physical Output Contract

**Status: approved by the owner on 2026-11-18, with changes to D-2, O-1 and D9 (see "Owner decisions"). Implementation authorised.** Alpha 0.1 Phase C. Nothing here is implemented. Desktop Engineering wrote sections 1–7 (displays, windows, IPC, clock, scaling, tasks). Output Engineering wrote section 8 (rendering, sources, cadence, pixel tests, Resolume procedure) and reviewed sections 1–7 in 8.12. Desktop reviewed section 8 and answered 8.12 in 8.13; the accepted changes are applied in sections 1–7. Section 9 gives one implementation order for both lanes. The owner approved the design and decided D-1…D-5 and O-1…O-9; the owner's changes are applied in sections 2, 7, 8.2 and 9.

Scope: one Pixel Lab **output** (an `VideoOutput`, for example "OUT 1 · Processor A · 3072 × 1920") shown full screen, 1:1, with no interface, on a chosen **display** (a monitor or the input of an LED processor), from the Electron app. Built so several outputs on several displays can run at once, even though Alpha ships one.

Builds on [DECISIONS](DECISIONS.md) (2026-11-18, Alpha 0.1 impact), the [rendering contract](CONTRACTS.md#rendering-contract) and the current shell in `desktop/src/`.

Words used here:

| Term | Meaning |
| --- | --- |
| Output | A project `VideoOutput` (`project.output.outputs`, `src/domain/model.ts`): an id, a name and a size in `output` px |
| Display | A monitor as Electron's `screen` module reports it |
| Output window | The `BrowserWindow` that shows one output on one display |
| Control window | Today's editor window |
| Session | What an output window draws: a frozen project, a source and its settings |
| DIP | Device-independent pixels, the unit of Electron window bounds |
| Device px | Physical framebuffer pixels: what the cable carries |

## 1. Displays (main process)

The main process owns display detection. Renderers never call `screen` and never see raw `Display` objects.

```ts
// Sent to the control window. All sizes are integers.
interface DisplayInfo {
  key: DisplayKey;            // stable identity, see below
  electronId: number;         // Display.id, valid for this app run only
  label: string;              // Display.label, "Built-in Retina Display", "DELL U2720Q", may be ""
  internal: boolean;          // Display.internal
  primary: boolean;           // id === screen.getPrimaryDisplay().id
  boundsDip: Rect;            // Display.bounds, DIP, in the desktop's coordinate space
  scaleFactor: number;        // Display.scaleFactor: 1, 2, or 1.25 / 1.5 / 1.75 on Windows
  devicePx: Size;             // framebuffer size in device px, see "Physical size"
  devicePxExact: boolean;     // false when devicePx came from rounding a fractional product
  rotation: 0 | 90 | 180 | 270;
  refreshHz: number;          // Display.displayFrequency, 0 when unknown
  hostsControlWindow: boolean;// the control window's centre is on it
  hostsOutput: string | null; // outputId shown there now
}
interface DisplayKey { label: string; devicePx: Size; internal: boolean; electronId: number }
interface Rect { x: number; y: number; width: number; height: number }
interface Size { width: number; height: number }
```

**Physical size.**

- macOS: `devicePx = round(bounds.width × scaleFactor) × round(bounds.height × scaleFactor)`. `scaleFactor` is 1 or 2, so the product is exact. This is the **framebuffer**, not necessarily the panel: in a macOS *scaled* mode ("Looks like 2560 × 1440" on a 4K panel) the framebuffer is 5120 × 2880 and macOS resamples it to the panel. Electron can't see that. The supported setup is an external display or processor input at its native mode with no scaling, which is how an LED processor normally presents itself. The pixel-grid test card is how the operator catches a scaled mode (section 8).
- Windows: use `screen.dipToScreenRect(null, display.bounds)` (Windows-only API), which returns device px without guessing. At 125 % a 1920 × 1080 display reports 1536 × 864 DIP, and 150 % reports 1280 × 720; both map back exactly. Sizes that don't divide evenly (1366 at 125 % gives 1092.8) can be off by one after rounding; set `devicePxExact: false` there. **Only confirmable on real Windows.**
- Rotation: when 90 or 270, `bounds` are already swapped; `devicePx` follows `bounds`.

**Stable identity.** `Display.id` is the platform id (`CGDirectDisplayID` on macOS). It's usually stable across unplugging, but not guaranteed across reboots, docks or ports. To find "the same display" again, match in order: same `electronId` and same `label` and `devicePx`; else same `label` and `devicePx`; else nothing (ask the operator). Two identical monitors with an empty or equal label are ambiguous: they need the operator to pick again. Nothing about displays is saved in the project in Alpha.

**Choosing a display.** The operator picks one from `output:list-displays` in the control window. Rules enforced by main:

- A display shows at most one output (`DISPLAY_BUSY`).
- The display hosting the control window can be chosen only with an explicit `allowControlDisplay: true`, for rehearsal on a single laptop. Default refuses (`CONTROL_DISPLAY`).
- When the output's size isn't the display's `devicePx`, `output:open` still works, but the result carries a `sizeMatch` warning (section 4). Nothing is ever scaled to fit.

**Events.** Main listens to `screen` `display-added`, `display-removed` and `display-metrics-changed` (with `changedMetrics`: `bounds`, `workArea`, `scaleFactor`, `rotation`). On each event it rebuilds the list, pushes `output:displays-changed` to the control window and applies section 2's disconnect rules to any affected output window. Metric events arrive in bursts while macOS rearranges displays, so main debounces them by 250 ms before acting.

## 2. Output windows

### Creation

Only the main process creates output windows, in response to validated IPC from the control window. The renderer never gets a handle, a URL to open or a way to create windows. Existing restrictions stay as they are: `setWindowOpenHandler` denies everything, `will-navigate` and `will-redirect` are blocked outside the allowed URL, `will-attach-webview` is blocked, and permissions are denied.

```js
new BrowserWindow({
  x, y, width, height,            // = target display.bounds, DIP
  show: false, frame: false, transparent: false, hasShadow: false,
  backgroundColor: '#000000',     // black before the first frame and after a crash
  resizable: false, movable: false, minimizable: false, maximizable: false,
  fullscreenable: true, skipTaskbar: true, focusable: true,
  enableLargerThanScreen: true,
  webPreferences: {
    preload: path.join(__dirname, 'output-preload.cjs'),
    contextIsolation: true, sandbox: true, nodeIntegration: false,
    webSecurity: true, webviewTag: false,
    backgroundThrottling: false,  // keeps animation going when the window isn't focused
    zoomFactor: 1, spellcheck: false, devTools: !app.isPackaged,
  },
});
```

- **URL, fixed:** `app://pixellab/output.html` packaged, `http://127.0.0.1:<port>/output` in development. It's one route in an allowlist held by main; any other URL in an output window is refused by `will-navigate` and by the IPC sender check. The route is a separate Next page (`src/app/output/page.tsx`, Output Engineering's), so the output window doesn't load the editor. **Needed in the asset handler:** `assetPath` must serve `/output.html` (static export writes `output.html`); no other path mapping changes.
- **Preload, minimal:** `output-preload.cjs` exposes only `window.pixelLabOutput` (section 3). It has none of the control window's project-file functions.
- **Test mode:** `pixelLabOutput.testMode` is true only when main's smoke condition holds (`!app.isPackaged && --smoke-test`). Main adds a fixed argument to the output renderer through `webPreferences.additionalArguments` when it creates the window, and the preload reads it from `process.argv`. No URL query, no IPC channel, and nothing the page can set. It is false in packaged builds and in normal development runs. The output page uses it to enable hidden-test-only helpers (O6) and stays inactive without it.
- **Full screen without interface:** after `ready-to-show`, main calls `setBounds(display.bounds)`, `setAlwaysOnTop(true, 'screen-saver')`, `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`, then on macOS `setSimpleFullScreen(true)` (no Spaces animation, menu bar and Dock hidden on that display) and on Windows `setFullScreen(true)`. Whether macOS native full screen or simple full screen behaves better with "Displays have separate Spaces" on and off must be tested on a real monitor (task D6).
- **Cursor:** the output page sets `cursor: none` on `html`. The window never takes focus by itself (`showInactive()`), so the control window keeps the keyboard. macOS shows the cursor again whenever it moves over the window; that's acceptable and is listed in the risks.
- **Zoom locked:** `setVisualZoomLevelLimits(1, 1)`, and main swallows ⌘ +/−/0 and Ctrl +/−/0 in `before-input-event`.
- **Esc closes, in main:** `webContents.on('before-input-event')` on the output window: Esc `keyDown` → close this output. It runs in the main process, so it works even when the output renderer is hung. A global shortcut is **not** registered (it would steal Esc from other apps); Esc works when the output window has focus, and the control window always has a Close button and `output:close`.
- **Independent close:** closing an output window changes nothing in the control window except its status. Quitting the app closes every output window. Closing the control window while outputs run is an owner decision (D-3).
- **Sleep:** while at least one output is `live` or `held`, main holds one `powerSaveBlocker.start('prevent-display-sleep')`; it stops when the last output leaves those states. One blocker for all outputs. `held` keeps it because the window is on the monitor showing the paused frame while the operator decides to Resume, and a sleeping display would black out the LED wall. `waiting-display` releases it: there's no monitor to keep awake. Decided after the D7 review.
- **Content protection is off.** `setContentProtection` would black the window out in screen recordings and some capture setups.
- **Colour: the output display's macOS profile must be sRGB IEC61966-2.1.** Output sends the same RGB values as the MP4 only on a display using that profile.
  - **Why the app doesn't force it:** by default Chromium colour-manages each frame to the display's profile. On the dev Mac's XDR display, pure green (0,255,0) reads back as (1,255,0) at 1× and 2× (O5). With `--force-color-profile=srgb`, Chromium tags frames as sRGB instead, and macOS WindowServer is expected to convert them to the display's ColorSync profile. That is the Lead Architect's reading, **not measured yet**: the physical session's sRGB check confirms or corrects it. Either way, the values on the cable should be unchanged only when that profile is sRGB, which makes both paths an identity transform. So the app never sets the switch (and in Electron 43 it can't: see Measured, below).
  - **Test harness only:** `capturePage` reads Chromium's buffer, not the cable. `test:smoke` passes `--force-color-profile=srgb` so pixel probes are deterministic on any Mac. A passing O5 therefore proves what Chromium draws, not what reaches the LED processor.
  - **Measured (Electron 43):** `app.commandLine.appendSwitch('force-color-profile', 'srgb')` has no effect, even on the first line of `main.cjs`: `getSwitchValue` reads `srgb`, but green still reads back as (1,255,0). Chromium reads the switch before `main.cjs` runs, so only the command line works. A value given there also wins over `appendSwitch`.
  - **Reported to the page:** each `DisplayInfo` may carry `colorSpace` (Electron `Display.colorSpace`) and `colorDepth`. sRGB reads as `{primaries:BT709, transfer:SRGB, …}`; the XDR display's own profile reads as `primaries:P3`. Under the test-harness switch it always reads sRGB. The page's warning when a display isn't sRGB is Output's (later PR).
  - **Physical check** [monitor físico], in the monitor session right after D6: set the output display's profile to *sRGB IEC61966-2.1* (System Settings → Displays → Colour profile). Record the real `DisplayInfo.colorSpace` string in TEST-RESULTS (from a normal run, not `test:smoke`, whose switch overrides it), so Output's warning can be checked against it; BT709/SRGB is expected. Then check at the LED processor or a capture card that pure green reads exactly (0,255,0) and the test card's greys read their exact values.

### State machine (one output)

| From | Event | To | Notes |
| --- | --- | --- | --- |
| closed | `output:open` accepted | opening | Window created hidden, fixed URL loaded |
| opening | `output:ready`, session sent, report with `firstFrameDrawn: true` | live | Window shown inactive, full screen; sleep blocker held |
| opening | Load failure, no `output:ready` within 10 s, or a report with `errorCode` and `firstFrameDrawn: false` | failed | `LOAD_FAILED` / `OPEN_TIMEOUT`; window black |
| live | Report with `errorCode` after an `output:update` | live | Previous session keeps playing; `error` set |
| live, held | Display removed | waiting-display | Window hidden at once, renderer kept; the output's clock is paused at the current frame; sleep blocker released |
| waiting-display | Same display back, **reliable** key match (one candidate, see below) | held | Re-placed, full screen again, shown inactive on the paused frame, `output:display` sent; sleep blocker held again; operator notified (D-2) |
| waiting-display | A display back with an ambiguous or partial match | waiting-display | Nothing shown; operator notified with `DISPLAY_AMBIGUOUS` and must pick the display again |
| held | `output:resume` from the control window | live | Clock restarts from the paused frame with a new epoch. **Never automatic** (D-2) |
| opening, failed | Display removed | closed | Window closed, `DISPLAY_NOT_FOUND`. Nothing was playing, so there is nothing to hold |
| live | `render-process-gone`, or no answer to main's liveness probe for 5 s | failed | Window kept black and on its display; control window told |
| failed | `responsive` (after a hang) | live | |
| failed | `output:retry` | opening | One reload of the fixed URL, latest session re-sent |
| any | `output:close`, Esc in the output window, app quit | closed | Window destroyed; sleep blocker released with the last live or held output |

```ts
type OutputState = 'closed' | 'opening' | 'live' | 'waiting-display' | 'held' | 'failed';
// held: on its display, full screen, paused, waiting for the operator to confirm. Reached only after a reconnect.
```

### Disconnect and reconnect

- **Display removed.** Main hides the window at once (`hide()`) and moves to `waiting-display`. Otherwise macOS and Windows move orphaned windows to the primary display, which would cover the operator's screen with a full-screen test card. The window and its renderer are kept, so nothing reloads.
- **Display removed, clock.** Main pauses the output's clock at the frame on screen (`{ state: 'paused', frame }`), so nothing advances while the wall is dark.
- **Display back (owner decision D-2).** Main detects the reconnect automatically. The match is **reliable** only when exactly one connected display matches the key at the first or second level of section 1 (same `electronId`, `label` and `devicePx`, or same `label` and `devicePx`) and no other display shares that `label` and `devicePx`. Then main re-places the window, re-applies full screen, shows it inactive on the paused frame, sends `output:display`, moves to `held` and pushes `output:status` with `reconnected: true`. The control window shows a notice ("OUT 1 is back on DELL U2720Q, paused at frame 1234") with a **Resume** button. Playback continues **only** after the operator confirms (`output:resume`). With an ambiguous or partial match (identical monitors, a different size, an empty label shared by two displays) nothing is shown: the output stays in `waiting-display` and the control window reports `DISPLAY_AMBIGUOUS`; the operator picks the display again or closes the output. **There is no automatic playback after a disconnect.**
- **Metrics changed** (resolution, scale or rotation of the display in use). Main re-places the window to the new bounds, sends the new `DisplayInfo` to the output window on `output:display` (the page re-lays out its canvas without rebuilding the source) and reports the new `devicePx` to the control window. If the output no longer matches it updates `sizeMatch`. It never rescales content. A reconnect (above) sends `output:display` too.

### Renderer failure

| Event | Main does | Screen shows | Control window gets |
| --- | --- | --- | --- |
| `render-process-gone` | State `failed`. Window kept, not hidden | Black (`backgroundColor`) | `output:status` with `error: RENDERER_GONE` and the reason |
| No answer to main's liveness probe for 5 s | State `failed`; Esc and Close still work (main-side) | Last frame, frozen | `RENDERER_UNRESPONSIVE` |
| Probe answered again | Back to `live` | Animation resumes | Cleared |
| Page fails to load or never reports ready within 10 s | `failed` | Black | `LOAD_FAILED` / `OPEN_TIMEOUT` |
| During `opening`, a report with `errorCode` and `firstFrameDrawn: false` (the first session couldn't be prepared) | `failed` | Black | `LOAD_FAILED`, with the page's code (`SOURCE_SETTINGS_INVALID`, `MASTER_TOO_LARGE`, …) in `render.errorCode` |
| During `live`, a report with `errorCode` (an `output:update` couldn't be prepared) | Stays `live`: the previous session keeps playing | Previous session | `error` set from the report; cleared by the next good report |
| `output:retry` | One reload of the fixed URL, session re-sent | Black, then content | `opening`, then `live` |

**Hang detection (D8, measured).** Main runs its own liveness probe: a trivial script the output renderer must run on its main thread, abandoned after 2 s unanswered; the 5 s rule counts from the last answer. Nothing is exposed to the page. Electron's `unresponsive` event isn't used: on Electron 43 a page hung for 25 s never raised it, with or without synthetic input, and an output window gets no real input.

A failed output stays as a black full-screen window instead of closing, because closing would reveal the desktop on the LED wall. Owner decision D-1.

## 3. IPC

Channels are fixed strings. Every handler checks the sender like today's `assertSender`: exact `WebContents`, main frame only, and URL equal to the allowed URL **for that window's role**. Control channels accept only the control window. Output channels accept only the output window registered under that `outputId`. Payloads are validated in main with hand-written checks (desktop code has no schema library): unknown keys rejected, strings bounded, integers checked with `Number.isSafeInteger`.

**What main can and can't validate.** Main is plain CommonJS and doesn't load the app's TypeScript, so it can't run `parseProjectFile`, `validateProject` or a source's settings parser. It checks the envelope (as `validateText` does for project files today: size, JSON, `format`), that `outputId` appears in `project.output.outputs`, and the shape and bounds of everything else. The control window runs `validateProject` before sending, and the output page parses and validates again and is authoritative; its refusals come back as report error codes (section 2, "Renderer failure").

```ts
// ── Control window → main (invoke / handle) ───────────────────────────────
type OutputId = string;   // VideoOutput.id, 1–64 chars [A-Za-z0-9_-]

interface OutputOpenRequest {
  outputId: OutputId;
  display: DisplayKey;            // from output:list-displays
  allowControlDisplay?: boolean;  // single-laptop rehearsal only
  session: OutputSession;
}
interface OutputSession {
  revision: number;               // increments on every output:update
  projectText: string;            // serializeProject(project), ≤ 16 MiB, checked like project files today
  outputId: OutputId;             // must equal the request's outputId and exist in the project
  source: { id: string; settings: JsonValue };  // output source id (section 8.5) + its frozen settings, ≤ 1 MiB
  clock: OutputClock;
}
type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

interface ControlApi {   // window.pixelLabDesktop.output, control preload
  listDisplays(): Promise<DisplayInfo[]>;                                   // output:list-displays
  open(req: OutputOpenRequest): Promise<OutputStatus>;                      // output:open
  update(outputId: OutputId, session: OutputSession): Promise<OutputStatus>;// output:update
  setClock(outputId: OutputId | '*', clock: OutputClock): Promise<void>;    // output:clock
  close(outputId: OutputId | '*'): Promise<void>;                           // output:close
  retry(outputId: OutputId): Promise<OutputStatus>;                         // output:retry
  resume(outputId: OutputId): Promise<OutputStatus>;                        // output:resume, only from held (D-2)
  status(): Promise<OutputStatus[]>;                                        // output:status-all
  onStatus(cb: (s: OutputStatus) => void): () => void;                      // output:status (push)
  onDisplays(cb: (d: DisplayInfo[]) => void): () => void;                   // output:displays-changed (push)
}

interface OutputStatus {
  outputId: OutputId;
  state: OutputState;
  display: DisplayInfo | null;
  sessionRevision: number | null;
  sizeMatch: 'exact' | 'smaller-than-display' | 'larger-than-display' | 'mixed' | 'unknown';
  // Per axis, from the page's layout (8.3): output px past the display edge, display px past the output edge.
  croppedPx: { right: number; bottom: number } | null;
  blackPx: { right: number; bottom: number } | null;
  reconnected: boolean;                 // true in held after a reconnect, until output:resume (D-2)
  render: OutputRenderReport | null;    // last report from the output window
  error: { code: OutputErrorCode | OutputRenderErrorCode; message: string } | null;  // render codes: 8.4
}

// ── Main → output window (send / on) ──────────────────────────────────────
// Main adds the display it placed the window on before forwarding the session.
interface OutputWindowSession extends OutputSession { display: DisplayInfo }

interface OutputApi {    // window.pixelLabOutput, output preload
  onSession(cb: (s: OutputWindowSession) => void): void;   // output:session
  onClock(cb: (c: OutputClock) => void): void;       // output:clock
  onDisplay(cb: (d: DisplayInfo) => void): void;     // output:display (metrics change, reconnect; no session rebuild)
  ready(): void;                                     // output:ready  (page loaded, listening)
  report(r: OutputRenderReport): void;               // output:report (≤ 2 per second)
  readonly testMode: boolean;                        // true only in an unpackaged --smoke-test run (O6), see below
}

// What the output window measures and sends back. Output fills it; Desktop checks it.
interface OutputRenderReport {
  sessionRevision: number;
  firstFrameDrawn: boolean;
  frame: number;
  devicePixelRatio: number;            // window.devicePixelRatio
  viewportCss: Size;                   // innerWidth × innerHeight
  canvasPx: Size;                      // backing store of the output canvas
  outputPx: Size;                      // VideoOutput size drawn at scale 1
  browserFps: number;                  // measured rAF rate, browser metric, never LED refresh
  lateFrames: number; skippedFrames: number;
  error?: string;                      // source or draw failure, short text, ≤ 500 chars
  // Optional, filled by Output (8.4). Validated in main: sizes as safe positive integers, strings ≤ 200 chars,
  // cadence.pattern ≤ 240 entries, errorCode from the closed list in 8.4.
  contentBoxDevicePx?: Size | null;    // ResizeObserver device-pixel-content-box
  masterPx?: Size;
  sourceId?: string;
  errorCode?: OutputRenderErrorCode;
  cadence?: OutputCadence;             // 8.6
  limits?: { maxCanvasSide: number; maxCanvasArea: number; maxTextureSize: number; depthMaxSize: number | null };
}
```

```ts
type OutputErrorCode =
  | 'BAD_REQUEST'            // payload failed validation
  | 'UNTRUSTED_SENDER'       // wrong window, frame or origin
  | 'UNKNOWN_OUTPUT'         // outputId not in projectText
  | 'DISPLAY_NOT_FOUND'      // key doesn't match a connected display
  | 'DISPLAY_BUSY'           // another output is on that display
  | 'CONTROL_DISPLAY'        // the control window's display, without allowControlDisplay
  | 'ALREADY_OPEN'           // output:open for an output that isn't closed
  | 'TOO_MANY_OUTPUTS'       // over the configured limit (1 in Alpha)
  | 'PROJECT_INVALID'        // envelope check fails in main (deep validation: control window and page)
  | 'LOAD_FAILED' | 'OPEN_TIMEOUT'
  | 'RENDERER_GONE' | 'RENDERER_UNRESPONSIVE'
  | 'DISPLAY_AMBIGUOUS'      // a display came back but the match isn't reliable (D-2)
  | 'NOT_RESUMABLE'          // output:resume when the output isn't held
  | 'NOT_ONE_TO_ONE';        // report shows devicePixelRatio or canvas size off (section 4)
```

| Code | When | State after | Operator sees |
| --- | --- | --- | --- |
| BAD_REQUEST, UNTRUSTED_SENDER | Validation in main | Unchanged | Logged; the UI shows "Output request rejected" |
| UNKNOWN_OUTPUT, PROJECT_INVALID | Before creating a window | closed | "Fix the mapping first", with the validation issue |
| Page codes in `render.errorCode`: SOURCE_UNKNOWN, SOURCE_SETTINGS_INVALID, ASSET_MISSING, GPU_UNAVAILABLE, MASTER_TOO_LARGE, DRAW_FAILED, and the page's own PROJECT_INVALID / UNKNOWN_OUTPUT | Output window reports | `failed` if no frame was drawn yet, else unchanged | Shown like PROJECT_INVALID, with the page's message |
| DISPLAY_NOT_FOUND | Display gone between list and open | closed | Display list refreshed |
| DISPLAY_BUSY, CONTROL_DISPLAY, ALREADY_OPEN, TOO_MANY_OUTPUTS | Before creating a window | Unchanged | Reason next to the display picker |
| LOAD_FAILED, OPEN_TIMEOUT | During `opening` | failed, black | Retry / Close |
| RENDERER_GONE, RENDERER_UNRESPONSIVE | During `live` | failed, black or frozen | Retry / Close |
| NOT_ONE_TO_ONE | First report after `live` (and after each `output:display`) | live, with error set | Warning with measured vs expected sizes; content keeps running |

`output:update` replaces the session of a live output. The output window prepares the new session to the side and swaps at the next frame only once it's fully prepared; if preparing fails, the previous session keeps playing and the report carries the error. A first session that fails leaves the window black (`opening` → `failed`). Main keeps the latest session per output, so a retry re-sends it without asking the control window; `OutputStatus.sessionRevision` is the revision the page reports drawing, not the last one sent.

**Update rules in main.** The window is never recreated and the state doesn't change.
- **Validation:** the session goes through the same checks as `output:open`, and its `outputId` must equal the update's.
- **Revision:** must be greater than the stored one; otherwise `BAD_REQUEST`. An update for an output that isn't open, or for `'*'`, is `UNKNOWN_OUTPUT`.
- **Accepted states:** `opening`, `live` and `failed`. In `opening` before `output:ready`, ready sends the latest session. After ready, it's forwarded at once, and `live` then needs a first frame of the new revision. In `failed`, it's stored and the next retry sends it.
- **Refused states:** `waiting-display` and `held`, with `BAD_REQUEST`, so a new session (and its clock) can't restart playback before `output:resume` (D-2).

## 4. Data, sources and clock

**Session.** The output window receives `projectText` and parses it with the shared `parseProjectFile`, then `resolveMapping`, exactly as the editor does. No second mapping path. The source is created by id from its frozen settings (`createOutputSource`, section 8.5), not looked up in the module registry, whose sources read the editor's live stores. For the test card the settings are mode and logo; for Depth Studio they're the whole `DepthSceneConfig`, because Depth Studio's config isn't saved in the project yet (`depth-store.ts` waits for its `modules[id]` section). Which settings each source needs is Output's part (8.5). Desktop only carries them, bounded and as JSON.

**Edits don't go live by themselves.** The session is a snapshot. The control window sends `output:update` when the operator presses "Update output", so a half-edited mapping never reaches the wall. Owner decision D-4: explicit update (draft) vs live follow.

**Clock: recommendation — a shared epoch, controlled through main.**

```ts
type OutputClock =
  | { state: 'playing'; fps: ContentFps; startFrame: number; epochMs: number } // epochMs on the shared clock
  | { state: 'paused'; frame: number };
// In the output window, every requestAnimationFrame:
//   frame = startFrame + Math.floor((now() - epochMs) * fps / 1000)
// now(): a timestamp on the performance.timeOrigin + performance.now() clock, the same in every process.
// Output windows use the rAF callback's timestamp on that clock, quantized to the refresh grid (8.6).
```

Main stamps `epochMs` when the operator presses play, and sends the clock in the session and on every play, pause or seek. Each output window then computes its frame from the same formula. There is no per-frame message.

| Option | Verdict |
| --- | --- |
| **Shared epoch + control via main (recommended)** | Zero per-frame traffic. Outputs stay aligned to within one display refresh. Keeps running if the control window's renderer hangs or is busy re-rendering React. Deterministic: the frame is a pure function of time, so a reloaded output rejoins on the right frame |
| Per-frame relay from main over IPC | Main's timers jitter by milliseconds, each frame costs one IPC per window, and a busy main process stalls every output |
| BroadcastChannel from the control window | Works on the same origin, but makes the editor renderer the master clock: a long React render or a hang stops the wall. Per-frame messages too |

Limits, stated plainly: `performance.timeOrigin + now()` is comparable across processes to within about a millisecond on one machine. Outputs on displays with different refresh phases differ by up to one refresh period. There is no genlock with the LED processor; that's out of Alpha. 30 fps on a 60 Hz display shows each frame for two refreshes; 25 fps on 60 Hz can't be even (Output's part reports it).

## 5. Retina and Windows scaling: what the shell guarantees

The goal: one output px = one device px on the cable.

What Desktop guarantees:

1. The window's bounds equal `display.bounds` in DIP, so its content covers the whole framebuffer, `devicePx`.
2. Zoom is fixed at 1 and can't be changed by keys or pinch, so CSS px × `devicePixelRatio` = device px, with `devicePixelRatio === display.scaleFactor`.
3. `DisplayInfo.devicePx`, `scaleFactor` and `devicePxExact` reach the output window in `OutputWindowSession.display`, and again on `output:display` after every metrics change or reconnect, so Output doesn't guess them.
4. Main compares the first report (and the first after each `output:display`) with the display. All of these must hold: `devicePixelRatio === scaleFactor`, `canvasPx === devicePx`, `contentBoxDevicePx === devicePx` (once the page has observed it; `null` means not yet), and `round(viewportCss × devicePixelRatio) === devicePx`. When `devicePxExact` is true any difference raises `NOT_ONE_TO_ONE` with the measured and expected values. When it's false (fractional Windows scale), a difference of ±1 px per axis is a warning, and more than 1 px is `NOT_ONE_TO_ONE`.
5. **No switch can change the scale in a distributed build.** `--force-device-scale-factor` is added to the packaged build's refusal list (next to the debugging switches), so it exists only in the unpackaged test runner (O-9, 8.8). `capturePage()` for the pixel tests lives in the test harness only, behind `!app.isPackaged` and a test flag; no IPC channel exposes captures.

What Output must do (section 8): size the canvas backing store to `devicePx` exactly (not `innerWidth × devicePixelRatio`, which can be fractional), set its CSS size to `devicePx / devicePixelRatio`, draw the output at scale 1 at the top-left with smoothing off, and paint the rest black. No `setZoomFactor` tricks: zoom stays 1, and the canvas absorbs the ratio.

| Case | Expectation | Confirmable on |
| --- | --- | --- |
| macOS, processor input at native mode, scale 1 | Exact | macOS + external monitor [monitor físico] |
| macOS, HiDPI default mode, scale 2 | Exact: CSS px ×2 | macOS + Retina-class external monitor [monitor físico] |
| macOS, *scaled* mode | Framebuffer exact, panel resampled by macOS; invisible to Electron | Pixel-grid card on the real panel [monitor físico] |
| Windows 100 % / 125 % / 150 % / 175 % | Exact when `devicePxExact`; ±1 px at the edge otherwise | **Windows only, not claimed** |
| Output smaller than the display | Drawn 1:1 at top-left, black elsewhere, `sizeMatch: smaller-than-display` | Either |
| Output larger than the display | Cropped at right and bottom, never scaled, `sizeMatch: larger-than-display` | Either |
| Larger on one axis, smaller on the other | Cropped on one side, black on the other, `sizeMatch: mixed`, with `croppedPx` and `blackPx` per axis | Either |

## 6. Several outputs, and no preview cap

- Main keeps a `Map<OutputId, OutputWindowRecord>`, not one global window. The limit is a constant (`MAX_OUTPUTS`, 1 in Alpha), checked in `output:open`; raising it needs no API change.
- One display shows one output. One output is shown on one display. A per-screen or per-group output is just another `VideoOutput` in the project, so the contract doesn't change.
- `output:clock` and `output:close` accept `'*'` for every output, and they share the epoch.
- **The Live preview's 4096 px cap doesn't apply.** The output window draws the master at its real size (needed to cut regions, as `targetSource` does) and the output at its real size. Practical limits: Chromium's canvas limit (32,767 px a side, about 268 MP in area) and GPU memory. Output measures these and documents them in section 8. Desktop adds nothing that scales or caps.

## 7. Desktop tasks for Phase C

Small, in order. Each one ends with `npm --prefix desktop test`, `npm run typecheck && npm run lint && npm test`, and a note in `desktop/docs/TEST-RESULTS.md`. **[monitor físico]** marks tasks that need a real external display.

| # | Task | Acceptance criteria |
| --- | --- | --- |
| D1 | **Window registry.** Replace the single `window` in `main.cjs` with a control window plus a `Map` of output windows; `assertSender` takes a role (`control` / `output:<id>`) and the allowed URL for it | Unit tests: control channels reject an output window's sender and vice versa; existing IPC tests pass unchanged; app behaves as today with no output open |
| D2 | **Displays.** `displays.cjs`: pure `toDisplayInfo(display, platform, dipToScreenRect?)` and `matchDisplay(key, list)`; `output:list-displays`, `output:displays-changed` with 250 ms debounce | Unit tests with fixtures: 1× and 2× macOS, Windows 125 % on 1920 × 1080 (exact 1920 × 1080) and 1366 × 768 (`devicePxExact: false`), rotation 90; key matching including the identical-twins case. Listing returns the built-in display on the dev Mac |
| D3 | **IPC validation.** `output-ipc.cjs`: pure validators for `OutputOpenRequest`, `OutputSession`, `OutputClock`, `OutputRenderReport` (including the optional 8.4 fields), ids and sizes; the 1:1 comparison of section 5 as a pure function; error codes as in section 3. Add `--force-device-scale-factor` to the packaged refusal list | Unit tests for each error code and each bound (16 MiB project, 1 MiB settings, id pattern, safe integers, unknown keys, report field bounds); 1:1 cases: exact, ±1 with `devicePxExact` false (warning), ±1 with it true (error), `contentBoxDevicePx: null` (pending); packaged refusal test for the new switch |
| D4 | **Output preload and route plumbing.** `output-preload.cjs` with `window.pixelLabOutput` only (`onSession`, `onClock`, `onDisplay`, `ready`, `report`); allowlisted URL per mode; `assetPath` serves `/output.html` | Smoke test extended: the output page has no `pixelLabDesktop`, no Node globals, sandbox and isolation on; navigating it elsewhere is blocked; a stub `output.html` loads under `app://` |
| D5 | **Open and close on the built-in display** (with `allowControlDisplay`) | `output:open` → `live` within 2 s with a stub page; Esc closes it from main even while the page runs `while(true){}`; Close from the control window works; `powerSaveBlocker` active only while live (asserted with `isStarted`); window never steals focus |
| D6 | **Full screen on an external display** [monitor físico] | Window covers the display exactly (`getBounds()` equals display bounds); no menu bar, Dock or title bar visible on that display; compared native vs simple full screen with "Displays have separate Spaces" on and off; the decision recorded |
| D7 | **Disconnect and reconnect** [monitor físico] | Unplugging hides the window within 500 ms, nothing appears on the laptop screen and the clock pauses; replugging the same monitor shows the window on it within 2 s in `held`, on the paused frame, with the operator notice; **the frame number doesn't advance until `output:resume`**; a different monitor, or a second identical one, doesn't take it over (`DISPLAY_AMBIGUOUS`). Unit tests of the reliable-match rule and of the `held` transitions run on the dev Mac without a monitor |
| D8 | **Failure handling** | Killing the output renderer (`process.crash()` in a dev-only hook) → `failed`, black window, status pushed within 1 s; a hung page → `RENDERER_UNRESPONSIVE` after 5 s; `output:retry` returns to `live` |
| D9 | **Clock relay — backlog, not an Alpha 0.1 criterion** (owner decision). The shared clock stays in the architecture; Alpha runs one output. When taken up: | Two output windows (`MAX_OUTPUTS` raised in a test build, on two displays, one of them can be the control display with `allowControlDisplay`) [monitor físico] report the same frame number at the same timestamp within 1 frame at 30 fps over 10 minutes; pause and seek reach both within 100 ms |
| D10 | **1:1 check** [monitor físico], after O2, run together with O10 in the same monitor session | `NOT_ONE_TO_ONE` raised when a stub reports a wrong ratio; on the real external display at scale 1 and at scale 2, the report's `canvasPx` and `contentBoxDevicePx` match `devicePx`, and O10's pixel-grid photos pass |
| D11 | **Field rehearsal** [monitor físico] | Laptop + external monitor or processor input: open, run 30 minutes with no display sleep, Esc, reopen, unplug and replug, then leave the output `held` for at least 5 minutes before Resume with no display sleep. Results with photos in TEST-RESULTS |

**Risks.**

- macOS full-screen behaviour with separate Spaces may leave a menu bar or animate between Spaces on the output display (D6 decides).
- The cursor shows again whenever the mouse crosses the output display; `cursor: none` hides it only once it's over the page.
- Display identity across docks and adapters can change `Display.id`; the label+size fallback can confuse two identical monitors.
- A macOS scaled mode looks fine but isn't 1:1; only the pixel-grid card on the real panel catches it.
- Windows rounding at fractional scales is unverified until a Windows 11 machine is available.
- Large masters (Festival is 5120 × 1664) cost GPU memory per output window; two or more outputs need measuring before `MAX_OUTPUTS` goes above 1.
- Changing `main.cjs` from one window to a registry touches the IPC security code; D1 must keep every existing test green before anything else lands.

## Owner decisions

Decided 2026-11-18. Every draft position below is approved as written except D-2, changed by the owner, and O-1, approved with conditions. Also by owner decision: multi-display clock sync (D9) moves to the backlog and isn't an Alpha 0.1 criterion.

| # | Question | Draft position |
| --- | --- | --- |
| D-1 | On renderer crash or hang: keep a black full-screen window, or close it | Keep black: closing shows the desktop on the wall |
| D-2 | Monitor reconnects: resume automatically, or wait for the operator | **Owner: changed.** Detect automatically; restore the window only on a reliable match; stay paused (`held`); notify the operator; resume only after explicit confirmation. No automatic playback |
| D-3 | Closing the control window while outputs run: keep them running, ask, or close them | Ask, with "Keep running" as default; quitting always closes all |
| D-4 | Edits reach a live output: on "Update output" only, or immediately | Only on "Update output" |
| D-5 | Allow an output on the control window's display (single-laptop rehearsal) | Allowed only with an explicit toggle, off by default |
| O-1 | Output window: draw the whole master at scale 1 and cut, or render only the output's regions (needs a `FrameInput.clip` contract change) | **Owner: approved with conditions.** Whole master and cut for Alpha 0.1; measure performance and memory with Festival Main Stage (5120 px) in O8; keep the renderer decoupled from the window and from the cut (8.2); region rendering documented as an evolution path, not implemented |
| O-2 | Add the `pixel-grid` test card to the Output module, the Live preview and the MP4 export, not only the output window | Everywhere: the Resolume check needs it in MP4 |
| O-3 | Motion Lab patterns on the physical output in Alpha | No: test card, pixel grid and Depth Studio only |
| O-4 | Output size ≠ display size: anything drawn on the wall to show it | Nothing on the wall; warning with pixel counts in the control window only; the `display`-space grid outlines the output edge |
| O-5 | Master larger than the canvas or GPU limit | Refuse with `MASTER_TOO_LARGE`, never scale |
| O-6 | Uneven cadence (24/25/50 fps on 60 Hz, 30/60 on 50 Hz): block, or allow with a warning | Allow, with a warning that names the pattern and suggests the matching display rate |
| O-7 | Add the optional report fields of 8.4 to `OutputRenderReport` (and Desktop's validator) | Yes, before O4 |
| O-8 | Depth Studio's config travels frozen in `session.source.settings`, since it isn't saved in the project | Yes, until the `modules[id]` section exists for Depth Studio |
| O-9 | Use `--force-device-scale-factor=1` in the test runner (never in a packaged build) to cover 1× without an external monitor | Yes, alongside the physical 1× check |

## 8. Rendering and pixel tests (Output Engineering)

Written by Output Engineering. Desktop reviews it. Same rule as sections 1–7: nothing here is implemented, and nothing is built before the owner approves.

The goal is the one in section 5, from the drawing side: **output px (x, y) of the `VideoOutput` lands on device px (x, y) of the display**, with the same RGB value the MP4 export writes for that output and frame, for every x < min(output width, display width) and y < min(output height, display height). Everything else on the display is black.

### 8.1 The output page

`src/app/output/page.tsx`, exported as `output.html`. A client component that renders one `<canvas>` and nothing else. All logic lives in a plain class, `OutputRuntime` (`src/modules/output/output-runtime.ts`), so it can be read and tested without React.

**What it loads.** The root layout (fonts as CSS variables, `globals.css`) and the runtime. Nothing from the editor: no `state/store.ts`, no studio panels, no `modules/registry.ts` (its sources read the live UI stores; see "Sources" below). The build records the page's chunk size in [PERFORMANCE](../development/PERFORMANCE.md), and a test fails if the output chunk graph includes `state/store`.

**No interface, no cursor.**

```css
/* Scoped to the output page only. */
html, body { margin: 0; padding: 0; background: #000; overflow: hidden; cursor: none; user-select: none; }
canvas { display: block; position: fixed; left: 0; top: 0; image-rendering: pixelated; }
```

The page draws nothing but content: no status text, no warning, no logo of its own, on the wall or anywhere. Every warning goes to the control window through `OutputRenderReport`. Without `window.pixelLabOutput` (opened in a normal browser) it stays black and logs one console line.

**Lifecycle.**

```ts
// src/modules/output/output-runtime.ts (sketch, not final code)
class OutputRuntime {
  start(api: OutputApi, canvas: HTMLCanvasElement): void;  // api.onSession / onClock, then api.ready()
  // onSession(s): prepare(s) off to the side; if it succeeds, swap at the next rAF; if it fails,
  //   keep drawing the previous session (if any) and report the error. A half-built session never draws.
  // onClock(c): replace the clock; the next rAF uses it.
  // rAF loop: draw only when (sessionRevision, contentFrame, layout) changed. A still card costs nothing.
  // Every 500 ms: api.report(report).
}

interface PreparedSession {
  revision: number;
  project: Project;                 // parseProjectFile(s.projectText)
  mapping: ResolvedMapping;         // resolveMapping(project)
  target: VideoTarget;              // videoTargets(mapping).find(t => t.kind === "output" && t.id === s.outputId)
  master: Omit<FrameInput, "frame" | "fps">;  // same object the Output Studio panel builds today
  source: FrameSource;              // frozen, see 8.5, already prepared (fonts, logo, WebGL)
  layout: OutputLayout;             // 8.3, from s.display and window.devicePixelRatio
}
```

**One mapping path.** The frame is assembled by the code the MP4 export already uses, unchanged:

```
projectText ─parseProjectFile─▶ Project ─resolveMapping─▶ ResolvedMapping ─videoTargets─▶ VideoTarget (this output)
                                                                                              │
frozen FrameSource ──targetSource(source, target, master)──▶ draws master at scale 1, copies each slice
                                                              masterRect → outputRect, 1:1, smoothing off
```

`targetSource` is called on the visible canvas after a black fill of the whole backing store. It draws only inside `target.width × target.height`; whatever falls past the canvas is clipped by the canvas, never scaled. So for the same project, output, source settings and frame number, **the output window and the MP4 export produce the same pixels**, and section 8.7 tests exactly that. No coordinate is computed in the output page: every rectangle comes from `resolveMapping` through `videoTargets`.

`parseProjectFile` already runs the schema. The runtime also refuses a session whose mapping has `unresolved` screens belonging to this output, or whose `outputId` is missing from `mapping.outputs` (`PROJECT_INVALID`, `UNKNOWN_OUTPUT`). Main checks the same before opening (section 3); the page checks again because it can't trust that main's copy of the parser is the same build.

### 8.2 Native resolution: whole master, then cut

**Decision (O-1): draw the whole master at scale 1 into an off-screen canvas, then copy this output's slices.** That is what `targetSource` does today. No new contract.

| Option | For | Against |
| --- | --- | --- |
| **Whole master + cut (chosen)** | No contract change: `FrameSource` already says "draws the whole master canvas once". Same code as the MP4 export, so output = MP4 by construction. Shared regions read identical pixels. Test-card labels and Depth Studio's camera are defined on the whole master, so they're correct with no extra work | Each output window draws every master pixel, including other outputs' regions. With N outputs that's N× the work |
| Only this output's regions, in master coordinates | Less fill and less memory per window when a master is much larger than one output | Needs a contract change (`FrameInput` clip hint) and every source honouring it. Depth Studio would need an off-axis sub-frustum, which isn't bit-identical to a crop because of MSAA and rasterization rules. Two code paths to prove equal |

Why the cost is acceptable in Alpha: one output, and the largest bundled master, Festival Main Stage, is 5120 × 1664 = 8.5 MP, about 34 MB as RGBA. That is far below Chromium's canvas limits (8.9). Whether it holds 60 fps on the GPU is **measured, not assumed**: task O8 records frame time for Festival with the test card and with Depth Studio at 60 fps.

**The 4096 px preview cap never applies.** `MAX_SOURCE_SIDE` and `sourceScale` in `live-renderer.ts` are the Live preview's; the output page doesn't import `live-renderer.ts`. `targetSource` always uses scale 1 and throws otherwise.

**Limits are refusals, never scaling.** Before the first frame the runtime checks:

```ts
type MasterLimit = { maxSide: number; maxArea: number };   // measured once per window, 8.9
// 2D canvas: master and canvasPx must each fit maxSide and maxArea.
// Depth Studio: max(master.width, master.height) <= depthMaxSize(), as the MP4 export already checks.
// Over a limit → report error MASTER_TOO_LARGE with the size and the limit; the window stays black.
```

`drawDepthScene` scales a too-large master down then up "which only a preview may do"; the output path must never reach that branch, so the check above runs before the source is created, exactly as `frozenSource` does in `studio-panel.tsx` today.

**When a contract change would be needed.** Only if O8 measures that the whole master doesn't hold the content frame rate, or when `MAX_OUTPUTS` goes above 1 with large masters. Then the smallest change is one optional field, proposed through the Lead Architect as `CONTRACTS.md` requires:

```ts
// Proposed later, not for Alpha.
interface FrameInput {
  // ...
  /** Master-space rectangles the caller will read. A source may skip pixels outside them; inside them it
   *  must draw exactly what it draws without the hint. Absent = whole master. */
  readonly clip?: readonly PixelRect<"master">[];
}
```

A source that ignores the hint stays correct. A test compares hinted vs unhinted pixels inside the clip for every source that honours it.

**Owner conditions on O-1 (2026-11-18).**

1. **Measure** frame time and memory with Festival Main Stage (5120 × 1664) in O8, for the calibration card, the pixel grid and Depth Studio. The numbers go in 8.9 and in the PR.
2. **Keep three layers apart**, so region rendering can come later without rewriting the architecture:

   | Layer | Owns | Must not know about |
   | --- | --- | --- |
   | Source (`FrameSource`, from `createOutputSource`) | Drawing master pixels for a frame | Windows, displays, outputs, slices |
   | Composer (`targetSource` + `videoTargets`) | Which master rectangles go where in output px | Windows, IPC, how the source draws |
   | Presenter (`OutputRuntime` + `outputLayout`) | The canvas, device px, cadence, reports | Mapping maths and source internals |

   The output page talks to the composer only through `targetSource(source, target, master)`; the MP4 export uses the same call. No window code reaches into a source and no source reads the window.
3. **Evolution path to region rendering** (documented, **not** implemented in Alpha): add the optional `FrameInput.clip` above through the Lead Architect; the composer passes the union of this output's `masterRect`s; sources opt in one at a time (calibration card and pixel grid first, Depth Studio last, with its own sub-frustum and a pixel-equality test); the presenter, IPC, windows and the MP4 path don't change. Trigger: O8 shows Festival can't hold the content rate, or `MAX_OUTPUTS` goes above 1.

### 8.3 Canvas size and placement

```ts
// src/engines/output-layout.ts, pure
interface OutputLayoutInput { devicePx: Size; devicePixelRatio: number; outputPx: Size; devicePxExact: boolean }
interface OutputLayout {
  canvasPx: Size;            // = devicePx exactly
  canvasCss: { width: string; height: string };  // `${devicePx.width / dpr}px`, not rounded
  visiblePx: Size;           // min(outputPx, devicePx) per axis: output px that reach the cable
  croppedPx: { right: number; bottom: number };  // output px past the display edge, never shown
  blackPx: { right: number; bottom: number };    // display px past the output edge, painted black
  sizeMatch: 'exact' | 'smaller-than-display' | 'larger-than-display' | 'mixed';
}
export function outputLayout(i: OutputLayoutInput): OutputLayout;
```

Rules in the page:

- `canvas.width/height = display.devicePx` from `OutputWindowSession.display`, **not** `innerWidth × devicePixelRatio` (fractional on Windows) and not `screen.width` (DIP).
- CSS size `devicePx / devicePixelRatio`, set as an unrounded px string. Position fixed at 0, 0.
- 2D context `{ alpha: false }`, `setTransform(1, 0, 0, 1, 0, 0)`, `imageSmoothingEnabled = false` before every `drawImage`. Fill the whole backing store `#000`, then `targetSource` draws at scale 1 at the top-left.
- **Verification in the page:** a `ResizeObserver` on the canvas with `{ box: 'device-pixel-content-box' }` gives the real number of device pixels the canvas covers, as Chromium lays it out. It must equal `canvasPx`. This is the strongest 1:1 check available from inside the renderer, and it's reported (8.4).
- Re-layout on a new session or `display` (section 8.12 asks Desktop for a display-update message), and on `matchMedia('(resolution: <dpr>dppx)')` change. Re-layout reallocates the canvas only when `canvasPx` changes.

### 8.4 What the page reports

Desktop's `OutputRenderReport` fields, filled as follows, plus the optional fields Output asks to add (8.12, O-7). Desktop's validator rejects unknown keys, so these must be in the contract before O4 lands.

```ts
interface OutputRenderReport {
  sessionRevision: number;           // revision of the session being drawn (not the last received)
  firstFrameDrawn: boolean;
  frame: number;                     // content frame of the last draw
  devicePixelRatio: number;
  viewportCss: Size;                 // innerWidth × innerHeight
  canvasPx: Size;                    // backing store
  outputPx: Size;                    // target.width × target.height
  browserFps: number;                // rAF callbacks per second over the last 2 s. Browser metric only
  lateFrames: number;                // since last report: rAF intervals > 1.5 × measured refresh period
  skippedFrames: number;             // since last report: content frames that should have been shown and weren't
  error?: string;
  // ── Proposed additions (optional, Output fills them) ──
  contentBoxDevicePx?: Size | null;  // ResizeObserver device-pixel-content-box; null until observed
  masterPx?: Size;
  sourceId?: string;
  errorCode?: OutputRenderErrorCode;
  cadence?: OutputCadence;           // 8.6
  limits?: { maxCanvasSide: number; maxCanvasArea: number; maxTextureSize: number; depthMaxSize: number | null };
}
type OutputRenderErrorCode =
  | 'PROJECT_INVALID' | 'UNKNOWN_OUTPUT'
  | 'SOURCE_UNKNOWN' | 'SOURCE_SETTINGS_INVALID'
  | 'ASSET_MISSING'          // test-card logo or face failed to load while the settings need it
  | 'GPU_UNAVAILABLE'        // Depth Studio without WebGL 2, or context lost
  | 'MASTER_TOO_LARGE'
  | 'DRAW_FAILED';
```

The 1:1 check Desktop runs on the first report (section 5, item 4) should use all three: `devicePixelRatio === scaleFactor`, `canvasPx === devicePx`, and `contentBoxDevicePx === devicePx`. When `devicePxExact` is false (fractional Windows scale) a ±1 difference is a warning, not `NOT_ONE_TO_ONE`.

### 8.5 Sources and their frozen settings

The registry's sources (`calibrationSource`, `depthSource`) read the editor's live stores on every `draw`, and those stores don't exist in the output window. The output uses the **frozen factories** the MP4 export already uses (`createCalibrationSource`, `createDepthSource`), through one Output-owned table. No module-contract change:

```ts
// src/modules/output/output-sources.ts
type OutputSourceId = 'calibration-test-card' | 'pixel-grid' | 'depth-scene';

/** Control window: the settings of the source as the operator sees it now. Also used by the MP4 export. */
export function frozenSettings(id: OutputSourceId): JsonValue;

/** Output window (and MP4 export): validate settings, load assets, check limits. Rejects with a code. */
export function createOutputSource(id: string, settings: JsonValue, master: Size): Promise<FrameSource>;
```

`studio-panel.tsx`'s `frozenSource` becomes a call to these two, so the operator's MP4 and the live output are built from the same settings by the same function.

| `source.id` | `source.settings` | Prepared before the first frame | Refuses with |
| --- | --- | --- | --- |
| `calibration-test-card` | `CalibrationSettings`: `{ mode: 'identification' \| 'calibration', logo: 'center' \| 'watermark' \| 'off' }` | `prepareCalibrationSource()`: logo and the `--font-cal-mono` face, both local assets under `app://` | `SOURCE_SETTINGS_INVALID` for any other key or value; `ASSET_MISSING` if `logo !== 'off'` and the logo didn't load |
| `pixel-grid` (new, 8.7) | `PixelGridSettings`: `{ space: 'master' \| 'display', motion: boolean }` | Nothing to load (no fonts beyond the face above) | `SOURCE_SETTINGS_INVALID` |
| `depth-scene` | The whole `DepthSceneConfig` (a few hundred bytes of JSON) | One `DepthRenderer`; `depthMaxSize()` checked against the master | `SOURCE_SETTINGS_INVALID` if `normalizeDepthConfig(settings)` isn't deep-equal to `settings` (the control window sends a normalized config, so any difference is a bug, never silently fixed); `GPU_UNAVAILABLE`; `MASTER_TOO_LARGE` |

Depth Studio's config is **not** in the project today (`depth-store.ts`: saving waits for the `modules[id]` section), so it must travel in `source.settings`. Section 4 says otherwise; see 8.12.

**Motion Lab patterns are not on the physical output in Alpha** (O-3). They aren't registered as a source yet (the adapter was part of L1), and the Alpha path needs only the test card, the pixel grid and Depth Studio. If the owner wants them, the row would be `{ pattern: PatternId, options: PatternOptions }` through `renderPattern` + `drawPattern` at scale 1, with no other change.

`DrawOptions.fontFamily` is passed as today (`"sans-serif"`); the test card and the grid use their own loaded face.

### 8.6 Content cadence vs the display's refresh

Three numbers, never confused: **content fps** (24/25/30/50/60, the clock's `fps`), **browser fps** (rAF callbacks per second, what Chromium delivers to this window), and **LED refresh** (set in the processor, thousands of Hz, invisible to Pixel Lab and never reported as anything).

**Which frame.** Desktop's formula (section 4) stays: `frame = startFrame + floor((t − epochMs) × fps / 1000)`. Output refines how `t` is taken, inside the page:

1. `t` is the rAF callback's own timestamp (`performance.timeOrigin + rafTimestamp`), which Chromium aligns to the vsync it's producing for, not `performance.now()` at some later point in the callback.
2. **Quantized to the refresh grid**, so jitter of a fraction of a millisecond can't flip `floor` at a frame boundary (a 60 fps clock on a 60 Hz display would otherwise show a random double and skip). With `P` the median rAF interval over the last 60 callbacks and `t0` the first rAF timestamp after the clock arrived: `t' = t0 + round((t − t0) / P) × P`. Re-anchor `t0` when `|t − t'| > P / 4` (display clock drift, a dropped vsync). Every window still computes a pure function of time, so outputs stay within one refresh of each other, as section 4 promises.

**Expected pattern.** Refreshes each content frame stays on screen, over one cycle:

| Content fps | 60 Hz display | 50 Hz display |
| --- | --- | --- |
| 24 | 3, 2 (uneven, classic pulldown) | 2 ×11, 3 (uneven) |
| 25 | 3, 2, 3, 2, 2 (uneven) | 2 (even) |
| 30 | 2 (even) | 2, 2, 1 (uneven) |
| 50 | 1, 1, 1, 1, 2 (uneven) | 1 (even) |
| 60 | 1 (even) | 1 frame in 6 never shown |

Pure function, unit-tested against this table:

```ts
// src/engines/output-layout.ts
interface OutputCadence {
  contentFps: ContentFps;
  refreshHz: number;        // DisplayInfo.refreshHz, or the measured rate when it is 0
  measuredHz: number;       // 1000 / P
  pattern: number[];        // refreshes per content frame over one cycle (capped at 1 s for 59.94-style rates)
  even: boolean;            // every entry equal and fps <= refreshHz
  repeated: number;         // since last report: content frames held longer than the pattern says
}
export function cadencePattern(fps: number, refreshHz: number): { pattern: number[]; even: boolean };
```

`skippedFrames` counts content frames the pattern says should have appeared and didn't (frame number jumped by more than the pattern allows); `lateFrames` counts rAF intervals over 1.5 P. Both reset at every report.

**Warning in the control window** (not on the wall) when `even` is false: "25 fps content on a 60 Hz display can't play evenly (3-2-3-2-2). Set the display to 50 Hz if it offers it, or use 30 or 60 fps." When `measuredHz` differs from `refreshHz` by more than 2 %: "This window receives 30 frames per second but the display runs at 60 Hz. Content may stutter." (that also catches Chromium syncing the window to another display's vsync, which must be checked on a real second display, O9).

### 8.7 The pixel-grid test card

A new deterministic source, `pixel-grid`, owned by Output: `src/engines/pixel-grid.ts` (pure geometry) and `src/modules/output/pixel-grid-source.ts` (the `FrameSource`). It exists to make any scaling, offset, crop or resampling visible, on a canvas capture, in a decoded MP4 and in a close-up photo.

Two spaces:

- `space: 'master'`: drawn on the master canvas inside each screen's `masterRect`, like the calibration card, then cut by the mapping. Proves the whole chain: mapping → slice copy → window → cable. This is the one exported to MP4 for Resolume.
- `space: 'display'`: the output runtime draws it **directly on the full `canvasPx`**, ignoring the mapping, plus a 1-px cyan line along the output's right and bottom edge when the output is smaller than the display. Proves the window → cable part alone, independent of any project. It's an output-only mode, not offered in the MP4 export.

Per rectangle (a screen region, or the whole display), all coordinates integers relative to the rectangle's origin, `w × h` its size:

| Element | Exact pixels | What it reveals |
| --- | --- | --- |
| Edge line | 1-px white (#FFF) on row 0, row h−1, column 0, column w−1 | Missing line = crop or 1-px offset on that side |
| Inner edge | 1-px black gap, then a 1-px white line at inset 2 | Gray instead of white-black-white = resampling at the edge |
| Corner markers | 16 × 16 squares at inset 4, TL red, TR green, BL blue, BR white; each with a 1-px black notch at its own corner | A wrong colour in a corner = flipped or rotated; a marker cut short = crop |
| Grid | 1-px #404040 lines every 10 px, 1-px #A0A0A0 lines every 100 px, from the origin | Uneven spacing = non-integer scale |
| Coordinates | Every 100-px crossing: text `x,y` in the rectangle's master (or display) coordinates, 11 px, in the calibration face | Reads the real position on the photo |
| Checker patches | 64 × 64 patches of 1 × 1 and of 2 × 2 black/white checker, and 64 × 64 of 1-px vertical and horizontal stripes (pitch 2), in a 128 × 128 block at the centre (rectangles from 160 × 160) and next to each corner marker (from 456 × 456, so blocks never touch); patch origin on even coordinates. Elements that don't fit a small rectangle are left out, never shrunk | 1:1 → crisp; any scale ≠ 1 or half-pixel offset → flat gray or moiré, visible even from a distance |
| Label | Centre: name, `w × h`, master origin, output origin (`SCR-03 · 640 × 360 · master 1280,0 · out 0,360`) | Which region is where |
| Motion marker (`motion: true`) | A 4 × 4 white square on rows 24–27 (below the corner markers) that moves 4 px right per content frame between x = 4 and w − 4, wrapping, so it never covers the edge lines | Repeated or skipped content frames in a slow-motion video of the display |

Colour lines are only in the corner markers, 16 × 16 at even coordinates, because H.264 4:2:0 halves chroma resolution: 1-px colour detail can't survive an MP4, 1-px white-on-black can (luma is full resolution). The 1 × 1 checker may still blur after H.264 compression; that's expected and recorded, not a failure of the mapping (the MP4 checks in O2 and 8.11 use only the probes that survive).

```ts
// src/engines/pixel-grid.ts, pure
type GridOp = { kind: 'rect'; x: number; y: number; w: number; h: number; color: string }
            | { kind: 'text'; x: number; y: number; text: string; color: string };
export function pixelGridOps(rect: { w: number; h: number }, label: GridLabel, opts: { motionFrame: number | null }): GridOp[];
/** The colour the card puts at (x, y) outside text boxes: the oracle the pixel tests compare against. */
export function expectedGridPixel(rect: { w: number; h: number }, x: number, y: number): [number, number, number] | 'text';
```

### 8.8 Pixel tests

**Unit tests (vitest, node, no canvas)**, in `tests/output-*.test.ts`:

- `outputLayout`: 1× 1920 × 1080; 2× 3840 × 2160 display with a 3840 × 2160 output (exact) and a 1920 × 1080 output (`smaller`, 1920 right / 1080 bottom black); output larger (cropped); mixed; Windows 125 % 1366 × 768 fixture (`canvasCss` 1092.8 px, `devicePxExact: false`).
- `cadencePattern`: every cell of the table in 8.6, plus 59.94 Hz.
- `pixelGridOps` / `expectedGridPixel`: every op integer and inside the rectangle; corner colours; checker parity; ops identical for the same input (determinism); text boxes reported so the comparers skip them.
- `createOutputSource` settings validation: each source, each bad value and unknown key → the right code.
- Assembly without a canvas: for Festival and for a fixture with non-zero slice offsets, the region list the output page uses is exactly `videoTargets(mapping)` for that output (it's the same call, the test guards against a second path appearing).

**Electron pixel tests** (`desktop/tests/output-pixels.test.cjs`, after D1–D5; runs on the dev Mac with no external display):

1. Open the output on the built-in display with `allowControlDisplay: true` and `pixel-grid` in `display` space. Main takes `webContents.capturePage()` after `firstFrameDrawn`.
2. The capture must be `devicePx` in size. If Electron returns it at another size, the test fails; it never resamples to compare. (Whether `capturePage` returns device px on a 2× display is the first thing this task measures.)
3. Compare ~2,000 probe pixels (all four corners and edges at offsets 0–3, the corner markers, every checker patch at full density, random grid points with a fixed seed) to `expectedGridPixel`, **exact match**, text boxes excluded.
4. Same with `space: 'master'` on a fixture project whose output has three slices at odd, non-zero offsets: probes at each slice's four corners in output coordinates.
5. **2× and 1×.** The built-in Retina display covers 2×. The same test runs a second time with the dev-only switch `--force-device-scale-factor=1` (test runner only, never in a packaged build) to cover 1×. A real 1× monitor is still checked physically (O10), because the switch is not the same thing as a 1× display.
6. **Mutation check.** The test must fail against two deliberately broken builds: canvas sized `innerWidth × innerHeight` (CSS px) and scaled by CSS, and smoothing on with a 0.5 px offset. A pixel test that passes against these proves nothing.

**Output = MP4** (Electron): for Festival's two outputs, frames 0 and 37 of the calibration card and the pixel grid, a hash of the capture's visible area equals a hash of `targetSource(...)` drawn off-screen by the export path at the same frame. Equality, not tolerance.

**Physical** [monitor físico]: the pixel grid in `display` space and then `master` space on an external monitor, photographed from 10–20 cm with a phone, at the monitor's native mode with scale 1, at a HiDPI mode with scale 2, and at one macOS *scaled* mode (expected to fail visibly: gray checker patches; the photo documents what the operator should look for). Pass = all four edge lines, both inner lines and all corner markers complete, and the 1 × 1 checker crisp. Photos go into `desktop/docs/TEST-RESULTS.md`.

### 8.9 Measured limits (O8)

Measured 2026-11-20 by `desktop/tests/smoke-scripts/o8-limits.cjs`, hidden smoke run (`npm --prefix desktop run test:smoke -- --smoke-script=…`), on the dev Mac:
- **Machine:** MacBook Pro MacBookPro18,4, Apple M1 Max, 32 GB, macOS 26.2.
- **Software:** Electron 43.8.10, Chromium 150.0.7871.250.
- **Display:** the hidden run's virtual display, 3600 × 2338 device px at scale 2, 120 Hz.
- **Workload:** Festival Main Stage OUT 1 (Processor A, 3072 × 1920). Every frame draws the whole 5120 × 1664 master, then cuts (O-1). 30 s per measurement after a 2 s warm-up.

| Limit | Value | How it was measured |
| --- | --- | --- |
| 2D canvas side | **65,535 px** works; 65,536 fails | Canvas `w × 1`, fill the far pixel, read it back. Over the limit Chromium gives **no error: the canvas stays blank** (reads 0, 0, 0). The runtime still refuses above 32,767 (`CHROMIUM_CANVAS_LIMITS`), unchanged; see O8's PR |
| 2D canvas area | **268,435,456 px** (16384 × 16384 and 32767 × 8192 work; 16385 × 16384 and 32767 × 8193 fail, silently) | Same round-trip |
| GPU texture side (`MAX_TEXTURE_SIZE`) | **16,384 px** | WebGL 2 in the output window (the report's `limits`). Festival's master (5120) is well under it. Canvases between 16,385 and 65,535 px a side are allowed by Chromium but may fall back to software; not measured |
| Depth Studio (`depthMaxSize()`) | **16,384 px** | `min(MAX_RENDERBUFFER_SIZE, MAX_VIEWPORT_DIMS)`, from the report. Festival (5120) plays at 1:1 (O7) |
| Memory per output window, Festival, test card | **Renderer 179–182 MiB** working set (peak 238); GPU process 106–108 MiB, against 99–103 MiB before opening | `app.getAppMetrics()`: the output window's renderer pid and the GPU process, while live. Apple Silicon shares memory between CPU and GPU, and IOSurface allocations may not all show in the GPU process |
| Same, pixel grid | Renderer 155–156 MiB; GPU process 105–106 MiB | Same |
| Same, Depth Studio | **Renderer 122–127 MiB**; GPU process 106–107 MiB | Same. The MSAA buffer at the master's size isn't visible as a jump in the GPU process's working set on this machine |
| First frame (open → live) | **660–697 ms** (one Depth Studio run 217 ms) | Control-window IPC to the controller's `live` state, per source and frame rate. That covers creating the window, loading the page, the session, preparing the source and drawing |
| Frame time and content rate | See the table below | The page's own paint record (testMode only), the reports' `browserFps`, `lateFrames`, `skippedFrames` and `cadence.measuredHz` |

| Source | Content fps | Content frames drawn / due | Paint ms (median / p99 / max) | Interval ms (median / p99) | Late / skipped |
| --- | --- | --- | --- | --- | --- |
| Calibration test card | 30 | 907 / 907 (100 %) | 4.5 / 4.8 / 5.3 | 33.3 / 42.1 | 0 / 0 |
| Calibration test card | 60 | 1814 / 1814 (100 %) | 4.1 / 4.3 / 4.6 | 16.7 / 25.1 | 0 / 0 |
| Pixel grid (motion) | 30 | 908 / 907 (100 %) | 4.6 / 6.0 / 8.9 | 33.4 / 36.0 | 3 / 0 |
| Pixel grid (motion) | 60 | 1813 / 1813 (100 %) | 2.8 / 3.4 / 3.7 | 16.7 / 18.8 | 0 / 0 |
| Depth Studio | 30 | 901 / 900 (100 %) | 0.8 / 1.3 / 1.8 | 33.3 / 42.3 | 0 / 0 |
| Depth Studio | 60 | 1801 / 1801 (100 %) | 0.8 / 1.2 / 2.8 | 16.7 / 19.5 | 2 / 0 |

`browserFps` was 120 and `measuredHz` 120.5 in every run.

- **What "paint" covers:** the CPU time of one paint: black fill, the source drawing the whole master, the slice copies. For Depth Studio that's the WebGL submission and the copy, not the GPU's own render time, which a hidden window can't time.
- **What "late" means:** a rAF interval longer than 1.5 refresh periods.

**Against the trigger for region rendering (8.2):** "O8 shows Festival can't hold the content rate, or `MAX_OUTPUTS` goes above 1."
- **Content rate:** Festival held both 30 and 60 fps with every source, with 0 skipped frames.
- **Headroom:** the slowest paint (pixel grid at 30 fps, max 8.9 ms) is about half a 60 fps frame (16.7 ms).
- **`MAX_OUTPUTS`:** still 1.
- **Verdict: the trigger isn't met; region rendering stays documented, not built.**

**What these numbers don't cover:**
- **A real display.** The hidden window's frames aren't a panel's vsync, so a frame rate held here doesn't prove the wall holds it. O9's cadence video is that check.
- **Other machines.** A venue laptop or an integrated GPU will be slower. Re-run the script there before a show.

### 8.10 Output tasks for Phase C

Small, in order. Each ends with `npm run typecheck && npm run lint && npm test` and, once Electron is involved, `npm --prefix desktop test` and a note in `desktop/docs/TEST-RESULTS.md`. **[monitor físico]** marks tasks that need a real external display.

| # | Task | Depends on | Acceptance criteria |
| --- | --- | --- | --- |
| O1 | **Layout and cadence, pure.** `src/engines/output-layout.ts`: `outputLayout`, `cadencePattern`, `contentFrame(clock, t, P, t0)` | — | Unit tests in 8.8 pass; every cell of the 8.6 table matches; no DOM import |
| O2 | **Pixel-grid card.** `src/engines/pixel-grid.ts`, `pixel-grid-source.ts`, registered in `output/module.ts`; its id added to `catalog.ts` with the Lead Architect's OK; a "Pixel test" fixture project (master 1920 × 1080, three screens, one 1920 × 1080 output with slices at odd non-zero offsets) under `tests/fixtures/` | — | Unit tests pass; the card shows in the Live preview and the MP4 export; frame 0 of a 1920 × 1080 export, decoded with WebCodecs in Electron, has **at least 99.9 %** of edge-line and 2 × 2-checker probes within ±8 luma, and every outlier is exact in the source canvas (owner decision, 2026-11-18: H.264 softens a few pixels at corners and macroblock edges; the physical 1:1 checks don't go through the codec and stay exact) |
| O3 | **Frozen source table.** `output-sources.ts`; `studio-panel.tsx` uses it | O2 | Settings tests for every code in 8.5; the MP4 panel's frame-0 preview canvas is pixel-identical before and after the refactor (hash, in the browser) |
| O4 | **Output page.** `src/app/output/page.tsx`, `output-runtime.ts`, CSS from 8.1, report from 8.4 | O1, O3, D4, report fields agreed (O-7) | Static export writes `output.html`; the page's chunks don't include `state/store`; in a browser without the preload it stays black with one console line; with D4's preload: first frame within 1 s of the session for Festival on the dev Mac; the DOM holds one canvas; a bad session keeps the previous one on screen and reports the code |
| O5 | **Electron pixel tests, 1× and 2×** | O4, D5 | 0 mismatched probes at 2× (built-in display) and at 1× (`--force-device-scale-factor=1`), in `display` and `master` space; both mutation builds fail; `contentBoxDevicePx === devicePx` in every report |
| O6 | **Output = MP4** | O5 | Hashes equal for Festival OUT 1 and OUT 2, frames 0 and 37, calibration card and pixel grid |
| O7 | **Depth Studio on the output** | O4 | Festival plays Depth Studio at 1:1 when `depthMaxSize() ≥ 5120`; a master over the limit reports `MASTER_TOO_LARGE` and stays black (forced with a fake limit in a test); a lost WebGL context reports `GPU_UNAVAILABLE` and recovers on restore |
| O8 | **Limits and performance** | O4, O7 | Every "to measure" row in 8.9 filled with the Mac model, macOS and Electron version; frame time (median and 99th percentile) and memory (process and GPU) for Festival Main Stage at 5120 × 1664 with the calibration card, the pixel grid and Depth Studio at 30 and 60 fps recorded (owner condition on O-1) |
| O9 | **Cadence on a real display** [monitor físico] | O4, D6 | Pixel grid with `motion: true`, 240 fps phone video of 10 s per content rate on a 60 Hz display (and 50 Hz if the monitor offers it): the counted pattern equals 8.6's table; 30 fps for 10 min with 0 `skippedFrames`; `measuredHz` within 2 % of the display's rate; the warning appears for uneven combinations |
| O10 | **Physical 1:1** [monitor físico] | O5, D6, D10 | Close-up photos pass the criteria in 8.8 at scale 1 and scale 2; the macOS scaled mode visibly fails; `sizeMatch` warning text checked for a smaller output on a HiDPI display |
| O11 | **Resolume Arena procedure** [monitor físico] | O2, O3 | 8.11 executed, every box filled with what was seen and photos, results in `docs/integrations/RESOLUME.md` |

**Risks.**

- `capturePage()` might return a DIP-sized image on 2× displays. Then O5 has to read the bitmap at the right scale factor or compare inside the page; known in the first hour of O5.
- `--force-device-scale-factor=1` is not a real 1× display; only O10 proves 1×.
- Chromium may not sync an output window's rAF to the external display's vsync on macOS (e.g. follow the primary display). O9 catches it via `measuredHz`; there's no fix in Alpha beyond the warning.
- Fractional CSS size on Windows may be snapped by Chromium's layout; `contentBoxDevicePx` would show it. Windows is not claimed.
- H.264 4:2:0 and compression blur 1-px colour and possibly the 1 × 1 checker in MP4s. The grid is designed around it (8.7); the Resolume check uses the probes that survive.
- Depth Studio's MSAA buffer at master size may cost more GPU memory than expected (O8).
- Text in the grid is anti-aliased; exact-match tests exclude text boxes, so a regression inside a label isn't caught by them.
- Every output window draws the whole master; fine for one output, to be re-measured before `MAX_OUTPUTS` > 1.

### 8.11 Resolume Arena test procedure

Resolume hasn't been tested with Pixel Lab yet. Nothing below assumes a result: each box records what was actually seen. Run it on the dev Mac with one external monitor at its native mode, scale 1. Results and photos go into `docs/integrations/RESOLUME.md`. No Arena preset file is generated (same rule as that document).

**Setup**

- [ ] Write down: Arena version, macOS version, Mac model, monitor model, its native resolution and refresh, cable/adapter.
- [ ] In Pixel Lab, open the "Pixel test" fixture (O2). Check it validates with no errors.
- [ ] Export the MP4 of the **master** (1920 × 1080), `pixel-grid` in `master` space, `motion: true`, 30 fps, 10 s.
- [ ] Export the MP4 of **OUT 1** (1920 × 1080), same card and settings.
- [ ] Export the Resolume package (slice tables, CSV, pixel-map guides, manifest, setup guide).
- [ ] Open Pixel Lab's own output window for OUT 1 on the monitor and take the reference close-up photos of the four corners and the centre. Close it.

**A. Per-output MP4, shown 1:1**

- [ ] Composition size = 1920 × 1080, frame rate 30.
- [ ] Advanced Output: the external monitor as the output device, at its native resolution; one slice, input = 0, 0, 1920, 1080, output = 0, 0, 1920, 1080.
- [ ] Drop the OUT 1 MP4 in a clip slot. Check the clip's reported size is 1920 × 1080 and that its transform does no fit, scale or offset.
- [ ] Close-up photos of the four corners and the centre. All four edge lines present: ☐ yes ☐ no (which side).
- [ ] Inner lines distinct from the edge lines (white-black-white, not gray): ☐ yes ☐ no.
- [ ] Corner markers: right colours, complete 16 × 16: ☐ yes ☐ no.
- [ ] 2 × 2 checker crisp: ☐ yes ☐ no. 1 × 1 checker: ☐ crisp ☐ blurred by the codec ☐ gray (scaled).
- [ ] Coordinates read on the photo match their position (e.g. `1000,500` sits at the 1000/500 crossing): ☐ yes ☐ no.
- [ ] Compared with the reference photos of Pixel Lab's own output: ☐ same ☐ different (describe).
- [ ] Black is black and white is full white (no lifted blacks from video-range levels), judged on the photo with fixed exposure: ☐ yes ☐ no.
- [ ] Motion marker steps evenly at 30 fps on the 60 Hz monitor (slow-motion video): ☐ yes ☐ no.

**B. Master MP4, cut by slices**

- [ ] Composition size = master size (1920 × 1080), 30 fps; master MP4 in a clip slot, no fit or scale.
- [ ] Advanced Output: enter every slice from the package's slice table by hand (input rectangle in master px, output rectangle in output px).
- [ ] Load the package's input guide and output guide images. Each slice outline sits exactly on its guide: ☐ yes ☐ no (which slice, how many px).
- [ ] On the monitor, every slice shows its own edge lines, corner markers and label (`SCR-xx · w × h · master x,y · out x,y`), and the label's numbers match the slice table: ☐ yes ☐ no.
- [ ] Where slices touch, no line is doubled or missing (no off-by-one at the seam): ☐ yes ☐ no.
- [ ] Compared with Pixel Lab's own output window of OUT 1: ☐ same ☐ different (describe).
- [ ] Repeat the A checks for corners, checker and levels on this output.

**Closing**

- [ ] Every "no" or "different" has a photo and a one-line description.
- [ ] Record what has to change in Pixel Lab, in the package, or in the procedure. Nothing is declared compatible with Resolume until A and B pass.

### 8.12 Output review of sections 1–7

**Agreed, no change:** main-only display detection and window creation; the window options and security settings of section 2 (Output adds nothing that needs `nodeIntegration`, a webview, extra preload functions or any network); black `backgroundColor`; no scaling anywhere in the shell; zoom locked at 1; the shared-epoch clock; explicit "Update output" (D-4); black window on failure (D-1); `MAX_OUTPUTS` as a constant; no preview cap.

**Objections and proposed changes** (Desktop's text is left as it is; these are for Desktop to accept or reject):

1. **Depth Studio settings aren't in the project.** Section 4 says Depth Studio's "`project.modules` entry is already in the project". It isn't: `depth-store.ts` says saving waits for the `modules[id]` section. Proposed: Depth's config travels in `source.settings` (8.5), well under the 1 MiB bound.
2. **Sources aren't looked up in the registry.** Section 4 says "the source is looked up by id in the module registry". The registry's sources read live editor stores. Proposed wording: "the source is created by id from its frozen settings (`createOutputSource`, section 8.5)".
3. **Display updates need a message to the output window.** Section 5 item 3 says `devicePx`, `scaleFactor` and `devicePxExact` reach the output window "again on every metrics change", but `OutputApi` has only `onSession` and `onClock`. Proposed: `onDisplay(cb: (d: DisplayInfo) => void)` on `output:display`, or re-sending `output:session` with the same `revision` and the new `display`. Output prefers `onDisplay`: a re-sent session would rebuild the source for nothing.
4. **Report fields.** Add the optional fields in 8.4 (`contentBoxDevicePx`, `masterPx`, `sourceId`, `errorCode`, `cadence`, `limits`) to `OutputRenderReport` and its validator, since unknown keys are rejected.
5. **Stronger 1:1 check.** Section 5 item 4 compares `viewportCss × devicePixelRatio` with `devicePx`. Add `canvasPx === devicePx` and `contentBoxDevicePx === devicePx`. With `devicePxExact: false`, a ±1 px difference should be a warning, not `NOT_ONE_TO_ONE`.
6. **`sizeMatch` needs a fourth value.** An output wider but shorter than the display is neither smaller nor larger. Add `'mixed'`, and carry the per-axis numbers (8.3 `croppedPx`, `blackPx`) so the warning can say how many pixels are cropped or black on each side.
7. **Clock sampling.** Keep the formula; Output takes `t` from the rAF timestamp and quantizes it to the refresh grid (8.6). Section 4's "`now()` = `performance.timeOrigin + performance.now()`" should read "a timestamp on that clock; output windows use the rAF timestamp".
8. **Session swap semantics.** "The output window swaps at the next frame" (section 3): Output adds that the swap happens only after the new session is fully prepared; if preparing fails, the previous session keeps playing and the report carries the error. A first session that fails leaves the window black (`opening` → `failed` via the report). Desktop's state machine should treat a report with `errorCode` and `firstFrameDrawn: false` during `opening` as `LOAD_FAILED`.
9. **Source errors.** Main can't validate `source.settings` (no registry, no schemas). Output validates and reports `SOURCE_UNKNOWN` / `SOURCE_SETTINGS_INVALID`. Desktop shows these like `PROJECT_INVALID`.
10. **D10 and O5/O10 overlap.** D10's close-up photo uses the pixel-grid card from O2; D10 should be scheduled after O2 and run together with O10, one session with the monitor.
11. **Rehearsal on the laptop.** O5's automated tests rely on `allowControlDisplay` (D-5); Output agrees with Desktop's draft (explicit toggle, off by default).
12. **Static export.** Section 2 states `assetPath` must serve `/output.html`; agreed. Output's page lives at `src/app/output/page.tsx` and inherits the root layout (fonts only); no other route or rewrite is needed.

### 8.13 Desktop response to 8.12

All twelve points accepted and applied to sections 1–7. No disagreement left.

| # | Point | Answer | Reason, and where it's applied |
| --- | --- | --- | --- |
| 1 | Depth settings aren't in the project | Accepted | Correct: `depth-store.ts` doesn't save yet. Section 4 now says the whole `DepthSceneConfig` travels in `source.settings` |
| 2 | Sources created from frozen settings, not the registry | Accepted | Registry sources read live stores that don't exist in the output window. Section 4 and the `OutputSession.source` comment |
| 3 | A display-update message | Accepted, `onDisplay` / `output:display` | Re-sending the session would rebuild the source for nothing. Added to `OutputApi`, to "Disconnect and reconnect" and to section 5 |
| 4 | Optional report fields | Accepted | The validator rejects unknown keys, so they belong in the contract now. Added to `OutputRenderReport` with bounds; D3 validates them |
| 5 | Stronger 1:1 check, ±1 as a warning when inexact | Accepted | `contentBoxDevicePx` is the best in-renderer evidence. Section 5 item 4; D3 tests it as a pure function |
| 6 | `sizeMatch: 'mixed'` and per-axis numbers | Accepted | Real case (wide, short output). `OutputStatus` gains `croppedPx` / `blackPx`; new row in section 5's table |
| 7 | Clock sampled from the rAF timestamp, quantized | Accepted | Same clock, better sample; formula unchanged. Section 4 comment |
| 8 | Swap only when fully prepared; failed first session → `failed` | Accepted | Never shows a half-built session. State machine, "Renderer failure" table and the `output:update` paragraph |
| 9 | Source errors validated and reported by the page | Accepted | Main can't load the app's parsers. Error table row for page codes; `OutputStatus.error.code` accepts them |
| 10 | D10 after O2, together with O10 | Accepted | Same photos, one monitor session. D10 updated; section 9 schedules them together |
| 11 | `allowControlDisplay` off by default | Accepted | Already the draft for D-5 |
| 12 | `output.html` served by `assetPath`, no other route | Accepted | Already in section 2 and D4 |

**Desktop review of section 8.** Agreed, with three clarifications, all now in sections 1–7 and none a disagreement:

- **8.1, "Main checks the same before opening".** Main can't run `parseProjectFile` or `resolveMapping`: it checks the envelope and that the output id exists. The control window validates before sending and the page is authoritative, which 8.1 already provides. Section 3 now says so.
- **8.8, `--force-device-scale-factor=1`.** Fine in the unpackaged test runner. The packaged build will refuse it like the debugging switches, so it can't break 1:1 in a show (section 5 item 5, task D3).
- **8.8, `capturePage()`.** Test harness only, behind `!app.isPackaged` and a test flag; no IPC channel returns captures (section 5 item 5).

Shell-side, the rest of section 8 needs nothing new: one canvas, no extra preload functions, no network, no `nodeIntegration`, CSS `cursor: none`, reports at 2 per second, which fits the `output:report` limit.

## 9. Implementation order (Desktop and Output)

One order for both lanes. Steps on the same line can run in parallel. The owner approved this document on 2026-11-18. Each task lands as its own small PR with evidence: what it implements, tests passed, what wasn't tested, what depends on external hardware, remaining risks. Alpha 0.1 isn't declared done until step 9 passes.

| Step | Task | Lane | Needs | Where |
| --- | --- | --- | --- | --- |
| 1 | D1 Window registry | Desktop | — | Dev Mac |
| 1 | O1 Layout and cadence, pure | Output | — | Dev Mac |
| 2 | D2 Displays | Desktop | D1 | Dev Mac |
| 2 | O2 Pixel-grid card + "Pixel test" fixture | Output | — | Dev Mac |
| 3 | D3 IPC validation (report fields, 1:1 check, scale-switch refusal) | Desktop | D1 | Dev Mac |
| 3 | O3 Frozen source table | Output | O2 | Dev Mac |
| 4 | D4 Output preload, allowlisted route, `output.html` in `assetPath` | Desktop | D1, D3 | Dev Mac |
| 5 | O4 Output page | Output | O1, O3, D4 | Dev Mac |
| 5 | D5 Open and close on the built-in display (stub page first, then O4's page) | Desktop | D2, D3, D4 | Dev Mac |
| 6 | D8 Failure handling | Desktop | D5 | Dev Mac |
| 6 | O5 Electron pixel tests, 1× and 2× | Output | O4, D5 | Dev Mac |
| 7 | O6 Output = MP4 | Output | O5 | Dev Mac |
| 7 | O7 Depth Studio on the output | Output | O4 | Dev Mac |
| 8 | O8 Measured limits | Output | O4, O7 | Dev Mac |
| — | O12 Operator controls: "Send to a monitor" in the Output studio (added 2026-11-20, #42), then the Update button and the sRGB warning | Output | D5, D7 | Dev Mac |
| 9 | **One session with the external monitor**, in this order: D6 full screen (decides native vs simple full screen) → sRGB colour check (section 2, Colour) → D7 disconnect / reconnect → D10 + O10 1:1 photos at scale 1, scale 2 and one scaled mode → O9 cadence (240 fps video) → O11 Resolume Arena procedure → D11 30-minute field rehearsal | Both | Steps 1–8; D6 first, since every later check needs the window in place | [monitor físico] |

D9 (clock across two displays) is in the backlog by owner decision; it isn't part of this session. If the monitor session finds a problem in D6, D7 or D10, the fix goes back to the dev Mac and the session repeats from D6.

