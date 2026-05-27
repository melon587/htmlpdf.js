# htmlpdf.js

[![npm version](https://img.shields.io/npm/v/htmlpdf.js.svg)](https://www.npmjs.com/package/htmlpdf.js)
[![license](https://img.shields.io/npm/l/htmlpdf.js.svg)](https://github.com/melon587/htmlpdf.js/blob/main/LICENSE)

A lightweight HTML to PDF converter library based on jsPDF, supporting custom fonts, page breaks, repeat headers, and multi-page rendering.

## ✨ Features

- 📄 **Multi-page rendering** - Automatically splits content across multiple PDF pages
- 🎨 **Custom fonts** - Support for custom font families with different weights and styles
- 📑 **Page breaks** - Control page breaks with `page-break="before"` or `page-break="avoid"` attributes
- 🔁 **Repeat headers** - Automatically repeat table headers on each page with `repeat-header` attribute
- 📐 **Header & Footer** - Customizable page headers and footers with page numbers
- 🗜️ **Compression** - Built-in PDF compression support
- 🎯 **Accurate rendering** - Preserves text, colors, backgrounds, borders, and images

## 📦 Installation

```bash
npm install htmlpdf.js
```

## 🚀 Quick Start

```javascript
import { htmlpdf } from 'htmlpdf.js';

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
  format: 'a4',              // Page format: 'a4', 'letter', etc.
  orientation: 'portrait',   // 'portrait' or 'landscape'
  margin: 10,                // Page margin in mm
  compress: true,            // Enable PDF compression
  output: 'blob'             // Output format: 'blob', 'dataurl', or 'arraybuffer'
});
```

### Custom Fonts

```javascript
const blob = await htmlpdf(element, {
  fontConfig: [
    {
      fontFamily: 'Roboto',
      fontUrl: 'https://example.com/fonts/roboto-regular.ttf',
      fontWeight: 400,
      fontStyle: 'normal',
      isDefault: true
    },
    {
      fontFamily: 'Roboto',
      fontUrl: 'https://example.com/fonts/roboto-bold.ttf',
      fontWeight: 700,
      fontStyle: 'normal'
    }
  ]
});
```

### Header and Footer

```javascript
const blob = await htmlpdf(element, {
  header: {
    height: 10,  // Header height in mm
    render(doc, { pageNumber, totalPages, pageWidth, margin }) {
      doc.setFontSize(9);
      doc.text('My Document', margin, margin - 2);
      doc.text(
        `Page ${pageNumber} / ${totalPages}`,
        pageWidth - margin,
        margin - 2,
        { align: 'right' }
      );
    }
  },
  footer: {
    height: 8,   // Footer height in mm
    render(doc, { pageNumber, totalPages, pageWidth, pageHeight, margin }) {
      doc.setFontSize(8);
      doc.text(
        `${pageNumber} / ${totalPages}`,
        pageWidth / 2,
        pageHeight - margin + 4,
        { align: 'center' }
      );
    }
  }
});
```

### Page Breaks

```html
<!-- Force page break before this element -->
<div page-break="before">
  This content starts on a new page
</div>

<!-- Avoid page break inside this element -->
<div page-break="avoid">
  This content will not be split across pages
</div>
```

### Repeat Table Headers

```html
<table>
  <thead repeat-header>
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

## 📚 API Reference

### `htmlpdf(element, options)`

Converts an HTML element to PDF.

#### Parameters

- **element** `HTMLElement` - The DOM element to convert
- **options** `Object` - Configuration options

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `output` | `string` | `'blob'` | Output format: `'blob'`, `'dataurl'`, or `'arraybuffer'` |
| `format` | `string` | `'a4'` | Page format (any jsPDF supported format) |
| `orientation` | `string` | `'portrait'` | Page orientation: `'portrait'` or `'landscape'` |
| `margin` | `number` | `10` | Page margin in mm |
| `compress` | `boolean` | `true` | Enable PDF compression |
| `fontConfig` | `Array` | `[]` | Custom font configurations |
| `header` | `Object` | - | Header configuration `{ height, render }` |
| `footer` | `Object` | - | Footer configuration `{ height, render }` |

#### Font Configuration

Each font config object should have:

```javascript
{
  fontFamily: 'FontName',    // Font family name
  fontUrl: 'https://...',    // URL to .ttf font file
  fontWeight: 400,           // Font weight (400, 700, etc.)
  fontStyle: 'normal',       // Font style ('normal' or 'italic')
  isDefault: false,          // Whether this is the default font
  priority: 0,               // Font selection priority (higher = preferred)
  charRanges: [[0x0000, 0xFFFF]]  // Unicode ranges (optional)
}
```

#### Returns

Returns a `Promise` that resolves to:
- `Blob` - if `output` is `'blob'`
- `string` - if `output` is `'dataurl'`
- `ArrayBuffer` - if `output` is `'arraybuffer'`

## 🎯 Browser Support

Modern browsers with ES6+ support:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT © [melon587](https://github.com/melon587)

## 🙏 Acknowledgments

Built with [jsPDF](https://github.com/parallax/jsPDF)
