# Custom Fonts

htmlpdfx.js supports any TTF or OTF font loaded by URL or inline Base64.

## Single Font

```js
const blob = await htmlpdf(element, {
  fonts: [
    {
      fontFamily: 'Roboto',
      fontUrl: 'https://example.com/fonts/Roboto-Regular.ttf',
      fontWeight: 400,
      fontStyle: 'normal',
      isDefault: true,
    },
  ],
});
```

## Multiple Weights

```js
fonts: [
  {
    fontFamily: 'Roboto',
    fontUrl: '...roboto-regular.ttf',
    fontWeight: 400,
    isDefault: true,
  },
  { fontFamily: 'Roboto', fontUrl: '...roboto-bold.ttf', fontWeight: 700 },
  {
    fontFamily: 'Roboto',
    fontUrl: '...roboto-italic.ttf',
    fontWeight: 400,
    fontStyle: 'italic',
  },
];
```

## Mixed Languages (charRanges)

Use `charRanges` to assign fonts to specific Unicode ranges. Characters are matched in array order; unmatched characters fall back to `isDefault`.

```js
fonts: [
  {
    fontFamily: 'Roboto',
    fontUrl: '...Roboto-Regular.ttf',
    isDefault: true, // fallback for all unmatched characters
  },
  {
    fontFamily: 'NotoSansCJK',
    fontUrl: '...NotoSansCJK-Regular.ttf',
    charRanges: [[0x4e00, 0x9fff]], // CJK Unified Ideographs
  },
  {
    fontFamily: 'NotoSansArabic',
    fontUrl: '...NotoSansArabic-Regular.ttf',
    charRanges: [
      [0x0600, 0x06ff], // Arabic
      [0x0750, 0x077f], // Arabic Supplement
    ],
  },
];
```

## Per-element Font Override (`pdf-font`)

Use the `pdf-font` HTML attribute to override fonts for a specific element without changing global config.

```html
<p pdf-font="NotoSansCJK">你好世界</p>

<!-- Multiple fonts (comma-separated) -->
<p pdf-font="Roboto,NotoSansCJK">Hello 你好</p>
```

```html
<!-- Vue dynamic binding (array) -->
<p :pdf-font="['Roboto', 'NotoSansCJK']">Hello 你好</p>
```

**Priority chain for `pdf-font` elements:**

```
pdf-font fonts (with charRanges)
  → pdf-font fonts (without charRanges — element default)
    → global charRanges fonts
      → global isDefault font
        → helvetica
```

## Font Config Fields

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `fontFamily` | `string` | ✅ | — | CSS font-family name |
| `fontUrl` | `string` | \* | — | URL to TTF/OTF file |
| `fontBase64` | `string` | \* | — | Inline Base64 font data |
| `fontWeight` | `number\|string` | ❌ | `400` | `400`, `700`, `'bold'`, etc. |
| `fontStyle` | `string` | ❌ | `'normal'` | `'normal'` or `'italic'` |
| `isDefault` | `boolean` | ❌ | `false` | Use for all unmatched characters |
| `charRanges` | `Array<[number, number]>` | ❌ | — | Unicode codepoint ranges |

\* Either `fontUrl` or `fontBase64` is required.

::: tip Caching Fonts are fetched and cached by URL for the lifetime of the page. To bust the cache, change the URL. :::
