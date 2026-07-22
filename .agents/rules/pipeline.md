# Pipeline Rules

## Overview

`src/main.js` owns the **12-step pipeline**. Steps must run in the exact order below. Never reorder, merge, or skip steps. Each step depends on side-effects from the previous one.

## Step Order

| # | Function | File | Purpose |
| --- | --- | --- | --- |
| 1 | `initContext()` | `core/context.js` | Create jsPDF doc, compute scale & dimensions |
| 2 | `createClonedDocument()` | `core/document-cloner.js` | Clone DOM into hidden iframe, inject fonts |
| 3 | `collectNodes()` | `core/node-parser.js` | Parse cloned DOM into flat node array |
| 3b | `preloadImages()` | `core/image-loader.js` | Capture all image data while iframe is alive |
| 4 | `destroyClonedDocument()` | `core/document-cloner.js` | Remove iframe — after this, no DOM access |
| 5 | `loadFontsToJsPDF()` | `core/font-loader.js` | Register custom fonts into jsPDF |
| 6 | `createRepeatHeaderManager()` | `core/repeat-header-manager.js` | Build repeat-header metadata |
| 6b | `getPageBreakLinesMap()` | `core/page-break-lines.js` | Build pageBreakBorder WeakMap |
| 7 | `streamPaginate()` | `core/stream-pagination.js` | Single-pass pagination → allPlacements |
| 8 | `collectPageBreakLines()` | `core/page-break-lines.js` | Build per-page spill closing lines |
| 9 | `renderNode()` loop | `render/node.js` | Iterate allPlacements, render each node |
| 10 | `drawSpillClosingLines()` | `render/border.js` | Draw closing lines at table break points |
| 11 | `renderHeaderFooter()` | `core/page.js` | Call header/footer render callbacks |
| 12 | `ctx.output()` | `core/context.js` | Emit Blob / DataURL / ArrayBuffer |

## Critical Invariants

### iframe lifetime (steps 2–4)

- Steps 2–4 share the iframe's lifetime window.
- `collectNodes()` and `preloadImages()` both run **inside** the try/finally that calls `destroyClonedDocument()`.
- If `preloadImages()` fails, the iframe must still be destroyed — hence the `finally` block.
- After step 4, the live DOM, computed styles, and layout are gone. Never call `getBoundingClientRect()`, `getComputedStyle()`, or image-fetching after this point.

### Page management in the render loop (step 9)

- `allPlacements` is sorted by page number.
- The render loop calls `ensurePage(doc, placement.page, currentPage)` to advance jsPDF to the correct page.
- `ensurePage` calls `doc.addPage()` for each missing page, then `doc.setPage()`.
- Render functions must NOT call `doc.addPage()` themselves.

### Progress reporting

- `tick(stage, progress)` is called between steps to report progress to `onProgress`.
- Stage names: `'clone'`, `'images'`, `'fonts'`, `'paginate'`, `'render'`, `'output'`.
- Progress is a 0.0–1.0 float.
- `debug: true` activates `console.log` timing output.

## Options Destructuring (in main.js)

```js
const { output = 'blob', fonts = [], header, footer, tables = [] } = options;
```

- `output`: `'blob'` | `'datauristring'` | `'arraybuffer'` — passed to `ctx.output()`
- `fonts`: array of font config objects — passed to `loadFontsToJsPDF` and `renderNode`
- `header` / `footer`: `{ height: number, render: (doc, info) => void }`
- `tables`: array of table config objects for repeat-header and pageBreakBorder

## Adding a New Pipeline Step

1. Place the new step in the correct position among the 12 steps.
2. If the step needs live DOM access, it must go **before** step 4 (destroyClonedDocument).
3. If the step produces placement data, it must go **before** step 9 (render loop).
4. Add a `tick()` call after the new step with an appropriate stage name.
5. Update this file with the new step in the table above.

## Modifying `document-cloner.js` — `origIndex` Contract

`node-parser.js` walks the clone tree and original tree in lock-step using `origIndex` to sync child positions. This works because the two trees have identical child order for all non-injected nodes.

**Rule:** Any node injected into the clone tree by `document-cloner.js` (e.g. pseudo-element spans) **must** carry a `data-*` marker attribute. `walk()` in `node-parser.js` detects these markers and skips them without advancing `origIndex`.

Injecting nodes without a marker will silently misalign `origEl` ↔ `measEl` pairs, causing wrong coordinates and styles with no error thrown.

See `wiki/node-parser.md` for the full dual-walk design.
