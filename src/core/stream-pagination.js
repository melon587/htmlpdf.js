/**
 * @file stream-pagination.js
 * 流式分页策略：动态决策分页，支持 page-break、repeat-header、跨页元素
 *
 * ## 整体流程
 *
 * streamPaginate({ nodes, ctx, fonts, repeatHeaderManager })
 * │
 * ├─ needsNewPage()           判断节点是否需要换页
 * │  ├─ 自然溢出              node.y >= currentPageBottom
 * │  ├─ text 节点保护          node.y + height > currentPageBottom（避免文本被切割）
 * │  ├─ page-break: avoid     整体推到下一页
 * │  └─ page-break: before    强制换页
 * │
 * ├─ calcNextPageStart()      计算换页后的新页起点（accumulatedYpx）
 * │  ├─ 自然溢出 → currentPageBottom（连续不留空隙）
 * │  └─ 节点整体推到新页 → node.y（节点顶部对齐新页顶部）
 * │
 * ├─ repeat-header 处理
 * │  ├─ headerRendered=false  首次遇到表头，不生成副本（原始表头会渲染）
 * │  ├─ headerRendered=true   换页时生成表头副本，跳过原始表头节点
 * │  └─ currentPageContentOffsetPx  维护表头高度偏移，用于计算内容区起点
 * │
 * ├─ 生成 nodePlacements      每个节点的渲染计划 { page, node, offsetYpx, type }
 * │
 * ├─ expandSpillPlacements()  跨页展开：为溢出节点在后续页生成 spill placement
 * │  ├─ buildNodeLastPageMap() 建立"节点及子孙出现的最大页码"映射（避免坐标误判）
 * │  ├─ 检测节点是否溢出        nodeBottom > pageBottom
 * │  └─ 生成 spill placement   为每个溢出页生成 { page, node, offsetYpx, clipTopPx, type: 'spill' }
 * │
 * └─ mergePlacements()        归并 normal 和 spill，同页时 spill 优先（背景先渲染）
 *
 * ## 核心概念
 *
 * ### accumulatedYpx
 * 全局 Y 坐标累积值（px），表示当前页的"换页点"（即新页的原始顶部）。
 * - 初始值为 0（第一页从顶部开始）
 * - 换页时更新为 calcNextPageStart() 的返回值
 * - 自然溢出时 = currentPageBottom（连续不留空隙）
 * - 节点整体推到新页时 = node.y（节点顶部对齐新页顶部）
 *
 * ### currentPageContentOffsetPx
 * 当前页的表头高度偏移（px），用于 repeat-header。
 * - 无 repeat-header 或首次遇到表头时 = 0
 * - 生成表头副本后 = headerHeightPx
 * - 用于计算 effectiveOffsetYpx = accumulatedYpx - currentPageContentOffsetPx
 *
 * ### pageStartOffsets
 * Map<页码, { pageRawTopPx, pageContentTopPx }>
 * - pageRawTopPx: 换页点的全局 px（含表头高度，即 accumulatedYpx）
 * - pageContentTopPx: 内容区起点的全局 px（已减去表头高度）
 * - 用于跨页展开时计算溢出页的 offsetYpx
 *
 * ### placement
 * 渲染计划对象，包含：
 * - page: 页码（1-based）
 * - node: 要渲染的节点
 * - offsetYpx: 该页内容区起点的全局 px（用于计算 relativeY = node.y - offsetYpx）
 * - type: 'normal' | 'spill' | 'repeat-header' | 'repeat-header-child'
 * - isLastSpill: 是否是最后一页的 spill（用于渲染底部边框）
 * - clipTopPx: spill 专用，表头高度（用于裁剪顶部）
 *
 * ## 使用约定
 *
 * ### 行级容器的 page-break
 * 对于 flex row、grid row、table row 等"行级容器"，用户应该设置：page-break
 *
 * 否则，容器内的 text 节点可能单独触发换页，导致同一行的其他列（特别是居中/底部对齐的列）
 * 被推到新页后位置错乱（Y 坐标小于换页点，可能盖住 repeat-header）。
 *
 * ### text 节点保护
 * 为了避免文本被页面切割（上半行在旧页底部，下半行在新页顶部），默认对 text 节点启用
 * 换页保护：只要 text 被切割就推到下一页。这意味着用户无需手动给每个 text 加 page-break。
 */

import {
  shouldSkipOriginalHeader,
  generateRepeatHeaderPlacements,
} from './repeat-header-manager';

/**
 * 准备字体配置：按优先级排序
 *
 * @param {Array} fonts - 字体配置数组，每项包含 { fontFamily, priority, isDefault, ... }
 * @returns {Array} sortedFontConfig - 按 priority 降序排列的字体配置（用于字体匹配）
 */
function getFontConfig(fonts) {
  return fonts.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

/**
 * 计算 placement 的渲染顺序权重（同页内）
 *
 * - spill: 0（背景/边框，最先渲染）
 * - repeat-header / repeat-header-child: 1（表头，次之）
 * - normal: 2（正常内容，最后渲染）
 */
function placementOrder(p) {
  if (p.type === 'spill') return 0;

  if (p.type === 'repeat-header' || p.type === 'repeat-header-child') return 1;

  return 2;
}

/**
 * placement 排序比较函数
 * 1. 先按页码升序
 * 2. 同页内按 placementOrder 升序（spill → repeat-header → normal）
 */
function comparePlacements(a, b) {
  if (a.page !== b.page) return a.page - b.page;

  return placementOrder(a) - placementOrder(b);
}

/**
 * 判断节点是否需要换页
 *
 * 换页的四种情况：
 * 1. 自然溢出：节点起始位置超出当前页底部（node.y >= currentPageBottom）
 * 2. text 节点保护：text 节点被切割时推到下一页（避免文本被页面切成两半）
 * 3. page-break: avoid - 节点无法完整放入当前页，整体推到下一页
 *    豁免：节点高度超过一整页时，avoid 无法生效，降级为自然 spill（避免无限换页）
 * 4. page-break: before - 节点设置了强制换页，且不在当前页起始位置
 *
 * @param {Object} node - 当前节点
 * @param {number} currentPageBottom - 当前页底部的全局 Y 坐标（px）
 * @param {number} accumulatedYpx - 当前页的换页点（全局 Y 坐标，px）
 * @param {number} contentHeightPx - 单页内容区高度（px），用于 avoid 豁免判断
 * @returns {boolean} 是否需要换页
 */
function needsNewPage(
  node,
  currentPageBottom,
  accumulatedYpx,
  contentHeightPx,
) {
  if (node.y >= currentPageBottom) return true;

  // text 节点：只要被切割就推到下一页（行级别保护）
  if (node.type === 'text' && node.y + node.height > currentPageBottom)
    return true;

  if (node.pageBreak === 'avoid' && node.y + node.height > currentPageBottom) {
    // 豁免：节点本身比一页还高，推到下一页也放不下，让其自然 spill，避免无限换页
    if (node.height > contentHeightPx) return false;

    return true;
  }

  if (node.pageBreak === 'before' && node.y > accumulatedYpx) return true;

  return false;
}

/**
 * 计算换页后 accumulatedYpx 的新起始位置（px）
 *
 * 两种策略：
 * 1. 自然溢出（node.y >= currentPageBottom）：
 *    返回 currentPageBottom，从当前页底部开始，保证连续不留空隙
 *
 * 2. 节点整体推到新页（page-break: avoid / before / text 保护）：
 *    返回 node.y，以节点顶部作为新页起点，使节点在新页顶部对齐
 *
 * @param {Object} node - 触发换页的节点
 * @param {number} currentPageBottom - 当前页底部的全局 Y 坐标（px）
 * @returns {number} 新页的 accumulatedYpx
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
export function expandSpillPlacements(
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

    // 确定该节点真正的最后一页，取以下两者的最大值：
    //
    // lastPageByMap：节点及子孙在 nodePlacements 里出现的最大页码。
    //   适用于容器节点——子孙分布到更后面的页时，容器的 bg/border 也需要延伸到那页。
    //   对叶子节点（如 IMG），子孙 = 自身，lastPageByMap = p.page，无法反映实际跨越页数。
    //
    // lastPageByCoord：从节点底部坐标直接推算的绝对页码。
    //   适用于叶子节点（无子孙可冒泡），同时为容器节点提供兜底。
    //   公式：ceil((nodeBottom - pageContentTopPx) / contentHeightPx) + p.page - 1
    //   含义：节点底部在当前页之后还跨了多少页，加上当前页码即为绝对页码。
    const lastPageByMap = nodeLastPage.get(p.node._origEl) || p.page;
    const lastPageByCoord =
      Math.ceil(
        (p.node.y +
          p.node.height -
          (pageInfo ? pageInfo.pageContentTopPx : 0)) /
          contentHeightPx,
      ) +
      p.page -
      1;
    const lastPage = Math.min(
      Math.max(lastPageByMap, lastPageByCoord),
      totalPagesCount,
    );

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
 * 归并两个页码递增的 placement 数组（O(n) 双指针）
 * 同页时 spill 优先：背景/边框先渲染，normal placement 后覆盖在上面
 *
 * @param {Array} normal - nodePlacements
 * @param {Array} spill  - spillPlacements
 * @returns {Array} 合并后的 placements
 */
function mergePlacements(normal, spill) {
  const result = [];
  let i = 0;
  let j = 0;

  while (i < normal.length && j < spill.length) {
    if (spill[j].page < normal[i].page) {
      result.push(spill[j++]);
    } else if (normal[i].page < spill[j].page) {
      result.push(normal[i++]);
    } else {
      // 同页：先消耗所有 spill，再消耗 normal
      // 只推进 j，下一轮继续比较同一个 normal，直到该页 spill 全部消耗完
      result.push(spill[j++]);
    }
  }

  while (i < normal.length) result.push(normal[i++]);
  while (j < spill.length) result.push(spill[j++]);

  return result;
}

/**
 * 流式分页主函数：单次遍历 nodes，动态决策换页，生成渲染计划
 *
 * 算法流程：
 * 1. 遍历所有节点，检查是否需要换页（needsNewPage）
 * 2. 换页时更新 accumulatedYpx 和 currentPage，处理 repeat-header
 * 3. 跳过原始表头节点（当前页已有 repeat-header 副本时）
 * 4. 生成节点渲染计划（nodePlacements）
 * 5. 跨页展开：为溢出节点生成 spill placement（expandSpillPlacements）
 * 6. 归并 normal 和 spill，同页时 spill 优先（mergePlacements）
 * 7. 合并 headerPlacements，按页码+类型排序，返回 allPlacements
 *
 * 时间复杂度：O(N)，其中 N 是节点数量
 *
 * @param {Object} params
 * @param {Array} params.nodes - 节点数组（由 collectNodes 生成）
 * @param {Object} params.ctx - 渲染上下文（包含 scale、doc、contentHeight 等）
 * @param {Array} params.fonts - 字体配置数组
 * @param {Object} params.repeatHeaderManager - repeat-header 管理器实例（可选，无配置时为 null）
 * @returns {Object} 分页方案
 * @returns {number} .totalPages - 总页数
 * @returns {Array} .allPlacements - 所有渲染计划（spill + repeat-header + normal），按页码和类型排好序
 * @returns {Array} .sortedFontConfig - 按优先级排序的字体配置
 */
export function streamPaginate({
  nodes,
  ctx,
  fonts = [],
  repeatHeaderManager = null,
}) {
  const sortedFontConfig = getFontConfig(fonts);
  const { contentHeightPx } = ctx;

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
    if (
      needsNewPage(node, currentPageBottom, accumulatedYpx, contentHeightPx)
    ) {
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

  // 归并 nodePlacements 与 spillPlacements（O(n) 双指针，同页 spill 优先）
  const mergedPlacements = mergePlacements(nodePlacements, spillPlacements);

  // 合并所有 placements 并按页码、类型排序（spill < repeat-header < normal）
  const allPlacements = [...headerPlacements, ...mergedPlacements].sort(
    comparePlacements,
  );

  // 返回分页方案
  return {
    totalPages: totalPagesCount,
    allPlacements,
    sortedFontConfig,
  };
}
