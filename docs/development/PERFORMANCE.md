# Performance

Baselines and budgets. **Don't claim a performance change without before and after numbers from this method.**

## Baseline

Measured 2026-11-07: production build, Apple M1 Max, 32 GB, Chrome 156, 60 Hz display, Node 26, served from localhost. The app chunk has the same content hash on commit `c17be93` and on the Phase 0 branch, so these numbers describe the MVP.

**Read these with care.** This is a fast, idle machine with no network, so the numbers show relative cost and catch regressions. They don't predict a venue laptop. Frame tests use synthetic input events.

### Bundle

| | Raw | Gzip |
| --- | --- | --- |
| Initial JS (7 files, before the app loads) | 562 KB | **172.8 KB** |
| App chunk, loaded right after (`ssr: false`) | 831 KB | **260.3 KB** |
| JSZip chunk, on demand at package export | 190 KB | 55 KB |
| CSS | 57 KB | 10 KB |
| Fonts (2 Inter subsets) | 45 KB | n/a |
| HTML | 6.4 KB | n/a |

### Largest dependencies

Module sizes before bundling, from `next analyze`. They overlap with the table above.

| Package | Raw | Where |
| --- | --- | --- |
| `next` (with React DOM) | 667 KB | Initial |
| `konva` | 192 KB | App chunk |
| `@base-ui/react` | 186 KB | App chunk |
| `react-reconciler` (for `react-konva`) | 129 KB | App chunk |
| `zod` | 106 KB | App chunk |
| App code (`src/`, all layers) | about 113 KB | App chunk |
| `jszip` + `pako` + `lie` | 90 KB | On demand |
| `sonner` | 35 KB | App chunk |
| `cn` | 26 KB | App chunk |

### Initial route

| Metric | Result |
| --- | --- |
| HTML response time | 1.4 ms (18 ms first request) |
| First paint, repeat load | 44 to 212 ms (background only) |
| **First contentful paint, repeat load** | **344 to 428 ms** (6 samples) |
| Load event, repeat load | 35 to 195 ms |
| Cold first load | 484 KB transferred, load event 157 ms. Timing is a single sample and FCP wasn't reliable, so treat cold load as not yet measured |

The server sends an empty shell, so nothing meaningful paints until the 260 KB app chunk has loaded and run. That's the main gap between first paint and FCP.

### Editor frame times

Intervals between animation frames, in ms. 16.7 is a perfect 60 fps. Each cell gives the range of p95 across repeated runs of 180 frames: 4 for zoom, 3 for drag, 2 for pan. p50 was 16.7 in every run.

| Screens | Cabinets | Zoom p95 | Over 20 ms | Drag one, p95 | Pan p95 |
| --- | --- | --- | --- | --- | --- |
| 1 | 8192 | 17.9 to 18.0 | 0 | 17.8 to 18.0 | 18.2 to 18.3 |
| 3 | 72 | 17.9 to 18.2 | 0 | 18.1 to 18.3 | 18.1 to 18.2 |
| 20 | 480 | 17.9 to 18.3 | 0 | 18.2 to 18.4 | 18.2 to 18.3 |
| 100 | 2000 | 17.5 to 18.1 | 0 | 17.5 to 17.8 | 18.1 to 18.3 |
| 500 | 2000 | **33.3** | 15 to 19 of 179 | Invalid: selected nothing | 17.4 to 17.9 |

Dragging all 100 screens at once: p95 18.4 to 18.6, with no frames over 20 ms.

### Rendering

**The editor holds 60 fps through 100 screens on this machine.** Zoom begins to drop frames only at 500 screens, well beyond a typical show.

The first drops follow screen count rather than cabinet count: one screen with 8192 cabinets stays smooth, while 500 screens with 2000 cabinets don't. That fits the code, where each zoom frame re-renders `TopBar` and every `ScreenItem` (no `memo`) and rebuilds their Konva nodes, including screens outside the view. It's inferred from scaling and reading the code, and hasn't been confirmed with a profiler. There's no measured need to change this yet.

### Exports

Time from click to finished file, as the range over repeated runs (3 runs, or 2 at the limit). Longest stall is the longest main-thread task.

| Project | Canvas | PNG | SVG | Resolume package | Longest stall |
| --- | --- | --- | --- | --- | --- |
| 3 screens | 1536 × 768 | 15 to 24 ms | 2 to 5 ms | 108 to 143 ms, 0.3 MB | Under 50 ms |
| 20 screens | 2560 × 3072 (8 MP) | 66 to 70 ms | 2 to 4 ms | 452 to 466 ms, 1.7 MB | Under 50 ms |
| 100 screens | 5120 × 6400 (33 MP) | 190 to 211 ms | 4 to 6 ms | 1.3 s, 8.8 MB | 58 to 79 ms |
| 1 screen at limit | 16384 × 8192 (134 MP) | 552 to 692 ms | 6 to 7 ms | 2.1 to 2.3 s, 2.3 MB | 192 to 323 ms |

### Measurements under system load

An earlier session on the same code gave far worse numbers, and they didn't reproduce on an idle machine:

| Test | Under load | Idle |
| --- | --- | --- |
| Zoom, 100 screens, p95 | 67 to 133 ms | 18 ms |
| Zoom, 500 screens, p50 / p95 | 117 / 251 ms | 16.7 / 33 ms |
| PNG, 33 MP | 937 ms | 200 ms |
| Package, 100 screens | 6.0 s | 1.3 s |
| Package, limit size | 10.8 s | 2.2 s |

The cause wasn't identified. That session followed a fresh install of about 600 MB, and iCloud Drive was later seen using a full CPU core on this machine, so [background syncing](TESTING.md#environment) is a possibility, but this is unconfirmed. These aren't a baseline. They are a warning: a busy or slower machine could plausibly see costs this high, and **nothing has been measured on venue-class hardware**.

### Pure engines

Median ms, from `npm run perf:engines`.

| Project | `resolveMapping` | `validateProject` | Scene + SVG |
| --- | --- | --- | --- |
| 100 screens | 0.04 | 0.22 | 0.42 |
| 500 screens | 0.21 | 3.81 | 1.25 |

Validation is O(n²) in screens, and runs on every edit. At 500 screens it's still well under a frame.

### Memory

| Item | Finding | Basis |
| --- | --- | --- |
| JS heap, typical | 29 to 87 MB during the runs above | Measured (`performance.memory`, coarse) |
| Canvas during PNG export | Width × height × 4: 131 MB at 33 MP, **537 MB at the limit** | Calculated. Not in the JS heap |
| Package export | Holds every finished PNG in memory until zipped. Canvases aren't released explicitly | From the code |

Total process and GPU memory were **not measured**. On a smaller laptop, the limit-size export is the most likely thing to fail. It did not fail on this machine.

## Budgets

| Metric | Budget | Baseline | Status |
| --- | --- | --- | --- |
| Initial JS, gzip | ≤ 190 KB | 172.8 KB | ✅ |
| App chunk, gzip | ≤ 280 KB | 260.3 KB | ✅ |
| Initial + app chunk, gzip | ≤ 460 KB | 433.1 KB | ✅ |
| FCP, repeat load | ≤ 500 ms | 344 to 428 ms | ✅ |
| Zoom, 100 screens, p95 | ≤ 20 ms | 18.1 ms | ✅ |
| Zoom, 500 screens, p95 | ≤ 34 ms | 33.3 ms | ✅ (at the limit) |
| Drag all, 100 screens, p95 | ≤ 20 ms | 18.6 ms | ✅ |
| PNG, 33 MP | ≤ 500 ms | 211 ms | ✅ |
| PNG, limit size | ≤ 1.5 s | 692 ms | ✅ |
| Package, 100 screens | ≤ 3 s | 1.3 s | ✅ |
| Longest main-thread stall during export | ≤ 500 ms | 323 ms | ✅ |
| `validateProject`, 500 screens | ≤ 16 ms | 3.8 ms | ✅ |

These budgets apply to this reference machine, idle, and exist to catch regressions. Size budgets sit just above the baseline to stop growth, so new dependencies must fit inside them or justify raising them. Venue-laptop budgets can only be set after measuring one.

## Priorities

Effects are expectations until measured. Don't optimize without a failing measurement.

1. **Measure on venue-class hardware.** The biggest unknown, and it decides whether anything below is urgent.
2. **Code splitting:** the only measured user-facing gap. Separate the start screen from the workspace, so Konva doesn't load until a project opens.
3. **Lazy loading:** keep JSZip lazy, and review `zod` and `next-themes`.
4. **Avoid unnecessary rerenders:** isolate `TopBar` from viewport changes and `memo` screen items, when a measurement calls for it.
5. **Efficient canvas rendering:** skip screens outside the view, or use a layer transform for zoom and pan, when a measurement calls for it.
6. **Export memory:** release canvases after each image, and test the limit size on a smaller machine.

## How to measure

Use a throwaway clone so that fixtures and builds stay out of the working copy.

```bash
git clone <repo> /tmp/ppl-perf && cd /tmp/ppl-perf && npm ci
PERF_OUT=public/perf npm run perf:engines       # timings in public/perf/engines.txt, plus fixtures
cp scripts/perf/browser-harness.js public/perf/
npm run build
npm run perf:bundle                             # sizes. Add -- --check to enforce budgets
npx next analyze --output --snapshot base       # per-package composition
npx next start -p 3212
```

In Chrome, on `http://localhost:3212`, in the DevTools console:

```js
await import("/perf/browser-harness.js");
ppl.loadMetrics();                  // after a reload, for repeat-load numbers
await ppl.importFixture("large");   // small, medium, large, n500, limit
await ppl.measureZoom();
await ppl.measureDrag();            // moves content: re-import before exports
await ppl.importFixture("large");
await ppl.measureExports();         // captures files in memory, no downloads
```

**Rules, learned the hard way**
- Confirm the machine is idle first. `await ppl.frames(90)` should give a p95 near 17 ms, and no install, build or indexing should be running.
- Repeat every test and report the range. A single run can be wrong by a factor of five.
- If a result surprises you, check that the test really did the work. `measureDrag` reports what it selected: an empty `selection` makes the run invalid.
- Keep the tab visible. Clear the origin's site data afterward.
- Record the commit, machine and any differences in method alongside new numbers.
