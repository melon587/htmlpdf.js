# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- [Playwright](https://playwright.dev/) - E2E testing framework

---

[1.0.0]: https://github.com/melon587/htmlpdf.js/releases/tag/v1.0.0
