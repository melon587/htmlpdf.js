/**
 * 处理 page-break（before / avoid）
 * @param {Array} nodes - 节点数组（会被修改：推移 y 坐标、更新 height）
 * @param {number} pageHeightPx - 一页高度（px）
 */
export function processPageBreaks(nodes, pageHeightPx) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node.pageBreak) continue;

    let delta = 0;

    if (node.pageBreak === 'before') {
      // 强制从下一页顶部开始：计算到下一页顶部的偏移
      const pageIndex = Math.floor(node.y / pageHeightPx);
      const pageEnd = (pageIndex + 1) * pageHeightPx;
      const usedInPage = node.y % pageHeightPx;
      if (usedInPage > 0.5) {
        delta = pageEnd - node.y; // 推到下一页顶
      }
    } else if (node.pageBreak === 'avoid') {
      // 若底部超出当前页，整体推到下一页顶部
      const pageIndex = Math.floor(node.y / pageHeightPx);
      const pageEnd = (pageIndex + 1) * pageHeightPx;
      if (node.y + node.height >= pageEnd) {
        delta = pageEnd - node.y;
      }
    }

    if (delta <= 0) continue;

    console.log(
      '[htmlpdf] Pass0',
      node.pageBreak,
      node.tag,
      'delta=' + delta.toFixed(1),
    );

    // 平移本节点及之后所有节点
    for (let j = i; j < nodes.length; j++) {
      nodes[j].y += delta;
    }

    // 更新 i 之前所有祖先节点的 height（让跨页边框/背景能延伸到正确底部）
    for (let j = 0; j < i; j++) {
      const ancestor = nodes[j];
      if (
        ancestor._origEl &&
        nodes[i]._origEl &&
        ancestor._origEl.contains(nodes[i]._origEl)
      ) {
        ancestor.height += delta;
      }
    }
  }
}
