# Node Parser — Design Deep Dive

## Purpose

`src/core/node-parser.js` converts the cloned DOM into a **flat array of node objects** that the rest of the pipeline can work with without touching the live DOM.

After `collectNodes()` returns, the iframe is destroyed. Every piece of data needed for rendering must already be captured in the node array.

## The Clone-Primary Dual-Walk

The traversal runs two DOM trees in lock-step:

```
collectNodes(element, cloneRoot)
              │           │
              │           └── measEl (clone tree, inside iframe)
              └── origEl  (original tree, in the live page)
```

### Why two trees?

The clone tree is needed for **measurement**: it lives inside a hidden iframe that has been set up with the correct page width, injected fonts, and materialized pseudo-elements. `getBoundingClientRect()` and `getComputedStyle()` on the clone give accurate layout values.

The original tree is needed for **semantics**: certain data only exists or is reliable on the original element.

### Division of responsibility

| Data | Source | Reason |
| --- | --- | --- |
| Coordinates (x, y, width, height) | clone (`measEl`) | Accurate layout inside iframe |
| Computed styles | clone (`measEl`) | Injected fonts affect font metrics |
| Text line measurement (Range) | clone (`measEl`) | Requires live layout |
| Pseudo-element spans | clone only | Injected by `document-cloner.js`, not in original |
| `tagName` | original (`origEl`) | Identical in both; original used for clarity |
| `pageBreak` (break-before/inside) | original (`origEl`) | CSS attribute on original element |
| `CANVAS._el` reference | **original** (`origEl`) | Clone's canvas pixel data is empty after `cloneNode()` |
| `IMG._el` reference | **clone** (`measEl`) | Clone's img has the loaded src in the iframe |
| `_origEl` reference | original (`origEl`) | Used by `contains()` / `matchesSelector()` later |

### The `CANVAS` exception — critical

`cloneNode()` does **not** copy canvas pixel data. The cloned canvas is always blank. `image-loader.js` must read the canvas content from the **original** element before the iframe is destroyed. This is the only hard reason the original tree reference is kept.

## `walk(origEl, measEl)` — the sync traversal

```
for each child of measEl:
  if child has data-pseudo attribute:
    → pseudo-element injected by document-cloner.js
    → walk(measChild, measChild)   // origEl = measEl, no origIndex advance
  else if child is ELEMENT_NODE:
    → find corresponding origChild by advancing origIndex
    → walk(origChild, measChild)
  else if child is TEXT_NODE:
    → find corresponding text node in origChildren
    → parseTextNode({ textNode: measChild, origParent: origEl, ... })
```

### The `origIndex` invariant

`origIndex` tracks position in `origChildren` and advances only for real (non-injected) nodes. This relies on the clone tree and original tree having **identical child order** for all non-injected nodes.

**Critical constraint:** Any future injection into the clone tree by `document-cloner.js` must be marked with a `data-*` attribute so `walk()` can identify and skip it without advancing `origIndex`. Failure to do this causes silent node misalignment bugs.

## Multi-line Text Splitting

When a text node wraps across lines, `getClientRects()` returns multiple rects — one per line. `processMultilineText()` handles this:

1. Iterate every character in `raw` using `Range.setStart/setEnd`.
2. Group characters by Y coordinate (2 px tolerance).
3. For each group (line), join chars and normalize whitespace.
4. Emit one text node per line.

**Important:** Range character offsets must use `raw` (the original `textContent`), not the normalized text. Using the normalized string would shift offsets and produce wrong coordinates.

## Node Object Shape (output)

```js
// Element node
{
  type: 'element' | 'pseudo-element',
  pseudoType: 'before' | 'after' | undefined,
  tag: 'DIV' | 'P' | 'IMG' | ...,
  x: number,           // px, relative to clone root left
  y: number,           // px, relative to clone root top
  width: number,       // px
  height: number,      // px
  rowSpanChildMaxHeight: number,  // TR only: max height of rowspan>1 children
  pageBreak: 'avoid' | 'before' | null,
  _el: Element | null, // IMG → clone element; CANVAS → original element; else null
  _origEl: Element,    // always the original DOM element (for contains/matchesSelector)
  style: { backgroundColor, backgroundImage, ..., borderTopWidth, ... },
}

// Text node
{
  type: 'text',
  tag: '#text',
  text: string,        // whitespace-normalized line content
  x: number,
  y: number,
  width: number,
  height: number,
  style: { color, fontSize, fontFamily, fontWeight, fontStyle,
           textAlign, lineHeight, textDecoration, direction },
  pdfFont: string | null,  // from data-pdf-font attribute on parent
  _origEl: Element,        // parent element in original tree
}
```

## Future: Replacing the Clone Strategy

The current clone mechanism (`document-cloner.js`) is acknowledged as complex. If the clone strategy is replaced (e.g. using a different iframe setup, or a Shadow DOM approach), the contract `node-parser.js` requires is:

1. `cloneRoot` must be a mounted DOM element with accurate `getBoundingClientRect()` values relative to its own top-left corner.
2. The clone tree's child order must match the original tree's child order for all non-injected nodes.
3. Any nodes injected into the clone (pseudo-elements etc.) must carry a `data-*` marker attribute.
4. Custom fonts must already be injected into the clone document before `collectNodes()` is called, so that text metrics are accurate.
5. `CANVAS` elements in the clone will always have empty pixel data — the original element reference (`_origEl`) must be preserved for canvas rendering.
