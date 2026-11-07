# Requirements

## Problem

Preparing an LED show means turning cabinets and screen layouts into exact pixel coordinates, re-entering them in the media server, and giving templates to content creators. Done by hand, one wrong pixel shows up on the wall during load-in.

## Users

LED and video technicians at Playground Studio. Later, other production companies as SaaS customers.

## Functional requirements

Status: ✅ implemented, ⚠️ implemented with a stated gap.

| Area | Requirement | Status |
| --- | --- | --- |
| Projects | Create, save, duplicate, reopen, with metadata | ✅ |
| Cabinets | Reusable profiles: size in mm, exact pixels, nominal pitch | ✅ |
| Screens | Add, configure cabinet rows and columns, duplicate, rename, group, delete | ✅ |
| Workspace | Zoom, pan, snapping, alignment, exact positioning | ✅ |
| Mapping | Separate physical, content and output models | ✅ |
| Mapping | Independent regions, shared canvases, custom coordinates, automatic bounds, master resolution | ✅ |
| Validation | Overlapping regions, invalid coordinates, impossible configurations, clear messages | ✅ |
| Export | PNG, SVG, JSON manifest, technical report, Resolume package, at exact pixels | ✅ |
| Resolume | Reliable manual workflow | ⚠️ Not yet followed in real Resolume ([details](../integrations/RESOLUME.md)) |
| Persistence | Reliable local storage, ready for later sync | ✅ |
| Offline | Works without a network | ⚠️ Data and logic are local, but the page itself must be served ([risk](../architecture/OVERVIEW.md#assessment)) |

## Quality requirements

- Pixel coordinates are exact integers, with explicit units and coordinate spaces.
- All technical calculation is deterministic and independent of the UI.
- Performance stays within the [budgets](../development/PERFORMANCE.md).

## Constraints

- Local-only storage until [Phase 5](ROADMAP.md#phase-5-saas-platform).
- Generic cabinet profiles only. Real product values come from supplier data sheets.

Future scope lives in the [roadmap](ROADMAP.md).
