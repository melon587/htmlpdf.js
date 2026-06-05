/**
 * 收集表头子树索引
 */
function collectHeaderSubtree(nodes, startIndex, hdrBottom) {
  const hdrSubtreeIndices = new Set();

  for (let j = startIndex; j < nodes.length; j++) {
    if (nodes[j].y < hdrBottom) {
      hdrSubtreeIndices.add(j);
    } else break;
  }

  return hdrSubtreeIndices;
}

/**
 * 缓存节点与表格容器的 DOM 关系
 */
function buildNodeTableRelation(nodes, tableContainer, hdrSubtreeIndices) {
  const nodeInTable = new Map();

  if (!tableContainer) return nodeInTable;

  for (let j = 0; j < nodes.length; j++) {
    if (hdrSubtreeIndices.has(j)) continue;

    const n = nodes[j];

    nodeInTable.set(j, n._origEl && tableContainer.contains(n._origEl));
  }

  return nodeInTable;
}

/**
 * 判断当前页是否有表格数据
 */
function hasTableDataInPage(
  nodes,
  { hdrSubtreeIndices, nodeInTable, pageTopPx, pageEndPx },
) {
  for (let j = 0; j < nodes.length; j++) {
    if (hdrSubtreeIndices.has(j)) continue;

    const n = nodes[j];

    if (n.y < pageTopPx || n.y >= pageEndPx) continue;

    if (nodeInTable.get(j)) return true;
  }

  return false;
}

/**
 * 推移当前页内所有节点的 y 坐标（表头自身除外）
 * 表头重复时，当前页所有内容（不只是表格内节点）都需要整体下移，
 * 否则表格外的 element 节点不会跟着移动，
 * 但其 text 子节点（_origEl=null）会被推移，导致 border 和文本错位。
 */
function shiftNodesInPage(
  nodes,
  { hdrSubtreeIndices, pageTopPx, pageEndPx, hdrHeight },
) {
  for (let j = 0; j < nodes.length; j++) {
    if (hdrSubtreeIndices.has(j)) continue;

    const n = nodes[j];

    if (n.y >= pageTopPx && n.y < pageEndPx) {
      n.y += hdrHeight;
    }
  }
}

/**
 * 更新祖先容器的 height
 */
function updateAncestorHeights(nodes, hdrIndex, hdrNode, hdrHeight) {
  for (let j = 0; j < hdrIndex; j++) {
    const ancestor = nodes[j];

    if (ancestor._origEl?.contains(hdrNode._origEl)) {
      ancestor.height += hdrHeight;
    }
  }
}

/**
 * 创建表头副本节点
 */
function createHeaderCopies(nodes, hdrSubtreeIndices, offsetY) {
  const copies = [];

  for (const j of hdrSubtreeIndices) {
    copies.push({
      ...nodes[j],
      y: nodes[j].y + offsetY,
      _repeatCopy: true,
    });
  }

  return copies;
}

/**
 * 处理 repeat-header（跨页重复表头）
 * @param {Array} nodes - 节点数组（会被修改：推移 y 坐标）
 * @param {number} pageHeightPx - 一页高度（px）
 * @returns {Array} extraNodes - 插入的表头副本节点
 */
export function processRepeatHeaders(nodes, pageHeightPx) {
  const extraNodes = [];

  for (let i = 0; i < nodes.length; i++) {
    const hdrNode = nodes[i];

    if (!hdrNode.repeatHeader) continue;

    const hdrHeight = hdrNode.height;
    const hdrBottom = hdrNode.y + hdrHeight;
    const tableContainer = hdrNode._origEl?.parentElement;

    const hdrSubtreeIndices = collectHeaderSubtree(nodes, i, hdrBottom);
    const firstPage = Math.floor(hdrNode.y / pageHeightPx) + 1;
    const nodeInTable = buildNodeTableRelation(
      nodes,
      tableContainer,
      hdrSubtreeIndices,
    );

    for (let p = firstPage + 1; ; p++) {
      const pageTopPx = (p - 1) * pageHeightPx;
      const pageEndPx = p * pageHeightPx;

      const hasData = hasTableDataInPage(nodes, {
        hdrSubtreeIndices,
        nodeInTable,
        pageTopPx,
        pageEndPx,
      });

      if (!hasData) break;

      shiftNodesInPage(nodes, {
        hdrSubtreeIndices,
        pageTopPx,
        pageEndPx,
        hdrHeight,
      });

      updateAncestorHeights(nodes, i, hdrNode, hdrHeight);

      const offsetY = pageTopPx - hdrNode.y;
      const copies = createHeaderCopies(nodes, hdrSubtreeIndices, offsetY);

      extraNodes.push(...copies);
    }
  }

  return extraNodes;
}
