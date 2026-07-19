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
 * @param {Object} params.node       - 调整后的节点（y 为页内坐标）
 * @param {Object} params.ctx
 * @param {boolean} params.isLastSpill
 * @param {number}  params.clipBottom - 当前页内容可用高度上限（mm），由调用方传入
 */
function renderBackgroundAndBorder({ node, ctx, isLastSpill, clipBottom }) {
  drawBackground({
    node,
    ctx,
    clipBottom,
    isLastSpill,
  });
  drawBorder({
    node,
    ctx,
    clipBottom,
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
 * @param {number|null} [params.pageActualBottomPx=null]
 *   本页实际内容底部全局 y（px）。null 时回退到 ctx.contentHeight（整页高度）。
 *   avoid/before 推页时该值小于整页底部，确保背景/边框不会多画到被推走后的空白区域。
 */
export function renderNode({
  node,
  ctx,
  offsetYpx = 0,
  sortedFontConfig = [],
  isLastSpill = true,
  pageActualBottomPx = null,
}) {
  // 1. 坐标转换：全局 → 页内
  const { toMM, contentHeight } = ctx;
  const relativeYpx = node.y - offsetYpx;
  const relativeYmm = toMM(relativeYpx);

  // 2. 边界检查：跳过完全在当前页之外的节点
  // 条件：节点顶部和底部都在页面顶部以上（负坐标且底部也是负数）
  if (relativeYmm < 0 && relativeYmm + toMM(node.height) <= 0) {
    return;
  }

  // 3. 创建页内坐标的节点副本
  const adjustedNode = { ...node, y: relativeYpx };

  // 4. 计算本页背景/边框裁剪上限（mm，页内坐标）
  //    pageActualBottomPx 存在：本页实际内容底部 - 本页起始偏移 = 本页实际高度(px) → 转 mm
  //    无 pageActualBottomPx：回退到整页高度 contentHeight（自然溢出/无推页场景）
  const clipBottom = pageActualBottomPx
    ? toMM(pageActualBottomPx - offsetYpx)
    : contentHeight;

  // 公共渲染参数
  const commonParams = {
    node: adjustedNode,
    ctx,
    isLastSpill,
    clipBottom,
  };

  // 5. 根据节点类型调度渲染
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
