/**
 * 在 linesByPage Map 中追加一条出口线记录
 */
function addLine(linesByPage, page, entry) {
  if (!linesByPage.has(page)) linesByPage.set(page, []);

  linesByPage.get(page).push(entry);
}

/**
 * 找当前页内最后一个完整放入页面的 TR 底部（px）
 * 条件：TR 顶部在页面范围内，且 TR 底部不超出页面底部
 * @returns {number|null} 找不到时返回 null
 */
export function findLastTrBottomPx(trNodes, pageTopGlobal, pageBottomGlobal) {
  let lastTrBottomPx = null;

  for (const tr of trNodes) {
    const trTop = tr.y;
    const trBottom = tr.y + tr.height;
    const fitsInPage =
      trTop >= pageTopGlobal &&
      trTop < pageBottomGlobal &&
      trBottom <= pageBottomGlobal;

    if (fitsInPage && (lastTrBottomPx === null || trBottom > lastTrBottomPx)) {
      lastTrBottomPx = trBottom;
    }
  }

  return lastTrBottomPx;
}

/**
 * 收集每页的 pageBreakBorder 出口闭合线
 *
 * 策略：对每个在 pageBreakBorderMap 中登记的表格容器节点，
 * 在该节点跨页的每一页（非最后页）画一条出口线，
 * 出口线贴着当前页内最后一个完整放入的 TR 的底部。
 *
 * @param {Object}  options
 * @param {Array}   options.nodes               - 节点数组
 * @param {Array}   options.allPlacements       - 所有渲染计划（normal + spill + repeat-header）
 * @param {Object}  options.ctx                 - 渲染上下文
 * @param {number}  options.contentHeight       - 单页内容区高度（mm）
 * @param {WeakMap} options.pageBreakBorderMap  - node → borderStyle 映射（由 main.js 构建）
 * @returns {Map<number, Array>}  pageNum → [{ node, offsetYpx, exitAtPx }]
 */
export function collectPageBreakLines({
  nodes,
  allPlacements,
  ctx,
  contentHeight,
  pageBreakBorderMap,
}) {
  const contentHeightPx = contentHeight / ctx.scale;

  // ── 预处理：O(N) 建立两个 Map，避免后续嵌套全量扫描 ──────────────────────

  // tableEl → trNodes[]：该表格内所有 TR 节点
  const trNodesByTable = new Map();
  // tableNode → placements[]：该表格节点的所有 placement
  const placementsByTable = new Map();

  for (const node of nodes) {
    if (pageBreakBorderMap.has(node)) {
      // 这是表格容器节点，初始化 Map 条目
      if (!trNodesByTable.has(node._origEl))
        trNodesByTable.set(node._origEl, []);

      if (!placementsByTable.has(node)) placementsByTable.set(node, []);
    }

    // 如果是 TR，挂到它所属的每一个 pageBreakBorder 祖先容器下
    if (node.tag === 'TR' && node._origEl) {
      for (const [tableEl, trList] of trNodesByTable) {
        if (tableEl.contains(node._origEl)) {
          trList.push(node);
        }
      }
    }
  }

  for (const placement of allPlacements) {
    const list = placementsByTable.get(placement.node);
    if (list) list.push(placement);
  }

  // ── 按表格、按 placement 收集出口线 ────────────────────────────────────────

  const linesByPage = new Map();

  for (const [tableNode, placements] of placementsByTable) {
    const trNodes = trNodesByTable.get(tableNode._origEl) || [];

    for (const placement of placements) {
      const { page: pageNum, offsetYpx } = placement;
      const clipTopPx = placement.clipTopPx || 0;

      // 当前页内容区的全局 px 范围
      const pageTopGlobal = offsetYpx + clipTopPx;
      const pageBottomGlobal = offsetYpx + contentHeightPx;

      // 最后一页：表格底部在当前页内 → 不需要出口线
      const nodeBottomPx = tableNode.y + tableNode.height;
      if (nodeBottomPx <= pageBottomGlobal) continue;

      const lastTrBottomPx = findLastTrBottomPx(
        trNodes,
        pageTopGlobal,
        pageBottomGlobal,
      );
      const exitAtPx =
        lastTrBottomPx !== null ? lastTrBottomPx : pageBottomGlobal;

      addLine(linesByPage, pageNum, { node: tableNode, offsetYpx, exitAtPx });
    }
  }

  return linesByPage;
}
