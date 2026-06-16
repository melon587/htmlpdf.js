import { drawBackground } from './background';
import { drawBorder } from './border';
import { drawImage } from './image';
import { drawText } from './text';

/**
 * 渲染单个节点到 PDF
 *
 * 流式分页已将页面偏移量（offsetYpx）算入节点的 y 坐标，
 * 所以各 draw 函数只需处理相对当前页顶部的坐标，无需再传 pageOffsetY。
 *
 * @param {Object} doc - jsPDF 实例
 * @param {Object} node - 节点对象（y 已是相对当前页顶部的 px 坐标）
 * @param {Object} ctx - 渲染上下文
 * @param {number} offsetYpx - 当前页在全局坐标系中的起始 y（px），用于将节点 y 转为页内坐标
 * @param {number} contentHeight - 单页内容区高度（mm），用于跨页裁剪
 * @param {Array} sortedFontConfig - 排序后的字体配置
 * @param {string} fallbackFontFamily - fallback 字体
 */
export function renderNode({
  doc,
  node,
  ctx,
  offsetYpx = 0,
  contentHeight,
  sortedFontConfig = [],
  fallbackFontFamily = 'helvetica',
}) {
  const relativeYpx = node.y - offsetYpx;

  // 跳过完全在当前页之外的节点
  const relativeYmm = ctx.toMM(relativeYpx);
  if (relativeYmm < 0 && relativeYmm + ctx.toMM(node.height) <= 0) return;

  const adjustedNode = { ...node, y: relativeYpx };

  if (adjustedNode.type === 'element') {
    drawBackground({
      doc,
      node: adjustedNode,
      ctx,
      clipTop: 0,
      clipBottom: contentHeight,
    });
    drawBorder({
      doc,
      node: adjustedNode,
      ctx,
      clipTop: 0,
      clipBottom: contentHeight,
    });

    if (adjustedNode.tag === 'IMG') {
      drawImage({ doc, node: adjustedNode, ctx, clipTop: 0 });
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
