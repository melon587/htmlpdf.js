import {
  createContext,
  createClonedDocument,
  collectNodes,
  preloadImages,
  destroyClonedDocument,
  loadFontsToJsPDF,
  applyPageBreaks,
  collectRepeatHeaderMeta,
  createPages,
  renderHeaderFooter,
} from './core';
import { renderNodes } from './render';

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
  const { doc, scale, contentHeight, toMM } = ctx;

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

  // 处理 page-break 元素 重新定位全部元素（直接修改 nodes[i].y）
  applyPageBreaks(nodes, pageHeightPx);

  // 收集 repeat-header 元信息 用于渲染节点
  const repeatHeaderMeta = collectRepeatHeaderMeta(
    nodes,
    pageHeightPx,
    repeatHeaders,
  );

  // 创建页 + 渲染内容节点（Pass2 会动态渲染表头副本）
  const totalPages = createPages(doc, nodes, toMM, contentHeight);

  renderNodes({
    doc,
    nodes,
    ctx,
    contentHeight,
    fonts,
    repeatHeaderMeta,
  });

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
