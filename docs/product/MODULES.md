# Customization and Modules

**Status: proposal, not approved.** Written 2026-11-07 for the design and product reviews. Nothing here is in the [ROADMAP](ROADMAP.md) yet. Each item needs approval before work starts, and some change scope that the roadmap currently excludes; those are marked.

It covers four topics:
1. Demo projects.
2. Making the interface customizable.
3. A module contract, so features can be added without growing the core.
4. Candidate functional modules: content templates, quick video, NDI output and video generation.

## 1. Demo projects

**Today.**
- **Festival Main Stage:** a realistic six-screen show, kept in [`examples/`](../../examples/). Its builder and test are described in [TESTING](../development/TESTING.md#unit-tests).
- **Motion Lab acceptance:** the three-screen project from `motionLabProject()`.
- **Perf fixtures:** `perf-500` and the others come from `npm run perf:engines`. They're stress tests, not demos. `perf-500` is 500 identical 256 × 256 screens in a 25 × 20 grid, built only to measure speed. Its output in `public/perf/` is gitignored.

**Example gallery: built** on `feat/example-gallery`, as described below, with four examples: Festival Main Stage, Corporate Keynote, Motion Lab acceptance and a 500-screen stress test. Examples are built in the app by pure builders loaded on first use, instead of fetched files.

**Original proposal:**
- **Open example:** opening one creates a new local copy through the normal import path, so it passes `parseProjectFile` and the shipped file is never edited.
- **Content:** Festival Main Stage, Motion Lab acceptance, and two or three more real show shapes, such as a corporate stage with side screens, a touring wall with delay screens, and a stress test labelled as one.
- **Kept in sync:** each example has a builder and a test, as Festival Main Stage does, so a schema change can't silently break it.
- **Bundle:** examples are fetched on demand from a static folder, so the initial bundle doesn't change. The cost is a few KB of JSON each.
- **Size:** small, about one PR, with no new dependencies. It fits Phase 1.

## 2. Customization

**What exists.**
- **Tokens:** 58 CSS custom properties in `src/app/globals.css`, with direction in [DESIGN_SYSTEM](DESIGN_SYSTEM.md).
- **Components:** shadcn/ui on Base UI.
- **Layout:** fixed, with the explorer on the left, the canvas in the center, the inspector on the right and actions on top.
- **Preferences:** none. Nothing about the interface is stored per user.

**Proposed levels, cheapest first.**

| Level | What the user changes | How |
| --- | --- | --- |
| Theme | Accent, surface contrast, density (compact or comfortable), text size | `data-*` attributes on `<html>` switch token sets. No component changes |
| Layout | Show, hide, resize and collapse the explorer and inspector; focus mode that hides both | Panel sizes and visibility in a preferences store |
| Workspace presets | One click per role: Mapping, Motion Lab, Present (canvas only, large readouts) | Named sets of theme and layout values |
| Modules | Which modules are on, and their order in the toolbar | The module registry in section 3 |

**Rules for the design review.**
- **Separate from projects:** preferences are per user and per machine, never part of the project file. They live under their own storage key, so the project schema doesn't change and project files stay identical between users.
- **Content stays brightest:** no theme may make the interface compete with the preview.
- **Accents keep their meaning:** cyan means selection and live guides, and violet means Motion Lab. A theme can change their shade, not their role.
- **Exports never change:** pixel maps, exported PNG and SVG files, and the Resolume guide look the same under every theme. A wrong-looking export goes to a physical wall.
- **Accessibility:** WCAG AA contrast in every theme and density, and reduced motion is respected.
- **Light theme is open:** whether to offer one is a product question. The product is designed for dark venues.

## 3. Module contract

**The pattern already exists.** Motion Lab was added as a self-contained feature:
- a pure engine (`engines/motion/`);
- its own state that is never saved or undone (`state/motion-store.ts`);
- a drawing layer (`preview/`);
- a canvas mode loaded on first use (`components/motion/`, in a 7.5 KB chunk);
- read-only use of `resolveMapping`.

What's missing is a shared contract: Motion Lab is wired into `canvas-header.tsx` and `canvas-area.tsx` by hand.

**Proposed contract**, as a sketch to review rather than final code:

```ts
interface PixelLabModule {
  id: string;                     // "motion-lab"
  name: string;
  accent?: string;                // token name, e.g. "--motion"
  requires?: { network?: boolean; native?: boolean; secrets?: boolean };
  slots: {                        // each loaded on first use with next/dynamic
    canvasMode?: () => Promise<ComponentType>;
    toolbar?: () => Promise<ComponentType>;
    inspector?: () => Promise<ComponentType>;
    exports?: ExportEntry[];      // added to the Export menu
  };
}
```

**Rules.**
- **Static registry:** modules are listed in code at build time. Nothing is loaded from the network at runtime, which keeps the app offline-capable and keeps unreviewed code out.
- **Mapping is read-only:** modules read `resolveMapping` and the view model. They never compute mapping values. They change a project only through `engines/project-ops.ts`, which keeps undo working.
- **Pure engines:** module engines follow the same rules as `src/engines`: no React, clock, randomness or DOM.
- **Stored data:** a module that needs to save data in the project gets a versioned `modules[id]` section. Adding it needs a `SCHEMA_VERSION` bump and a migration. Do this when the first module needs it, not before.
- **Bundle:** each module records its chunk size in [PERFORMANCE](../development/PERFORMANCE.md). The initial bundle stays within budget whatever the module count.
- **Capabilities are visible:** a module that needs the network, a native helper or an API key says so in the interface, and stays off until set up.

**Suggested order:**
1. Extract Motion Lab into the contract. This is a small refactor, and there must be no change in its measured behaviour.
2. Add the preferences store.
3. Turn panels into slots.

## 4. Candidate functional modules

| Module | Value | Feasibility | Scope | Size |
| --- | --- | --- | --- | --- |
| Content templates | Designers get exact-size files per screen, canvas or output | High. Reuses `exports/scene.ts` | In Phase 1 | Small |
| Full-screen output | Plays the preview on a real wall through the processor | High | Next Motion Lab step, recommended in [SESSION](../../SESSION.md) | Small |
| Stage mockups and quick video | Pitch ideas as a rendered stage or a video per screen | Medium | Video encoding is excluded from Phase 2; needs approval | Medium |
| NDI output | Sends the preview to Resolume, vMix or OBS with no cables | Low in the browser alone | Needs a native part; Phase 3 or later | Large |
| Video generation API | AI content at each screen's exact size | Medium technically, but needs a backend or user keys | Conflicts with no-backend until Phase 5 | Large |

### Content templates

Per screen, canvas or output:
- PNG and SVG at the exact pixel size, with the screen name, resolution, cabinet grid, safe areas and seams;
- a PSD-style layered layout is not proposed; any format must be one we can generate and test (see [CLAUDE.md](../../CLAUDE.md), "Do not invent file formats").

It's mostly done: `exports/scene.ts` already draws the map. What's left is the per-screen framing and a batch download.

### Stage mockups and quick video

- **Mockup:** an image, and later a video, of content on the Physical view, for client pitches. The live preview already composites content onto screens at their stage positions, so this is mostly an export of what it draws.
- **Content per screen:** simple layouts (image, logo, text, color, Motion Lab pattern), fitted to each screen or drawn once on the master canvas and sliced through the mapping. Slicing through the mapping is the better default, because content then flows continuously across screens.
- **Video files:** encoding in the browser is possible with WebCodecs (`VideoEncoder`) plus an MP4 muxer library.
  - **Dependency:** the muxer is a new dependency, so it needs a measured bundle cost and a DECISIONS record.
  - **Browser support:** codec support and maximum encode size vary by browser and machine. Very wide sizes, such as a 4608 × 128 ribbon, may need encoding per canvas or tiling. Test this before promising it.
  - **Resolume:** it plays H.264 MP4, but DXV is its native codec. A browser can't encode DXV; Resolume's own converter would be the step after.

### NDI output

Browsers can't send NDI. Options, cheapest first:
1. **No code:** open the full-screen preview and capture it with an existing NDI capture tool, such as NDI's screen capture or OBS with an NDI plugin. Worth testing as soon as full-screen output exists.
2. **Local companion:** a small native helper on the same machine that receives frames from the browser over localhost and sends them as NDI with the NDI SDK.
3. **Desktop app:** a desktop shell (Tauri or Electron) around the app, with NDI built in. This changes the product's form.

**Open questions:**
- **Licence:** the NDI SDK's licence and branding terms must be reviewed.
- **Throughput:** raw frames are large. 1920 × 1080 RGBA at 60 fps is about 500 MB/s, and a 5120 × 1664 master is about four times that, so the frame path must be measured before committing.
- **Rule:** a frame sent over NDI must be pixel-exact to the mapping, the same rule as exports.

### Video generation API

- **Where keys live:** it needs the network and an API key, and the app has no backend.
  - **Bring your own key:** the user's key is stored only on their machine. It's quick, but the key sits in the browser.
  - **Server proxy:** safer and allows usage tracking, but it brings a backend in before [Phase 5](ROADMAP.md#phase-5-saas-platform).
- **Exact sizes:** providers generate at fixed sizes and aspect ratios, not at sizes like 4608 × 128 or 3072 × 384.
  - **Default flow:** generate at the master canvas's aspect, then crop, scale and slice through the mapping. Screens then share one continuous piece of content.
  - **Extreme ratios:** such as a 36:1 ribbon, these need wide generation or tiling. State any upscaling, never hide it.
- **Provider-neutral:** use a small adapter interface, with no provider SDK built into the app. The provider choice gets a DECISIONS record.
- **Show the costs:** cost per generation, wait time, content rights and provider terms. Generated media is project data, so its storage and size limits need a decision.

## Recommended order

1. Example gallery and content templates. Small, inside Phase 1, no dependencies.
2. Module contract, by extracting Motion Lab, plus the preferences store, theme levels and the design review.
3. Full-screen output to a second display, then the no-code NDI test through screen capture.
4. Stage mockups, then quick video. Needs approval to lift the video-encoding exclusion.
5. NDI companion, after a measured prototype and the licence review.
6. Video generation, after the decision on keys versus a backend.

## For the reviewing agents

- **Design:** read [DESIGN_SYSTEM](DESIGN_SYSTEM.md), `src/app/globals.css`, then sections 2 and 3 here. Open the app with Festival Main Stage imported to see the workspace and Live preview.
- **Product and modules:** read [ROADMAP](ROADMAP.md), [OVERVIEW](../architecture/OVERVIEW.md), then sections 3 and 4 here. Check proposals against the rules in [CLAUDE.md](../../CLAUDE.md): pure engines, mapping as the single source, no invented file formats, measured dependencies.
