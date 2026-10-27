# Before Output

Use `beforeOutput` to modify the completed jsPDF document before it is serialized to a Blob, data URL, or ArrayBuffer.

## Example

```js
const blob = await htmlpdf(element, {
  beforeOutput(doc, { totalPages, ctx }) {
    doc.setProperties({ title: 'Quotation' });
    for (let page = 1; page <= totalPages; page += 1) {
      doc.setPage(page);
      doc.setFont('helvetica');
      doc.setFontSize(10);
      doc.text('Reviewed', ctx.pageWidth - 10, 10, { align: 'right' });
    }
  },
});
```

The callback receives the raw jsPDF instance and `{ totalPages, ctx }`. It runs once during a normal export, after the document content and all headers and footers have been drawn.

## Asynchronous Work

An `async` callback is also supported. Await any preparation inside the callback before applying your jsPDF changes; PDF output waits for the returned promise to resolve.

## Notes

- Select the target page explicitly with `doc.setPage()` before drawing.
- `totalPages` is the original pagination result. Adding or deleting pages does not change this value; use `doc.getNumberOfPages()` to get the edited document's page count.
- Page edits do not trigger repagination or redraw headers and footers.
- Treat `ctx` layout values as read-only. They are not recalculated after document edits. Page dimensions are in mm.
- A thrown error or rejected promise causes `htmlpdf()` to reject. Callback return values do not replace the PDF output.
- Do not call `ctx.output()` from the callback: it invokes `beforeOutput` again.

See [API Reference](../api#beforeoutput) for the callback signature and context fields.
