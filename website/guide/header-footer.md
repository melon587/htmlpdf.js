# Header & Footer

Use `header` and `footer` options to render custom content on every page.

## Example

```js
const blob = await htmlpdf(element, {
  header: {
    height: 10, // mm — reserved at top of every page
    render(doc, { pageNumber, totalPages, pageWidth, margin }) {
      doc.setFontSize(9);
      doc.text('My Document', margin, margin - 2);
      doc.text(
        `Page ${pageNumber} / ${totalPages}`,
        pageWidth - margin,
        margin - 2,
        { align: 'right' },
      );
    },
  },
  footer: {
    height: 8,
    render(doc, { pageNumber, totalPages, pageWidth, pageHeight, margin }) {
      doc.setFontSize(8);
      doc.text(
        `${pageNumber} / ${totalPages}`,
        pageWidth / 2,
        pageHeight - margin + 4,
        { align: 'center' },
      );
    },
  },
});
```

## `PageRenderInfo` Object

The second argument passed to `render()`:

| Field        | Type     | Description             |
| ------------ | -------- | ----------------------- |
| `pageNumber` | `number` | Current page (1-based)  |
| `totalPages` | `number` | Total pages in document |
| `pageWidth`  | `number` | Page width in mm        |
| `pageHeight` | `number` | Page height in mm       |
| `margin`     | `number` | Page margin in mm       |

## Notes

- `height` is in **mm**. The content area is reduced by this amount on every page.
- `doc` is the raw jsPDF instance — you can call any jsPDF API inside `render()`.
- Text colour and font size set inside `render()` do not carry over to the main content.
