import { drawBackground } from './background';
import { drawBorder } from './border';
import { drawImage } from './image';
import { drawText } from './text';

/**
 * 渲染单个节点到 PDF
 *
 * @param {Object} doc - jsPDF 实例
 * @param {Object} node - 节点对象（y 为全局坐标，由 offsetYpx 转换为页内坐标）
 * @param {Object} ctx - 渲染上下文
 * @param {number} offsetYpx - 当前页内容区起始的全局 y（px）
 * @param {number} contentHeight - 单页内容区高度（mm），用于跨页裁剪
 * @param {Array} sortedFontConfig - 排序后的字体配置
 * @param {string} fallbackFontFamily - fallback 字体
 * @param {boolean} isLastSpill - 是否是该节点的最后一个 spill placement（用于跨页背景/边框渲染）
 */
export function renderNode({
  doc,
  node,
  ctx,
  offsetYpx = 0,
  contentHeight,
  sortedFontConfig = [],
  fallbackFontFamily = 'helvetica',
  isLastSpill = true,
}) {
  const relativeYpx = node.y - offsetYpx;

  // 跳过完全在当前页之外的节点（顶部和底部都在页面顶部以上）
  const relativeYmm = ctx.toMM(relativeYpx);
  if (relativeYmm < 0 && relativeYmm + ctx.toMM(node.height) <= 0) return;

  const adjustedNode = { ...node, y: relativeYpx };

  if (adjustedNode.type === 'element') {
    drawBackground({
      doc,
      node: adjustedNode,
      ctx,
      clipBottom: contentHeight,
      isLastSpill,
    });
    drawBorder({
      doc,
      node: adjustedNode,
      ctx,
      clipBottom: contentHeight,
      isLastSpill,
    });

    if (adjustedNode.tag === 'IMG') {
      drawImage({ doc, node: adjustedNode, ctx, offsetYpx, contentHeight });
    }
  } else if (adjustedNode.type === 'text') {
    drawText({
      doc,
      node: adjustedNode,
      ctx,
      clipTop: 0,
      sortedFontConfig,
      fallbackFontFamily,
    });
  }
}
