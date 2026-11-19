# Physical Output Contract

**Status: design draft, not approved.** Alpha 0.1 Phase C. Nothing here is implemented. Desktop Engineering wrote sections 1–7 (displays, windows, IPC, clock, scaling, tasks). Output Engineering adds rendering and pixel tests in section 8, then each lane reviews the other's part. The owner approves before any production code.

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
- **Full screen without interface:** after `ready-to-show`, main calls `setBounds(display.bounds)`, `setAlwaysOnTop(true, 'screen-saver')`, `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`, then on macOS `setSimpleFullScreen(true)` (no Spaces animation, menu bar and Dock hidden on that display) and on Windows `setFullScreen(true)`. Whether macOS native full screen or simple full screen behaves better with "Displays have separate Spaces" on and off must be tested on a real monitor (task D6).
- **Cursor:** the output page sets `cursor: none` on `html`. The window never takes focus by itself (`showInactive()`), so the control window keeps the keyboard. macOS shows the cursor again whenever it moves over the window; that's acceptable and is listed in the risks.
- **Zoom locked:** `setVisualZoomLevelLimits(1, 1)`, and main swallows ⌘ +/−/0 and Ctrl +/−/0 in `before-input-event`.
- **Esc closes, in main:** `webContents.on('before-input-event')` on the output window: Esc `keyDown` → close this output. It runs in the main process, so it works even when the output renderer is hung. A global shortcut is **not** registered (it would steal Esc from other apps); Esc works when the output window has focus, and the control window always has a Close button and `output:close`.
- **Independent close:** closing an output window changes nothing in the control window except its status. Quitting the app closes every output window. Closing the control window while outputs run is an owner decision (D-3).
- **Sleep:** while at least one output is `live`, main holds one `powerSaveBlocker.start('prevent-display-sleep')`; it stops when the last output leaves `live`. One blocker for all outputs, reference-counted.
- **Content protection is off.** `setContentProtection` would black the window out in screen recordings and some capture setups.

### State machine (one output)

```
           output:open
 closed ───────────────▶ opening ──(page ready, session sent, first frame)──▶ live
   ▲                        │                                                 │
   │                        └──(load failed, timeout 10 s)──▶ failed          │
   │                                                            │             │
   │                                                            │             │
   ├──────────────── output:close, Esc, app quit ◀──────────────┴─────────────┤
   │                                                                           │
   │                    display removed ┌──────────────────────┐               │
   │              ┌────────────────────▶│ waiting-display      │◀──────────────┘
   │              │                     │ window hidden, black │
   │              │                     └──────────┬───────────┘
   │              │   same display back (key match)│ → re-place, show → live
   │              │                                │ output:close → closed
   │                                               
   │   renderer gone / unresponsive 5 s
   └──────── failed ◀───────────────── live
              window black, never hidden behind the desktop; control window told
              output:retry → opening (one renderer reload, session re-sent)
```

```ts
type OutputState = 'closed' | 'opening' | 'live' | 'waiting-display' | 'failed';
```

### Disconnect and reconnect

- **Display removed.** Main hides the window at once (`hide()`) and moves to `waiting-display`. Otherwise macOS and Windows move orphaned windows to the primary display, which would cover the operator's screen with a full-screen test card. The window and its renderer are kept, so nothing reloads.
- **Display back.** When a display arrives whose key matches (section 1), main re-places the window, re-applies full screen, shows it inactive and returns to `live`. Automatic resume vs waiting for the operator is owner decision D-2; the draft assumes automatic, since a flickering cable shouldn't need someone at the laptop.
- **Metrics changed** (resolution, scale or rotation of the display in use). Main re-places the window to the new bounds and reports the new `devicePx`. If the output no longer matches it adds the `sizeMatch` warning. It never rescales content.

### Renderer failure

| Event | Main does | Screen shows | Control window gets |
| --- | --- | --- | --- |
| `render-process-gone` | State `failed`. Window kept, not hidden | Black (`backgroundColor`) | `output:status` with `error: RENDERER_GONE` and the reason |
| `unresponsive` for 5 s | State `failed`; Esc and Close still work (main-side) | Last frame, frozen | `RENDERER_UNRESPONSIVE` |
| `responsive` after that | Back to `live` | Animation resumes | Cleared |
| Page fails to load or never reports ready within 10 s | `failed` | Black | `LOAD_FAILED` / `OPEN_TIMEOUT` |
| `output:retry` | One reload of the fixed URL, session re-sent | Black, then content | `opening`, then `live` |

A failed output stays as a black full-screen window instead of closing, because closing would reveal the desktop on the LED wall. Owner decision D-1.

## 3. IPC

Channels are fixed strings. Every handler checks the sender like today's `assertSender`: exact `WebContents`, main frame only, and URL equal to the allowed URL **for that window's role**. Control channels accept only the control window. Output channels accept only the output window registered under that `outputId`. Payloads are validated in main with hand-written checks (desktop code has no schema library): unknown keys rejected, strings bounded, integers checked with `Number.isSafeInteger`.

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
  source: { id: string; settings: JsonValue };  // registry source id + its frozen settings, ≤ 1 MiB
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
  status(): Promise<OutputStatus[]>;                                        // output:status-all
  onStatus(cb: (s: OutputStatus) => void): () => void;                      // output:status (push)
  onDisplays(cb: (d: DisplayInfo[]) => void): () => void;                   // output:displays-changed (push)
}

interface OutputStatus {
  outputId: OutputId;
  state: OutputState;
  display: DisplayInfo | null;
  sessionRevision: number | null;
  sizeMatch: 'exact' | 'smaller-than-display' | 'larger-than-display' | 'unknown';
  render: OutputRenderReport | null;    // last report from the output window
  error: { code: OutputErrorCode; message: string } | null;
}

// ── Main → output window (send / on) ──────────────────────────────────────
// Main adds the display it placed the window on before forwarding the session.
interface OutputWindowSession extends OutputSession { display: DisplayInfo }

interface OutputApi {    // window.pixelLabOutput, output preload
  onSession(cb: (s: OutputWindowSession) => void): void;   // output:session
  onClock(cb: (c: OutputClock) => void): void;       // output:clock
  ready(): void;                                     // output:ready  (page loaded, listening)
  report(r: OutputRenderReport): void;               // output:report (≤ 2 per second)
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
  error?: string;                      // source or draw failure, short text
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
  | 'PROJECT_INVALID'        // projectText fails parseProjectFile / validateProject
  | 'LOAD_FAILED' | 'OPEN_TIMEOUT'
  | 'RENDERER_GONE' | 'RENDERER_UNRESPONSIVE'
  | 'NOT_ONE_TO_ONE';        // report shows devicePixelRatio or canvas size off (section 4)
```

| Code | When | State after | Operator sees |
| --- | --- | --- | --- |
| BAD_REQUEST, UNTRUSTED_SENDER | Validation in main | Unchanged | Logged; the UI shows "Output request rejected" |
| UNKNOWN_OUTPUT, PROJECT_INVALID | Before creating a window | closed | "Fix the mapping first", with the validation issue |
| DISPLAY_NOT_FOUND | Display gone between list and open | closed | Display list refreshed |
| DISPLAY_BUSY, CONTROL_DISPLAY, ALREADY_OPEN, TOO_MANY_OUTPUTS | Before creating a window | Unchanged | Reason next to the display picker |
| LOAD_FAILED, OPEN_TIMEOUT | During `opening` | failed, black | Retry / Close |
| RENDERER_GONE, RENDERER_UNRESPONSIVE | During `live` | failed, black or frozen | Retry / Close |
| NOT_ONE_TO_ONE | First report after `live` | live, with error set | Warning with measured vs expected sizes; content keeps running |

`output:update` replaces the session of a live output; the output window swaps at the next frame. Main keeps the latest session per output, so a retry or a reconnect re-sends it without asking the control window.

## 4. Data, sources and clock

**Session.** The output window receives `projectText` and parses it with the shared `parseProjectFile`, then `resolveMapping`, exactly as the editor does. No second mapping path. The source is looked up by id in the module registry, and `settings` is that source's frozen settings (for the test card: pattern and logo; for Depth Studio: its `project.modules` entry is already in the project). Which settings each source needs is Output's part (section 8). Desktop only carries them, bounded and as JSON.

**Edits don't go live by themselves.** The session is a snapshot. The control window sends `output:update` when the operator presses "Update output", so a half-edited mapping never reaches the wall. Owner decision D-4: explicit update (draft) vs live follow.

**Clock: recommendation — a shared epoch, controlled through main.**

```ts
type OutputClock =
  | { state: 'playing'; fps: ContentFps; startFrame: number; epochMs: number } // epochMs on the shared clock
  | { state: 'paused'; frame: number };
// In the output window, every requestAnimationFrame:
//   frame = startFrame + Math.floor((now() - epochMs) * fps / 1000)
// now() = performance.timeOrigin + performance.now(), in every process.
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
3. `DisplayInfo.devicePx`, `scaleFactor` and `devicePxExact` reach the output window in `OutputWindowSession.display`, and again on every metrics change, so Output doesn't guess them.
4. Main compares the first `OutputRenderReport` with the display: `devicePixelRatio === scaleFactor` and `round(viewportCss × devicePixelRatio) === devicePx`. Anything else raises `NOT_ONE_TO_ONE` with both values.

What Output must do (section 8): size the canvas backing store to `devicePx` exactly (not `innerWidth × devicePixelRatio`, which can be fractional), set its CSS size to `devicePx / devicePixelRatio`, draw the output at scale 1 at the top-left with smoothing off, and paint the rest black. No `setZoomFactor` tricks: zoom stays 1, and the canvas absorbs the ratio.

| Case | Expectation | Confirmable on |
| --- | --- | --- |
| macOS, processor input at native mode, scale 1 | Exact | macOS + external monitor [monitor físico] |
| macOS, HiDPI default mode, scale 2 | Exact: CSS px ×2 | macOS + Retina-class external monitor [monitor físico] |
| macOS, *scaled* mode | Framebuffer exact, panel resampled by macOS; invisible to Electron | Pixel-grid card on the real panel [monitor físico] |
| Windows 100 % / 125 % / 150 % / 175 % | Exact when `devicePxExact`; ±1 px at the edge otherwise | **Windows only, not claimed** |
| Output smaller than the display | Drawn 1:1 at top-left, black elsewhere, `sizeMatch: smaller-than-display` | Either |
| Output larger than the display | Cropped at right and bottom, never scaled, `sizeMatch: larger-than-display` | Either |

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
| D3 | **IPC validation.** `output-ipc.cjs`: pure validators for `OutputOpenRequest`, `OutputSession`, `OutputClock`, ids and sizes; error codes as in section 3 | Unit tests for each error code and each bound (16 MiB project, 1 MiB settings, id pattern, safe integers, unknown keys) |
| D4 | **Output preload and route plumbing.** `output-preload.cjs` with `window.pixelLabOutput` only; allowlisted URL per mode; `assetPath` serves `/output.html` | Smoke test extended: the output page has no `pixelLabDesktop`, no Node globals, sandbox and isolation on; navigating it elsewhere is blocked; a stub `output.html` loads under `app://` |
| D5 | **Open and close on the built-in display** (with `allowControlDisplay`) | `output:open` → `live` within 2 s with a stub page; Esc closes it from main even while the page runs `while(true){}`; Close from the control window works; `powerSaveBlocker` active only while live (asserted with `isStarted`); window never steals focus |
| D6 | **Full screen on an external display** [monitor físico] | Window covers the display exactly (`getBounds()` equals display bounds); no menu bar, Dock or title bar visible on that display; compared native vs simple full screen with "Displays have separate Spaces" on and off; the decision recorded |
| D7 | **Disconnect and reconnect** [monitor físico] | Unplugging hides the window within 500 ms and nothing appears on the laptop screen; replugging the same monitor restores `live` on it within 2 s; a different monitor doesn't take it over |
| D8 | **Failure handling** | Killing the output renderer (`process.crash()` in a dev-only hook) → `failed`, black window, status pushed within 1 s; a hung page → `RENDERER_UNRESPONSIVE` after 5 s; `output:retry` returns to `live` |
| D9 | **Clock relay** | Two output windows (`MAX_OUTPUTS` raised in a test build, on two displays, one of them can be the control display with `allowControlDisplay`) [monitor físico] report the same frame number at the same timestamp within 1 frame at 30 fps over 10 minutes; pause and seek reach both within 100 ms |
| D10 | **1:1 check** [monitor físico] | `NOT_ONE_TO_ONE` raised when a stub reports a wrong ratio; on the real external display at scale 1 and at scale 2, the report matches `devicePx` and the pixel-grid card (section 8) shows no resampling in a close-up photo |
| D11 | **Field rehearsal** [monitor físico] | Laptop + external monitor or processor input: open, run 30 minutes with no display sleep, Esc, reopen, unplug and replug. Results with photos in TEST-RESULTS |

**Risks.**

- macOS full-screen behaviour with separate Spaces may leave a menu bar or animate between Spaces on the output display (D6 decides).
- The cursor shows again whenever the mouse crosses the output display; `cursor: none` hides it only once it's over the page.
- Display identity across docks and adapters can change `Display.id`; the label+size fallback can confuse two identical monitors.
- A macOS scaled mode looks fine but isn't 1:1; only the pixel-grid card on the real panel catches it.
- Windows rounding at fractional scales is unverified until a Windows 11 machine is available.
- Large masters (Festival is 5120 × 1664) cost GPU memory per output window; two or more outputs need measuring before `MAX_OUTPUTS` goes above 1.
- Changing `main.cjs` from one window to a registry touches the IPC security code; D1 must keep every existing test green before anything else lands.

## Decisions for the owner

| # | Question | Draft position |
| --- | --- | --- |
| D-1 | On renderer crash or hang: keep a black full-screen window, or close it | Keep black: closing shows the desktop on the wall |
| D-2 | Monitor reconnects: resume automatically, or wait for the operator | Resume automatically on the same display |
| D-3 | Closing the control window while outputs run: keep them running, ask, or close them | Ask, with "Keep running" as default; quitting always closes all |
| D-4 | Edits reach a live output: on "Update output" only, or immediately | Only on "Update output" |
| D-5 | Allow an output on the control window's display (single-laptop rehearsal) | Allowed only with an explicit toggle, off by default |

## 8. Rendering and pixel tests (Output Engineering)

*To be written by Output Engineering:* the `output.html` page, how each source (calibration test card, Depth Studio, Motion Lab patterns) is drawn from an `OutputSession` at native size, canvas sizing from `devicePx`, the pixel-grid test card, pixel-sampling tests, frame-rate cadence on 50/60 Hz displays, and measured canvas and GPU limits. Desktop reviews this section.
