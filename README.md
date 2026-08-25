# htmlpdfx.js

[![npm version](https://img.shields.io/npm/v/htmlpdfx.js.svg)](https://www.npmjs.com/package/htmlpdfx.js) [![license](https://img.shields.io/npm/l/htmlpdfx.js.svg)](https://github.com/melon587/htmlpdf.js/blob/main/LICENSE)

[English](./README.md) | [中文文档](./README.zh-CN.md)

A lightweight HTML to PDF converter library based on jsPDF, supporting custom fonts, page breaks, repeat headers, pseudo-elements, and multi-page rendering with cross-page image/canvas cropping.

## ✨ Features

- 📄 **Multi-page rendering** - Automatically splits content across multiple PDF pages
- 🎨 **Custom fonts** - Support for custom font families with different weights and styles, including mixed-language support (e.g., English + Chinese + Arabic)
- 🌍 **RTL/BiDi support** - Native support for right-to-left languages (Arabic, Hebrew) with automatic text reordering
- 📑 **Page breaks** - Control page breaks with `page-break="before"` or `page-break="avoid"` attributes
- 🔁 **Repeat headers** - Automatically repeat table headers on each page with `repeat-header` attribute
- 📐 **Header & Footer** - Customizable page headers and footers with page numbers
- 🖼️ **Cross-page cropping** - Images and canvases that span multiple pages are automatically cropped and rendered across pages
- 🎭 **Pseudo-elements** - Support for `::before` and `::after` pseudo-elements with string content
- 🌈 **Linear gradients** - Render CSS `linear-gradient()` backgrounds (to top/bottom/left/right, angles, multiple color stops)
- 🔲 **Border radius** - Rounded corners (`border-radius`) are fully rendered in backgrounds, borders, and images
- 🗜️ **Compression** - Built-in PDF compression support
- 🎯 **Content-based rendering** - Uses browser's computed layout (`getBoundingClientRect()`) to capture element positions, supporting Flexbox, Grid, and most CSS layouts

## 📦 Installation

```bash
npm install htmlpdfx.js
```

## 🚀 Quick Start

```javascript
import { htmlpdf } from 'htmlpdfx.js';

// Basic usage
const element = document.getElementById('content');
const blob = await htmlpdf(element);

// Download PDF
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'document.pdf';
a.click();
```

## 📖 Usage Examples

### Basic Configuration

```javascript
const blob = await htmlpdf(element, {
  format: 'a4', // Page format: 'a4', 'letter', etc.
  orientation: 'portrait', // 'portrait' or 'landscape'
  margin: 10, // Page margin in px
  compress: true, // Enable PDF compression
  output: 'blob', // Output format: 'blob', 'dataurl', or 'arraybuffer'
});
```

### Per-element Font Override (`pdf-font`)

Use the `pdf-font` attribute to specify which font(s) to use for a specific element, without changing the global font configuration. This is useful when different parts of your document need different fonts.

> **Prerequisite**: The font name used in `pdf-font` must already be registered in the global `fonts` config. If it is not found, the font will be skipped and a warning will be printed to the console.

**Basic usage — assign a single font to an element:**

```javascript
// Step 1: Register fonts in the global fonts config
const blob = await htmlpdf(element, {
  fonts: [
    {
      fontFamily: 'Roboto',
      fontUrl: '/fonts/Roboto-Regular.ttf',
      isDefault: true,
    },
    {
      fontFamily: 'NotoSansCJK',
      fontUrl: '/fonts/NotoSansCJK-Regular.ttf',
      charRanges: [[0x4e00, 0x9fff]],
    },
  ],
});
```

```html
<!-- Step 2: Use pdf-font in HTML to assign a registered font to this element -->
<!-- This paragraph uses NotoSansCJK regardless of the global default -->
<p pdf-font="NotoSansCJK">你好世界</p>
```

**Multiple fonts — for mixed-language text within a single element:**

```html
<!-- Static attribute (comma-separated) -->
<p pdf-font="Roboto,NotoSansCJK">Hello 你好</p>

<!-- Vue dynamic binding (array) -->
<p :pdf-font="['Roboto', 'NotoSansCJK']">Hello 你好</p>
```

When multiple fonts are listed, fonts with `charRanges` configured will match their respective character ranges precisely. The first font without `charRanges` acts as the default fallback for that element.

**Priority chain for `pdf-font` elements:**

```
pdf-font fonts (with charRanges)
  → pdf-font fonts (without charRanges, as element default)
    → global charRanges fonts
      → global isDefault font
        → helvetica
```

**Fine-grained control — combine `pdf-font` with `charRanges`:**

If the global config uses Roboto as default, but a specific paragraph is all Chinese and you want NotoSansCJK to render it directly without per-character `charRanges` matching:

```javascript
// Global config
fonts: [
  { fontFamily: 'Roboto', isDefault: true },
  { fontFamily: 'NotoSansCJK', charRanges: [[0x4e00, 0x9fff]] },
];
```

```html
<!-- This paragraph uses NotoSansCJK as its element default,
     skipping per-character charRanges matching -->
<p pdf-font="NotoSansCJK">全中文段落，直接用 NotoSansCJK 渲染</p>
```

---

### Custom Fonts

> Font files (`.ttf`) are required. You can find ready-to-use fonts at: https://github.com/melon587/fonts.git

```javascript
const blob = await htmlpdf(element, {
  fonts: [
    {
      fontFamily: 'Roboto',
      fontUrl: 'https://example.com/fonts/roboto-regular.ttf',
      fontWeight: 400,
      fontStyle: 'normal',
      isDefault: true,
    },
    {
      fontFamily: 'Roboto',
      fontUrl: 'https://example.com/fonts/roboto-bold.ttf',
      fontWeight: 700,
      fontStyle: 'normal',
    },
  ],
});
```

### Mixed Language Support (English + Chinese + Arabic)

```javascript
const blob = await htmlpdf(element, {
  fonts: [
    {
      fontFamily: 'Roboto',
      fontUrl: 'https://example.com/Roboto-Regular.ttf',
      fontWeight: 400,
      fontStyle: 'normal',
      isDefault: true, // Default for English and other Latin characters
    },
    {
      fontFamily: 'NotoSansCJK',
      fontUrl: 'https://example.com/NotoSansCJK-Regular.ttf',
      fontWeight: 400,
      fontStyle: 'normal',
      charRanges: [
        [0x4e00, 0x9fff], // CJK Unified Ideographs (Chinese)
      ],
    },
    {
      fontFamily: 'NotoSansArabic',
      fontUrl: 'https://example.com/NotoSansArabic-Regular.ttf',
      fontWeight: 400,
      fontStyle: 'normal',
      charRanges: [
        [0x0600, 0x06ff], // Arabic
        [0x0750, 0x077f], // Arabic Supplement
      ],
    },
  ],
});
```

### Header and Footer

The `render` callback receives `headerHeight` / `footerHeight` (in mm) so you can position text inside the header/footer area without hard-coding offsets.

```javascript
const blob = await htmlpdf(element, {
  header: {
    height: 10, // Header height in mm
    render(doc, { pageNumber, totalPages, pageWidth, margin, headerHeight }) {
      doc.setFontSize(9);
      // Center text vertically within the header band (y=0 ~ y=headerHeight)
      const y = headerHeight * 0.65;
      doc.text('My Document', margin, y);
      doc.text(`Page ${pageNumber} / ${totalPages}`, pageWidth - margin, y, {
        align: 'right',
      });
    },
  },
  footer: {
    height: 8, // Footer height in mm
    render(
      doc,
      { pageNumber, totalPages, pageWidth, pageHeight, footerHeight },
    ) {
      doc.setFontSize(8);
      // Center text vertically within the footer band (y=pageHeight-footerHeight ~ y=pageHeight)
      const y = pageHeight - footerHeight * 0.35;
      doc.text(`${pageNumber} / ${totalPages}`, pageWidth / 2, y, {
        align: 'center',
      });
    },
  },
});
```

### Page Breaks

```html
<!-- Force page break before this element -->
<div page-break="before">This content starts on a new page</div>

<!-- Avoid page break inside this element -->
<div page-break="avoid">This content will not be split across pages</div>
```

> **Auto avoid**: `TR`, `SVG`, and `VIDEO` elements automatically get `page-break="avoid"` behavior without any attribute — they are never split across pages.

### Repeat Table Headers

Add the table selector and header selector via `tables`:

```html
<table id="my-table">
  <thead id="my-table-header">
    <tr>
      <th>Name</th>
      <th>Email</th>
      <th>Department</th>
    </tr>
  </thead>
  <tbody>
    <!-- Table rows... -->
  </tbody>
</table>
```

```javascript
const blob = await htmlpdf(element, {
  tables: [
    {
      selector: '#my-table',
      repeatHeader: '#my-table-header',
    },
  ],
});
```

### Pseudo-elements

htmlpdf supports `::before` and `::after` pseudo-elements with **string content only**:

```css
/* ✅ Supported: String content */
.icon::before {
  content: '✓ ';
  color: green;
}

.badge::after {
  content: 'NEW';
  background: red;
  color: white;
}

/* ✅ Supported: Unicode escapes */
.star::before {
  content: '\2605'; /* ★ */
}

/* ❌ Not supported: Counters, attr(), url() */
.item::before {
  content: counter(item); /* Counter not supported */
}
```

**Workaround for counters**: Use JavaScript to generate numbered elements before exporting:

```javascript
// Before exporting to PDF
document.querySelectorAll('.step-list li').forEach((li, index) => {
  const span = document.createElement('span');
  span.className = 'step-number';
  span.textContent = index + 1;
  li.insertBefore(span, li.firstChild);
});

// Then export
await htmlpdf(element);
```

## 📚 API Reference

### `htmlpdf(element, options)`

Converts an HTML element to PDF.

#### Parameters

- **element** `HTMLElement` - The DOM element to convert
- **options** `Object` - Configuration options

#### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `output` | `string` | `'blob'` | Output format: `'blob'`, `'dataurl'`, or `'arraybuffer'` |
| `format` | `string` | `'a4'` | Page format (any jsPDF supported format) |
| `orientation` | `string` | `'portrait'` | Page orientation: `'portrait'` or `'landscape'` |
| `margin` | `number` | `0` | Page margin in px |
| `compress` | `boolean` | `true` | Enable PDF compression |
| `fonts` | `Array` | `[]` | Custom font configurations |
| `header` | `Object` | - | Header configuration `{ height: mm, render(doc, info) }` |
| `footer` | `Object` | - | Footer configuration `{ height: mm, render(doc, info) }` |
| `tables` | `Array` | `[]` | Table configurations, e.g. `[{ selector: '#t1', repeatHeader: 'thead', pageBreakBorder: '1px solid #ccc' }]` |
| `debug` | `boolean` | `false` | Print per-stage timing logs to the console |
| `onProgress` | `Function` | - | Progress callback `({ stage, progress: 0~1 }) => void`. Stages: `'clone'`, `'images'`, `'fonts'`, `'paginate'`, `'render'`, `'output'` |

#### Font Configuration

Each font config object supports the following fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `fontFamily` | `string` | ✅ | Font family name (e.g., `'Roboto'`, `'NotoSansCJK'`) |
| `fontUrl` | `string` | \* | URL to .ttf font file (required if `fontBase64` not provided) |
| `fontBase64` | `string` | \* | Base64-encoded font data (required if `fontUrl` not provided) |
| `fontWeight` | `number\|string` | ❌ | Font weight: `400`, `700`, `'bold'`, etc. (default: `400`) |
| `fontStyle` | `string` | ❌ | Font style: `'normal'` or `'italic'` (default: `'normal'`) |
| `isDefault` | `boolean` | ❌ | If `true`, this font is used for all characters not matched by `charRanges` |
| `charRanges` | `Array<[number, number]>` | ❌ | Unicode ranges for this font, e.g., `[[0x4E00, 0x9FFF]]` for CJK |

**Font Selection Rules:**

1. **charRanges first**: Characters are matched against fonts with `charRanges` in array order
2. **isDefault fallback**: If no `charRanges` match, use the font marked `isDefault: true`
3. **Helvetica fallback**: If no match is found (no `isDefault`, no matching `charRanges`), fall back to built-in `helvetica`

**Example: Mixed Language Support**

```javascript
fonts: [
  {
    fontFamily: 'NotoSansCJK',
    fontUrl: 'https://example.com/NotoSansCJK-Regular.ttf',
    charRanges: [[0x4e00, 0x9fff]], // Chinese characters
  },
  {
    fontFamily: 'Roboto',
    fontUrl: 'https://example.com/Roboto-Regular.ttf',
    isDefault: true, // For all other characters (English, numbers, etc.)
  },
];
```

**Notes:**

- `charRanges` and `isDefault` are mutually exclusive (use one or the other per font)
- When `charRanges` overlap across multiple fonts, array order determines precedence
- Fonts are fetched and cached by URL for the lifetime of the page; changing the URL is the correct way to bust the cache

#### Returns

Returns a `Promise` that resolves to:

- `Blob` - if `output` is `'blob'`
- `string` - if `output` is `'dataurl'`
- `ArrayBuffer` - if `output` is `'arraybuffer'`

## 🎨 Supported CSS Features

### ✅ Fully Supported

- **Text**: `color`, `fontSize`, `fontFamily`, `fontWeight`, `fontStyle`, `textAlign`, `lineHeight`, `textDecoration`
- **Backgrounds**: Solid colors (`background-color`), linear gradients (`linear-gradient()`), background images (`background-image: url(...)`) with `background-size` and `background-position` support
- **Borders**: All border styles (`border-width`, `border-color`, `border-style`, `border-radius`) including rounded corners
- **Images**: `<img>` tags with cross-page cropping support
- **Canvas**: `<canvas>` elements with cross-page cropping support
- **Pseudo-elements**: `::before` and `::after` with string content
- **RTL/BiDi**: Right-to-left text (Arabic, Hebrew) with automatic text reordering

### ⚠️ Layout Considerations

**Content-based positioning**: htmlpdf uses the browser's computed layout (via `getBoundingClientRect()`) to determine element positions. This means:

- ✅ **Flexbox & Grid layouts work** - Elements positioned by flex/grid will render at their computed positions
- ✅ **Most layouts render correctly** - As long as the browser calculates positions correctly, htmlpdf will capture them

**However, for tables specifically:**

- ✅ **Use native `<table>` tags** - Recommended for tabular data, especially when using features like repeat headers
- ⚠️ **Avoid flex/grid for tables** - While technically supported, using `display: flex` or `display: grid` to create table-like layouts may cause unexpected behavior with table-specific features (repeat headers, page breaks within tables)

**Performance considerations:**

- ⚡ **Keep HTML structure simple** - htmlpdf recursively traverses the DOM tree; deeply nested elements significantly increase processing time
- ⚡ **Minimize wrapper elements** - Avoid unnecessary `<div>` wrappers when possible
- ⚡ **Flatten complex layouts** - Simplify nested flex/grid structures before PDF generation for better performance

**Example - Performance optimization:**

```html
<!-- ❌ Avoid: Deeply nested structure -->
<div class="wrapper">
  <div class="container">
    <div class="row">
      <div class="col">
        <div class="card">
          <div class="card-body">
            <p>Content</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ✅ Better: Flattened structure -->
<div class="content">
  <p>Content</p>
</div>
```

**Example - Recommended table structure:**

```html
<!-- ✅ Recommended: Native table -->
<table>
  <thead>
    <tr>
      <th>Column 1</th>
      <th>Column 2</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Data 1</td>
      <td>Data 2</td>
    </tr>
  </tbody>
</table>

<!-- ⚠️ Not recommended for tables: Flex/grid -->
<div style="display: grid; grid-template-columns: 1fr 1fr;">
  <div>Column 1</div>
  <div>Column 2</div>
  <div>Data 1</div>
  <div>Data 2</div>
</div>
```

### ⚠️ Partially Supported

- **Backgrounds**: Only `linear-gradient()` with standard directions (to top/bottom/left/right, diagonal corners like `to top right`, and angle values). Radial/conic gradients not supported.
- **Pseudo-elements**: Only `content: "string"` supported. Counters (`counter()`), attributes (`attr()`), and images (`url()`) are not supported.

### ❌ Not Supported

- **Transforms**: CSS transforms (`rotate`, `scale`, `skew`, `matrix`) are not rendered
- **Advanced CSS**: Animations, transitions, filters, shadows, backdrop-filter
- **Complex borders**: Border images, advanced border styles (double, groove, ridge, inset, outset)
- **Gradients**: Radial gradients, conic gradients, repeating gradients

## 🎯 Browser Support

Modern browsers with ES6+ support:

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## ⚠️ Known Limitations

### Browser-only

htmlpdfx.js **cannot run in Node.js, Deno, or any server-side environment**. It relies on browser APIs that do not exist outside a browser context:

- `getBoundingClientRect()` — for element coordinates
- `getComputedStyle()` — for CSS properties
- `Range.getClientRects()` — for multi-line text measurement

If you need server-side HTML-to-PDF, consider [Puppeteer](https://pptr.dev/) or [Playwright](https://playwright.dev/).

### CSS transforms

CSS `transform` (rotate, scale, skew, matrix, translate) is **not rendered**. Elements are always drawn at their un-transformed layout position.

### Unsupported CSS

- Box shadows, text shadows, `filter`, `backdrop-filter`
- CSS animations and transitions (only the static initial state is captured)
- Radial gradients, conic gradients, repeating gradients
- `clip-path`, `mask`, `overflow: hidden` on non-rectangular areas

### Images

- SVG `<img>` tags are not rendered (inline `<svg>` elements are also not supported)
- Data URIs in `background-image` may fail if the browser blocks them in the iframe

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT © [melon587](https://github.com/melon587)

## 🙏 Acknowledgments

Built with [jsPDF](https://github.com/parallax/jsPDF)
