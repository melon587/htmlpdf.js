# Ignore Elements

Add `htmlpdf-ignore` to exclude an element and its entire subtree from PDF export while keeping it visible in the original page.

## Example

```html
<div id="content">
  <h1>Quotation</h1>
  <button htmlpdf-ignore>Export PDF</button>
  <p>This text appears in the PDF.</p>
  <section htmlpdf-ignore>
    <p>This section and all its children are excluded.</p>
  </section>
</div>
```

```js
const blob = await htmlpdf(document.getElementById('content'));
```

## Layout Behavior

Ignored elements are removed from the cloned document before layout measurement and pagination. They do not leave a placeholder; the browser reflows the remaining content. Fixed container dimensions and other CSS constraints still apply.

The original DOM, including canvas pixels and current form values, is not modified by the ignore operation.

## Attribute Presence

All of these exclude the element:

```html
<div htmlpdf-ignore>Excluded</div>
<div htmlpdf-ignore="true">Excluded</div>
<div htmlpdf-ignore="false">Still excluded</div>
```

Remove the attribute to include the element again:

```js
element.removeAttribute('htmlpdf-ignore');
```

## Notes

- The export root and its ancestors must not have `htmlpdf-ignore`; otherwise `htmlpdf()` rejects.
- The attribute name is exactly `htmlpdf-ignore`, without a `data-` prefix.
- There is no `ignoreElements` callback, configurable attribute name, or html2canvas attribute alias.
