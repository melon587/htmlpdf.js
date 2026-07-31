/**
 * @file node.js
 * 节点渲染调度：将解析后的节点（element / pseudo-element / text）渲染到 PDF
 *
 * renderNode()
 * ├─ element       → drawBackground + drawBorder + (drawImage for IMG/CANVAS)
 * ├─ pseudo-element → drawBackground + drawBorder + (drawText if has text)
 * └─ text          → drawText
 */

import {
  drawBackground,
  pushAncestorClips,
  popAncestorClips,
} from './background';
import { drawBorder } from './border';
import { drawImage } from './image';
import { drawText } from './text';

/**
 * 渲染背景和边框（element 和 pseudo-element 共用）
 * @param {Object} params.node       - 调整后的节点（y 为页内坐标）
 * @param {Object} params.ctx
 * @param {boolean} params.isLastSpill
 * @param {number}  params.clipTop    - 当前页内容可用起点（mm），repeat-header 底部
 * @param {number}  params.clipBottom - 当前页内容可用终点（mm）
 */
function renderBackgroundAndBorder({
  node,
  ctx,
  isLastSpill,
  clipTop,
  clipBottom,
}) {
  drawBackground({
    node,
    ctx,
    clipTop,
    clipBottom,
    isLastSpill,
  });
  drawBorder({
    node,
    ctx,
    clipTop,
    clipBottom,
    isLastSpill,
  });
}

/**
 * 渲染单个节点到 PDF
 * @param {Object} params.node           - 节点（y 为全局坐标）
 * @param {Object} params.ctx            - 渲染上下文
 * @param {number} [params.offsetYpx=0]  - 当前页内容区起始全局 y（px）
 * @param {Array}  [params.fonts=[]]     - 字体配置数组
 * @param {boolean}[params.isLastSpill=true] - 是否是该节点的最后一个 spill placement
 * @param {number|null} [params.pageActualBottomPx=null]
 *   本页实际内容底部全局 y（px）。null 时回退到 ctx.contentHeight（整页高度）。
 * @param {number} [params.clipTopPx=0]
 *   本页内容区顶部偏移（px）。repeat-header 存在时等于 header 高度，
 *   确保 spill 背景不会画进 repeat-header 区域。
 */
export function renderNode({
  node,
  ctx,
  offsetYpx = 0,
  fonts = [],
  isLastSpill = true,
  pageActualBottomPx = null,
  clipTopPx = 0,
}) {
  // 1. 坐标转换：全局 → 页内
  const { toMM, contentHeight, toPdfX, toPdfYmm, contentHeightPx } = ctx;
  const relativeYpx = node.y - offsetYpx;
  const relativeYmm = toMM(relativeYpx);

  // 2. 边界检查：跳过完全在当前页之外的节点
  if (relativeYmm < 0 && relativeYmm + toMM(node.height) <= 0) {
    return;
  }

  // 3. 创建页内坐标的节点副本
  const adjustedNode = { ...node, y: relativeYpx };

  // 4. 计算本页背景/边框裁剪范围（mm，页内坐标）
  const clipTop = toMM(clipTopPx);
  const clipBottom = pageActualBottomPx
    ? toMM(pageActualBottomPx - offsetYpx)
    : contentHeight;

  // 5. 应用祖先 overflow clip（圆角裁剪）
  const pageHeightPx = pageActualBottomPx
    ? pageActualBottomPx - offsetYpx
    : contentHeightPx;
  const { doc } = ctx;
  const clipCount = pushAncestorClips({
    doc,
    ancestors: node.overflowClipAncestors,
    toMM,
    toPdfX,
    toPdfYmm,
    offsetYpx,
    pageHeightPx,
  });

  // 公共渲染参数
  const commonParams = {
    node: adjustedNode,
    ctx,
    isLastSpill,
    clipTop,
    clipBottom,
  };

  // 6. 根据节点类型调度渲染
  if (adjustedNode.type === 'element') {
    renderBackgroundAndBorder(commonParams);

    if (adjustedNode.tag === 'IMG' || adjustedNode.tag === 'CANVAS') {
      drawImage({ node: adjustedNode, ctx, offsetYpx });
    }
  } else if (adjustedNode.type === 'pseudo-element') {
    renderBackgroundAndBorder(commonParams);

    if (adjustedNode.text) {
      drawText({
        node: adjustedNode,
        ctx,
        clipTop: 0,
        sortedFontConfig: fonts,
      });
    }
  } else if (adjustedNode.type === 'text') {
    drawText({
      node: adjustedNode,
      ctx,
      clipTop: 0,
      sortedFontConfig: fonts,
    });
  }

  // 7. 释放祖先 clip 上下文
  popAncestorClips(doc, clipCount);
}
