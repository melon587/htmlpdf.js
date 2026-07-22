# Pagination Design — Deep Dive

## Overview

`streamPaginate()` in `src/core/stream-pagination.js` performs a **single-pass, left-to-right traversal** of the flat node array and produces `allPlacements` — a sorted list of rendering instructions.

No second pass is needed. No backtracking. Once a node is assigned a page, that decision is final.

## Input / Output

```
Input:  nodes[]              flat node array from node-parser.js
        ctx                  context object (page dimensions, scale)
        repeatHeaderManager  pre-built repeat-header metadata

Output: { totalPages, allPlacements }
```

`allPlacements` is an array sorted by `page`, then by render priority within a page:

1. Spill placements (elements carrying over from a previous page)
2. Repeat-header placements (thead rows injected at the top of each page)
3. Normal placements (elements that start on this page naturally)

## Core Variables in `streamPaginate()`

| Variable | Type | Meaning |
| --- | --- | --- |
| `accumulatedYpx` | number | Running px of content consumed so far (global Y cursor) |
| `currentPage` | number | The page currently being filled (1-indexed) |
| `pageStartOffsets` | Map | `pageIndex → accumulatedYpx` at the start of that page |
| `nodePlacements` | Map | `node → { page, offsetYpx }` — first placement per node |

## Page-Break Decision: `needsNewPage(node)`

Called for each node before placing it. Returns `true` if a page break should occur before placing this node on the current page.

Conditions checked (any one triggers a break):

1. **Natural overflow** — `node.y + node.height > accumulatedYpx + contentHeightPx` Node bottom would exceed the current page bottom.

2. **`break-before: page`** — `node.pageBreak === 'before'` Explicit page break requested.

3. **`break-inside: avoid`** — `node.pageBreak === 'avoid'` AND the node doesn't fit on the current page's remaining space.

4. **Text protect** — parent node has `avoid` and this text line would overflow. Prevents a single orphan text line at the bottom of a page.

5. **Implicit avoid** — `TR`, `SVG`, `VIDEO` tags automatically behave as `avoid`.

## `calcNextPageStart(page, repeatHeaderManager)`

After deciding to break to a new page, `calcNextPageStart()` computes the new `accumulatedYpx` for the top of the next page.

If the table has a repeat header, the repeat-header height is added to the page-start offset so that content starts below the repeated header.

## Spill Elements

An element whose height > `contentHeightPx` cannot fit on one page and must "spill" across multiple pages.

### Detection

After the single pass, `expandSpillPlacements()` checks each `nodePlacements` entry:

```
if (node.y + node.height > pageStartOffsets[node.page] + contentHeightPx)
   → element spills
```

### Spill Placement Generation

`expandSpillPlacements()` generates one extra placement for each additional page the element spans:

```
page P+1: offsetYpx = pageStartOffsets[P+1] - node.y
          isLastSpill = (P+1 is the last page the element spans)
```

The `offsetYpx` value shifts the element up in the render coordinate space so that the correct visual slice appears on each page.

### `isLastSpill` Flag

- `isLastSpill = false`: element continues onto the next page. Background extends to full page height. Bottom border is suppressed.
- `isLastSpill = true`: element ends on this page. Background clips to node bottom. Bottom border is drawn.

## Repeat Headers

When `tables[i].repeatHeader` is configured, `<thead>` rows repeat at the top of every page the table spans.

### Setup (`repeat-header-manager.js`)

`collectHeaderMetas(nodes, tables)` walks the node array and identifies `<thead>` subtrees for tables that match `tables[i].selector`.

Each `headerMeta` stores:

- The thead node and its children
- The table's first and last pages (computed during pagination)
- The header's height in px

### Injection during pagination

Inside `streamPaginate()`, on each page break:

```
headerMeta = repeatHeaderManager.getHeaderMetaForNode(node)
if (headerMeta && currentPage > 1)
  placements += generateRepeatHeaderPlacements(headerMeta, currentPage, accumulatedYpx)
```

`shouldSkipOriginalHeader()` returns `true` for original `<thead>` rows on pages 2+ to prevent double rendering.

## `buildNodeLastPageMap()`

After spill expansion, some container nodes span multiple pages but only have one entry in `nodePlacements`. `buildNodeLastPageMap()` computes the actual last page for each node by taking the maximum page of all its children:

```
for each node in reverse DFS order:
  lastPage[node] = max(lastPage[node], lastPage[child])
```

This determines `isLastSpill` for container elements.

## `mergePlacements()` — O(n) Dual-Pointer Merge

Three sorted arrays are merged in one pass:

1. `spillPlacements` — from `expandSpillPlacements()`
2. `repeatHeaderPlacements` — from repeat-header manager
3. `normalPlacements` — from the single pass

The merge maintains page order. Within the same page, the priority is: `spillPlacements` > `repeatHeaderPlacements` > `normalPlacements`

## Spill Closing Lines

After `streamPaginate()` returns, `collectPageBreakLines()` uses `allPlacements` to identify which table containers have a page break mid-table and records a "closing line" entry for each such page transition.

`drawSpillClosingLines()` in `render/border.js` then draws a horizontal line at the bottom of the table's last visible row on each page, creating a visual table border at the cut point.

This is configured via `tables[i].pageBreakBorder: '1px solid #ccc'` in `options.tables`.

## Example: Multi-Page Table with Repeat Header

```
Page 1:
  ┌─────────────────┐
  │  thead (repeated)│  ← repeat-header placement, page=1
  ├─────────────────┤
  │  tbody rows...   │  ← normal placements, page=1
  │  (spill continues)
└─────────────────┘  ← closing line drawn here

Page 2:
  ┌─────────────────┐
  │  thead (repeated)│  ← repeat-header placement, page=2
  ├─────────────────┤
  │  (spill)        │  ← spill placements for tbody container, page=2
  │  tbody rows...   │  ← normal placements, page=2
  └─────────────────┘
```
