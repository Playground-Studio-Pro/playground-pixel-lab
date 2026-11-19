# Bundled fonts

Committed so `next build` and the desktop app work with no network. Loaded by `next/font/local` in [`../layout.tsx`](../layout.tsx).

| File | Family | Axes | Source | Licence |
| --- | --- | --- | --- | --- |
| `Inter-latin-wght.woff2` | Inter | wght 100–900 | Google Fonts `inter/v20`, latin subset | [OFL-Inter.txt](OFL-Inter.txt) |
| `JetBrainsMono-latin-wght.woff2` | JetBrains Mono | wght 100–800 | Google Fonts `jetbrainsmono/v24`, latin subset | [OFL-JetBrainsMono.txt](OFL-JetBrainsMono.txt) |

These are the same latin subset files `next/font/google` downloaded at build time before 2026-11-18 (unicode range U+0000–00FF plus common punctuation), so rendering is unchanged. Licence texts come from the `google/fonts` repository. Both fonts are under the SIL Open Font License 1.1, which allows bundling and redistribution with software.

SHA-256:

```text
c940764593d0fe5d596be327ca7558855e018039fb78509aa21921fd3644c3e4  Inter-latin-wght.woff2
1e06740a02a443fb7f3eeda8fcaa685a0f6c620e3f01e6666e847295469ce3ad  JetBrainsMono-latin-wght.woff2
```
