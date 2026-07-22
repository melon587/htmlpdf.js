# Pagination Rules

## Core Concept

Pagination is **single-pass**: `streamPaginate()` in `src/core/stream-pagination.js` traverses the flat node array once and produces `allPlacements` — the only data structure that determines what renders on which page and at what Y offset.

**Never add page-break logic to render files.** All decisions about page boundaries belong here.

## Key Data Structures

### `allPlacements` (array of placement objects)

```js
{
  (node, // reference to the node object from collectNodes()
    page, // 1-indexed PDF page number
    offsetYpx, // Y shift applied to this placement (0 for first spill, positive for later)
    isLastSpill, // boolean — true on the final page of a multi-page spill
    pageActualBottomPx); // px value of the page bottom for clipping purposes
}
```

### `nodePlacements` (internal, before merge)

Maps `node → { page, offsetYpx }`. Built during the single-pass traversal.

### `pageStartOffsets` (internal)

Maps `pageIndex → accumulatedYpx` — the global Y position of the top of each page. Used by `expandSpillPlacements()` to build cross-page spill placements.

## Page-Break Decision Logic (in `needsNewPage()`)

A new page is triggered when **any** of these conditions is true:

| Condition | CSS trigger |
| --- | --- |
| Natural overflow | node bottom > current page bottom (no CSS needed) |
| `page-break-before: always` | `break-before: page` or `page-break-before: always` |
| `page-break-inside: avoid` | `break-inside: avoid` or `page-break-inside: avoid` |
| Text protect | text node whose parent has `avoid` — prevents orphan text lines |
| Implicit avoid | `TR`, `SVG`, `VIDEO` elements automatically get avoid behaviour |

## Spill Placements

Elements taller than one page height **spill** across multiple pages.  
`expandSpillPlacements()` generates one placement per spill-page from `nodePlacements`.

```
page 1: placement { page:1, offsetYpx:0,          isLastSpill: false }
page 2: placement { page:2, offsetYpx: -pageH,     isLastSpill: false }
page 3: placement { page:3, offsetYpx: -pageH*2,   isLastSpill: true  }
```

`offsetYpx` is negative — it shifts the element up so the correct slice is visible on each page.

## Repeat-Header Placements

When a `tables[]` config entry specifies `repeatHeader: true`, the table `<thead>` rows are repeated at the top of each page the table spans.

`generateRepeatHeaderPlacements()` in `repeat-header-manager.js` generates the extra placements and inserts them at the **top of each page** via `mergePlacements()`.

`shouldSkipOriginalHeader()` returns `true` for `<thead>` rows that already appear at the natural position on page 1 — prevents double-rendering.

## `mergePlacements()` — O(n) dual-pointer merge

Spill placements and repeat-header placements are pre-sorted by page.  
`mergePlacements()` merges them into `allPlacements` in one pass:

- Spill placements come **before** normal placements on the same page.
- Repeat-header placements come **before** all other placements on their page.

## `buildNodeLastPageMap()`

After the single pass, `buildNodeLastPageMap()` bubbles the maximum page number of any child node up to its ancestors. This gives each container node the last page it touches, which is used to correctly set `isLastSpill` for container elements.

## Rules for Modifying Pagination

1. **All page-break conditions** live in `needsNewPage()`. Do not add conditions elsewhere.
2. **`accumulatedYpx`** is the running total of px consumed so far. It resets to `calcNextPageStart()` at each page break.
3. **`calcNextPageStart()`** returns the new `accumulatedYpx` for the top of the next page, accounting for repeat-header height.
4. Never mutate `allPlacements` after `streamPaginate()` returns — it is read-only input to the render loop.
5. When adding a new page-break trigger, add it to `needsNewPage()` and document it here.
