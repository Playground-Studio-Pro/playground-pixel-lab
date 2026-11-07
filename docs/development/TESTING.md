# Testing

## Run before every PR

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

[CI](../../.github/workflows/ci.yml) runs the same four checks on a clean checkout, on every pull request and on pushes to `main`.

**Passing locally isn't proof of a clean checkout.** Generated files can hide problems, as with the route types that made `tsc` pass only after a build. When changing tooling, test from a fresh `git clone` with `npm ci`.

## Environment

**Don't develop inside a synced folder.** iCloud Drive syncs `~/Documents` on this development machine, and it creates duplicates such as `.next/types/routes.d 2.ts`. These break `tsc` with `Duplicate identifier` errors, and 360 had appeared in `node_modules` when this was found. Heavy syncing also competes for CPU during builds and measurements.

If this happens, delete `.next` and `node_modules`, then run `npm ci`. The lasting fix is to keep the repository in a folder that doesn't sync.

## Unit tests

Vitest, in `tests/`. Fast (about 1 s) and in Node, with `fake-indexeddb` for storage.

| File | Covers |
| --- | --- |
| `units.test.ts` | Integer enforcement, mm parsing and formatting |
| `mapping.test.ts` | Screen specs, geometry, master and canvas calculation, independence of the three layouts |
| `validation.test.ts` | Each issue type, exact overlap reporting, severity order |
| `ops.test.ts` | Impossible configurations, screen operations, snapping, alignment, viewport |
| `exports.test.ts` | Scene geometry, SVG, PNG header, manifest, report, Resolume adapter and package |
| `persistence.test.ts` | File round trip, corrupted data, IndexedDB, revision conflicts |
| `history.test.ts` | Undo history core: order, redo clearing, merging repeats, limit, save revision kept; undo and redo shortcuts |
| `store-history.test.ts` | Undo and redo through the real store and IndexedDB for every kind of edit, plus saving after undo, selection and project switching |

**Rules**
- Engines and exports get unit tests, with values worked out by hand rather than copied from output.
- Test the error message when it's the point: users act on those messages.
- Shared fixture: `threeScreenProject()` in `tests/helpers.ts` gives a known 2432 × 768 project.

## Not covered by unit tests

| Area | How it's checked today |
| --- | --- |
| Konva canvas, gestures, dialogs, keyboard shortcuts | Manual acceptance run |
| PNG pixels in a real browser | Manual acceptance run |
| Resolume behaviour | [Not yet tested](../integrations/RESOLUME.md#first-real-world-check) |

Automated browser tests are a [Phase 1](../product/ROADMAP.md#phase-1-mapping-studio) decision. They'd add a dependency, so they need a stated reason first.

## Manual acceptance run

Run against a production build (`npm run build && npm start`) when canvas, state, persistence or exports change.

1. Create a project.
2. Add a screen with a generic cabinet, and another with a new custom cabinet. Saving the cabinet returns to Add screen with it selected.
3. With a 128 × 128 cabinet, add Left 4×6, Center 12×6 and Right 3×5.
   - **Expect:** master canvas **2432 × 768**, with Right at x = 2048.
4. Drag Right onto Center.
   - **Expect:** an overlap error with its exact area, and mapping exports disabled. The technical report and project file stay enabled.
5. Drag Right back. It snaps to (2048, 0). Arrow keys move it 1 px, Shift + arrow 10 px.
6. Open Preview and check the size shown. Check the Physical view (mm) and the Output view.
7. Export PNG, SVG, manifest and Resolume package.
   - **Expect:** the PNG is exactly 2432 × 768. White border pixels at x = 511, 512, 2047 and 2048. Row y = 639 is white under Right, and y = 640 is background.
   - **Expect:** the zip contains README, manifest, CSV, report, project file and all pixel maps.
8. Export the project file, reload, and export it again.
   - **Expect:** the two files are byte-identical.
9. Duplicate the project, open the original from the list, and delete the copy after confirming.
10. Undo and redo with ⌘Z and ⇧⌘Z:
    - Delete a screen, then undo and redo it. Drag a screen, then undo it.
    - Press an arrow key several times quickly. **Expect:** one undo returns the screen to where it started.
    - Change columns and the cabinet in the inspector, and a mapping setting such as "Same as content position". Undo each.
    - Type in a text field without applying it, then press ⌘Z. **Expect:** only the typed text is undone, not the project.
    - Reload after undoing. **Expect:** the project reopens as it was left, and Undo is disabled, because history isn't stored.

Performance measurement is covered in [PERFORMANCE](PERFORMANCE.md).
