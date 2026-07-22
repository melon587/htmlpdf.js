# Coordinate System

## Three Coordinate Spaces

The library works with three different unit spaces. Never mix them.

| Space | Unit | Used in |
| --- | --- | --- |
| **DOM/px** | pixels | Node coordinates, computed styles, image sizes |
| **PDF/mm** | millimetres | jsPDF API calls (`doc.rect`, `doc.line`, `doc.text`, etc.) |
| **PDF/pt** | points | Font sizes only (`doc.setFontSize`) |

## Pixel Space

- All node coordinates (`node.x`, `node.y`, `node.width`, `node.height`) are in **px**.
- These are measured from `rootElement.getBoundingClientRect()` during `collectNodes()`.
- `contentHeightPx = contentHeight(mm) / scale` — the page height in px units.
- `accumulatedYpx` in the paginator is a running px counter of how far down the content we've gone.

## Scale Factor

```
scale = contentWidth(mm) / rootElement.width(px)
```

The scale factor maps px distances to mm distances on the PDF page.  
It is computed once in `initContext()` and stored on `ctx.scale`.

## `ctx` Coordinate Helpers

All conversions go through these helpers — never do raw arithmetic:

```js
ctx.toMM(px);
// Converts a distance in px to mm.
// Use for widths, heights, offsets.
// = px * scale

ctx.toPdfX(x);
// Converts a node's left-edge x (px, relative to root) to absolute PDF X (mm).
// = margin + x * scale

ctx.toPdfY(y);
// Converts a node's top-edge y (px, relative to root) to absolute PDF Y (mm),
// adjusted for margin and header height.
// BUT in the render loop, y must be further adjusted for offsetYpx:
//   effective_y_px = node.y - offsetYpx
//   pdfY = ctx.toPdfY(effective_y_px)
// = margin + headerHeight + y * scale

ctx.toPdfYmm(ymm);
// Same as toPdfY but takes mm input (skips scale).
// Used when you already have a mm value but need to add margin+header.
// = margin + headerHeight + ymm

ctx.toPt(px);
// Converts px to points for font size.
// = px * scale * 2.8346
```

## `offsetYpx` in the Render Loop

Each placement carries an `offsetYpx`:

- For non-spill placements (single-page elements): `offsetYpx = 0`
- For spill placements on page N: `offsetYpx = (N-1) * contentHeightPx` (negative values shift the element upward so the correct slice is visible)

Inside render functions, the effective node-top in px is:

```
effectiveTopPx = node.y - offsetYpx
```

And the PDF Y coordinate is:

```
pdfY = ctx.toPdfY(effectiveTopPx)
     = margin + headerHeight + effectiveTopPx * scale
```

## `clipBottom` — The Page Clip Boundary

```
clipBottom (mm) = ctx.toMM(pageActualBottomPx - offsetYpx)
```

`clipBottom` is the maximum visible Y coordinate (mm, relative to the node's top-left corner) on the current page. All render functions clip their output to `[0 … clipBottom]`.

For the **last spill page** (`isLastSpill = true`), `clipBottom` equals the actual node bottom.  
For **middle spill pages** (`isLastSpill = false`), `clipBottom` equals the full page height.

## Margin & Header Space

The PDF page has this vertical layout:

```
┌─────────────────────────────┐  ← y = 0
│  margin (mm)                │
├─────────────────────────────┤  ← y = margin
│  header area (headerHeight) │
├─────────────────────────────┤  ← y = margin + headerHeight
│                             │
│  content area               │  ← node coordinates map here
│  (contentHeight mm)         │
│                             │
├─────────────────────────────┤  ← y = margin + headerHeight + contentHeight
│  footer area (footerHeight) │
├─────────────────────────────┤
│  margin (mm)                │
└─────────────────────────────┘  ← y = pageHeight
```

`toPdfY()` always adds `margin + headerHeight` to ensure nodes land in the content area.

## Common Mistakes

| Mistake | Correct approach |
| --- | --- |
| Passing a raw px value to `doc.rect()` | `ctx.toPdfX(node.x), ctx.toPdfY(node.y)` |
| Passing a raw mm value to `doc.setFontSize()` | `ctx.toPt(node.style.fontSize)` |
| Manually adding margin to coordinates | Use `toPdfX` / `toPdfY` — they already include margin |
| Forgetting `offsetYpx` when computing Y | `effectiveTopPx = node.y - offsetYpx` always |
| Using `toPdfY` for a width or height | Use `toMM` for distances, `toPdfX/Y` for positions |
