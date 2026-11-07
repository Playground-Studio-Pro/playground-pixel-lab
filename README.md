# Playground Pixel Lab

Map LED screens to exact pixels and prepare them for Resolume. A professional tool for audiovisual production, used by Playground Studio.

**Status:** working MVP. See [SESSION.md](SESSION.md) for the current state and [ROADMAP](docs/product/ROADMAP.md) for what's next.

## Quick start

Requires Node.js 24 or later. Keep the repository outside folders synced by iCloud Drive or similar services. [Here's why](docs/development/TESTING.md#environment).

```bash
npm install
npm run dev     # http://localhost:3000
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm test` | Unit tests |
| `npm run typecheck` | Generate route types, then type-check |
| `npm run lint` | ESLint |
| `npm run build` | Production build |
| `npm run perf:bundle` | Bundle size report, after a build |
| `npm run perf:engines` | Engine timings and stress fixtures |

Projects are stored in the browser's IndexedDB, separately for each browser and address. Use **Export > Project file** for backups or to move a project to another machine.

## Using it

1. **New project.**
2. **Add screen:** choose a cabinet or create one, then set columns and rows.
3. **Position:** Content holds pixel positions on the master canvas, Physical holds the stage plan in mm, and Output holds positions in the video signal.
4. **Preview**, then **Export**. Exports that carry coordinates are blocked while Checks lists errors.

| Input | Action |
| --- | --- |
| Scroll, Space + drag, or middle drag | Pan |
| Pinch, or ⌘ / Ctrl + scroll | Zoom |
| Arrow keys / Shift + arrow | Nudge 1 / 10 (px, or mm on Physical) |
| Shift + click, or drag on empty space | Multi-select |
| ⌘ + click | Select one screen inside a group |
| Ctrl while dragging | Bypass snapping |
| ⌘D / Delete / ⌘S / Esc | Duplicate / delete / save / deselect |

## Documentation

Start with [CLAUDE.md](CLAUDE.md), which holds the engineering rules and a map of all documents.
