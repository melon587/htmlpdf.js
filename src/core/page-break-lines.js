/**
 * @file page-break-lines.js
 * 跨页表格闭合线收集模块：在每页表格出口处绘制底部边框，避免内容被截断
 *
 * collectPageBreakLines({ nodes, allPlacements, ctx, pageBreakBorderMap })
 *   ├─ 预处理（O(N)）：trNodesByTable（tableEl→trNodes）、placementsByTable（tableNode→placements）
 *   ├─ 遍历每个表格的每个 placement：
 *   │   ├─ 判断是否最后一页（表格底部在页内）→ 跳过
 *   │   └─ findLastTrBottomPx() 找最后完整 TR 底部 → 记录出口线
 *   └─ 返回 Map<pageNum, lines[]>
 */

import { matchesSelector } from '../utils';

/**
 * 在 linesByPage Map 中追加一条出口线记录
 * @param {Map<number, Array>} linesByPage
 * @param {number} page
 * @param {Object} entry - { node, offsetYpx, exitAtPx }
 */
function addLine(linesByPage, page, entry) {
  if (!linesByPage.has(page)) linesByPage.set(page, []);

  linesByPage.get(page).push(entry);
}

/**
 * 找当前页内最后一个完整放入的 TR 底部位置
 * 完整放入条件：trTop >= pageTopGlobal && trTop < pageBottomGlobal && trBottom <= pageBottomGlobal
 * @param {Array<Object>} trNodes
 * @param {number} pageTopGlobal
 * @param {number} pageBottomGlobal
 * @returns {number|null} 最后一个完整 TR 的底部位置（px），找不到时返回 null
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
 * 对每个 pageBreakBorderMap 中的表格：找其所有 placements，
 * 对非最后页找最后完整 TR 底部位置，记录出口线。
 *
 * @param {Object}  options
 * @param {Array}   options.nodes            - 所有解析后的节点
 * @param {Array}   options.allPlacements    - 所有渲染计划（normal + spill + repeat-header）
 * @param {Object}  options.ctx              - 渲染上下文（scale、contentHeight 等）
 * @param {WeakMap} options.pageBreakBorderMap - 表格节点 → 边框样式（由 main.js 构建）
 * @returns {Map<number, Array<{node, offsetYpx, exitAtPx}>>} 页码 → 出口线数组
 */
export function collectPageBreakLines({
  nodes,
  allPlacements,
  ctx,
  pageBreakBorderMap,
}) {
  const { contentHeightPx } = ctx;

  // ── 预处理：O(N) 建立两个 Map ──────────────────────────────────────────────

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
      const clipTopPx = placement.clipTopPx ?? 0;

      // 当前页内容区的全局 px 范围
      // pageActualBottomPx 存在时（avoid/before 推页）用实际底部，否则回退到整页底部
      const pageTopGlobal = offsetYpx + clipTopPx;
      const pageBottomGlobal =
        placement.pageActualBottomPx || offsetYpx + contentHeightPx;

      // 最后一页：表格底部在当前页内 → 不需要出口线
      const nodeBottomPx = tableNode.y + tableNode.height;
      if (nodeBottomPx <= pageBottomGlobal) continue;

      // 找最后一个完整 TR 的底部，作为出口线位置
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

/**
 * 构建 pageBreakBorder 映射（表格容器 → 边框样式）
 * @param {Array} nodes
 * @param {Array} tables - [{ selector, pageBreakBorder }]
 * @returns {WeakMap<node, borderStyle>}
 */
export function getPageBreakLinesMap(nodes, tables) {
  const borderMap = new WeakMap();

  tables
    .filter((t) => t.pageBreakBorder)
    .forEach((tableConf) => {
      // 找所有匹配的容器节点（同一 selector 可能匹配多个表格实例）
      nodes
        .filter((n) => matchesSelector(n._origEl, tableConf.selector))
        .forEach((containerNode) => {
          borderMap.set(containerNode, tableConf.pageBreakBorder);
        });
    });

  return borderMap;
}
