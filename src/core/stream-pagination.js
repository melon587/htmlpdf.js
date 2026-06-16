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

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const headerMeta = repeatHeaderManager?.getHeaderMetaForNode(node);

    const currentPageBottom =
      accumulatedYpx + contentHeightPx - currentPageContentOffsetPx;

    // 检查是否需要换页
    if (needsNewPage(node, currentPageBottom, accumulatedYpx)) {
      accumulatedYpx = calcNextPageStart(node, currentPageBottom);
      currentPage++;

      // 处理 repeat-header
      if (headerMeta) {
        if (!headerMeta.headerRendered) {
          // 原始表头尚未渲染，本次换页后继续正常渲染
          currentPageContentOffsetPx = 0;
          // eslint-disable-next-line no-param-reassign
          headerMeta.skipOnCurrentPage = false;
        } else {
          // 原始表头已渲染，在新页顶部插入 repeat-header 副本
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

    // 计算有效偏移量
    const effectiveOffsetYpx = accumulatedYpx - currentPageContentOffsetPx;

    // 生成节点渲染计划
    nodePlacements.push({
      page: currentPage,
      node,
      offsetYpx: effectiveOffsetYpx,
      type: 'normal',
    });

    // headerNode 放入渲染计划后立即标记，下次该表格换页时开始生成 repeat-header 副本
    // 注意：headerNode 在 DOM 顺序上先于 tbody，所以它被 skip 时 headerRendered 已经是
    // true（skip 条件依赖 headerRendered），不存在永远标记不到的情况
    if (headerMeta && node._origEl === headerMeta.headerNode._origEl) {
      // eslint-disable-next-line no-param-reassign
      headerMeta.headerRendered = true;
    }
  }

  // 返回分页方案
  return {
    totalPages: currentPage,
    nodePlacements,
    headerPlacements,
    sortedFontConfig,
    fallbackFontFamily,
  };
}
