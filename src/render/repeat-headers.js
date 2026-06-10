import { renderNode } from './node';

/**
 * 渲染所有表头副本到指定页，并返回偏移映射
 */
export function drawRepeatHeaders({
  doc,
  repeatHeaderMeta,
  ctx,
  contentHeight,
  sortedFontConfig,
  fallbackFontFamily,
  currentPage: initialPage = -1,
}) {
  let currentPage = initialPage;
  const headerHeightByPage = {};

  for (const meta of repeatHeaderMeta) {
    const { headerNode, headerChildren, pages, pageHeightPx } = meta;

    for (const pg of pages) {
      headerHeightByPage[pg] = headerNode.height;

      if (pg !== currentPage) {
        doc.setPage(pg);
        currentPage = pg;
      }

      const pageTop = (pg - 1) * pageHeightPx;
      const headerOffsetY = headerNode.y;
      const pageOffsetY = (pg - 1) * contentHeight;

      const headerCopy = { ...headerNode, y: pageTop };
      renderNode({
        doc,
        node: headerCopy,
        ctx,
        pageOffsetY,
        clipTop: pageOffsetY,
        clipBottom: pageOffsetY + contentHeight,
        sortedFontConfig,
        fallbackFontFamily,
      });

      for (const child of headerChildren) {
        const relativeY = child.y - headerOffsetY;
        const childCopy = { ...child, y: pageTop + relativeY };
        renderNode({
          doc,
          node: childCopy,
          ctx,
          pageOffsetY,
          clipTop: pageOffsetY,
          clipBottom: pageOffsetY + contentHeight,
          sortedFontConfig,
          fallbackFontFamily,
        });
      }

      console.log(`[repeat-header] Rendered header on page ${pg}`);
    }
  }

  return { currentPage, headerHeightByPage };
}

/**
 * 计算节点在指定页的偏移后坐标
 */
export function applyHeaderOffset(node, page, headerHeightByPage) {
  const headerOffset = headerHeightByPage[page] || 0;

  return headerOffset > 0 ? { ...node, y: node.y + headerOffset } : node;
}
