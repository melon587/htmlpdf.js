/**
 * @file stream-pagination.js
 * 流式分页：单次遍历 nodes，动态决策换页，生成渲染计划（placements）
 *
 * streamPaginate({ nodes, ctx, fonts, repeatHeaderManager })
 * ├─ needsNewPage()            判断节点是否需要换页（自然溢出 / text 保护 / avoid / before）
 * ├─ calcNextPageStart()       计算新页起点 accumulatedYpx
 * ├─ repeat-header 处理        换页时生成表头副本，跳过原始表头节点
 * ├─ 生成 nodePlacements       { page, node, offsetYpx, type: 'normal', paintOrder }
 * ├─ expandSpillPlacements()   为跨页节点在后续页生成 spill placement
 * └─ comparePlacements sort    合并所有 placements 并按页码+类型+paintOrder 排序
 *
 * ## CSS Table painting order（CSS2.1 §17.5.4）
 *
 * 同页同 type 的 placements 按 paintOrder 排序，确保渲染顺序符合浏览器规范：
 *   0  TABLE / COLGROUP / COL  → 最先画（容器背景在最底层）
 *   1  TBODY / THEAD / TFOOT   → row group 背景
 *   2  TR                      → row 背景
 *   3  TD / TH                 → cell 背景（高于 TR，修复 rowspan 背景覆盖问题）
 *   4  其他普通元素             → DFS 顺序足够，统一为同一权重
 *   5  text / pseudo-element   → 内容层，最后画
 *
 * 同一 paintOrder 内保留 DFS 原始顺序（stable sort + dfsIndex tiebreaker）。
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
 * CSS Table painting order（CSS2.1 §17.5.4）
 * 返回值越小越先渲染（背景层优先于内容层）
 */
function getPaintOrder(node) {
  if (node.type === 'text' || node.type === 'pseudo-element') return 5;

  const { tag } = node;
  if (tag === 'TABLE' || tag === 'COLGROUP' || tag === 'COL') return 0;

  if (tag === 'TBODY' || tag === 'THEAD' || tag === 'TFOOT') return 1;

  if (tag === 'TR') return 2;

  if (tag === 'TD' || tag === 'TH') return 3;

  return 4;
}

/**
 * placement 排序：
 *   1. 页码升序
 *   2. 同页内按 placementOrder（spill → repeat-header → normal）
 *   3. 同页同 type 内按 paintOrder（CSS Table painting order）
 *   4. 同 paintOrder 内按 dfsIndex 保留原始 DFS 顺序
 */
function comparePlacements(a, b) {
  if (a.page !== b.page) return a.page - b.page;

  const typeOrd = placementOrder(a) - placementOrder(b);
  if (typeOrd !== 0) return typeOrd;

  const paintOrd = a.paintOrder - b.paintOrder;
  if (paintOrd !== 0) return paintOrd;

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
      const spillRawOffset = spillPageInfo ? spillPageInfo.pageRawTopPx : 0;
      // clipTopPx = pageRawTopPx - pageContentTopPx = 表头高度 px
      const clipTopPx = spillRawOffset - spillOffsetYpx;

      nodeSpills.push({
        page: sp,
        node: p.node,
        offsetYpx: spillOffsetYpx,
        clipTopPx,
        type: 'spill',
        isLastSpill: sp === lastPage, // 只有最后一页才是 true
        paintOrder: p.paintOrder,
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

  const nodePlacements = []; // 节点渲染计划
  const headerPlacements = []; // repeat-header 渲染计划

  // 每页内容区起始偏移：key=页码，value={ pageRawTopPx（含表头）, pageContentTopPx（减表头）, pageActualBottomPx（本页内容实际底部全局px）}
  const pageStartOffsets = new Map();
  pageStartOffsets.set(1, {
    pageRawTopPx: 0,
    pageContentTopPx: 0,
    pageActualBottomPx: contentHeightPx, // 初始值：整页用满，换页时修正上一页的实际底部
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
      // 计算本页实际内容底部（全局px）：
      // - 自然溢出 → currentPageBottom（整页用满）
      // - text 保护 / avoid / before 推页 → node.y（节点起点，剩余空间废弃）
      const pageActualBottomPx = calcNextPageStart(node, currentPageBottom);

      // 修正上一页的 pageActualBottomPx（初始化为整页底部，推页后需更正）
      // 取最小值：同一页可能有多个节点触发推页，第一个被推走的决定本页实际底部
      const prevPageInfo = pageStartOffsets.get(currentPage);
      if (
        prevPageInfo &&
        pageActualBottomPx < prevPageInfo.pageActualBottomPx
      ) {
        prevPageInfo.pageActualBottomPx = pageActualBottomPx;
      }

      accumulatedYpx = pageActualBottomPx;
      currentPage += 1;

      // 处理 repeat-header（先处理，再记录 effectiveOffset）
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
          headerPlacements.push(...result.placements);
          currentPageContentOffsetPx = result.headerHeightPx;
          // eslint-disable-next-line no-param-reassign
          headerMeta.skipOnCurrentPage = true;
        }
      } else {
        currentPageContentOffsetPx = 0;
      }

      // repeat-header 处理完后记录新页偏移（pageContentTopPx 已含 header 修正）
      // pageActualBottomPx 初始设为整页底部，若后续有 avoid/before 推页会再次修正
      const newPageContentTopPx = accumulatedYpx - currentPageContentOffsetPx;
      pageStartOffsets.set(currentPage, {
        pageRawTopPx: accumulatedYpx,
        pageContentTopPx: newPageContentTopPx,
        pageActualBottomPx: newPageContentTopPx + contentHeightPx, // 初始：整页用满
      });

      // 重新处理当前节点
      i -= 1;
      continue;
    }

    // 跳过原始表头节点（当前页已有 repeat-header 副本时）
    // skipOnCurrentPage 存在 headerMeta 上，各表格独立维护，避免多表格时相互干扰
    if (
      headerMeta?.skipOnCurrentPage &&
      shouldSkipOriginalHeader(node, headerMeta)
    ) {
      continue;
    }

    // 计算内容区起点偏移（全局 px，已减去表头高度）
    const effectiveOffsetYpx = accumulatedYpx - currentPageContentOffsetPx;

    // 生成节点渲染计划
    // pageActualBottomPx 先用当前页整页底部（若后续 avoid/before 推页会由 pageStartOffsets 修正）
    nodePlacements.push({
      page: currentPage,
      node,
      offsetYpx: effectiveOffsetYpx,
      type: 'normal',
      isLastSpill: true,
      paintOrder: getPaintOrder(node),
      dfsIndex: i,
    });

    // headerNode 放入渲染计划后立即标记，下次该表格换页时开始生成 repeat-header 副本
    // 注意：headerNode 在 DOM 顺序上先于 tbody，所以它被 skip 时 headerRendered 已经是
    // true（skip 条件依赖 headerRendered），不存在永远标记不到的情况
    if (headerMeta && node._origEl === headerMeta.headerNode._origEl) {
      // eslint-disable-next-line no-param-reassign
      headerMeta.headerRendered = true;
    }
  }

  // 回填 normal placements 的 pageActualBottomPx：
  // normal placement 生成时该页的 pageActualBottomPx 可能还未被后续 avoid/before 推页修正，
  // 循环结束后 pageStartOffsets 已全部修正，在此统一回填。
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

  // 归并 nodePlacements 与 spillPlacements 并按页码、类型排序
  // comparePlacements 已包含 placementOrder/paintOrder/dfsIndex 全部排序维度，
  // 无需预先 merge，直接 concat + sort 即可。
  const allPlacements = [
    ...headerPlacements,
    ...nodePlacements,
    ...spillPlacements,
  ].sort(comparePlacements);

  // 返回分页方案
  return {
    totalPages: totalPagesCount,
    allPlacements,
  };
}
