# Font System — Deep Dive

## Overview

The font system handles two separate concerns:

1. **Layout fidelity** — ensuring the cloned iframe uses the correct fonts so that text measurements (character widths, line heights) match what will appear in the PDF.
2. **PDF embedding** — registering fonts into jsPDF so they are embedded in the output file.

Both concerns are handled by `src/core/font-loader.js`, executed at different pipeline steps.

## Font Config Reference

```js
options.fonts = [
  {
    family: 'NotoSansSC', // required — CSS font-family name
    src: 'https://cdn/.../NotoSansSC-Regular.ttf', // required (or use data)
    data: '<base64 string>', // alternative to src
    style: 'normal', // optional: 'normal' | 'italic'
    weight: '400', // optional: '400' | '700' | 'bold' etc.
    charRanges: [
      // optional: unicode codepoint pairs
      [0x4e00, 0x9fff], // CJK Unified Ideographs
      [0x3040, 0x309f], // Hiragana
    ],
  },
];
```

Fields that do **NOT** exist and must not be added:

- `priority` — no such field. Selection order is determined by array position.
- `fallback` — no such field.

## Phase 1: Injecting Fonts into the iframe (`injectFontsToDocument`)

Called inside `createClonedDocument()` **before** layout is measured.

For each font config:

1. `getFontBase64(config)` — returns base64 either from `config.data` or by fetching `config.src`.
2. `buildFontFaceRule(config, base64)` in `utils/index.js` constructs a `@font-face` CSS rule including the `unicode-range` descriptor (from `buildUnicodeRange(charRanges)`).
3. A `<style>` element containing all `@font-face` rules is injected into the iframe's `<head>`.

After injection, the browser applies the fonts to the cloned DOM, so `getBoundingClientRect()` and range measurements in `node-parser.js` reflect the real font metrics.

## Phase 2: Loading Fonts into jsPDF (`loadFontsToJsPDF`)

Called after the iframe is destroyed (step 5).

For each font config:

1. `getFontBase64(config)` — fetches or retrieves from `fontCache`.
2. `doc.addFileToVFS(filename, base64)` — registers the font file in jsPDF's virtual file system.
3. `doc.addFont(filename, family, style)` — makes jsPDF aware of the font for use with `setFont`.

The `fontCache` Map in `font-loader.js` ensures each URL is fetched only once across both phases.

## Font Selection at Render Time

`drawText()` in `src/render/text.js` selects the font per character segment.

### Step 1: `buildEffectiveFontConfig(node, sortedFontConfig)`

Builds an ordered list of font configs to try for this node.

- If `node.pdfFont` is set (from `data-pdf-font` attribute), only fonts whose `family` appears in that space-separated list are included (in order they appear in `options.fonts`).
- Otherwise, all fonts from `options.fonts` are candidates.

### Step 2: `segmentTextByFont(text, effectiveFontConfig)`

Splits the text string into segments, where each segment uses a single font.

For each character:

1. Get the Unicode codepoint.
2. Call `findFontForChar(code, effectiveFontConfig)`:
   - Iterates the effective config list.
   - If a config has `charRanges`, checks whether the codepoint falls in any range.
   - If a config has no `charRanges`, it matches any character.
   - Returns the first matching config.
3. If no config matches → use Helvetica (jsPDF built-in).
4. Group consecutive characters that use the same font into one segment.

### Step 3: `measureSegmentWidths(segments, fontStyle, ctx)`

Temporarily sets each segment's font and calls `doc.getTextWidth()` to measure it. This is used for alignment calculations.

### Step 4: `drawMultiSegmentAligned()`

Renders each segment at the correct X position, accounting for overall text alignment (left / center / right) and RTL direction.

## `data-pdf-font` Attribute

HTML elements can request specific fonts via this attribute:

```html
<!-- Force NotoSansSC for this element -->
<p data-pdf-font="NotoSansSC">中文内容</p>

<!-- Prefer NotoSansSC, then Roboto for this element -->
<span data-pdf-font="NotoSansSC Roboto">混合内容 mixed</span>
```

During DOM enhancement in `document-cloner.js`:

- `propagatePdfFontToElement()` walks the DOM tree and copies the attribute from parents to children that don't have their own `data-pdf-font` declaration.
- `getPdfFont()` in `utils/index.js` reads the attribute, walking up ancestors if needed.

## `charRanges` and CSS `unicode-range`

### In JS font config

```js
charRanges: [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
];
```

### Converted to CSS by `buildUnicodeRange()`

```css
unicode-range: U+4E00-9FFF, U+3400-4DBF;
```

This CSS is included in the `@font-face` rule injected into the iframe, so the browser applies the font to matching characters during layout.

At render time, the same `charRanges` are used by `findFontForChar()` to select the correct font for each character in jsPDF.

## Font Style / Weight Mapping

| CSS `font-style`    | CSS `font-weight` | jsPDF style string |
| ------------------- | ----------------- | ------------------ |
| `normal`            | `400`, `normal`   | `'normal'`         |
| `normal`            | `700`, `bold`     | `'bold'`           |
| `italic`, `oblique` | `400`, `normal`   | `'italic'`         |
| `italic`, `oblique` | `700`, `bold`     | `'bolditalic'`     |

`getCombinedFontStyle(fontStyle, fontWeight)` in `text.js` handles this mapping.

For a font to support bold/italic variants, separate font config entries with the corresponding `style` and `weight` values must be present in `options.fonts`.

## Fallback Chain

1. **`data-pdf-font` restricted set** — fonts whose family is listed in the attribute
2. **Full `options.fonts` list** — all configured fonts, checked by `charRanges`
3. **Helvetica** — jsPDF built-in, always available, covers basic Latin

There is no `fonts[0]` fallback layer — if `charRanges` narrows all fonts out for a given character, the system falls directly to Helvetica.

## Common Font Bugs and Causes

| Symptom | Likely cause |
| --- | --- |
| Text shows as boxes / tofu | Font not registered in jsPDF (Phase 2 failed) |
| Text correct in browser but wrong in PDF | Font not injected into iframe (Phase 1 failed) |
| Wrong characters appear | `charRanges` overlapping across fonts |
| Bold text not bold in PDF | Missing bold variant in `options.fonts` (same family, `weight: '700'`) |
| `data-pdf-font` has no effect | Attribute not being propagated by `document-cloner.js` |
