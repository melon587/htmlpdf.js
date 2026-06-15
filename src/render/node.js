import { drawBackground } from './background';
import { drawBorder } from './border';
import { drawImage } from './image';
import { drawText } from './text';

/**
 * 渲染单个节点到 PDF
 * 统一接口：适用于流式分页和固定分页
 * 
 * @param {Object} doc - jsPDF 实例
 * @param {Object} node - 节点对象
 * @param {Object} ctx - 渲染上下文
 * @param {number} offsetYpx - 节点在当前页的偏移量（px）
 * @param {number} contentHeight - 单页内容区高度（mm）
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
  const { toMM } = ctx;
  const relativeYpx = node.y - offsetYpx;
  const relativeYmm = toMM(relativeYpx);

  // 跳过完全在当前页之外的节点
  if (relativeYmm < 0) {
    const nodeBottomMm = relativeYmm + toMM(node.height);
    if (nodeBottomMm <= 0) {
      return;
    }
  }

  // 调整节点坐标为相对坐标
  const adjustedNode = { ...node, y: relativeYpx };

  if (adjustedNode.type === 'element') {
    drawBackground({
      doc,
      node: adjustedNode,
      ctx,
      pageOffsetY: 0,
      clipTop: 0,
      clipBottom: contentHeight,
    });
    drawBorder({
      doc,
      node: adjustedNode,
      ctx,
      pageOffsetY: 0,
      clipTop: 0,
      clipBottom: contentHeight,
    });
    if (adjustedNode.tag === 'IMG') {
      drawImage({
        doc,
        node: adjustedNode,
        ctx,
        pageOffsetY: 0,
        clipTop: 0,
      });
    }
  } else if (adjustedNode.type === 'text') {
    drawText({
      doc,
      node: adjustedNode,
      ctx,
      pageOffsetY: 0,
      clipTop: 0,
      sortedFontConfig,
      fallbackFontFamily,
    });
  }
}
