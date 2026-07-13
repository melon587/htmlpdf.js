/**
 * @file page-break-lines.js
 * 跨页表格闭合线收集模块
 *
 * ## 功能说明
 *
 * 为跨页表格在页面出口处绘制底部边框（闭合线），避免表格内容看起来被"截断"。
 *
 * ## 问题背景
 *
 * 当表格跨多页时，如果只在最后一页绘制底部边框，中间页的表格内容会显得不完整。
 * 用户期望在每一页的表格底部都看到边框，形成视觉上的"封闭"效果。
 *
 * ## 解决方案
 *
 * 在表格跨页的每一页（非最后页）出口处绘制一条水平线（pageBreakBorder），
 * 该线贴着当前页内最后一个完整放入的 TR（表格行）的底部。
 *
 * ## 整体流程
 *
 * collectPageBreakLines({ nodes, allPlacements, ctx, contentHeight, pageBreakBorderMap })
 *   │
 *   ├─ 1. 预处理（O(N)）
 *   │   ├─ trNodesByTable: tableEl → trNodes[]     建立表格→行节点映射
 *   │   └─ placementsByTable: tableNode → placements[]   建立表格→渲染计划映射
 *   │
 *   ├─ 2. 遍历每个表格的每个 placement
 *   │   ├─ 计算当前页的全局 px 范围
 *   │   ├─ 判断是否是最后一页（表格底部在页内）→ 跳过
 *   │   ├─ findLastTrBottomPx() 找最后一个完整 TR 的底部
 *   │   └─ 记录出口线位置
 *   │
 *   └─ 3. 返回 Map<pageNum, lines[]>
 *
 * ## 关键概念
 *
 * ### pageBreakBorder
 * - 表格跨页时在页面出口处绘制的底部边框
 * - 配置：tables: [{ selector: '.my-table', pageBreakBorder: '1px solid #ccc' }]
 * - 由 main.js 构建 WeakMap（node → borderStyle）
 *
 * ### 出口线（Exit Line）
 * - 位置：当前页内最后一个完整 TR 的底部
 * - 回退：如果找不到完整 TR，使用页面底部（pageBottomGlobal）
 * - 记录：{ node, offsetYpx, exitAtPx }
 *
 * ### TR（表格行）判断
 * - 完整放入：trTop >= pageTop && trTop < pageBottom && trBottom <= pageBottom
 * - 目的：确保闭合线不会切断某一行的内容
 *
 * ## 性能优化
 *
 * - 预处理阶段 O(N) 建立映射，避免后续嵌套全量扫描 O(N²)
 * - 使用 Map 和 WeakMap 快速查找
 * - 只处理配置了 pageBreakBorder 的表格
 *
 * ## 使用示例
 *
 * ```javascript
 * const spillClosingLinesByPage = collectPageBreakLines({
 *   nodes,
 *   allPlacements,
 *   ctx,
 *   contentHeight: 277,
 *   pageBreakBorderMap,
 * });
 *
 * // 返回值：Map { 1 => [{ node, offsetYpx, exitAtPx }], 2 => [...] }
 *
 * // 渲染阶段使用：
 * for (let page = 1; page <= totalPages; page++) {
 *   const spillLines = spillClosingLinesByPage.get(page);
 *   if (spillLines) {
 *     for (const line of spillLines) {
 *       drawSpillClosingLines({ doc, node: line.node, ctx, ... });
 *     }
 *   }
 * }
 * ```
 */

/**
 * 在 linesByPage Map 中追加一条出口线记录
 *
 * @param {Map<number, Array>} linesByPage - 页码 → 出口线数组的映射
 * @param {number} page - 页码（1-based）
 * @param {Object} entry - 出口线记录 { node, offsetYpx, exitAtPx }
 */
function addLine(linesByPage, page, entry) {
  if (!linesByPage.has(page)) linesByPage.set(page, []);

  linesByPage.get(page).push(entry);
}

/**
 * 找当前页内最后一个完整放入页面的 TR（表格行）底部位置
 *
 * ## 判断标准
 *
 * 一个 TR 被认为"完整放入"当前页，需满足所有条件：
 * 1. TR 顶部在页面范围内：trTop >= pageTopGlobal
 * 2. TR 顶部未超出底部：trTop < pageBottomGlobal
 * 3. TR 底部未超出底部：trBottom <= pageBottomGlobal
 *
 * ## 返回值
 *
 * - 成功：返回最后一个完整 TR 的底部坐标（px，全局坐标）
 * - 失败：返回 null（表示当前页没有完整的 TR）
 *
 * @param {Array<Object>} trNodes - TR 节点数组
 * @param {number} pageTopGlobal - 当前页顶部的全局 y 坐标（px）
 * @param {number} pageBottomGlobal - 当前页底部的全局 y 坐标（px）
 * @returns {number|null} 最后一个完整 TR 的底部位置（px），找不到时返回 null
 *
 * @example
 * const lastBottom = findLastTrBottomPx(
 *   trNodes,
 *   offsetYpx + clipTopPx,      // pageTopGlobal
 *   offsetYpx + contentHeightPx // pageBottomGlobal
 * );
 * // 返回: 1234.5 (px) 或 null
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
 * ## 策略
 *
 * 对每个在 pageBreakBorderMap 中登记的表格容器节点：
 * 1. 找到该表格的所有渲染计划（placements）
 * 2. 对每个 placement（非最后页）：
 *    - 找当前页内最后一个完整 TR 的底部
 *    - 在该位置记录一条出口线
 * 3. 最后一页不绘制出口线（表格完整结束）
 *
 * ## 性能优化
 *
 * - **预处理阶段**：O(N) 建立两个 Map
 *   - trNodesByTable：tableEl → trNodes[]
 *   - placementsByTable：tableNode → placements[]
 * - **收集阶段**：O(P × T)，P = placements 数量，T = 每页 TR 数量
 * - 避免了 O(N²) 的嵌套全量扫描
 *
 * ## 参数说明
 *
 * @param {Object}  options
 * @param {Array<Object>}   options.nodes - 所有解析后的节点（来自 collectNodes）
 * @param {Array<Object>}   options.allPlacements - 所有渲染计划（normal + spill + repeat-header）
 * @param {Object}  options.ctx - 渲染上下文（包含 scale 属性，用于 mm ↔ px 转换）
 * @param {number}  options.contentHeight - 单页内容区高度（mm）
 * @param {WeakMap<Object, string>} options.pageBreakBorderMap - 表格节点 → 边框样式映射
 *   由 main.js 的 buildPageBreakBorderMap() 构建
 *
 * @returns {Map<number, Array<Object>>} 页码 → 出口线数组的映射
 *   出口线格式：{ node, offsetYpx, exitAtPx }
 *   - node：表格容器节点
 *   - offsetYpx：当前页内容区起始的全局 y 坐标（px）
 *   - exitAtPx：出口线的全局 y 坐标（px）
 *
 * @example
 * const linesByPage = collectPageBreakLines({
 *   nodes: parsedNodes,
 *   allPlacements: [...nodePlacements, ...headerPlacements],
 *   ctx: { scale: 0.264583, toMM: fn, ... },
 *   contentHeight: 277,
 *   pageBreakBorderMap: new WeakMap([[tableNode, '1px solid #ccc']]),
 * });
 *
 * // 返回:
 * // Map {
 * //   1 => [{ node, offsetYpx: 0, exitAtPx: 1047.5 }],
 * //   2 => [{ node, offsetYpx: 1047.5, exitAtPx: 2095 }]
 * // }
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
