# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.6] - 2026-08-17

### ✨ Features

#### Dashed & Dotted Border with Border-Radius

- **`dashed` border now supports `border-radius`** - Rounded dashed borders are fully rendered using a per-side 12-segment path with Blink-style `selectBestDashGap` fitting so dashes align evenly around corners
  - Straight sides: clip-trapezoid + rect dash sequence (unchanged)
  - Rounded corners: arc segments computed from `buildRoundedGeom`; each dash block filled via `fillArcDash` using a bezier inner-arc approximation

- **`dotted` border now supports `border-radius`** - Rounded dotted borders place circular dots along both straight sides and corner arcs without clipping, so corner dots are never half-cut
  - Straight sides: clip-trapezoid + dot sequence (unchanged)
  - Rounded corners: dot centers computed from `buildRoundedGeom` arc segments; each dot filled via bezier circle (`fillDot`)

### ♻️ Refactoring

#### `border.js` → `border/` Module Split

- **Refactored the monolithic `border.js` into a `border/` directory** with clear per-responsibility modules:
  - `border/index.js` — main entry: `drawBorder`, `drawOneSide` router, `drawSpillClosingLines`, page-clip helper
  - `border/solid.js` — solid (and double-line fallback) trapezoid-fill model; exports `buildSidePath` and `fillOneSideLayer` for reuse
  - `border/double.js` — double border: two `fillOneSideLayer` calls at bw/3 widths with bw/3 gap
  - `border/dashed.js` — dashed border: straight-side rect-dash + rounded `fillArcDash`
  - `border/dotted.js` — dotted border: straight-side circle-dot + rounded `fillDot`
  - `border/rounded-geom.js` — shared rounded-border geometry: `buildRoundedGeom` (12-segment full-perimeter path, corner metadata, line geometry) and `selectBestDashGap` (Blink fitting algorithm); shared by `dashed.js` and `dotted.js`

### 🐛 Bug Fixes

#### Repeat-Header Conflict Between Multiple Tables

- **Fixed repeat-header generating incorrect copies when multiple tables share the same page** - When two tables both had `repeatHeader` configured and their data rows appeared on overlapping pages, the old `buildRepeatHeaderPageSet` used a `Set<string>` key of `"${page}-${el}"` where `el.toString()` always returned `"[object HTMLTableSectionElement]"`, causing different tables' thead nodes to collide on the same key and skip the wrong original headers
  - Root cause: the algorithm also relied on `headerHeightPx` from `pageStartOffsets` to decide which pages needed a repeat-header copy, but `headerHeightPx` was set by whichever node triggered the page break — not per-table — so table B could inherit table A's header height and generate spurious copies
  - Fix: `buildRepeatHeaderPageSet` now scans each table's **data rows** (non-thead nodes) to find which pages they appear on, then generates a repeat-header copy only for pages where `page > firstPage` of that table. Different tables' repeat-headers are now computed independently and cannot interfere
  - Map key changed from `string` to `Map<number, Set<Element>>` using DOM object references, eliminating the `toString()` collision

### 🧪 Testing

- **Exported `buildRepeatHeaderPageSet`** for unit testing (was previously unexported)
- **Added 4 unit tests for `buildRepeatHeaderPageSet`** covering:
  - `repeatHeaderManager` is `null` → returns empty Map
  - Data rows only on first page → no copies generated
  - Data rows spanning pages 1–3 → copies generated for pages 2 and 3
  - Two tables with non-overlapping data pages → each table's copies are independent (the core bug scenario)

### 📦 Migration Guide

No breaking changes — this release is fully backward compatible with v1.0.5.

---

## [1.0.5] - 2026-07-27

### ✨ Features

#### Border Radius Support

- **Added `border-radius` rendering** - Rounded corners are now fully rendered in PDF output
  - New `src/render/radius.js` module: parses all eight `border-radius` CSS values (`border-top-left-radius`, `border-top-right-radius`, `border-bottom-right-radius`, `border-bottom-left-radius`) and generates cubic Bézier arc paths
  - `border.js`: refactored to use `strokeRoundedSides()` for per-side arc rendering with cross-page support (top arc only on first page, bottom arc only on last page)
  - `background.js`: rounded clip mask applied before solid color and gradient fills; image backgrounds also respect `border-radius`
  - `image.js`: cross-page image cropping now clips to rounded corners on the first and last spill pages

#### Render Paint Order (CSS §17.5.4 Table Painting Order)

- **Implemented correct CSS table painting order** - Matches the browser's `TABLE → TBODY → TR → TD → text` paint order, ensuring backgrounds and borders layer correctly
  - `stream-pagination.js`: `placementOrder()` assigns render weights — container spills (TABLE/TBODY/TR) paint first, then repeat-headers, then normal nodes, and rowspan TD/TH spills paint last (on top of same-column sibling cells)
  - This fixes cases where rowspan cell backgrounds were incorrectly covered by adjacent non-rowspan cell backgrounds

### 🐛 Bug Fixes

#### Repeat-Header Edge Cases

- **Fixed repeat-header rendering when the first data TR triggers a page break** - When the first data row itself needed a new page, the header could be skipped or rendered at the wrong position
  - `repeat-header-manager.js` and `stream-pagination.js`: added a linked check so that when the THEAD itself detects it cannot share a page with the first data TR, a page break is triggered at the THEAD level, guaranteeing the header and its first data row always start together on a fresh page
  - Prevents the orphaned-header scenario where a repeat-header appeared alone at the bottom of a page with no following rows

#### Pseudo-element Style Inheritance

- **Fixed pseudo-element computed styles not reflecting inherited CSS properties** - Some CSS properties (e.g. `color`, `fontSize`) were not propagated to `::before` / `::after` spans materialized in the clone document
  - `src/utils/index.js`: extended `copyPseudoStyles()` to copy the full set of text and layout properties from the parent element's computed style into the injected span

#### `border-collapse` Table — Intelligent Border De-duplication

- **Rewrote the `border-collapse` de-duplication strategy** - The previous approach always suppressed `borderBottom` and `borderRight`, which caused internal borders to disappear when cells only declared `bottom`/`right` borders (no `top`/`left`)
  - Root cause: business-side cells had `top: none`, `right: 1px solid`, `bottom: 1px solid`, `left: 1px solid`. The old strategy suppressed both `bottom` and `right`, leaving only `left`, so all internal borders vanished
  - New strategy in `resolveCellBorderOverrides()`: detects which side the cell actually declares, then suppresses the opposite side only when the declared side is present
    - Horizontal: has `borderTop` → suppress `borderBottom` on non-last rows; no `borderTop` → keep `borderBottom` (it is the sole source)
    - Vertical: has `borderLeft` → suppress `borderRight` on non-last columns; no `borderLeft` → keep `borderRight` (it is the sole source)
  - Cross-page safety guaranteed: exactly one side is kept per adjacent pair, so dividing lines are never lost
- **Fixed `isNonLastRow` scope** - Previously scoped to the current `thead`/`tbody`/`tfoot` section; now queries all `<tr>` in the entire `<table>`, correctly de-duplicating borders at the `thead`/`tbody` boundary

#### Rowspan Cell Entry Border on Page Break

- **Fixed missing top border for rowspan cells at the top of continuation pages** - When a `TD`/`TH` with `rowspan > 1` spans a page break, the cell's top edge was invisible on the continuation page
  - Root cause: `drawBorder` only draws the `top` side when `isFirstPage === true`. For a spill placement the node's natural top is on a previous page, so `isFirstPage` is always `false` and the entry line is skipped
  - Fix: `expandSpillPlacements` (`stream-pagination.js`) now marks the first spill page with `isFirstSpill: true`. `drawBorder` (`border.js`) draws the `top` side when `isFirstPage || isFirstSpill`, placing the entry line at `clipTop` (below any repeat-header)
  - Changes: `src/core/stream-pagination.js`, `src/render/node.js`, `src/render/border.js`

### ♻️ Refactoring

#### `node-parser.js` — Border Collapse De-duplication & Helper Extraction

- **`border-collapse` border de-duplication** - `getComputedStyle` in a `border-collapse` table returns each td/th's own declared border values regardless of merging. Without correction, adjacent cells produce overlapping double lines
  - `resolveCellBorderOverrides()`: smart detection — suppresses only the opposite side when the primary side is present (see Bug Fixes for full algorithm). Replaced the old strategy that always suppressed `borderBottom`/`borderRight` regardless of which sides were actually declared
  - `TABLE_TAGS` exported constant: unified set of all table structure tag names (`TABLE`, `THEAD`, `TBODY`, `TFOOT`, `TR`, `TD`, `TH`) for use across render modules

- **Extracted inline logic from `parseElement` into named helper functions** to reduce cyclomatic complexity and improve readability:
  - `calcRowSpanChildMaxHeight(tag, isPseudo, measEl)` — computes max height of rowspan>1 children inside a TR
  - `getCellRowSpan(tag, isPseudo, origEl)` — reads and caches the `rowSpan` attribute
  - `getMediaEl(origEl, measEl)` — resolves `_el` reference (IMG → clone, CANVAS → original, other → null)

#### `src/utils/index.js` — Shared Utilities

- **Added `isCanvasBlank(canvas)`** utility to detect empty canvas elements, extracted from `image-loader.js` and `image.js` to reduce duplication

### 📦 Migration Guide

No breaking changes — this release is fully backward compatible with v1.0.4.

---

## [1.0.4] - 2026-07-19

### 🐛 Bug Fixes

#### Rowspan Table Page Break

- **Fixed `rowspan` cells causing incorrect page break position** - When a TR contained a `TD` with `rowspan > 1`, the effective row height could exceed the TR's own `height`, causing the row to be split mid-cell across pages
  - Root cause: `needsNewPage()` only checked `node.height` (TR's own height), ignoring taller `rowspan` child TDs
  - Fix: Added `rowSpanChildMaxHeight` field to TR nodes (computed in `node-parser.js` via `getBoundingClientRect()` on rowspan>1 children). `needsNewPage()` now uses `Math.max(node.height, node.rowSpanChildMaxHeight)` as the effective height for avoid-break decisions
  - Also fixed `calcNextPageStart()` to distinguish text-node cuts (return `currentPageBottom`) from avoid/before push-downs (return `node.y`), preventing text nodes inside oversized TDs from being mis-anchored

#### Repeat-Header / Text Overlap

- **Fixed text nodes visually overlapping repeat-header when a text node triggers a page break** - When a `text` node was the trigger for a page break (its bottom crossed `currentPageBottom`), `calcNextPageStart()` previously returned `currentPageBottom` instead of `node.y`, causing `accumulatedYpx` to land inside the repeat-header zone and the text to render on top of the header
  - Root cause: `calcNextPageStart()` had a special branch that returned `currentPageBottom` for `text` nodes, originally intended to guard against infinite loops but was never actually reachable for that purpose
  - Fix: Removed the special `text` branch — `calcNextPageStart()` now uniformly returns `node.y` for text-protection and avoid/before push-downs, ensuring the text starts at the top of the new page content area (below the repeat-header)
  - Also tightened the infinite-loop exemption in `needsNewPage()`: the guard condition for text nodes was changed from `node.height > contentHeightPx` to `node.height > contentHeightPx - pageContentOffsetPx`, correctly accounting for the space consumed by the repeat-header offset
  - Refactored `needsNewPage()` parameter list from positional args to a destructured object to satisfy ESLint `max-params` rule

#### Background & Border Overflow Past Page-Break Point

- **Fixed backgrounds and borders rendering into blank space after `page-break: avoid/before`** - When a node was pushed to the next page, the current page's background color and borders continued painting to the full page height instead of stopping at the actual content boundary
  - Root cause: `clipBottom` was always `ctx.contentHeight` (full page height), unaware that some space was vacated by pushed nodes
  - Fix: `stream-pagination.js` now tracks `pageActualBottomPx` per page — the real global-px bottom of content after any avoid/before push. This value is propagated through each `placement` object and converted to mm in `renderNode()` to produce a precise `clipBottom`
  - Also applied the same fix to `page-break-lines.js` (`collectPageBreakLines`) so closing border lines are drawn at the correct position instead of the full page bottom

### ♻️ Refactoring

#### Text Rendering Rewrite

- **Rewrote `text.js` rendering pipeline** - Separated layout responsibilities from `node-parser.js` into `text.js`, reducing coupling and improving maintainability
  - Text alignment for right-aligned and center-aligned content now correctly accounts for available line width
  - Cleaned up multiline text coordinate calculation

#### Page-Break Lines Module Move

- **Moved `page-break-lines.js` from `src/render/` to `src/core/`** - Better reflects its role as a layout/pagination concern rather than a rendering concern
  - Updated all import paths accordingly; no API changes

#### Rendering Context Consolidation

- **Consolidated rendering context (`context.js`)** - Moved scattered per-render calculations into `context.js`, reducing boilerplate across `background.js`, `border.js`, `image.js`, `text.js`, and `node.js`
  - Removed ~65 lines of repeated setup code across render modules

### 📦 Migration Guide

No breaking changes — this release is fully backward compatible with v1.0.3.

---

## [1.0.3] - 2026-07-09

### ✨ Features

#### Per-element Font Override (`pdf-font`)

- **Added `pdf-font` attribute** - Allows overriding the font for a specific element without affecting global font configuration
  - Supports single font: `pdf-font="roboto"`
  - Supports multiple fonts (comma-separated): `pdf-font="roboto,notoSansArabic"`
  - Supports Vue dynamic binding (array): `:pdf-font="['roboto', 'notoSansArabic']"`
  - Fonts with `charRanges` are applied as character-level matchers; fonts without `charRanges` act as the element's default fallback
  - Priority chain: `pdf-font` (with charRanges) > `pdf-font` (without charRanges, as element default) > global charRanges > global default > helvetica

### 🐛 Bug Fixes

#### Text Rendering - Multiline Text Coordinate Offset

- **Fixed character coordinate offset in multiline text** - `processMultilineText` was passing the normalized text as the Range index, but `textNode` offsets correspond to the raw text, causing misaligned coordinates
  - Solution: Pass `raw` text to Range, then normalize each line after extraction

---

## [1.0.2] - 2026-07-07

### 🐛 Bug Fixes

#### Text Rendering - Arabic Ligature Support

- **Fixed Arabic contextual forms (ligatures) rendering** - Modified tokenization logic to preserve Arabic ligatures
  - Issue: When preserving whitespace tokens, Arabic contextual letter forms were broken due to word-level tokenization
  - Solution: Skip whitespace tokens during tokenization, restore spaces via `join(' ')` during RTL text merging
  - Arabic letters now correctly display in their contextual forms (initial, medial, final, isolated)
  - Affects all connected scripts: Arabic, Persian, Urdu, etc.

#### Text Rendering - Word Spacing

- **Improved word spacing in LTR text** - Fixed missing spaces between English words
  - Previous approach: Preserved whitespace tokens but broke Arabic ligatures
  - Current approach: Skip whitespace during tokenization, rely on browser metrics and RTL merging for spacing
  - Both LTR (English) and RTL (Arabic) text now render with correct spacing

### 🧪 Testing

- All 158 unit tests pass
- Added comprehensive test cases for hyphenated words and special characters:
  - Hyphen-separated identifiers: `SWSUPPORT-Programing`, `ESTGARSTD-Extend`
  - Bracket notation: `[SKU123]-(2024)`, `[INV-2024]-(001)`
  - Mixed symbols: `{server}-(production):[port-8080]`
  - Version strings: `[DOC-XYZ]-(v1.0.2)`

### 📝 Documentation

- Updated example page (`examples/basic.html`) with test cases for:
  - Hyphenated technical identifiers (product codes, serial numbers)
  - Bracket and parenthesis combinations
  - Special characters in technical documentation

### 📦 Migration Guide

No breaking changes - this release is fully backward compatible with v1.0.1.

---

## [1.0.1] - 2026-07-06

### 🐛 Bug Fixes

#### External CSS Loading

- **Fixed external stylesheet loading in cloned iframes** - Added `waitForStyleSheets()` function to ensure all `<link rel="stylesheet">` tags are fully loaded before rendering
  - External CSS (e.g., Bootstrap CDN) is now correctly applied to PDF output
  - Handles both same-origin and cross-origin (CORS) stylesheets
  - Added `<base>` tag to cloned iframe to fix relative URL resolution in nested iframe scenarios
  - Implements 10-second timeout per stylesheet to prevent indefinite blocking

#### Pseudo-element Styles

- **Enhanced pseudo-element style copying** - Improved `copyPseudoStyles()` to include missing CSS properties
  - Added support for `textAlign` - ensures text alignment is preserved
  - Added support for Flexbox properties (`alignItems`, `justifyContent`, `flexDirection`, `flexWrap`)
  - Extracted `copyBorderStyles()` helper function to reduce code complexity and pass ESLint checks
  - Note: `opacity` is not yet supported (requires jsPDF GState API implementation)

### 🔧 Code Quality

- **Reduced cyclomatic complexity** - Refactored `copyPseudoStyles()` to meet ESLint complexity threshold (<20)
- **Fixed ESLint violations** - Resolved `no-param-reassign` warnings in border style copying
- **Added debug logging** - Implemented detailed logging in `findFontForChar()` for font selection debugging (can be removed in production)

### 📝 Documentation

- **Updated Unicode range examples** - Clarified that special symbols (★ ✓ ● ➤) require proper `charRanges` configuration:
  - `U+2600-U+26FF` - Miscellaneous Symbols (★ ☀ ☁ ☂)
  - `U+2700-U+27BF` - Dingbats (✓ ✗ ➤ ✈)
  - Added examples for configuring symbol fonts with `charRanges`

### 🧪 Testing

- All 158 unit tests pass
- Manual testing confirms external CSS and pseudo-element fixes work correctly

### ⚠️ Known Limitations

- **Opacity not supported** - Pseudo-elements with `opacity` will render at full opacity (requires future implementation of jsPDF GState API)
- **Symbol fonts** - Special characters (★ ✓) require explicit font configuration with appropriate `charRanges`

### 📦 Migration Guide

No breaking changes - this release is fully backward compatible with v1.0.0.

If you experience missing styles in PDF output:

1. Ensure external CSS files are accessible (CORS-enabled for cross-origin stylesheets)
2. Check that relative URLs in CSS are correct (now handled automatically via `<base>` tag)
3. Configure symbol fonts if using special characters in pseudo-element `content`

---

## [1.0.0] - 2026-07-02

### 🎉 Initial Release

The first stable release of htmlpdf.js - a lightweight HTML to PDF converter library based on jsPDF.

### ✨ Features

#### Core Functionality

- **Multi-page rendering** - Automatically splits content across multiple PDF pages with intelligent page break handling
- **Custom fonts** - Support for custom font families with different weights and styles
- **Mixed-language support** - Render documents with multiple languages (e.g., English + Chinese + Arabic) with automatic font fallback
- **RTL/BiDi support** - Native support for right-to-left languages (Arabic, Hebrew) with automatic text reordering and BiDi algorithm

#### Layout & Styling

- **Flexbox & Grid support** - Uses browser's computed layout (`getBoundingClientRect()`) to capture accurate element positions
- **Pseudo-elements** - Support for `::before` and `::after` pseudo-elements with string content and Unicode escapes
- **Linear gradients** - Render CSS `linear-gradient()` backgrounds with support for:
  - Directional gradients (to top/bottom/left/right)
  - Angle-based gradients (deg, rad, grad, turn)
  - Multiple color stops with position control
- **CSS properties** - Support for borders, backgrounds, shadows, opacity, transforms, and more

#### Page Control

- **Page breaks** - Control page breaks with `page-break="before"` or `page-break="avoid"` attributes
- **Repeat headers** - Automatically repeat table headers on each page with configurable selectors
- **Page break borders** - Add visual borders at page break points for tables and containers
- **Header & Footer** - Customizable page headers and footers with page numbers and custom rendering

#### Content Handling

- **Cross-page cropping** - Images and canvases that span multiple pages are automatically cropped and rendered across pages
- **Image support** - Supports common image formats (JPEG, PNG, GIF, WebP, SVG)
- **Canvas support** - Render HTML5 canvas elements with proper scaling
- **Text rendering** - Accurate text positioning with support for font weights, styles, and decorations

#### Performance & Output

- **Compression** - Built-in PDF compression support to reduce file size
- **Multiple output formats** - Export as Blob, Data URL, or ArrayBuffer
- **Progress tracking** - Optional progress callbacks for long-running conversions
- **Debug mode** - Detailed timing logs for performance analysis

### 📦 Package Info

- **Size**: ~1.6MB (uncompressed)
- **Dependencies**: jsPDF 4.2.1
- **Node.js**: >= 14.0.0
- **Module formats**: CommonJS (dist/htmlpdf.js) and ESM (dist/htmlpdf.esm.js)

### 🧪 Testing

- **158 unit tests** - Comprehensive test coverage for all core utilities and functions
  - `src/utils/` - Color parsing, CSS decoding, font selection, layout utilities
  - `src/render/gradient.js` - Linear gradient parsing and rendering
  - `src/core/repeat-header-manager.js` - Table header repetition logic
  - `src/main.js` - Core rendering pipeline functions
  - Pagination and page break calculations
- **47 E2E tests** - End-to-end tests with Playwright covering real-world scenarios

### 📖 Documentation

- Comprehensive README with examples and API reference (English)
- Chinese documentation (README.zh-CN.md)
- Complete JSDoc comments in source code
- MIT License

### 🔧 Configuration Options

```javascript
htmlpdf(element, {
  output: 'blob',              // 'blob' | 'dataurl' | 'arraybuffer'
  format: 'a4',                // Page format
  orientation: 'portrait',      // 'portrait' | 'landscape'
  margin: 0,                   // Page margin in pixels
  compress: true,              // Enable PDF compression
  fonts: [...],                // Custom font configurations
  tables: [...],               // Table repeat-header and page-break-border
  header: { ... },             // Page header configuration
  footer: { ... },             // Page footer configuration
  debug: false,                // Enable debug logging
  onProgress: (info) => {}     // Progress callback
})
```

### 🎯 Use Cases

- Generate PDF reports from web applications
- Export dashboards and data visualizations
- Create printable invoices and documents
- Convert HTML emails to PDF
- Archive web content for offline viewing
- Generate certificates and badges

### 🙏 Acknowledgments

Built with:

- [jsPDF](https://github.com/parallax/jsPDF) - PDF generation library
- [Rollup](https://rollupjs.org/) - Module bundler
- [Vitest](https://vitest.dev/) - Unit testing framework

---

[1.0.6]: https://github.com/melon587/htmlpdf.js/releases/tag/v1.0.6
[1.0.5]: https://github.com/melon587/htmlpdf.js/releases/tag/v1.0.5
[1.0.4]: https://github.com/melon587/htmlpdf.js/releases/tag/v1.0.4
[1.0.3]: https://github.com/melon587/htmlpdf.js/releases/tag/v1.0.3
[1.0.2]: https://github.com/melon587/htmlpdf.js/releases/tag/v1.0.2
[1.0.1]: https://github.com/melon587/htmlpdf.js/releases/tag/v1.0.1
[1.0.0]: https://github.com/melon587/htmlpdf.js/releases/tag/v1.0.0
