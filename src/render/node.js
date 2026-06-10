import { drawBackground } from './background';
import { drawBorder } from './border';
import { drawImage } from './image';
import { drawText } from './text';
import { drawRepeatHeaders, applyHeaderOffset } from './repeat-headers';

/**
 * 渲染单个节点到 PDF（支持跨页裁剪）
 * @param {Object} doc - jsPDF 实例
 * @param {Object} node - 节点对象
 * @param {Object} ctx - 渲染上下文
 * @param {number} pageOffsetY - 当前页顶部在内容坐标系的位置（mm）
 * @param {number} clipTop - 当前页顶部（mm，等于 pageOffsetY）
 * @param {number} clipBottom - 当前页底部（mm，等于 pageOffsetY + contentHeight）
 * @param {Array} fonts - 字体配置数组
 */
function renderNode({
  doc,
  node,
  ctx,
  pageOffsetY = 0,
  clipTop = 0,
  clipBottom = Infinity,
  sortedFontConfig = [],
  fallbackFontFamily = 'helvetica',
}) {
  if (node.type === 'element') {
    drawBackground({ doc, node, ctx, pageOffsetY, clipTop, clipBottom });
    drawBorder({ doc, node, ctx, pageOffsetY, clipTop, clipBottom });
    if (node.tag === 'IMG') drawImage({ doc, node, ctx, pageOffsetY, clipTop });
  } else if (node.type === 'text') {
    drawText({
      doc,
      node,
      ctx,
      pageOffsetY,
      clipTop,
      sortedFontConfig,
      fallbackFontFamily,
    });
  }
}

/**
 * Pass2：渲染所有节点到对应的 PDF 页
 * @param {Object} doc - jsPDF 实例
 * @param {Array} nodes - 节点数组
 * @param {Object} ctx - 渲染上下文（包含 toMM、px2pt 等工具函数）
 * @param {number} contentHeight - 单页内容区高度（mm）
 * @param {Array} fonts - 字体配置数组
 */
function renderNodes({
  doc,
  nodes,
  ctx,
  contentHeight,
  fonts = [],
  repeatHeaderMeta = [],
}) {
  const { toMM } = ctx;

  // 先寻找对应字体
  const sortedFontConfig = fonts
    .slice()
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const defaultFont = fonts.find((f) => f.isDefault);
  const fallbackFontFamily = defaultFont ? defaultFont.fontFamily : 'helvetica';

  let currentPage = -1;
  let headerHeightByPage = {};

  // 若有重复表头 渲染表头副本并构建偏移映射
  if (repeatHeaderMeta && repeatHeaderMeta.length > 0) {
    const result = drawRepeatHeaders({
      doc,
      repeatHeaderMeta,
      ctx,
      contentHeight,
      sortedFontConfig,
      fallbackFontFamily,
      currentPage,
    });

    currentPage = result.currentPage;
    headerHeightByPage = result.headerHeightByPage;
  }

  // 正常开始渲染原始节点
  for (const node of nodes) {
    const nodeYmm = toMM(node.y);
    const nodeBottomMm = toMM(node.y + node.height);
    const startPage = Math.floor(nodeYmm / contentHeight) + 1;
    const endPage = Math.ceil(nodeBottomMm / contentHeight) || 1;

    for (let p = startPage; p <= endPage; p++) {
      // 若有重复表头 节点需要偏移表头高度
      const adjustedNode = applyHeaderOffset(node, p, headerHeightByPage);

      const pageOffsetY = (p - 1) * contentHeight;
      const clipTop = pageOffsetY;
      const clipBottom = pageOffsetY + contentHeight;

      if (nodeYmm < clipBottom && nodeBottomMm > clipTop) {
        if (p !== currentPage) {
          doc.setPage(p);
          currentPage = p;
        }

        renderNode({
          doc,
          node: adjustedNode,
          ctx,
          pageOffsetY,
          clipTop,
          clipBottom,
          sortedFontConfig,
          fallbackFontFamily,
        });
      }
    }
  }

  console.log('[htmlpdf] Pass2: rendered', nodes.length, 'nodes');
}

export { renderNodes, renderNode };
