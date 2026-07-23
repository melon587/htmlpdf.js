# Repeat Table Header

When a table spans multiple pages, you can configure its header to repeat on every page.

## HTML

```html
<table id="my-table">
  <thead id="my-table-header">
    <tr>
      <th>Name</th>
      <th>Email</th>
      <th>Department</th>
    </tr>
  </thead>
  <tbody>
    <!-- rows... -->
  </tbody>
</table>
```

## Configuration

```js
const blob = await htmlpdf(element, {
  tables: [
    {
      selector: '#my-table', // CSS selector for the table container
      repeatHeader: '#my-table-header', // selector for the header to repeat
      pageBreakBorder: '1px solid #ccc', // optional closing border
    },
  ],
});
```

## Multiple Tables

```js
tables: [
  { selector: '#table-a', repeatHeader: 'thead' },
  {
    selector: '#table-b',
    repeatHeader: 'thead',
    pageBreakBorder: '1px solid #bbb',
  },
];
```

## `TableConfig` Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `selector` | `string` | ✅ | CSS selector for the table container |
| `repeatHeader` | `string` | ❌ | CSS selector for the header to repeat |
| `pageBreakBorder` | `string` | ❌ | Border drawn at the page-break bottom edge, e.g. `'1px solid #ccc'` |

::: tip `repeatHeader` must be a descendant of the element matched by `selector`. :::
