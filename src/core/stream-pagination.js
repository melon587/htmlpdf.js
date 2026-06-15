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
  let shouldSkipHeaderOnCurrentPage = false;

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
        if (headerMeta.actualStartPage === null) {
          // eslint-disable-next-line no-param-reassign
          headerMeta.actualStartPage = currentPage;
          // 第一页渲染原始表头，不渲染 repeat-header
          currentPageContentOffsetPx = 0;
          shouldSkipHeaderOnCurrentPage = false;
        } else if (currentPage > headerMeta.actualStartPage) {
          // 从第二页开始渲染 repeat-header
          const result = generateRepeatHeaderPlacements(
            headerMeta,
            currentPage,
            accumulatedYpx,
          );
          headerPlacements.push(...result.placements);
          currentPageContentOffsetPx = result.headerHeightPx;
          shouldSkipHeaderOnCurrentPage = true;
        }
      } else {
        currentPageContentOffsetPx = 0;
        shouldSkipHeaderOnCurrentPage = false;
      }

      // 重新处理当前节点
      i--;
      continue;
    }

    // 跳过原始表头节点（如果当前页已渲染 repeat-header 副本）
    if (
      shouldSkipHeaderOnCurrentPage &&
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
