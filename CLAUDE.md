# Project

**Playground Pixel Lab**: LED pixel mapping and content-template generation for live events. Used internally by Playground Studio first, built to become a multi-tenant SaaS later.

@AGENTS.md

# Operating Principles

- Read README.md and relevant docs before making architectural changes.
- Preserve reusable architecture.
- Do not silently change project scope. Future modules (see docs/TASKS.md) need explicit approval.
- Prefer small verified iterations.
- Update documentation when architecture or permanent decisions change.
- Do not use SESSION.md as permanent documentation.
- Verify implementation before reporting completion.
- Protect user data and existing working functionality.

# Hard rules

- Pixel values are integers (`Px`). Physical lengths are integer micrometres (`Um`). Never store float millimetres or round to hide an error.
- All technical calculation lives in `src/engines` and stays pure: no React, no storage, no clock, no random ids.
- Do not generate Resolume preset files until the conditions in docs/RESOLUME.md are met.
- Changing the stored project shape means bumping `SCHEMA_VERSION` and adding a migration in `src/persistence/schema.ts`.

# Commands

```bash
npm run dev        # development server
npm test           # unit tests
npm run typecheck
npm run lint
npm run build
```

# Documentation Model

Permanent knowledge belongs in:
- README.md
- docs/PROJECT_CONTEXT.md
- docs/ARCHITECTURE.md
- docs/DECISIONS.md
- docs/RESOLUME.md
- docs/TASKS.md

Temporary session state belongs in:
- .claude/SESSION.md

# Handoff

Before clearing a long Claude session, use: /handoff
