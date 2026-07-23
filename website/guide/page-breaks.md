# Page Breaks

## Attributes

Add `page-break` attributes directly to HTML elements.

```html
<!-- Force a page break before this element -->
<div page-break="before">This content starts on a new page</div>

<!-- Prevent this element from being split across pages -->
<div page-break="avoid">This block will never be split mid-element</div>
```

## Auto-avoid Elements

`TR`, `SVG`, and `VIDEO` elements automatically get `page-break="avoid"` behaviour — they are never split across pages, no attribute needed.

## Overflow exemption

When an element with `page-break="avoid"` is taller than a full page, the avoid constraint is automatically lifted to prevent an infinite pagination loop. The element will spill naturally across pages.
