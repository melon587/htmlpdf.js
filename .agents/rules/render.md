# Render Layer Rules

## Render Entry Point

`renderNode()` in `src/render/node.js` is the **only** public entry point for rendering. It dispatches to sub-renderers based on `node.type`:

| `node.type` | Sub-renderers called |
| --- | --- |
| `'element'` | `drawBackground` → `drawBorder` → `drawImage` (if IMG/CANVAS) |
| `'pseudo'` | `drawBackground` → `drawBorder` → `drawText` (if has text content) |
| `'text'` | `drawText` only |

Never call `drawBackground`, `drawBorder`, `drawImage`, or `drawText` directly from outside the render layer — always go through `renderNode()`.

## Cross-Page Clipping (`clipBottom`)

All render functions receive a `clipBottom` value (in mm) derived from:

```js
clipBottom = toMM(pageActualBottomPx - offsetYpx);
```

This is the maximum Y coordinate (relative to the node's top-left) that should be rendered on the current page. Render functions must clip their output to this boundary.

### Spill behaviour

| `isLastSpill` | `isLastSpill=false` (middle pages) | `isLastSpill=true` (final page) |
| --- | --- | --- |
| Background | extends to full page height | clips to actual node bottom |
| Left/right border | drawn on every page | drawn on every page |
| Top border | only on first page (nodeTop ≥ 0) | only on first page |
| Bottom border | not drawn | drawn (node bottom ≤ clipBottom) |

## Background (`src/render/background.js`)

Draw order (back to front):

1. **Solid color** — `background-color` via `setFillColor` + `rect`
2. **Linear gradient** — parsed by `gradient.js`, rendered to canvas slice, added via `addImage`
3. **Background image URL** — `node.bgSrc` (preloaded base64), positioned via `calcBgImageSize/Pos`

### `background-size` values supported

- `cover` — scale to cover the element, crop if needed
- `contain` — scale to fit inside the element, letterbox if needed
- `auto` — use natural image size
- Explicit px/% values

### `background-position` values supported

- Keywords: `top`, `bottom`, `left`, `right`, `center`
- Explicit px/% values

### CSS properties read (not always rendered)

- `border-radius` — read but **not rendered** (jsPDF has no native rounded rect with clip)

## Border (`src/render/border.js`)

- Borders are drawn as individual `line()` calls using jsPDF.
- `parseBorderString(borderStr)` splits `border-top`, `border-right`, etc. into `{ width, color }`.
- Zero-width or transparent borders are skipped.
- `drawSpillClosingLines()` draws a horizontal closing line at a table's page-break exit point. It uses `pageBreakBorder` config (the border style from `tables[].pageBreakBorder`) rather than the node's own border.

## Image (`src/render/image.js`)

- Source is always `node._srcCanvas` — a canvas element preloaded during `preloadImages()`.
- The visible slice `[visibleTopPx … visibleBottomPx]` is cropped from the source canvas using a temporary offscreen canvas.
- The cropped canvas is converted to base64 and added via `doc.addImage()`.
- Format is `'PNG'` if `canvasHasAlpha()` returns true, otherwise `'JPEG'`.

## Gradient (`src/render/gradient.js`)

- `parseLinearGradient(str)` parses a CSS `linear-gradient(...)` string into `{ angle, stops }`.
- Supported direction keywords: `to top`, `to bottom`, `to left`, `to right`, `to top left`, `to top right`, `to bottom left`, `to bottom right`
- Degree values are also supported (e.g. `45deg`).
- `renderGradientSlice()` renders only the current-page slice (not the full node height). This avoids memory issues for very tall elements.

## Text (`src/render/text.js`)

- `drawText()` is the main entry point.
- Text rendering supports **multi-font segmentation**: a single text node can span multiple fonts if different characters match different font configs via `unicode-range`.
- `segmentTextByFont()` splits a string into `[{ text, font }]` segments.
- Each segment is measured with jsPDF's `getTextWidth()`, then positioned for alignment.
- Alignment: `left`, `center`, `right` — computed relative to the node's bounding box.
- RTL: detected from `node.style.direction === 'rtl'`; uses jsPDF's `R2L` option.
- `applyTextStyle()` sets font size, color, and opacity on the jsPDF doc.

## Rules for Adding New Render Features

1. New visual effects on elements → add to `background.js` or a new file, call from `renderNode()`.
2. New border styles → add to `border.js`.
3. New text features → add to `text.js`; use `segmentTextByFont()` for font-aware text.
4. Never add `doc.addPage()` or page navigation inside any render function.
5. Never read from the live DOM — all data must be in the `node` object.
6. All coordinates passed to jsPDF must be in **mm** via `ctx` helpers.
