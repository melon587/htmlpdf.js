/**
 * @file node.js
 * 节点渲染调度：将解析后的节点（element / pseudo-element / text）渲染到 PDF
 *
 * renderNode()
 * ├─ element       → drawBackground + drawBorder + (drawImage for IMG/CANVAS)
 * ├─ pseudo-element → drawBackground + drawBorder + (drawText if has text)
 * └─ text          → drawText
 */

import { drawBackground } from './background';
import { drawBorder } from './border';
import { drawImage } from './image';
import { drawText } from './text';

/**
 * 渲染背景和边框（element 和 pseudo-element 共用）
 * @param {Object} params.node - 调整后的节点（y 为页内坐标）
 * @param {Object} params.ctx
 * @param {boolean} params.isLastSpill
 */
function renderBackgroundAndBorder({ node, ctx, isLastSpill }) {
  const { contentHeight } = ctx;
  drawBackground({
    node,
    ctx,
    clipBottom: contentHeight,
    isLastSpill,
  });
  drawBorder({
    node,
    ctx,
    clipBottom: contentHeight,
    isLastSpill,
  });
}

/**
 * 渲染单个节点到 PDF
 * @param {Object} params.node           - 节点（y 为全局坐标）
 * @param {Object} params.ctx            - 渲染上下文
 * @param {number} [params.offsetYpx=0]  - 当前页内容区起始全局 y（px）
 * @param {Array}  [params.sortedFontConfig=[]] - 排序后的字体配置
 * @param {boolean}[params.isLastSpill=true]    - 是否是该节点的最后一个 spill placement
 */
export function renderNode({
  node,
  ctx,
  offsetYpx = 0,
  sortedFontConfig = [],
  isLastSpill = true,
}) {
  // 1. 坐标转换：全局 → 页内
  const { toMM } = ctx;
  const relativeYpx = node.y - offsetYpx;
  const relativeYmm = toMM(relativeYpx);

  // 2. 边界检查：跳过完全在当前页之外的节点
  // 条件：节点顶部和底部都在页面顶部以上（负坐标且底部也是负数）
  if (relativeYmm < 0 && relativeYmm + toMM(node.height) <= 0) {
    return;
  }

  // 3. 创建页内坐标的节点副本
  const adjustedNode = { ...node, y: relativeYpx };

  // 公共渲染参数
  const commonParams = {
    node: adjustedNode,
    ctx,
    isLastSpill,
  };

  // 4. 根据节点类型调度渲染
  if (adjustedNode.type === 'element') {
    // 普通元素：背景 + 边框 + (图片)
    renderBackgroundAndBorder(commonParams);

    if (adjustedNode.tag === 'IMG' || adjustedNode.tag === 'CANVAS') {
      drawImage({ node: adjustedNode, ctx, offsetYpx });
    }
  } else if (adjustedNode.type === 'pseudo-element') {
    // 伪元素：背景 + 边框 + (文本)
    renderBackgroundAndBorder(commonParams);

    if (adjustedNode.text) {
      drawText({
        node: adjustedNode,
        ctx,
        clipTop: 0,
        sortedFontConfig,
      });
    }
  } else if (adjustedNode.type === 'text') {
    // 文本节点：直接渲染文本
    drawText({
      node: adjustedNode,
      ctx,
      clipTop: 0,
      sortedFontConfig,
    });
  }
}
