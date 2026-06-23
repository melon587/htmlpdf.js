import {
  createContext,
  createClonedDocument,
  collectNodes,
  preloadImages,
  destroyClonedDocument,
  loadFontsToJsPDF,
  renderHeaderFooter,
  createRepeatHeaderManager,
  streamPaginate,
} from './core';
import {
  renderNode,
  drawSpillClosingLines,
  collectPageBreakLines,
} from './render';
import { matchesSelector } from './utils';

/**
 * 对每个配置了 pageBreakBorder 的表格，找到对应的容器节点并打上标记。
 * 只标记容器节点本身，不传播到子节点，避免多次重复画线。
 */
function markPageBreakBorderNodes(nodes, tables) {
  tables
    .filter((t) => t.pageBreakBorder)
    .forEach((tableConf) => {
      const containerNode = nodes.find((n) =>
        matchesSelector(n._origEl, tableConf.selector),
      );

      if (containerNode) {
        containerNode._pageBreakBorder = tableConf.pageBreakBorder;
      }
    });
}

/**
 * 确保 PDF 文档有指定页，并切换到该页
 */
function ensurePage(doc, targetPage, currentPage) {
  if (targetPage > 1 && currentPage === 0) {
    // 第一页不需要 addPage
    doc.setPage(1);
  } else if (targetPage > currentPage) {
    // 需要新增页面
    for (let p = currentPage + 1; p <= targetPage; p++) {
      if (p > 1) doc.addPage();

      doc.setPage(p);
    }
  } else {
    doc.setPage(targetPage);
  }
}

/**
 * 主函数：将 HTML 元素转换为 PDF
 * @param {Element} element - 要转换的 DOM 元素
 * @param {Object} options - 配置选项
 * @param {string} [options.output='blob'] - 输出格式：'blob' | 'dataurl' | 'arraybuffer'
 * @param {string} [options.format='a4'] - 页面格式（jsPDF 支持的任意格式）
 * @param {string} [options.orientation='portrait'] - 页面方向：'portrait' | 'landscape'
 * @param {number} [options.margin=0] - 页边距（px，默认 0 无边距）
 * @param {boolean} [options.compress=true] - 是否启用 PDF 压缩
 * @param {Object} [options.header] - 页眉配置 { height: mm, render(doc, { pageNumber, totalPages, pageWidth, pageHeight, margin }) }
 * @param {Object} [options.footer] - 页脚配置 { height: mm, render(doc, { pageNumber, totalPages, pageWidth, pageHeight, margin }) }
 * @param {Array}  [options.fonts] - 字体配置数组
 * @param {Array}  [options.tables] - 表格配置数组，例如: [{ selector: '.my-table', repeatHeader: 'thead', pageBreakBorder: '1px solid #ccc' }]
 * @returns {Promise<Blob|string|ArrayBuffer>}
 */
export async function htmlpdf(element, options = {}) {
  const startTime = performance.now();

  const { output = 'blob', fonts = [], header, footer, tables = [] } = options;

  // 创建上下文 用于调用jsPDF的api
  const ctx = createContext(element, options);
  const { doc, contentHeight } = ctx;

  // 克隆目标元素（传入 fonts，注入字体到克隆文档）
  const { iframe, cloneRoot } = await createClonedDocument(element, fonts);

  let nodes;
  try {
    nodes = collectNodes(element, cloneRoot);
    await preloadImages(nodes); // 在 iframe 销毁前预加载图片
  } finally {
    destroyClonedDocument(iframe);
  }

  // 加载自定义字体到 jsPDF 用于渲染pdf时可以选择对应的字体
  await loadFontsToJsPDF(doc, fonts);

  // 创建 repeat-header 管理器
  const tablesWithRepeatHeader = tables.filter((t) => t.repeatHeader);
  const repeatHeaderManager =
    tablesWithRepeatHeader.length > 0
      ? createRepeatHeaderManager(nodes, tables)
      : null;

  // 使用流式分页计算渲染方案
  const {
    totalPages,
    nodePlacements,
    headerPlacements,
    sortedFontConfig,
    fallbackFontFamily,
  } = streamPaginate({
    nodes,
    ctx,
    contentHeight,
    fonts,
    repeatHeaderManager,
  });

  // 合并所有 placement 并排序：先按页码，同页内 spill < repeat-header < normal
  const allPlacements = [...headerPlacements, ...nodePlacements].sort(
    (a, b) => {
      if (a.page !== b.page) return a.page - b.page;

      // 同页内：spill 最先（背景/边框垫底），repeat-header 次之，normal 最后
      const typeOrder = (p) => {
        if (p.type === 'spill') return 0;

        if (p.type === 'repeat-header' || p.type === 'repeat-header-child')
          return 1;

        return 2;
      };

      return typeOrder(a) - typeOrder(b);
    },
  );

  // 构建 pageBreakBorder 映射
  markPageBreakBorderNodes(nodes, tables);

  // 收集 spill 闭合线（按页分组），O(N+P) 替代原 O(n²) 嵌套扫描
  const spillClosingLinesByPage = collectPageBreakLines(
    nodes,
    allPlacements,
    ctx,
    contentHeight,
  );

  // 执行渲染
  let currentPage = 0;
  for (const placement of allPlacements) {
    if (placement.page !== currentPage) {
      ensurePage(doc, placement.page, currentPage);
      currentPage = placement.page;
    }

    renderNode({
      doc,
      node: placement.node,
      ctx,
      offsetYpx: placement.offsetYpx,
      contentHeight,
      clipTopPx: placement.clipTopPx || 0,
      sortedFontConfig,
      fallbackFontFamily,
      isLastSpill: placement.isLastSpill,
    });
  }

  // 逐页绘制出口闭合线（在所有节点渲染完后画，避免被覆盖）
  for (let page = 1; page <= totalPages; page++) {
    const spillLines = spillClosingLinesByPage.get(page);
    if (!spillLines || spillLines.length === 0) continue;

    doc.setPage(page);
    for (const { node, offsetYpx, exitAtPx } of spillLines) {
      const clipBottomMM = ctx.toMM(exitAtPx - offsetYpx);
      drawSpillClosingLines({
        doc,
        node,
        ctx,
        clipBottom: clipBottomMM,
        pageBreakBorder: node._pageBreakBorder,
      });
    }
  }

  // 逐页调用 header/footer render 回调
  if (header || footer) {
    renderHeaderFooter(doc, { totalPages, ctx, header, footer });
  }

  // 输出
  let result;
  if (output === 'dataurl') result = doc.output('datauristring');
  else if (output === 'arraybuffer') result = doc.output('arraybuffer');
  else result = doc.output('blob');

  const elapsed = (performance.now() - startTime).toFixed(2);
  // eslint-disable-next-line no-console
  console.log(`[htmlpdf] Conversion completed in ${elapsed}ms`);

  return result;
}
