/**
 * @file stream-pagination.js
 * 流式分页：单次遍历 nodes，动态决策换页，生成渲染计划（placements）
 *
 * streamPaginate({ nodes, ctx, fonts, repeatHeaderManager })
 * ├─ needsNewPage()            判断节点是否需要换页（自然溢出 / text 保护 / avoid / before）
 * ├─ calcNextPageStart()       计算新页起点 accumulatedYpx
 * ├─ repeat-header 处理        换页时生成表头副本，跳过原始表头节点
 * ├─ 生成 nodePlacements       { page, node, offsetYpx, type: 'normal', dfsIndex }
 * ├─ expandSpillPlacements()   为跨页节点在后续页生成 spill placement
 * └─ comparePlacements sort    合并所有 placements 并按页码+类型+dfsIndex 排序
 *
 * ## 渲染顺序
 *
 * collectNodes() 以 DFS 前序收集节点，天然保证 TABLE → TBODY → TR → TD → text
 * 的顺序，与 CSS2.1 §17.5.4 Table painting order 一致。
 * 同页同 type 的 placements 直接按 dfsIndex 排序即可，无需额外的 paintOrder 层。
 */

import {
  shouldSkipOriginalHeader,
  generateRepeatHeaderPlacements,
} from './repeat-header-manager';

/**
 * placement 同页渲染顺序权重
 *   0  非 rowspan 的 spill（TABLE/TBODY/TR 等容器）→ 最先铺底
 *   1  repeat-header
 *   2  normal（含普通 TD/TH）
 *   3  rowspan TD/TH 的 spill → 最后画，覆盖在同页普通 TD 之上
 *      （CSS §17.5.4：rowspan cell 背景高于同列普通 cell 背景）
 */
function placementOrder(p) {
  if (p.type === 'spill') {
    const { tag } = p.node;
    if ((tag === 'TD' || tag === 'TH') && (p.node.rowSpan || 1) > 1) {
      return 3;
    }

    return 0;
  }

  if (p.type === 'repeat-header' || p.type === 'repeat-header-child') return 1;

  return 2;
}

/**
 * placement 排序：
 *   1. 页码升序
 *   2. 同页内按 placementOrder（spill → repeat-header → normal）
 *   3. 同 placementOrder 内按 dfsIndex 保留原始 DFS 顺序
 */
function comparePlacements(a, b) {
  if (a.page !== b.page) return a.page - b.page;

  const typeOrd = placementOrder(a) - placementOrder(b);
  if (typeOrd !== 0) return typeOrd;

  return a.dfsIndex - b.dfsIndex;
}

/**
 * 判断节点是否需要换页
 * - 自然溢出：node.y >= currentPageBottom
 * - text 保护：被切割时推到下一页
 * - avoid：放不下时推到下一页（节点高度超过一页时豁免，避免无限换页）
 * - before：强制换页（节点不在当前页起点时）
 *
 * @param {Object} node                - 待判断节点
 * @param {number} currentPageBottom   - 当前页内容区底边（全局 px）
 *                                       = accumulatedYpx + contentHeightPx - pageContentOffsetPx
 * @param {number} accumulatedYpx      - 当前页原始起点（全局 px，含表头区域）
 * @param {number} contentHeightPx     - 单页内容区总高度（px）
 * @param {number} pageContentOffsetPx - 当前页表头占用高度（px）。
 *                                       无 repeat-header 时为 0；有 repeat-header 时为表头高度。
 *                                       用于 text 保护豁免：确保换页后 text 高度不超过可用区，
 *                                       防止 accumulatedYpx 原地不动导致死循环。
 */
function needsNewPage({
  node,
  currentPageBottom,
  accumulatedYpx,
  contentHeightPx,
  pageContentOffsetPx,
}) {
  if (node.y >= currentPageBottom) return true;

  // text 节点：被切割时推到下一页（行级别保护）
  // 豁免：text 高度超过当前页可用内容区（contentHeightPx - pageContentOffsetPx）时，
  // 无论换到哪页都放不下，让其自然截断，避免死循环
  if (node.type === 'text' && node.y + node.height > currentPageBottom) {
    if (node.height > contentHeightPx - pageContentOffsetPx) return false;

    return true;
  }

  if (node.pageBreak === 'avoid') {
    // TR 节点：用 rowSpanChildMaxHeight 计算有效高度（含 rowspan 子 TD 的最大高度）
    const effectiveHeight =
      node.tag === 'TR'
        ? Math.max(node.height, node.rowSpanChildMaxHeight || 0)
        : node.height;

    if (node.y + effectiveHeight > currentPageBottom) {
      // 豁免条件：effectiveHeight 超过整页高度，无论如何放不下，
      // 豁免 avoid 推页，让其自然 spill，避免无限换页死循环。
      // 不检查位置（node.y <= accumulatedYpx），因为即使 table page-break="before"
      // 等场景导致 TR 尚未到达新页顶部，只要超整页就不可能放进任何一页，推页无意义。
      if (effectiveHeight > contentHeightPx) return false;

      return true;
    }
  }

  if (node.pageBreak === 'before' && node.y > accumulatedYpx) return true;

  return false;
}

/**
 * 计算换页后新页起点 accumulatedYpx
 *
 * - 自然溢出（node.y >= currentPageBottom）→ currentPageBottom（连续，不留空隙）
 * - text 保护 / avoid（TR / rowspan>1 TD）触发 → node.y
 *   从节点顶部开始新页，保证节点页内坐标 = headerHeightPx（有 repeat-header 时）
 *   或 0（无 repeat-header 时），不会落入表头区域造成重叠。
 *   DFS 顺序保证 TD 在其父 TR 之后立即出现，且 TD.y === TR.y，
 *   所以新页从 node.y 开始等价于"整个 TR 从新页顶部开始"，
 *   之后重新处理该 TD 及后续所有兄弟 TR，relY 全部 ≥ 0。
 */
function calcNextPageStart(node, currentPageBottom) {
  // 自然溢出
  if (node.y >= currentPageBottom) return currentPageBottom;

  // text 保护 / avoid（TR / rowspan>1 TD）：从节点顶部开始新页
  return node.y;
}

/**
 * 构建节点（含子孙）出现的最大页码映射，用于决定 spill 终止页
 * @param {Array} nodePlacements
 * @returns {Map} origEl → 最大页码
 */
export function buildNodeLastPageMap(nodePlacements) {
  // Step 1: 记录每个 origEl 自身出现的最大页码
  const selfMaxPage = new Map();
  for (const p of nodePlacements) {
    if (!p.node._origEl) continue;

    const cur = selfMaxPage.get(p.node._origEl) || 0;
    if (p.page > cur) selfMaxPage.set(p.node._origEl, p.page);
  }

  // Step 2: 向上冒泡，将每个节点的最大页码传播到所有祖先（O(N) 均摊）
  const nodeLastPage = new Map(selfMaxPage);
  for (const [el, page] of selfMaxPage) {
    let ancestor = el.parentElement;
    while (ancestor) {
      const cur = nodeLastPage.get(ancestor) || 0;
      if (page <= cur) break; // 祖先已有更大值，更上方祖先也已更新，提前终止

      nodeLastPage.set(ancestor, page);
      ancestor = ancestor.parentElement;
    }
  }

  return nodeLastPage;
}

/**
 * 为跨页节点在后续页生成 'spill' placement，使 renderNode 能继续绘制 bg/border
 * @param {Array}  nodePlacements   - normal placement 数组（页码递增）
 * @param {Map}    pageStartOffsets - 页码 → { pageRawTopPx, pageContentTopPx, pageActualBottomPx }
 * @param {number} contentHeightPx  - 单页内容区高度（px）
 * @param {number} totalPagesCount  - 总页数
 * @returns {Array} spillPlacements（页码递增）
 */
export function expandSpillPlacements(
  nodePlacements,
  pageStartOffsets,
  contentHeightPx,
  totalPagesCount,
) {
  const spillPlacements = [];

  // 方案A：建立节点及子孙的最大页码映射（容器用子孙冒泡，叶子用坐标推算）
  const nodeLastPage = buildNodeLastPageMap(nodePlacements);

  for (const p of nodePlacements) {
    // rowspan TD/TH 用 rowSpanActualBottom（分页后修正值），其他节点用 y+height
    const nodeBottomPx = p.node.rowSpanActualBottom ?? p.node.y + p.node.height;
    const pageInfo = pageStartOffsets.get(p.page);
    const pageContentTopPx = pageInfo ? pageInfo.pageContentTopPx : 0;
    const pageBottomGlobal = pageContentTopPx + contentHeightPx;

    if (nodeBottomPx <= pageBottomGlobal) continue;

    // 只对有边框或背景的 element 节点展开（text 节点不需要跨页 bg/border）
    if (p.node.type !== 'element') continue;

    // 确定该节点真正的最后一页，取 lastPageByMap（子孙最大页码冒泡）和
    // lastPageByCoord（底部坐标推算）两者的最大值：
    // - 容器节点：子孙冒泡到更后页时 lastPageByMap 更大
    // - 叶子节点（如 IMG）：子孙 = 自身，靠 lastPageByCoord 推算跨页数
    const lastPageByMap = nodeLastPage.get(p.node._origEl) || p.page;
    const lastPageByCoord =
      Math.ceil((nodeBottomPx - pageContentTopPx) / contentHeightPx) +
      p.page -
      1;
    const lastPage = Math.min(
      Math.max(lastPageByMap, lastPageByCoord),
      totalPagesCount,
    );

    const nodeSpills = [];
    for (let sp = p.page + 1; sp <= lastPage; sp += 1) {
      const spillPageInfo = pageStartOffsets.get(sp);
      const spillOffsetYpx = spillPageInfo ? spillPageInfo.pageContentTopPx : 0;
      // TD/TH spill 不能覆盖 repeat-header 区域，clipTopPx = 表头高度
      // 其他容器（TABLE、DIV 等）spill 从页顶开始（clipTopPx = 0），
      // 使祖先边框/背景覆盖整个页面包括 repeat-header 区域
      const { tag } = p.node;
      const isCellNode = tag === 'TD' || tag === 'TH';
      const spillHeaderH = spillPageInfo?.headerHeightPx ?? 0;
      const clipTopPx = isCellNode ? spillHeaderH : 0;

      nodeSpills.push({
        page: sp,
        node: p.node,
        offsetYpx: spillOffsetYpx,
        clipTopPx,
        type: 'spill',
        isLastSpill: sp === lastPage, // 只有最后一页才是 true
        dfsIndex: p.dfsIndex,
        // 本页实际内容底部（全局px）：用于渲染时计算精确 clipBottom
        pageActualBottomPx: spillPageInfo
          ? spillPageInfo.pageActualBottomPx
          : null,
      });
    }

    spillPlacements.push(...nodeSpills);
  }

  return spillPlacements;
}

/**
 * 流式分页主函数：单次遍历 nodes，动态决策换页，生成渲染计划
 *
 * 流程：
 * 1. 遍历节点，检查是否需要换页（needsNewPage）
 * 2. 换页时更新 accumulatedYpx / currentPage，处理 repeat-header
 * 3. 跳过原始表头节点（当前页已有 repeat-header 副本时）
 * 4. 生成 nodePlacements
 * 5. expandSpillPlacements：为溢出节点生成 spill placement
 * 6. 合并所有 placements 并按页码+类型排序，返回 allPlacements
 *
 * @param {Object} params
 * @param {Array}  params.nodes               - 节点数组（由 collectNodes 生成）
 * @param {Object} params.ctx                 - 渲染上下文（scale、doc、contentHeight 等）
 * @param {Object} params.repeatHeaderManager - repeat-header 管理器实例（无配置时为 null）
 * @returns {{ totalPages: number, allPlacements: Array }}
 */
export function streamPaginate({ nodes, ctx, repeatHeaderManager = null }) {
  const { contentHeightPx } = ctx;

  let currentPage = 1;
  let accumulatedYpx = 0;
  let currentPageContentOffsetPx = 0;

  const nodePlacements = []; // 节点渲染计划（含 repeat-header 副本）

  // 每页内容区起始偏移：
  //   pageRawTopPx      = accumulatedYpx（新页原始全局起点，含表头区域）
  //                       注意：此处 pageRawTopPx === pageContentTopPx，
  //                       使 spill.clipTopPx = 0，祖先边框/背景从页顶开始覆盖，
  //                       repeat-header 节点自身会盖在祖先背景之上。
  //   pageContentTopPx  = accumulatedYpx - headerHeightPx（内容区真实全局起点）
  //   pageActualBottomPx = 本页内容实际底部（全局px），换页时修正
  const pageStartOffsets = new Map();
  pageStartOffsets.set(1, {
    pageRawTopPx: 0,
    pageContentTopPx: 0,
    pageActualBottomPx: contentHeightPx,
  });

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const headerMeta = repeatHeaderManager?.getHeaderMetaForNode(node);

    const currentPageBottom =
      accumulatedYpx + contentHeightPx - currentPageContentOffsetPx;

    // 检查是否需要换页
    if (
      needsNewPage({
        node,
        currentPageBottom,
        accumulatedYpx,
        contentHeightPx,
        pageContentOffsetPx: currentPageContentOffsetPx,
      })
    ) {
      // 计算本页实际内容底部（全局px）
      const pageActualBottomPx = calcNextPageStart(node, currentPageBottom);

      // 修正上一页的 pageActualBottomPx
      const prevPageInfo = pageStartOffsets.get(currentPage);
      if (
        prevPageInfo &&
        pageActualBottomPx < prevPageInfo.pageActualBottomPx
      ) {
        prevPageInfo.pageActualBottomPx = pageActualBottomPx;
      }

      accumulatedYpx = pageActualBottomPx;
      currentPage += 1;

      // 处理 repeat-header
      if (headerMeta) {
        if (!headerMeta.headerRendered) {
          currentPageContentOffsetPx = 0;
          // eslint-disable-next-line no-param-reassign
          headerMeta.skipOnCurrentPage = false;
        } else {
          const result = generateRepeatHeaderPlacements(
            headerMeta,
            currentPage,
            accumulatedYpx,
          );
          nodePlacements.push(...result.placements);
          currentPageContentOffsetPx = result.headerHeightPx;
          // eslint-disable-next-line no-param-reassign
          headerMeta.skipOnCurrentPage = true;
        }
      } else {
        currentPageContentOffsetPx = 0;
      }

      // 记录新页偏移
      // pageRawTopPx = pageContentTopPx，确保容器节点 spill clipTopPx = 0，
      // headerHeightPx 单独记录，供 TD/TH spill 使用（不能覆盖表头区域）
      const newPageContentTopPx = accumulatedYpx - currentPageContentOffsetPx;
      pageStartOffsets.set(currentPage, {
        pageRawTopPx: newPageContentTopPx,
        pageContentTopPx: newPageContentTopPx,
        headerHeightPx: currentPageContentOffsetPx,
        pageActualBottomPx: newPageContentTopPx + contentHeightPx,
      });

      // 重新处理当前节点
      i -= 1;
      continue;
    }

    // 跳过原始表头节点（当前页已有 repeat-header 副本时）
    if (
      headerMeta?.skipOnCurrentPage &&
      shouldSkipOriginalHeader(node, headerMeta)
    ) {
      continue;
    }

    // 计算内容区起点偏移（全局 px，已减去表头高度）
    const effectiveOffsetYpx = accumulatedYpx - currentPageContentOffsetPx;

    // 生成节点渲染计划
    nodePlacements.push({
      page: currentPage,
      node,
      offsetYpx: effectiveOffsetYpx,
      type: 'normal',
      isLastSpill: true,
      dfsIndex: i,
    });

    // headerNode 放入渲染计划后立即标记
    if (headerMeta && node._origEl === headerMeta.headerNode._origEl) {
      // eslint-disable-next-line no-param-reassign
      headerMeta.headerRendered = true;
    }
  }

  // 回填 normal placements 的 pageActualBottomPx
  for (const p of nodePlacements) {
    const info = pageStartOffsets.get(p.page);
    p.pageActualBottomPx = info ? info.pageActualBottomPx : null;
  }

  // 跨页展开：为溢出节点在后续页生成 spill placement
  const totalPagesCount = currentPage;
  const spillPlacements = expandSpillPlacements(
    nodePlacements,
    pageStartOffsets,
    contentHeightPx,
    totalPagesCount,
  );

  // 合并并排序
  const allPlacements = [...nodePlacements, ...spillPlacements].sort(
    comparePlacements,
  );

  return {
    totalPages: totalPagesCount,
    allPlacements,
  };
}
