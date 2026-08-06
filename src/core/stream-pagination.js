/**
 * @file stream-pagination.js
 * 两遍扫描分页：
 *   第一遍 buildPageBoundaries()  —— 只跑换页决策，建立完整页边界表
 *   第二遍 assignPlacements()     —— 按 node.y 坐标查页码，生成 normal/repeat-header placements
 *   第三步 expandSpillPlacements() —— 为跨页节点在后续页生成 spill placement
 *
 * streamPaginate({ nodes, ctx, repeatHeaderManager })
 * ├─ buildPageBoundaries()        第一遍：needsNewPage / calcNextPageStart / pageStartOffsets
 * ├─ assignPlacements()           第二遍：node.y → page，normal + repeat-header placements
 * ├─ expandSpillPlacements()      跨页展开，生成 spill placements
 * └─ comparePlacements sort       合并排序，返回 allPlacements
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
 *   2  normal（含所有 TD/TH 和 text）
 *   3  rowspan TD/TH spill
 *
 * order=2 内部细分顺序由 sortKey 决定（见 streamPaginate sortKey 赋值）：
 *   普通 element(dfsIndex) < rowspan TD/TH(dfsIndex+N) < text(dfsIndex+2N)
 */
function placementOrder(p) {
  const { tag } = p.node;
  const isRowspanCell =
    (tag === 'TD' || tag === 'TH') && (p.node.rowSpan || 1) > 1;

  if (p.type === 'spill') {
    return isRowspanCell ? 3 : 0;
  }

  if (p.type === 'repeat-header' || p.type === 'repeat-header-child') return 1;

  return 2;
}

/**
 * placement 排序：
 *   1. 页码升序
 *   2. 同页内按 placementOrder
 *   3. 同 order 内按 sortKey（默认 = dfsIndex）
 */
function comparePlacements(a, b) {
  if (a.page !== b.page) return a.page - b.page;

  const typeOrd = placementOrder(a) - placementOrder(b);
  if (typeOrd !== 0) return typeOrd;

  return (a.sortKey ?? a.dfsIndex) - (b.sortKey ?? b.dfsIndex);
}

/**
 * 判断节点是否需要换页
 * - 自然溢出：node.y >= currentPageBottom
 * - text 保护：被切割时推到下一页
 * - avoid：放不下时推到下一页（节点高度超过一页时豁免，避免无限换页）
 * - before：强制换页（节点不在当前页起点时）
 * - repeat-header 联体：当节点是表的 firstDataTR，且
 *   headerHeight + TR有效高度 > 当前页剩余空间 时，整个表推到下一页
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
 * @param {Object|null} headerMeta     - 当前节点所属的 repeat-header meta（无时为 null）
 */
function needsNewPage({
  node,
  currentPageBottom,
  accumulatedYpx,
  contentHeightPx,
  pageContentOffsetPx,
  headerMeta,
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

  // repeat-header 联体判断：
  // 当前节点是 headerNode（THEAD）本身时，提前检查
  // headerHeight + firstDataTR有效高度 是否超过当前页剩余空间。
  // 若超出，则在 THEAD 处就触发换页，让整个表从新页顶部开始，
  // 避免 THEAD 单独停留在旧页形成孤立表头。
  // 豁免：联体高度超过整页时放不进任何页，让其自然分布。
  if (
    headerMeta &&
    node._origEl === headerMeta.headerNode._origEl &&
    headerMeta.firstDataTR
  ) {
    const trEffectiveH = Math.max(
      headerMeta.firstDataTR.height,
      headerMeta.firstDataTR.rowSpanChildMaxHeight || 0,
    );
    const combined = node.height + trEffectiveH;
    const remaining = currentPageBottom - node.y;

    if (combined > remaining && combined <= contentHeightPx) return true;
  }

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
    const nodeBottomPx = p.node.y + p.node.height;
    const pageInfo = pageStartOffsets.get(p.page);
    const pageContentTopPx = pageInfo ? pageInfo.pageContentTopPx : 0;
    const pageBottomGlobal = pageContentTopPx + contentHeightPx;

    // 只对有边框或背景的 element 节点展开（text 节点不需要跨页 bg/border）
    if (p.node.type !== 'element') continue;

    if (nodeBottomPx <= pageBottomGlobal) {
      continue;
    }

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
 * 第一遍：只跑换页决策，建立完整的页边界表 pageStartOffsets。
 * 不生成任何 placement，repeat-header 只取高度，不生成副本。
 *
 * @param {Array}  nodes
 * @param {number} contentHeightPx
 * @param {Object|null} repeatHeaderManager
 * @returns {Map} pageStartOffsets: pageNum → {
 *   pageContentTopPx,    内容区全局起点（已减去表头高度）
 *   pageActualBottomPx,  本页实际底部（text/avoid 换页时 < 理论值）
 *   headerHeightPx,      该页 repeat-header 高度（无则 0）
 *   accumulatedYpx,      该页原始全局起点（含表头区域）
 * }
 */
function buildPageBoundaries(nodes, contentHeightPx, repeatHeaderManager) {
  let currentPage = 1;
  let accumulatedYpx = 0;
  let currentPageContentOffsetPx = 0;

  const pageStartOffsets = new Map();
  pageStartOffsets.set(1, {
    pageContentTopPx: 0,
    pageActualBottomPx: contentHeightPx,
    headerHeightPx: 0,
    accumulatedYpx: 0,
  });

  // repeat-header：第一遍只需记录"该表头是否已经出现过"，
  // 用本地 Set 跟踪，不依赖 repeatHeaderManager 的 setMeta 状态。
  const headerRenderedSet = new Set();

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
        headerMeta,
      })
    ) {
      // 修正上一页的 pageActualBottomPx
      const pageActualBottomPx = calcNextPageStart(node, currentPageBottom);
      const prevPageInfo = pageStartOffsets.get(currentPage);
      if (
        prevPageInfo &&
        pageActualBottomPx < prevPageInfo.pageActualBottomPx
      ) {
        prevPageInfo.pageActualBottomPx = pageActualBottomPx;
      }

      accumulatedYpx = pageActualBottomPx;
      currentPage += 1;

      // 处理 repeat-header：只取高度，不生成 placements
      let headerHeightPx = 0;
      if (headerMeta && headerRenderedSet.has(headerMeta.headerNode._origEl)) {
        headerHeightPx = headerMeta.headerNode.height;
      }

      currentPageContentOffsetPx = headerHeightPx;

      const newPageContentTopPx = accumulatedYpx - currentPageContentOffsetPx;
      pageStartOffsets.set(currentPage, {
        pageContentTopPx: newPageContentTopPx,
        pageActualBottomPx: newPageContentTopPx + contentHeightPx,
        headerHeightPx: currentPageContentOffsetPx,
        accumulatedYpx,
      });

      // 重新处理当前节点
      i -= 1;
      continue;
    }

    // 标记表头节点已渲染（第一遍只维护本地 Set）
    if (headerMeta && node._origEl === headerMeta.headerNode._origEl) {
      headerRenderedSet.add(headerMeta.headerNode._origEl);
    }
  }

  return pageStartOffsets;
}

/**
 * 根据全局 y 坐标在 pageStartOffsets 中查找节点所属页码。
 *
 * 查找规则：
 *   找满足 pageContentTopPx <= y < pageActualBottomPx 的页。
 *   如果 y 落在两页之间的 gap（text/avoid 换页后旧页底部 < 新页顶部）：
 *     取第一个 pageContentTopPx > y 的页（即 gap 之后的下一页）。
 *   如果 y 超出所有页范围，返回最后一页。
 *
 * @param {number} y
 * @param {Map}    pageStartOffsets
 * @returns {number} page number (1-based)
 */
function findPageForY(y, pageStartOffsets) {
  let fallback = 1;
  for (const [page, info] of pageStartOffsets) {
    if (y >= info.pageContentTopPx && y < info.pageActualBottomPx) {
      return page;
    }

    // gap 情况：y < pageContentTopPx 意味着 y 落在上一页结束和本页开始之间
    if (y < info.pageContentTopPx) {
      return page;
    }

    fallback = page;
  }

  return fallback;
}

/**
 * 第二遍：按 node.y 坐标查页码，生成 normal placements 和 repeat-header placements。
 *
 * repeat-header 处理：
 *   - 对每个 pageStartOffsets 中 headerHeightPx > 0 的页，调用
 *     generateRepeatHeaderPlacements 生成该页的表头副本。
 *   - 原始 THEAD 节点及其子节点：若所在页已有 repeat-header 副本，跳过。
 *
 * @param {Array}       nodes
 * @param {Map}         pageStartOffsets
 * @param {Object|null} repeatHeaderManager
 * @returns {Array} nodePlacements
 */
/**
 * 构建 repeat-header 副本集合，并将副本 placements 推入 nodePlacements。
 * 返回 Set，key 格式：`${page}-${headerNode._origEl}`。
 */
function buildRepeatHeaderPageSet(
  nodes,
  pageStartOffsets,
  repeatHeaderManager,
  nodePlacements,
) {
  const repeatHeaderPageSet = new Set();

  if (!repeatHeaderManager) return repeatHeaderPageSet;

  // 一次遍历同时建立：origEl → meta 和 origEl → 首次出现页码
  const headerMetaByEl = new Map();
  const headerFirstPage = new Map();

  for (const node of nodes) {
    const headerMeta = repeatHeaderManager.getHeaderMetaForNode(node);
    if (!headerMeta) continue;

    const el = headerMeta.headerNode._origEl;
    if (node._origEl !== el || headerMetaByEl.has(el)) continue;

    headerMetaByEl.set(el, headerMeta);
    headerFirstPage.set(el, findPageForY(node.y, pageStartOffsets));
  }

  // 对 headerHeightPx > 0 的页生成 repeat-header placements
  for (const [page, info] of pageStartOffsets) {
    if (info.headerHeightPx <= 0) continue;

    for (const [el, headerMeta] of headerMetaByEl) {
      const firstPage = headerFirstPage.get(el);
      if (firstPage >= page) continue;

      const key = `${page}-${el}`;
      if (repeatHeaderPageSet.has(key)) continue;

      repeatHeaderPageSet.add(key);
      const result = generateRepeatHeaderPlacements(
        headerMeta,
        page,
        info.accumulatedYpx,
      );
      nodePlacements.push(...result.placements);
    }
  }

  return repeatHeaderPageSet;
}

/**
 * 第二遍：按 node.y 坐标查页码，生成 normal placements 和 repeat-header placements。
 *
 * @param {Array}       nodes
 * @param {Map}         pageStartOffsets
 * @param {Object|null} repeatHeaderManager
 * @returns {Array} nodePlacements
 */
function assignPlacements(nodes, pageStartOffsets, repeatHeaderManager) {
  const nodePlacements = [];

  const repeatHeaderPageSet = buildRepeatHeaderPageSet(
    nodes,
    pageStartOffsets,
    repeatHeaderManager,
    nodePlacements,
  );

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const headerMeta = repeatHeaderManager?.getHeaderMetaForNode(node);

    const page = findPageForY(node.y, pageStartOffsets);
    const pageInfo = pageStartOffsets.get(page);
    const offsetYpx = pageInfo ? pageInfo.pageContentTopPx : 0;

    // 跳过原始表头节点（所在页有 repeat-header 副本时）
    if (headerMeta && shouldSkipOriginalHeader(node, headerMeta)) {
      const key = `${page}-${headerMeta.headerNode._origEl}`;
      if (repeatHeaderPageSet.has(key)) continue;
    }

    nodePlacements.push({
      page,
      node,
      offsetYpx,
      type: 'normal',
      isLastSpill: true,
      dfsIndex: i,
    });
  }

  return nodePlacements;
}

/**
 * 流式分页主函数：两遍扫描分页，生成渲染计划
 *
 * 流程：
 * 1. buildPageBoundaries()   —— 第一遍：建立完整页边界表
 * 2. assignPlacements()      —— 第二遍：按 node.y 分配 placement
 * 3. expandSpillPlacements() —— 跨页展开
 * 4. 合并排序，返回 allPlacements
 *
 * @param {Object} params
 * @param {Array}  params.nodes               - 节点数组（由 collectNodes 生成）
 * @param {Object} params.ctx                 - 渲染上下文（scale、doc、contentHeight 等）
 * @param {Object} params.repeatHeaderManager - repeat-header 管理器实例（无配置时为 null）
 * @returns {{ totalPages: number, allPlacements: Array }}
 */
export function streamPaginate({ nodes, ctx, repeatHeaderManager = null }) {
  const { contentHeightPx } = ctx;

  // 第一遍：建立页边界
  const pageStartOffsets = buildPageBoundaries(
    nodes,
    contentHeightPx,
    repeatHeaderManager,
  );

  const totalPagesCount = pageStartOffsets.size;

  // 第二遍：按 node.y 分配 placements
  const nodePlacements = assignPlacements(
    nodes,
    pageStartOffsets,
    repeatHeaderManager,
  );

  // 回填 normal placements 的 pageActualBottomPx
  for (const p of nodePlacements) {
    const info = pageStartOffsets.get(p.page);
    p.pageActualBottomPx = info ? info.pageActualBottomPx : null;
  }

  // CSS §17.5.4：rowspan cell 背景高于同列普通 cell 背景。
  // DFS 前序下 rowspan TD dfsIndex 小于同行普通 TD，需要后移确保覆盖。
  // 用 sortKey 调整：
  //   rowspan TD/TH element  → dfsIndex + totalNodes   （排在所有普通 element 之后）
  //   所有 text 节点          → dfsIndex + 2*totalNodes （始终在所有 element 之后）
  // 普通 element 不设 sortKey，默认用 dfsIndex，排在最前。
  const totalNodes = nodes.length;
  for (const p of nodePlacements) {
    if (p.node.type === 'text') {
      p.sortKey = p.dfsIndex + 2 * totalNodes;
      continue;
    }

    const { tag } = p.node;
    if (
      p.type === 'normal' &&
      p.node.type === 'element' &&
      (tag === 'TD' || tag === 'TH') &&
      (p.node.rowSpan || 1) > 1
    ) {
      p.sortKey = p.dfsIndex + totalNodes;
    }
  }

  // 跨页展开：为溢出节点在后续页生成 spill placement
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
