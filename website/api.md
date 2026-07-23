# API Reference

## `htmlpdf(element, options?)`

Converts an HTML element to a PDF document. Returns a `Promise`.

```ts
function htmlpdf(element: HTMLElement, options?: HtmlpdfOptions): Promise<Blob>;
function htmlpdf(
  element: HTMLElement,
  options: HtmlpdfOptions & { output: 'dataurl' },
): Promise<string>;
function htmlpdf(
  element: HTMLElement,
  options: HtmlpdfOptions & { output: 'arraybuffer' },
): Promise<ArrayBuffer>;
```

### Parameters

| Parameter | Type             | Description                |
| --------- | ---------------- | -------------------------- |
| `element` | `HTMLElement`    | The DOM element to convert |
| `options` | `HtmlpdfOptions` | Optional configuration     |

### Returns

A `Promise` resolving to:

- `Blob` — when `output` is `'blob'` (default)
- `string` — when `output` is `'dataurl'`
- `ArrayBuffer` — when `output` is `'arraybuffer'`

---

## `HtmlpdfOptions`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `output` | `'blob' \| 'dataurl' \| 'arraybuffer'` | `'blob'` | Output format |
| `format` | `string \| [number, number]` | `'a4'` | Page format (any jsPDF format) |
| `orientation` | `'portrait' \| 'landscape'` | `'portrait'` | Page orientation |
| `margin` | `number` | `0` | Page margin in **px** |
| `compress` | `boolean` | `true` | Enable PDF compression |
| `fonts` | `FontConfig[]` | `[]` | Custom font configurations |
| `header` | `HeaderFooterConfig` | — | Page header |
| `footer` | `HeaderFooterConfig` | — | Page footer |
| `tables` | `TableConfig[]` | `[]` | Table repeat-header configurations |
| `debug` | `boolean` | `false` | Print per-stage timing to console |
| `onProgress` | `(e: ProgressEvent) => void` | — | Progress callback |

---

## `FontConfig`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `fontFamily` | `string` | ✅ | — | CSS font-family name |
| `fontUrl` | `string` | \* | — | URL to TTF/OTF file |
| `fontBase64` | `string` | \* | — | Inline Base64 font data |
| `fontWeight` | `number \| string` | ❌ | `400` | Weight: `400`, `700`, `'bold'`, … |
| `fontStyle` | `string` | ❌ | `'normal'` | `'normal'` or `'italic'` |
| `isDefault` | `boolean` | ❌ | `false` | Fallback for all unmatched characters |
| `charRanges` | `[number, number][]` | ❌ | — | Unicode codepoint ranges |

\* Either `fontUrl` or `fontBase64` is required.

---

## `HeaderFooterConfig`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `height` | `number` | ✅ | Height in **mm** reserved from the content area |
| `render` | `(doc: object, info: PageRenderInfo) => void` | ✅ | Called once per page |

### `PageRenderInfo`

| Field        | Type     | Description            |
| ------------ | -------- | ---------------------- |
| `pageNumber` | `number` | Current page (1-based) |
| `totalPages` | `number` | Total pages            |
| `pageWidth`  | `number` | Page width in mm       |
| `pageHeight` | `number` | Page height in mm      |
| `margin`     | `number` | Page margin in mm      |

---

## `TableConfig`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `selector` | `string` | ✅ | CSS selector for the table container |
| `repeatHeader` | `string` | ❌ | CSS selector for the header element to repeat |
| `pageBreakBorder` | `string` | ❌ | Border drawn at the page-break edge, e.g. `'1px solid #ccc'` |

---

## `ProgressEvent`

| Field      | Type            | Description                            |
| ---------- | --------------- | -------------------------------------- |
| `stage`    | `ProgressStage` | Current pipeline stage                 |
| `progress` | `number`        | Progress within the stage: `0.0`–`1.0` |

### `ProgressStage`

Stages in order: `'clone'` → `'images'` → `'fonts'` → `'paginate'` → `'render'` → `'output'`
