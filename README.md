# Playground Pixel Lab

Map LED screens to exact pixels and prepare them for Resolume.

## Status

Vertical slice working: create a project, build screens from cabinets, position them, calculate the master canvas, preview and export, save and reopen. See [docs/TASKS.md](docs/TASKS.md).

## Quick start

```bash
npm install
npm run dev     # http://localhost:3000
npm test
```

Projects are stored in the browser's IndexedDB, per browser and per address. Use **Export > Project file** for backups or to move a project to another machine.

## Workflow

1. **New project.**
2. **Add screen:** choose a cabinet or create one, then set columns and rows.
3. **Position** on the Content tab by dragging, with arrow keys, or by typing coordinates. The Physical tab holds the stage plan in mm; the Output tab holds positions in the video signal.
4. **Preview**, then **Export**. Exports that carry coordinates are blocked while Checks lists errors.

| Input | Action |
| --- | --- |
| Scroll, or Space + drag, or middle drag | Pan |
| Pinch, or ⌘ / Ctrl + scroll | Zoom |
| Arrow keys / Shift + arrow | Nudge 1 / 10 (px, or mm on Physical) |
| Shift + click, or drag on empty space | Multi-select |
| ⌘ + click | Select one screen inside a group |
| Ctrl while dragging | Bypass snapping |
| ⌘D / Delete / ⌘S / Esc | Duplicate / delete / save / deselect |

## Documentation

| File | Purpose |
|------|---------|
| docs/PROJECT_CONTEXT.md | Problem, user, objectives, constraints |
| docs/ARCHITECTURE.md | System design, components, data, dependencies |
| docs/DECISIONS.md | Permanent architecture and product decisions |
| docs/RESOLUME.md | What is known about Resolume compatibility, and how to verify a package |
| docs/TASKS.md | Current, next, later, and done work |
