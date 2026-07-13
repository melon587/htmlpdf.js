/**
 * @file node.js
 * 节点渲染调度模块
 *
 * ## 功能说明
 *
 * 负责将解析后的节点（element / pseudo-element / text）渲染到 PDF 页面。
 * 根据节点类型调用相应的渲染函数（background / border / image / text）。
 *
 * ## 节点类型
 *
 * 1. **element**：普通 HTML 元素
 *    - 渲染背景（drawBackground）
 *    - 渲染边框（drawBorder）
 *    - 如果是 IMG/CANVAS，渲染图片（drawImage）
 *
 * 2. **pseudo-element**：物化的伪元素（::before / ::after）
 *    - 渲染背景（drawBackground）
 *    - 渲染边框（drawBorder）
 *    - 如果有文本内容，渲染文本（drawText）
 *
 * 3. **text**：文本节点
 *    - 直接渲染文本（drawText）
 *
 * ## 坐标转换
 *
 * - 输入节点的 y 坐标是全局坐标（相对于整个文档）
 * - 通过 `node.y - offsetYpx` 转换为页内坐标
 * - 如果节点完全在当前页之外（< 0 且 + height <= 0），跳过渲染
 *
 * ## 跨页处理
 *
 * - isLastSpill：标记是否是该节点的最后一页（影响边框渲染）
 * - clipBottom 由 ctx.contentHeight 提供，无需外部传入
 */

import { drawBackground } from './background';
import { drawBorder } from './border';
import { drawImage } from './image';
import { drawText } from './text';

/**
 * 渲染背景和边框的辅助函数
 *
 * 用于减少重复代码，element 和 pseudo-element 都需要渲染背景和边框
 *
 * @param {Object} params - 渲染参数
 * @param {Object} params.node - 调整后的节点对象（y 为页内坐标）
 * @param {Object} params.ctx - 渲染上下文
 * @param {boolean} params.isLastSpill - 是否是最后一个 spill placement
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
 *
 * ## 流程
 *
 * 1. 坐标转换：全局坐标 → 页内坐标（node.y - offsetYpx）
 * 2. 边界检查：跳过完全在页面之外的节点
 * 3. 根据节点类型调度：
 *    - element → 背景 + 边框 + (图片)
 *    - pseudo-element → 背景 + 边框 + (文本)
 *    - text → 文本
 *
 * @param {Object} params - 渲染参数
 * @param {Object} params.node - 节点对象（y 为全局坐标）
 * @param {Object} params.ctx - 渲染上下文（包含 doc/toMM/toPdfX/toPdfY/contentHeight 等）
 * @param {number} [params.offsetYpx=0] - 当前页内容区起始的全局 y 坐标（px）
 * @param {Array} [params.sortedFontConfig=[]] - 排序后的字体配置（用于文本渲染）
 * @param {boolean} [params.isLastSpill=true] - 是否是该节点的最后一个 spill placement
 *
 * @example
 * renderNode({
 *   node: { type: 'element', y: 1000, height: 50, ... },
 *   ctx,
 *   offsetYpx: 800,
 *   isLastSpill: true,
 * });
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
    // 注意：getBoundingClientRect() 返回的坐标已包含 margin 影响，无需额外调整
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
