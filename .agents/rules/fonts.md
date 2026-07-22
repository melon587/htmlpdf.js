# Font System Rules

## Font Config Schema

Each entry in `options.fonts[]` must have this shape:

```js
{
  family: 'MyFont',        // required — CSS font-family name (must match @font-face)
  src: 'https://...',      // required — URL to .ttf/.otf file  (OR use `data`)
  data: '<base64>',        // alternative to src — inline base64 font data
  style: 'normal',         // optional — 'normal' | 'italic'  (default: 'normal')
  weight: '400',           // optional — '400' | '700' | 'bold' etc. (default: '400')
  charRanges: [            // optional — unicode ranges for font segmentation
    [0x4E00, 0x9FFF],      //   each entry: [start, end] codepoint pair
  ],
}
```

**Do NOT add a `priority` field.** It does not exist in the source and will be silently ignored.

## Two-Phase Font Loading

### Phase 1 — `injectFontsToDocument()` (inside iframe, step 2)

Injects `@font-face` CSS into the cloned iframe so that layout and text measurements reflect the custom font metrics.

### Phase 2 — `loadFontsToJsPDF()` (after iframe destroyed, step 5)

Fetches each font as base64, calls `doc.addFileToVFS()` + `doc.addFont()` to register it into jsPDF for PDF embedding.

A shared `fontCache` Map in `font-loader.js` prevents duplicate fetches across phases.

## Font Selection at Render Time

`drawText()` in `text.js` selects fonts per character via `findFontForChar()`:

1. Collect the effective font config list for this node with `buildEffectiveFontConfig()`.
   - Node's own `data-pdf-font` attribute (space-separated font family names) is checked first.
   - Falls back to global `fonts[]` array.
2. For each character code, iterate the effective config list:
   - If `charRanges` is defined, check whether the codepoint falls in any range.
   - If `charRanges` is absent, this font matches any character.
3. If no custom font matches, fall back to jsPDF's built-in **Helvetica**.
4. Adjacent characters that share the same font are grouped into one segment.

## `data-pdf-font` Attribute

Elements can declare preferred fonts via a HTML attribute:

```html
<span data-pdf-font="NotoSansSC">中文内容</span>
<p data-pdf-font="NotoSansSC Roboto">mixed content</p>
```

- Space-separated list of font family names.
- `getPdfFont()` in `utils/index.js` reads this attribute, walking up ancestors if needed.
- `document-cloner.js` propagates the attribute from parents to children during DOM enhancement.

## `charRanges` and `unicode-range`

`charRanges` in the font config is a JS array of `[start, end]` pairs.  
`buildUnicodeRange()` in `utils/index.js` converts it to a CSS `unicode-range` string for the `@font-face` declaration injected into the iframe.

Example:

```js
charRanges: [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
];
// → unicode-range: U+4E00-9FFF, U+3400-4DBF
```

## Font Style Mapping

`getCombinedFontStyle(fontStyle, fontWeight)` in `text.js` maps CSS values to jsPDF's four style identifiers:

| fontStyle | fontWeight     | jsPDF style    |
| --------- | -------------- | -------------- |
| `normal`  | `400`/`normal` | `'normal'`     |
| `normal`  | `700`/`bold`   | `'bold'`       |
| `italic`  | `400`/`normal` | `'italic'`     |
| `italic`  | `700`/`bold`   | `'bolditalic'` |

## Rules for Adding New Fonts

1. Add the font config object to `options.fonts[]`.
2. Specify `charRanges` if the font covers a specific script (e.g. CJK, Arabic).
3. Use `data-pdf-font` on HTML elements to force specific fonts for mixed-language content.
4. Do NOT add `priority` — font selection order is controlled by position in the `fonts[]` array and by `buildEffectiveFontConfig()` ordering.
5. Ensure the font URL is accessible from the browser (CORS-safe or same origin).
