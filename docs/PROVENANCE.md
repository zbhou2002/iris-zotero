# Source and asset provenance

Iris is a modified distribution of AIdea by zhile / Visterainer and its upstream contributors. AIdea in turn derives from llm-for-zotero. Original licenses and notices are retained in LICENSE, THIRD_PARTY_NOTICES.md, and the upstream snapshot.

## Source layout

- `upstream/aidea-3.4.1/` contains an upstream v3.4.1 source snapshot (commit `6d5b651953857be124361b8602b8222fca53da2f`), including TypeScript, build configuration, dependency lockfile, and original notices. One redistribution change removes the hardcoded Google OAuth client fallback in `src/utils/oauthCli.ts`; the same fallback is removed from the active baseline. Installed Gemini CLI configuration discovery remains. The snapshot documents the source lineage and is not the active Iris build.
- `plugin/baseline-aidea.js` is the editable, unminified JavaScript baseline from the local Iris 3.4.4.1 series. Earlier Iris edits were made directly to this bundle, so it is retained as the build input rather than falsely presenting the upstream TypeScript as a complete reconstruction of those edits.
- `plugin/build.mjs` applies checked source transformations and inserts the editable Iris helper modules from `plugin/src/content/scripts/`. A missing or ambiguous anchor fails the build. The generated `aidea.js` is excluded from Git and rebuilt before tests and packaging.
- `plugin/selection-translate.js` is the replacement selection translation implementation. The Iris test files exercise the generated handlers and source modules.
- `plugin/src/` contains addon packaging assets, locale resources, UI styles, and bridge/runtime setup source. The original full-document translation UI is not exposed by Iris, although inherited implementation remains in the source.

This is a transitional patch-based fork, not a clean upstream TypeScript refactor. Contributions should edit active source inputs and run the complete build and tests. The upstream lockfile records original dependency sources and licenses; the active Iris packaging path does not execute upstream workflows or scripts.

## Assets and dependencies

- Lucide-derived UI icons retain `plugin/src/content/icons/LUCIDE-LICENSE.txt`.
- KaTeX and its bundled fonts retain their licenses under `plugin/src/content/vendor/katex/`.
- OpenAI Sans binaries from the local prototype are deliberately excluded. The UI uses installed system fonts without redistributing them.
- `docs/assets/iris-hero-en.png` was generated for Iris with the built-in ImageGen tool. It is promotional artwork, not a screenshot, and implies no endorsement. The prompt is recorded in `docs/assets/hero-prompt.md`.
- Local speech setup downloads uv, Python, faster-whisper, sounddevice, and a Whisper model from their upstream sources. Those runtime downloads are not included in the XPI or this repository and retain their respective licenses.

The legacy addon ID and `aidea` namespace are retained for compatibility and do not imply that Iris releases are published by the upstream AIdea author.

- `docs/assets/iris-product-en.svg` and `iris-product-zh.svg` are original vector promotional illustrations created for Iris. They depict conceptual workflows, not application screenshots, and contain no third-party paper text or customer data.

- `plugin/src/content/icons/iris-rainbow-highlight.svg` is original vector UI artwork for Iris: a compact horizontal rainbow highlighter mark with a simplified pen tip. The design followed concept exploration with built-in ImageGen; no third-party logo or source image is included.
