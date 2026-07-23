# Getting Started

## Installation

::: code-group

```sh [npm]
npm install htmlpdfx.js
```

```sh [pnpm]
pnpm add htmlpdfx.js
```

```sh [yarn]
yarn add htmlpdfx.js
```

` :::

## Quick Start

```js
import { htmlpdf } from 'htmlpdfx.js';

const element = document.getElementById('content');
const blob = await htmlpdf(element);

// Download
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'document.pdf';
a.click();
```

## Basic Options

```js
const blob = await htmlpdf(element, {
  format: 'a4', // page format
  orientation: 'portrait',
  margin: 10, // px — converted to mm internally
  compress: true,
  output: 'blob', // 'blob' | 'dataurl' | 'arraybuffer'
});
```

## Browser Requirements

htmlpdfx.js relies on browser APIs that do not exist in Node.js or Deno:

- `getBoundingClientRect()` — element coordinates
- `getComputedStyle()` — CSS properties
- `Range.getClientRects()` — multi-line text measurement

| Browser       | Min version |
| ------------- | ----------- |
| Chrome / Edge | 90+         |
| Firefox       | 88+         |
| Safari        | 14+         |

::: warning Server-side rendering htmlpdfx.js **cannot run in Node.js or any server-side environment**. For server-side HTML-to-PDF, use [Puppeteer](https://pptr.dev/) or [Playwright](https://playwright.dev/). :::

## Next Steps

- [Custom Fonts](./fonts) — load TTF/OTF, mixed-language, per-character ranges
- [Page Breaks](./page-breaks) — `page-break="before"` / `"avoid"`
- [Header & Footer](./header-footer) — per-page render callbacks
- [Repeat Table Header](./repeat-header) — header on every page
- [API Reference](/api) — full options reference
