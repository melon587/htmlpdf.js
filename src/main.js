import {
  createContext,
  createClonedDocument,
  collectNodes,
  preloadImages,
  destroyClonedDocument,
  loadFontsToJsPDF,
  renderHeaderFooter,
} from './core';
import { createRepeatHeaderManager } from './core/repeat-header-manager';
import { streamPaginate } from './core/stream-pagination';
import { renderNode } from './render/node';

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
 * @param {Array}  [options.repeatHeaders] - 需要重复表头的表格配置，例如: ['#table1', { container: '#table2', header: '.my-header' }]
 * @returns {Promise<Blob|string|ArrayBuffer>}
 */
export async function htmlpdf(element, options = {}) {
  const startTime = performance.now();
  console.log('[htmlpdf] Start converting...');

  const {
    output = 'blob',
    fonts = [],
    header,
    footer,
    repeatHeaders = [],
  } = options;

  // 创建上下文 用于调用jsPDF的api
  const ctx = createContext(element, options);
  const { doc, scale, contentHeight } = ctx;

  // 计算内容区高度对应的 px 值，用于 page-break / repeat-header 坐标计算。
  const pageHeightPx = contentHeight / scale;

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

  // 🔍 调试：打印 repeatHeaders 配置
  console.log('[htmlpdf] repeatHeaders config:', repeatHeaders);

  // 创建 repeat-header 管理器
  const repeatHeaderManager =
    repeatHeaders.length > 0
      ? createRepeatHeaderManager(nodes, pageHeightPx, repeatHeaders)
      : null;

  console.log(
    '[htmlpdf] RepeatHeaderManager initialized:',
    repeatHeaderManager?.hasHeaders() ? 'Yes' : 'No',
  );

  // 🆕 使用流式分页计算渲染方案
  const paginationPlan = streamPaginate({
    nodes,
    ctx,
    contentHeight,
    fonts,
    repeatHeaderManager,
  });

  const {
    totalPages,
    nodePlacements,
    headerPlacements,
    sortedFontConfig,
    fallbackFontFamily,
  } = paginationPlan;

  console.log('[htmlpdf] Pagination plan:', {
    totalPages,
    nodePlacements: nodePlacements.length,
    headerPlacements: headerPlacements.length,
  });

  // 合并所有渲染计划（header 优先渲染）
  const allPlacements = [...headerPlacements, ...nodePlacements];

  // 按页码排序
  allPlacements.sort((a, b) => a.page - b.page);

  // 执行渲染
  let currentPage = 0;
  for (const placement of allPlacements) {
    // 切换到目标页
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
      sortedFontConfig,
      fallbackFontFamily,
    });
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

  const endTime = performance.now();
  const elapsed = (endTime - startTime).toFixed(2);
  console.log(`[htmlpdf] ✅ Conversion completed in ${elapsed}ms`);

  return result;
}

