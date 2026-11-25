# Workflow Sprint

**Status: plan, proposed 2026-11-24. Not approved to build.** The owner asked for planning only. Code starts after Alpha 0.1 passes and the owner approves this plan.

**Goal, in the owner's words:** "necesito que en el siguiente sprint pueda y entienda un flujo de trabajo de esta app".

**Done means:** a person who hasn't used Pixel Lab goes from a new project to an MP4 playing in Resolume, following the app and without help.

## What confuses today

Read in the code on `main` (7813fc9) and seen in the 2026-11-23 demo.

| # | Problem | Where |
| --- | --- | --- |
| 1 | "Content" and "Output" each mean two things: a canvas view (Physical / Content / Output) and a studio (Mapping / Content / Engineering / Output), in two bars, one above the other | `top-bar.tsx`, `studio-bar.tsx` |
| 2 | Exports are in two places: the Export menu (Resolume package, manifest, report, project) and Export MP4 inside the Output studio | `top-bar.tsx`, `output/studio-panel.tsx` |
| 3 | The test card is in three places: the Preview dialog, the Live preview menu and the Output studio. The Output studio copies the Live preview's choice once, then the two can differ | `studio-panel.tsx`, `motion-store.ts` |
| 4 | The Content studio has only Depth Studio. Patterns, test cards and Wall Build (PR 57) are in the Mapping studio's Live preview | `registry.ts`, `canvas-header.tsx` |
| 5 | Nothing says what comes next, or whether the project is ready to send | — |
| 6 | In a narrow window the top bar overlaps: "Fit to view" sat under Preview and opened it | Demo, browser pane about 1024 px wide |
| 7 | The Engineering studio is an empty placeholder in the main bar | `registry.ts` |

## The flow

Five steps, always visible, in the order a show is prepared. Each shows its state and one button that goes there. Steps guide; they never lock the app.

| Step | Ready when | Button goes to |
| --- | --- | --- |
| **1. Project** | A project is open | Start screen: new, import, example |
| **2. Screens** | At least one screen, every screen resolved, no validation errors | Mapping, with the first problem selected |
| **3. Content** | The operator chose the content to send | Live preview, content list |
| **4. Output** | Optional. An output is live | Output: monitor, colour profile, Open / Close |
| **5. Deliver** | The MP4 or Resolume package was saved and the project hasn't changed since | Output: export |

States: **to do**, **needs attention** (says why, in one sentence), **ready**, **optional**. A step never says ready by guessing:
- Ready comes from the resolved mapping, the validation issues and the real output state.
- "Delivered" means a file was saved in this session. It goes back to "needs attention" when the project, content or settings change.
- A live output never means the LED processor shows the right colours. Step 4 repeats the sRGB warning.

## Work, in order

| Id | Task | Lane | Size |
| --- | --- | --- | --- |
| W1 | Still mock-ups of the guide and the renamed bars, at 1280 and 1920 px wide. **The owner approves before any code** | Product Design | S |
| W2 | Pure `workflowSteps(input)` in `src/engines/workflow.ts`: state, reason and target per step. Unit tests for every state and change | Lead Architect | S |
| W3 | One content choice shared by Live preview and Output, in one store, so what you see is what you send. Wall Build listed with the other content | Lead Architect, with Output and Content | M |
| W4 | Guide panel (collapsible, remembers it per machine), and step buttons | Product Design | M |
| W5 | Clear names for the two bars; the Engineering studio hidden while empty; top bar that doesn't overlap from 1024 px | Product Design | M |
| W6 | One Deliver place: MP4 and Resolume package together, with what each is for and the next action in Resolume | Output Engineering | M |
| W7 | Wall Build in MP4 export, kept out of the output window until that's tested ([MODULES](MODULES.md#wall-build)) | Lead Architect + Output Engineering | S |
| W8 | A guided example and a one-page guide in Spanish, with screenshots taken from the app | Content Engineering | S |
| W9 | Usability check with the owner, and then with one person who hasn't used the app | Owner | S |

W1 and W2 can start together. W3 comes before W4, W6 and W7. W9 is the acceptance test.

## Acceptance

- The owner, with no help, does this from the app alone: new project → two screens from the catalog → test card → MP4 and package → plays in Resolume. Every place they stop or ask is written down.
- The same with one person who hasn't used the app.
- The content in Live preview and the content in the file are the same, checked by test.
- Each state change above has a unit test. No change to saved projects (`SCHEMA_VERSION`) or to exported bytes of existing content.
- Every screen works at 1024 px wide, with keyboard, and with reduced motion.
- The initial JavaScript stays inside its budget ([PERFORMANCE](../development/PERFORMANCE.md)), measured before and after.
- Outputs keep their rules: explicit Open, Esc / Close, no operator display without opt-in, Electron security unchanged.

## Not in this sprint

Processors, load, power and weight; the Nova setup sheet; Test card v2 with diagonal motion; ProRes; NDI; native Resolume presets; more Wall Build characters; a Spanish interface.

## Decisions for the owner

1. Approve this plan and its order.
2. Names. Proposed: the canvas views become **Stage / Canvas / Outputs**; the studios become **Map / Content / Output**.
3. Language. Proposed: interface in English as today, guide in Spanish.
4. Engineering hidden until it has something, with its future in [ROADMAP](ROADMAP.md).

## Dependencies

- Alpha 0.1's physical tests. If Resolume (O11) fails, its fix comes before W6.
- Wall Build (PR 57): engine review, then merge after Alpha 0.1 with the owner's approval. W7 needs it.
