/**
 * 流式分页策略：动态决策分页，支持 page-break
 */

import {
  shouldSkipOriginalHeader,
  generateRepeatHeaderPlacements,
} from './repeat-header-manager';

/**
 * 准备字体配置：排序 + 获取 fallback 字体
 */
function getFontConfig(fonts) {
  const sortedFontConfig = fonts
    .slice()
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const defaultFont = fonts.find((f) => f.isDefault);
  const fallbackFontFamily = defaultFont ? defaultFont.fontFamily : 'helvetica';

  return { sortedFontConfig, fallbackFontFamily };
}

/**
 * 判断节点是否需要换页
 *
 * 换页的三种情况：
 * 1. 自然溢出：节点起始位置超出当前页底部
 * 2. page-break: avoid - 节点无法完整放入当前页，整体推到下一页
 * 3. page-break: before - 节点设置了强制换页，且不在当前页起始位置
 */
function needsNewPage(node, currentPageBottom, accumulatedYpx) {
  if (node.y >= currentPageBottom) return true;

  if (node.pageBreak === 'avoid' && node.y + node.height > currentPageBottom)
    return true;

  if (node.pageBreak === 'before' && node.y > accumulatedYpx) return true;

  return false;
}

/**
 * 计算换页后 accumulatedYpx 的新起始位置（px）
 *
 * - 自然溢出（node.y 超出页底）：从当前页底部开始，保证连续不留空隙
 * - page-break:avoid / page-break:before：节点被整体推到新页，
 *   以 node.y 作为新页起点，使节点在新页顶部对齐
 */
function calcNextPageStart(node, currentPageBottom) {
  return node.y >= currentPageBottom ? currentPageBottom : node.y;
}

/**
 * 构建每个节点（含子孙）出现的最大页码映射。
 *
 * 方案A 的核心：避免用 DOM 坐标判断 spill 是否终止。
 * 在 page-break 场景下，pageContentTopPx 会跳跃，导致坐标判断提前终止 spill。
 * 改为用"节点自身及子孙节点出现的最大页码"来决定 spill 终止。
 *
 * 算法（O(N) 向上冒泡）：
 * 1. 遍历所有 placement，记录每个 origEl 自身出现的最大页码（selfMaxPage）
 * 2. 对每个 el，沿 parentElement 链向上冒泡，将自身最大页码写入所有祖先。
 *    若祖先已有更大值则提前终止（其上方祖先必然已被更大值更新过）。
 *
 * @param {Array} nodePlacements - normal placement 数组
 * @returns {Map} origEl → 该节点及子孙节点出现的最大页码
 */
function buildNodeLastPageMap(nodePlacements) {
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
 * 跨页展开：对每条 normal placement，检查节点是否溢出到后续页，
 * 若溢出则为每个溢出页生成额外的 'spill' placement，
 * 使 renderNode 能在溢出页继续绘制该节点的 bg/border。
 *
 * offsetYpx 使用 pageStartOffsets.get(spillPage).pageContentTopPx：
 *   relativeY = node.y - offsetYpx < 0（节点顶部在页面以上，符合预期）
 *   drawBorder/drawBackground 的 clipTop 会正确裁剪
 *
 * 方案A：用 nodeLastPage 映射（节点及子孙出现的最大页码）决定 spill 终止，
 * 而不是用 DOM 坐标，避免 page-break 场景下 pageContentTopPx 跳跃导致的误判。
 *
 * @param {Array}  nodePlacements   - normal placement 数组（页码递增）
 * @param {Map}    pageStartOffsets - 页码 → { pageRawTopPx, pageContentTopPx }
 * @param {number} contentHeightPx  - 单页内容区高度（px）
 * @param {number} totalPagesCount  - 总页数
 * @returns {Array} spillPlacements（页码递增）
 */
function expandSpillPlacements(
  nodePlacements,
  pageStartOffsets,
  contentHeightPx,
  totalPagesCount,
) {
  const spillPlacements = [];

  // 方案A：建立节点及子孙的最大页码映射
  const nodeLastPage = buildNodeLastPageMap(nodePlacements);

  for (const p of nodePlacements) {
    const nodeBottomPx = p.node.y + p.node.height;
    const pageInfo = pageStartOffsets.get(p.page);
    const pageContentTopPx = pageInfo ? pageInfo.pageContentTopPx : 0;
    const pageBottomGlobal = pageContentTopPx + contentHeightPx;

    if (nodeBottomPx <= pageBottomGlobal) continue;

    // 只对有边框或背景的 element 节点展开（text 节点不需要跨页 bg/border）
    if (p.node.type !== 'element') continue;

    // 用页码映射确定该节点真正的最后一页
    const lastPage = nodeLastPage.get(p.node._origEl) || totalPagesCount;

    const nodeSpills = [];
    for (let sp = p.page + 1; sp <= lastPage; sp++) {
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
      });
    }

    spillPlacements.push(...nodeSpills);
  }

  return spillPlacements;
}

/**
 * 流式分页计算：返回节点的分页方案和 repeat-header 渲染计划
 * @param {Object} params
 * @param {Array} params.nodes - 节点数组
 * @param {Object} params.ctx - 渲染上下文
 * @param {number} params.contentHeight - 内容高度（mm）
 * @param {Array} params.fonts - 字体配置
 * @param {Object} params.repeatHeaderManager - repeat-header 管理器实例
 */
export function streamPaginate({
  nodes,
  ctx,
  contentHeight,
  fonts = [],
  repeatHeaderManager = null,
}) {
  const { sortedFontConfig, fallbackFontFamily } = getFontConfig(fonts);
  const contentHeightPx = contentHeight / ctx.scale;

  let currentPage = 1;
  let accumulatedYpx = 0;
  let currentPageContentOffsetPx = 0;

  const nodePlacements = []; // 节点渲染计划
  const headerPlacements = []; // repeat-header 渲染计划

  // 记录每页内容区的起始偏移，用于跨页展开时计算溢出页的 offsetYpx
  // key: 页码（1-based）
  // value: {
  //   pageRawTopPx:     换页点的全局 px（含表头高度，即 accumulatedYpx）
  //   pageContentTopPx: 内容区起点的全局 px（已减去表头高度）
  // }
  const pageStartOffsets = new Map();
  pageStartOffsets.set(1, { pageRawTopPx: 0, pageContentTopPx: 0 });

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const headerMeta = repeatHeaderManager?.getHeaderMetaForNode(node);

    const currentPageBottom =
      accumulatedYpx + contentHeightPx - currentPageContentOffsetPx;

    // 检查是否需要换页
    if (needsNewPage(node, currentPageBottom, accumulatedYpx)) {
      accumulatedYpx = calcNextPageStart(node, currentPageBottom);
      currentPage++;

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
      pageStartOffsets.set(currentPage, {
        pageRawTopPx: accumulatedYpx,
        pageContentTopPx: accumulatedYpx - currentPageContentOffsetPx,
      });

      // 重新处理当前节点
      i--;
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
    nodePlacements.push({
      page: currentPage,
      node,
      offsetYpx: effectiveOffsetYpx,
      type: 'normal',
      isLastSpill: true,
    });

    // headerNode 放入渲染计划后立即标记，下次该表格换页时开始生成 repeat-header 副本
    // 注意：headerNode 在 DOM 顺序上先于 tbody，所以它被 skip 时 headerRendered 已经是
    // true（skip 条件依赖 headerRendered），不存在永远标记不到的情况
    if (headerMeta && node._origEl === headerMeta.headerNode._origEl) {
      // eslint-disable-next-line no-param-reassign
      headerMeta.headerRendered = true;
    }
  }

  // 跨页展开：为溢出节点在后续页生成 spill placement
  const totalPagesCount = currentPage;
  const spillPlacements = expandSpillPlacements(
    nodePlacements,
    pageStartOffsets,
    contentHeightPx,
    totalPagesCount,
  );

  // 归并 nodePlacements（页码递增）与 spillPlacements（spill 页也递增）
  // O(n) 替代 O(n log n) sort，避免临时大数组
  // 同页时 spill placement 优先：背景/边框 spill 先渲染，normal placement 后覆盖在上面
  const mergedPlacements = [];
  {
    let i = 0;
    let j = 0;
    while (i < nodePlacements.length && j < spillPlacements.length) {
      if (spillPlacements[j].page < nodePlacements[i].page) {
        // spill 页码更小，先放 spill
        mergedPlacements.push(spillPlacements[j++]);
      } else if (nodePlacements[i].page < spillPlacements[j].page) {
        // normal 页码更小，先放 normal
        mergedPlacements.push(nodePlacements[i++]);
      } else {
        // 同页：spill 优先（背景在下，内容在上）
        mergedPlacements.push(spillPlacements[j++]);
      }
    }
    while (i < nodePlacements.length)
      mergedPlacements.push(nodePlacements[i++]);
    while (j < spillPlacements.length)
      mergedPlacements.push(spillPlacements[j++]);
  }

  // 返回分页方案
  return {
    totalPages: totalPagesCount,
    nodePlacements: mergedPlacements,
    headerPlacements,
    sortedFontConfig,
    fallbackFontFamily,
  };
}
