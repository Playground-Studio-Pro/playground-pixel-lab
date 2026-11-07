# Architecture / Product Decisions

---
DATE: 2026-11-07
DECISION: No native Resolume preset generation yet. The package has a manual workflow, and the adapter has an explicit `nativePresetSupport: unsupported` slot.
WHY: The format isn't publicly documented, and no Resolume install was available to test a generated file. A corrupt preset found at load-in costs far more than typing slices.
IMPACT: Users enter slices by hand from the guide. See RESOLUME.md for what would change this.

---
DATE: 2026-11-07
DECISION: Physical lengths are stored as integer micrometres, and pixels as integers.
WHY: Exact arithmetic with no float drift, and no rounding that can hide an error.
IMPACT: Files store `widthUm: 500000`. The UI and manifest show millimetres, as strings formatted with integer maths.

---
DATE: 2026-11-07
DECISION: A region's size is not stored. It is always the screen's resolution.
WHY: Pixel-accurate 1:1 mapping is the product's core promise, and a stored size could drift out of sync.
IMPACT: Scaled regions aren't possible. Mixed-pitch scaling would need an explicit, separate feature.

---
DATE: 2026-11-07
DECISION: Mapping exports are blocked while validation has errors. The report and project file stay available.
WHY: Bad coordinates must not leave the app, but a report that lists the errors and a backup are still useful.
IMPACT: Warnings and notes never block.

---
DATE: 2026-11-07
DECISION: Storage is IndexedDB, with optimistic revision checks and debounced autosave.
WHY: Atomic transactions, larger capacity than localStorage, and the same conflict model cloud sync will need.
IMPACT: Data is per browser and per address. Project file export is the backup and transfer path.

---
DATE: 2026-11-07
DECISION: Importing a project file always creates a new project.
WHY: Opening a file should never overwrite existing work.
IMPACT: Importing the same file twice makes two projects.

---
DATE: 2026-11-07
DECISION: Library cabinets ship as generic profiles only, with no manufacturer names.
WHY: Inventing real product specs would be dangerous. Users enter values from the supplier's data sheet as custom profiles.
IMPACT: Generic profiles are read-only, and can be duplicated as custom.
