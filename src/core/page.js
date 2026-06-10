/**
 * Pass1：预创建所有需要的 PDF 页
 * @param {Object} doc - jsPDF 实例
 * @param {Array} nodes - 节点数组
 * @param {Function} toMM - px 转 mm 的函数
 * @param {number} contentHeight - 单页内容区高度（mm）
 * @returns {number} totalPages - 总页数
 */
export function createPages(doc, nodes, toMM, contentHeight) {
  let totalPages = 1;
  let maxNodeBottomMm = 0;

  for (const node of nodes) {
    const nodeBottomMm = toMM(node.y + node.height);
    const neededPages = Math.ceil(nodeBottomMm / contentHeight);

    if (nodeBottomMm > maxNodeBottomMm) {
      maxNodeBottomMm = nodeBottomMm;
    }

    while (totalPages < neededPages) {
      doc.addPage();
      totalPages++;
    }
  }

  return totalPages;
}

/**
 * 逐页调用 header/footer render 回调
 */
export function renderHeaderFooter(doc, { totalPages, ctx, header, footer }) {
  const { margin, pageWidth, pageHeight } = ctx;
  const info = { totalPages, pageWidth, pageHeight, margin };

  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);

    if (header && typeof header.render === 'function') {
      header.render(doc, { ...info, pageNumber: p });
    }

    if (footer && typeof footer.render === 'function') {
      footer.render(doc, { ...info, pageNumber: p });
    }
  }
}
