# Known Limitations

## Browser-only

htmlpdfx.js **cannot run in Node.js, Deno, or any server-side environment**. It relies on browser APIs that do not exist outside a browser context:

- `getBoundingClientRect()` — element coordinates
- `getComputedStyle()` — CSS properties
- `Range.getClientRects()` — multi-line text measurement

For server-side HTML-to-PDF, use [Puppeteer](https://pptr.dev/) or [Playwright](https://playwright.dev/).

## CSS transforms

CSS `transform` (rotate, scale, skew, matrix, translate) is **not rendered**. Elements are always drawn at their un-transformed layout position.

## Unsupported CSS

- Box shadows, text shadows, `filter`, `backdrop-filter`
- CSS animations and transitions (only the static initial state is captured)
- Radial gradients, conic gradients, repeating gradients
- `clip-path`, `mask`, `overflow: hidden` on non-rectangular areas

## Images

- SVG `<img>` tags are not rendered (inline `<svg>` elements are also not supported)
- Data URIs in `background-image` may fail if the browser blocks them in the iframe
