# htmlpdf.js — AI Agent Rules

## Project Overview

`htmlpdf.js` (npm: `htmlpdfx.js`) is a browser-side HTML-to-PDF library built on jsPDF. It clones a DOM subtree into a hidden iframe, parses it into a flat node tree, runs a single-pass stream paginator, then renders each node onto PDF pages.

## Key Constraints

- **No server. No Puppeteer. Browser only.** All rendering uses jsPDF canvas APIs.
- **Coordinates are always in mm** inside jsPDF calls; all internal measurements are in px.  
  Never mix units without using the `ctx` transform helpers (`toMM`, `toPdfX`, `toPdfY`, `toPt`).
- **The iframe is destroyed before rendering begins.** All data (images, computed styles) must be captured during `collectNodes()` / `preloadImages()` — never re-query the live DOM in renderers.
- **`allPlacements` is the single source of truth** for what renders on which page and at what Y offset. Never add page-based logic outside `stream-pagination.js` unless absolutely necessary.

## Module Map (authoritative)

```
src/main.js                          ← 12-step orchestration pipeline
src/core/context.js                  ← jsPDF init + coordinate transform helpers
src/core/document-cloner.js          ← DOM clone, pseudo-element materialization, font injection
src/core/font-loader.js              ← fetch/cache fonts as base64, register into jsPDF
src/core/wait.js                     ← async browser-resource wait utilities
src/core/node-parser.js              ← DOM → flat node array (clone-primary dual-walk, multi-line text)
src/core/image-loader.js             ← preload IMG/CANVAS/bg-image into node before iframe destroy
src/core/repeat-header-manager.js    ← table header repeat placements across pages
src/core/page-break-lines.js         ← spill closing-line collection per page
src/core/stream-pagination.js        ← single-pass paginator → allPlacements
src/core/page.js                     ← header/footer render callbacks
src/render/node.js                   ← render dispatcher (element / pseudo / text)
src/render/background.js             ← solid color, linear-gradient, bg-image URL
src/render/border.js                 ← 4-side borders + spill closing lines
src/render/gradient.js               ← CSS linear-gradient parser + canvas slice renderer
src/render/image.js                  ← IMG/CANVAS cross-page crop → PDF addImage
src/render/text.js                   ← multi-font segmentation, LTR/RTL, alignment
src/utils/index.js                   ← pure helpers (color, px, font-face, canvas-alpha…)
```

## Rules Index

| Topic                                         | File                  |
| --------------------------------------------- | --------------------- |
| Overall pipeline & step ordering              | `rules/pipeline.md`   |
| Pagination algorithm & allPlacements          | `rules/pagination.md` |
| Render layer (background/border/image/text)   | `rules/render.md`     |
| Font system (loading, segmentation, fallback) | `rules/fonts.md`      |

## Wiki Index

| Topic | File |
| --- | --- |
| Full architecture diagram & module interactions | `wiki/architecture.md` |
| Coordinate system (px ↔ mm ↔ pt, ctx helpers) | `wiki/coordinate-system.md` |
| Pagination deep-dive (algorithm, spill, repeat-header) | `wiki/pagination-design.md` |
| Font system deep-dive (config, unicode-range, fallback chain) | `wiki/font-system.md` |
| Node parser (clone-primary dual-walk, multi-line text, \_origEl contract) | `wiki/node-parser.md` |

## Code Graph (code-review-graph)

A code knowledge graph is pre-built for this project at `.code-review-graph/graph.db`. The `code-review-graph` MCP server is connected and provides 30 tools.

**Before exploring or modifying any source file, always call these tools first:**

1. `get_minimal_context_tool` — get a compact overview (~100 tokens) of the repo structure. Call this first on every new task.
2. `get_impact_radius_tool` — when modifying a file, call this to understand what else is affected.
3. `semantic_search_nodes_tool` — use this instead of Grep/Glob when searching for functions or classes by name or concept.
4. `query_graph_tool` — use this to find callers, callees, tests, or imports of any symbol.
5. `refactor_tool` — use this for rename previews, dead code detection, and refactoring suggestions.

Only fall back to direct file reads (Read/Grep/Glob) when the graph tools do not return sufficient detail.

## Do NOT

- Add `priority` to font config objects — it does not exist in the source.
- Re-fetch images or re-query the DOM after the iframe is destroyed.
- Write mm values directly without going through `ctx` helpers.
- Add page-break logic in render files — that belongs in `stream-pagination.js`.
- Expose jsPDF internals to callers; all PDF manipulation stays inside `src/`.

## Coding Style

- **Read `.eslintrc.cjs` before writing any code.** Generate code that satisfies all rules from the start — do not rely on post-fix. Key rules to internalize: `max-params: 4` (use object destructuring when a function needs more than 4 parameters), `complexity: 20`, `max-len: 80`, `no-var`, `prefer-const`, `eqeqeq`.
- **Prefer positive conditions.** Write `if (a) doSomething()` instead of `if (!a) return; doSomething()` unless the early-exit genuinely improves clarity (e.g. guard clauses at the top of a function).
- **Merge redundant conditions.** Combine checks that can be expressed as a single expression; keep `if` statements simple and readable.
- **This is a library, not application code — be conservative.** Before modifying any source file, propose the full change and wait for explicit confirmation before applying it.
