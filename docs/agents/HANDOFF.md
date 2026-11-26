# Handoff: Pixel Lab, sprint after Alpha 0.1 (2026-11-25)

## Latest update (end of 2026-11-25, read this first)
- **Guided LED flow:** PR 77 (`feature/guided-led`, stacked on 73).
  - Flow: drawing (PDF or image) → screens found → questions → review → test cards.
  - Mac app: (local build, not in the repo). Test drawings: (local build, not in the repo).
  - The owner is testing it.
  - Adds `pdfjs-dist`: the owner's OK is needed before merging.
- **Running in Mapping Engineering** (session `local_937e3517…`): split a screen across several outputs and processors.
  - **The owner decides in the flow** ("esas decisiones son las que quiero poder tomar en ese momento"). In Questions, only when they apply: split / bigger output / change cabinet or processor, where to cut (on whole cabinets), how many processors and outputs, and which part goes to which output.
  - A proposal is marked "proposed" and waits for confirmation.
  - If parts need a schema change, Mapping asks first, and it's decided with the owner.
  - **Decision for the owner:** splitting needs a schema change, 2 → 3. Proposal: `OutputSlice.parts?: [{ outputId, x, y, source }]`.
    - Without `parts`, projects read the same.
    - It touches 17 files, including Output's Resolume export.
    - Bring rotation and mirror into the same change.
    - Meanwhile Mapping does only the processor load and the warning with options. Done in `dffabfa`; the app is in (local build, not in the repo).
  - Found with the plenary at P2.6 (192 px): the centre screen is 5376 px wide, more than 3840. About 17 M px in total, at least 3 VX1000.
- **Arena: rotation, mirror and layer source,** read from a preset Arena saved: (local build, not in the repo). Next step: Pixel stores an angle and a mirror per screen and writes them to the preset. That needs a schema change, decided with the owner, done once.
- **Puebla, PR 76:** the review comment proposes scenes per screen (`composeScene`) and an open-door pose. The owner said the event used a **mask**: see (local build, not in the repo). Nothing implemented: waiting for the owner's OK and for the event's mask (PNG or SVG) and a photo.
- **Content:** the owner approved Flow/Aurora out (PR 75) and templates (PR 74), both done. Logo and video wait for a decision on media storage.
- **Nothing merged into `main`** (still `b433074`). Alpha 0.1 is still open.

Written by the Lead Architect (Claude) for whoever continues, such as Codex. The owner writes in Spanish and likes short answers.

## Where things stand
- `main` = `b433074`, CI green. **Nothing from this sprint is merged.** Every PR is a draft.
- **Alpha 0.1 is not finished.** Still pending: the 30-minute rehearsal (it covers Wi-Fi off and the reopen fix), Samsung, colours at a processor, licensed Arena, and Windows. Don't claim Windows support.
- **Test app with the whole sprint**, local only and never opened: (local build, not in the repo)
  - Built from a local merge of every sprint branch, in the scratchpad worktree `sprint`, commit `278021e`. Nothing was pushed.
  - 899 tests pass (1 skipped); typecheck and lint pass (0 errors, 2 warnings); the 108 desktop tests pass.
  - The app is not code-signed: ad-hoc signature with the icon added by hand. No smoke test was run, because the owner had Pixel Lab and Arena open.
  - Before opening it, quit the other Pixel Labs with ⌘Q. They share a profile and a single-instance lock.

## Sprint PRs (repo `Playground-Studio-Pro/playground-pixel-lab`)
| PR | What | Base | CI |
| --- | --- | --- | --- |
| 57 | Wall Build (LED workers) in Live preview | main | green |
| 67 | Every screen as one MP4 each, Wall Build export, in one ZIP | 57 | green |
| 75 | Content Flow and Aurora to MP4 and to the output window | 67 | running at last check |
| 66 | Typed values for Content | main | green |
| 71 | Saved looks in the project (`modules[...]`, no schema change) | main (stacked on 66) | green |
| 69 | Arena preset in the Resolume package, marked TEST | main | green |
| 72 | Live adjust (owner approved D-4 on 2026-11-25) | main | green |
| 68 | Live adjust measurements and design (docs only) | main | green |
| 70 | Fast map engine | main | green |
| 73 | Fast map interface, plus a fix so mapping shortcuts don't act in other studios | 70 | green |
| 74 | Content templates (PNG and SVG per screen, canvas and output) | main | green |
| 58 | Physical session handoff (docs, out of date) | main | green |

**Merge order:** 66 → 71; 57 → 67 → 75; 69; 72; 70 → 73; 74.
- Merge conflicts are only in append-only docs: `CHANGELOG.md`, `docs/development/PERFORMANCE.md` and `docs/agents/content-engineering.md`. Keep both sides.
- **Merge rules (owner):** an explicit OK per PR, CI green, no new commits since review. No rebase, no force push, no branch deletion. Command: `gh pr merge N --merge --match-head-commit <sha>`.
- **Before merging, check:**
  - Live (72): the hidden smoke test failed only on its own test script. The overlap pause and Close are covered by unit tests only. The owner chose to test it on the HP instead of more hidden runs.
  - Arena preset (69): proven with one Screen on Arena 7.28.1, macOS. Several Screens and Windows are not verified.
  - Flow and Aurora in the output window (75): not run in Electron.
  - Fast map: the 2-minute target is not measured.

## Test for the owner on the HP (1920×1080)
1. Open the test app. Use **Fast map**: paste the HP Stage list from (local build, not in the repo) and pick the cabinet size once per pitch.
2. Open the output on the HP. Turn on **Live**, move a screen with the arrows, and watch it on the wall. Check that an overlap pauses Live and that Close turns it off.
3. In Output, export Wall Build with **For → Every screen**: one ZIP, with one MP4 per screen.
4. Export the Resolume package and load the `_arena-preset_TEST.xml` file from `Documents/Resolume Arena/Presets/Advanced Output` in Advanced Output.
5. Time the run against Resolume. The goal is under 2 minutes for 8 screens.

## Rules that stay
- Never run Electron unless it's hidden with `--smoke-test`, and only with the owner's OK while their apps are open. Never run a visible fullscreen output on the primary display. Never set `allowControlDisplay` silently.
- Don't weaken Electron security. Don't integrate ProRes. Don't delete branches, worktrees or files. Keep `_backups/` and the sibling `desktop/` folder.
- Don't touch `CLAUDE_MASTER_PROMPT.md` or `START_HERE.md`. The repo is public: no photos or personal data.
- Each lane owns its files: see `docs/agents/README.md`. Engineering sessions use the worktrees in `agents/*`.

## Other files the owner uses
- (local build, not in the repo): the HP Stage guide, both demo projects, and the Arena preset that worked with a copy of what Arena saved.
- (local build, not in the repo): the approved fast map prototype.
  - Approved and done: #2 (Flow and Aurora out) and #3 (templates).
  - Next: the owner's own logo, image or video, after a decision on how media is stored with a project.

## Instructions for Codex (copy and paste)

> You are the Lead Architect of Pixel Lab. Read this file first, then `CLAUDE.md`, `SESSION.md` and `docs/agents/README.md` in the repo. Work in the worktree `the lead-architect worktree`, on a new branch `docs/sprint-handoff` from `origin/main`. Don't touch app code there. Reply to the owner in Spanish, briefly.
>
> 1. **Put the state in the repo:** one docs PR.
>    - Copy this file to `docs/agents/HANDOFF.md`. Remove anything personal and paths outside the repo, because the repo is public.
>    - Update `SESSION.md`: date, `main`, the table of open PRs and the merge order, what's tested and what isn't, and Alpha still open.
>    - In `docs/integrations/RESOLUME.md`, add the result of the preset that worked: Arena 7.28.1, macOS, one Screen, 8 slices matching to the pixel. Don't commit the owner's Arena files.
>    - In `docs/product/WORKFLOW.md`, add the approved fast map (prototype in (local build, not in the repo), kept out of the repo) and "Live approved by the owner, 2026-11-25".
>    - Mark PR 58 as replaced by this one. Don't close it without asking.
>    - The PR states what changes, what was checked and what's still pending. CI must be green. Ask the owner before merging.
> 2. **Review the sprint PRs** in the merge order above:
>    - Read each diff and check CI. Confirm no new commits since your review.
>    - Ask the owner's OK for each one, then merge with `gh pr merge N --merge --match-head-commit <sha>`.
>    - If a conflict shows up outside the append-only docs, stop and report.
> 3. **After every merge:** run `npm run typecheck`, `npm run lint`, the full tests and `npm --prefix desktop test` on `main`. If any of them fails, stop.
> 4. **Final app:** `npm --prefix desktop run pack:mac`.
>    - Copy the app to (local build, not in the repo), put the icon in `Contents/Resources/electron.icns`, and sign it with `codesign --force --deep -s -`.
>    - Don't replace `/Applications/Pixel Lab.app` without the owner's OK.
> 5. **Never:** force push, rebase, delete branches, run visible Electron, weaken security, or declare Alpha or Windows done.

## Pending
1. The owner tests the app on the HP, then merges PR by PR with an OK for each.
2. Alpha 0.1 physical tests.
3. Update docs: SESSION, the Resolume results, and close out PR 58.
4. Later: logo and video, the workflow sprint (`docs/product/WORKFLOW.md`), the top bar that overlaps at 1024 px, and a typed colour for screens in the inspector.
