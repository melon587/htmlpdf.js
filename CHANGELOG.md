# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.3]: https://github.com/melon587/htmlpdf.js/releases/tag/v1.0.3
[1.0.2]: https://github.com/melon587/htmlpdf.js/releases/tag/v1.0.2
[1.0.1]: https://github.com/melon587/htmlpdf.js/releases/tag/v1.0.1
[1.0.0]: https://github.com/melon587/htmlpdf.js/releases/tag/v1.0.0
