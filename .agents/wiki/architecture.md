# Architecture — Full Module Interaction Diagram

## High-Level Data Flow

```
User calls htmlpdf(element, options)
          │
          ▼
┌─────────────────────────────────────────────────────────┐
│  main.js  (12-step pipeline orchestrator)               │
└─────┬───────────────────────────────────────────────────┘
      │
      │  STEP 1: initContext(element, options)
      ├──────────────────────────────────────────────────▶  context.js
      │                                                      returns ctx { doc, scale, toMM, toPdfX... }
      │
      │  STEP 2: createClonedDocument(element, fonts)
      ├──────────────────────────────────────────────────▶  document-cloner.js
      │                  │                                   clones DOM → hidden iframe
      │                  ├──────────────────────────────▶    font-loader.js  (injectFontsToDocument)
      │                  └──────────────────────────────▶    wait.js  (waitForStyleSheets, waitForImages, waitForLayout)
      │                  returns { iframe, cloneRoot }
      │
      │  STEP 3: collectNodes(element, cloneRoot)
      ├──────────────────────────────────────────────────▶  node-parser.js
      │                                                      returns nodes[] (flat, with coords/styles)
      │
      │  STEP 3b: preloadImages(nodes)
      ├──────────────────────────────────────────────────▶  image-loader.js
      │                                                      mutates nodes: adds ._srcCanvas / .bgSrc
      │
      │  STEP 4: destroyClonedDocument(iframe)
      ├──────────────────────────────────────────────────▶  document-cloner.js
      │                                                      *** iframe gone, no more DOM access ***
      │
      │  STEP 5: loadFontsToJsPDF(ctx, fonts)
      ├──────────────────────────────────────────────────▶  font-loader.js
      │                                                      registers fonts into ctx.doc
      │
      │  STEP 6: createRepeatHeaderManager(nodes, tables)
      ├──────────────────────────────────────────────────▶  repeat-header-manager.js
      │                                                      returns repeatHeaderManager
      │
      │  STEP 6b: getPageBreakLinesMap(nodes, tables)
      ├──────────────────────────────────────────────────▶  page-break-lines.js
      │                                                      returns pageBreakBorderMap (WeakMap)
      │
      │  STEP 7: streamPaginate({ nodes, ctx, repeatHeaderManager })
      ├──────────────────────────────────────────────────▶  stream-pagination.js
      │                  │                                   single-pass pagination
      │                  └──────────────────────────────▶    repeat-header-manager.js
      │                                                        (generateRepeatHeaderPlacements, shouldSkipOriginalHeader)
      │                  returns { totalPages, allPlacements }
      │
      │  STEP 8: collectPageBreakLines({ nodes, allPlacements, ctx, pageBreakBorderMap })
      ├──────────────────────────────────────────────────▶  page-break-lines.js
      │                                                      returns spillClosingLinesByPage (Map)
      │
      │  STEP 9: renderNode loop (allPlacements)
      ├──────────────────────────────────────────────────▶  render/node.js
      │                  ├──────────────────────────────▶    render/background.js
      │                  │         └────────────────────▶      render/gradient.js
      │                  ├──────────────────────────────▶    render/border.js
      │                  ├──────────────────────────────▶    render/image.js
      │                  └──────────────────────────────▶    render/text.js
      │
      │  STEP 10: drawSpillClosingLines (per page)
      ├──────────────────────────────────────────────────▶  render/border.js
      │
      │  STEP 11: renderHeaderFooter(doc, { totalPages, ctx, header, footer })
      ├──────────────────────────────────────────────────▶  core/page.js
      │                                                      calls header.render / footer.render callbacks
      │
      │  STEP 12: ctx.output(output)
      └──────────────────────────────────────────────────▶  context.js
                                                             returns Blob | DataURL | ArrayBuffer
```

## Module Dependency Graph

```
main.js
├── core/context.js          (no internal deps)
├── core/document-cloner.js
│   ├── core/font-loader.js  (no internal deps)
│   ├── core/wait.js         (no internal deps)
│   └── utils/index.js
├── core/node-parser.js
│   └── utils/index.js
├── core/image-loader.js
│   └── utils/index.js
├── core/font-loader.js
│   └── utils/index.js
├── core/repeat-header-manager.js
│   └── utils/index.js
├── core/page-break-lines.js
│   └── utils/index.js
├── core/stream-pagination.js
│   └── core/repeat-header-manager.js
├── core/page.js             (no internal deps)
├── render/node.js
│   ├── render/background.js
│   │   ├── render/gradient.js
│   │   │   └── utils/index.js
│   │   └── utils/index.js
│   ├── render/border.js
│   │   └── utils/index.js
│   ├── render/image.js
│   │   └── utils/index.js
│   └── render/text.js       (no internal deps on render files)
└── utils/index.js           (no internal deps)
```

## Node Object Shape

Nodes produced by `node-parser.js` have this shape (abridged):

```js
{
  type: 'element' | 'text' | 'pseudo',
  tag: 'DIV' | 'P' | 'IMG' | ...,
  x: number,              // px, relative to root element
  y: number,              // px, relative to root element
  width: number,          // px
  height: number,         // px
  style: CSSStyleDeclaration,   // computed styles from cloned DOM
  pageBreak: 'avoid' | 'before' | null,
  pdfFont: string | null, // from data-pdf-font attribute
  _el: Element,           // reference to original DOM element
  _origEl: Element,       // same as _el for non-clones

  // text nodes only:
  text: string,
  lineIndex: number,

  // image nodes only (set by image-loader.js):
  _srcCanvas: HTMLCanvasElement,

  // background-image nodes (set by image-loader.js):
  bgSrc: string,          // base64 data URL
  bgNaturalWidth: number,
  bgNaturalHeight: number,
}
```

## Context Object Shape (`ctx`)

```js
{
  doc: jsPDF,
  scale: number,               // contentWidth(mm) / rootElement.width(px)
  margin: number,              // mm
  headerHeight: number,        // mm
  footerHeight: number,        // mm
  pageWidth: number,           // mm
  pageHeight: number,          // mm
  contentWidth: number,        // mm
  contentHeight: number,       // mm
  contentHeightPx: number,     // px (contentHeight / scale)

  // coordinate helpers:
  toMM(px): number,            // px → mm (scale only, no offset)
  toPdfX(x): number,           // px x → mm X on PDF page (includes left margin)
  toPdfY(y): number,           // px y → mm Y on PDF page (includes top margin + headerHeight)
  toPdfYmm(ymm): number,       // mm y → mm Y on PDF page (skips scale)
  toPt(px): number,            // px → pt (for font sizes)
  output(format): any,         // wraps doc.output()
}
```
