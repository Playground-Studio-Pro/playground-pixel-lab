# Performance

Baselines and budgets. **Don't claim a performance change without before and after numbers from this method.**

## Baseline

Measured 2026-11-07 on commit `c17be93`: production build, Apple M1 Max, 32 GB, Chrome, 60 Hz display, Node 26, served from localhost.

**Read these with care.** This is a fast machine with no network, so numbers show relative cost and regressions rather than what a venue laptop would experience. Frame tests use synthetic input events, and most are single runs.

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
| First paint, repeat load | 40 to 136 ms (background only) |
| **First contentful paint, repeat load** | **332 to 348 ms** (4 samples) |
| Load event, repeat load | 39 to 138 ms |
| Cold first load | Load event 157 ms, 484 KB transferred. FCP read 2332 ms in one sample, taken as the tool opened the tab, so treat that FCP as unreliable |

The server sends an empty shell, so nothing meaningful paints until the 260 KB app chunk has loaded and run. That's the main gap between first paint and FCP.

### Editor frame times

Intervals between animation frames, in ms. 16.7 is a perfect 60 fps. Idle: p50 16.7, p95 17.3.

| Test (100-screen project unless noted) | p50 | p95 | Max | Frames over 20 ms |
| --- | --- | --- | --- | --- |
| Drag one screen | 16.7 | 32.9 | 66 | 11 of 179 |
| Drag all 100 screens | 16.7 | 17.4 | 67 | 3 of 179 |
| Marquee select | 16.7 | 17.7 | 50 | 2 of 59 |
| Wheel pan | 16.7 | 17.7 | 50 | 7 of 179 |
| **Pinch zoom** | 33.4 | 67 to 133 | 183 | 142 to 147 of 179 |

Pinch zoom by project size:

| Screens | Cabinets | p50 | p95 | Over 20 ms |
| --- | --- | --- | --- | --- |
| 1 | 8192 | 16.7 | 33.3 | 10 of 179 |
| 3 | 72 | 16.7 | 33.4 | 22 of 179 |
| 20 | 480 | 16.7 | 66.5 | 37 of 179 |
| 100 | 2000 | 33.4 | 133.3 | 142 of 179 |
| 500 | 2000 | 116.7 | 250.5 | 174 of 179 |

### Rendering bottleneck

**Zoom cost follows screen count, not cabinet count.** One screen with 8192 cabinets holds 60 fps at the median, while 500 screens with 2000 cabinets drop to about 9 fps. So the cabinet grid isn't the cost. The per-screen work is: each zoom frame re-renders `TopBar` and every `ScreenItem` (no `memo`) and rebuilds their Konva nodes, including screens outside the view.

This is inferred from the scaling and from reading the code. It hasn't been confirmed with a profiler.

### Exports

Time from click to finished file, one run each. Longest stall is the longest main-thread task.

| Project | Canvas | PNG | SVG | Resolume package | Longest stall |
| --- | --- | --- | --- | --- | --- |
| 3 screens | 1536 × 768 | 41 ms | 12 ms | 337 ms, 0.3 MB | 56 ms |
| 100 screens | 5120 × 6400 (33 MP) | 937 ms | 13 ms | 6.0 s, 8.8 MB | 269 ms |
| 1 screen at limit | 16384 × 8192 (134 MP) | 2.9 s | 9 ms | 10.8 s, 2.3 MB | 752 ms |

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
| JS heap, idle | 25 to 43 MB | Measured (`performance.memory`, coarse) |
| JS heap after 100-screen package | 94 MB, before collection | Measured |
| Canvas during PNG export | Width × height × 4: 131 MB at 33 MP, **537 MB at the limit** | Calculated. Not in the JS heap |
| Package export | Holds every finished PNG in memory until zipped. Canvases aren't released explicitly | From the code |

Total process and GPU memory were **not measured**. On a smaller laptop, the limit-size export is the most likely thing to fail. It did not fail on this machine.

## Budgets

| Metric | Budget | Baseline | Status |
| --- | --- | --- | --- |
| Initial JS, gzip | ≤ 190 KB | 172.8 KB | ✅ |
| App chunk, gzip | ≤ 280 KB | 260.3 KB | ✅ |
| Initial + app chunk, gzip | ≤ 460 KB | 433.1 KB | ✅ |
| FCP, repeat load on this baseline setup | ≤ 500 ms | 348 ms | ✅ |
| Drag, 100 screens, p95 | ≤ 20 ms | 17.4 to 32.9 ms | ❌ |
| Zoom, 3 screens, p95 | ≤ 34 ms | 33.4 ms | ✅ |
| Zoom, 20 screens, p95 | ≤ 34 ms | 66.5 ms | ❌ |
| Zoom, 100 screens, p95 | ≤ 50 ms | 133.3 ms | ❌ |
| PNG, 33 MP | ≤ 1.5 s | 0.94 s | ✅ |
| PNG, limit size | ≤ 5 s | 2.9 s | ✅ |
| Package, 100 screens | ≤ 10 s | 6.0 s | ✅ |
| Longest main-thread stall during export | ≤ 1 s | 752 ms | ✅ |
| `validateProject`, 500 screens | ≤ 16 ms | 3.8 ms | ✅ |

Size budgets are set just above the baseline, to stop growth. New dependencies must fit inside them or justify raising them. The failing budgets are the [Phase 1](../product/ROADMAP.md#phase-1-mapping-studio) rendering goal.

## Priorities

Effects are expectations until measured.

1. **Avoid unnecessary rerenders:** isolate `TopBar` from viewport changes and `memo` screen items. This addresses the only failing budgets.
2. **Efficient canvas rendering:** skip screens outside the view. Consider a Konva layer transform for zoom and pan rather than recalculating every node.
3. **Code splitting:** separate the start screen from the workspace, so Konva doesn't load until a project opens.
4. **Lazy loading:** keep JSZip lazy, and review `zod` and `next-themes`.
5. **Export:** release canvases after each image, and consider a worker if stalls cause real problems.

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

Keep the tab visible, and close other heavy work. Clear the origin's site data afterward. Record the commit, machine and any differences in method alongside new numbers.
