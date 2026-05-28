import {
  createContext,
  createClonedDocument,
  collectNodes,
  preloadImages,
  destroyClonedDocument,
  loadFontsToJsPDF,
  processPageBreaks,
  processRepeatHeaders,
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
 * @param {Array}  [options.fontConfig] - 字体配置数组
 * @returns {Promise<Blob|string|ArrayBuffer>}
 */
export async function htmlpdf(element, options = {}) {
  const { output = 'blob', fontConfig = [], header, footer } = options;

  // Step 1: 创建上下文
  const ctx = createContext(element, options);
  const { doc, scale, contentHeight, toMM } = ctx;

  // 计算一页内容区高度（px）
  const pageHeightPx = contentHeight / scale;

  // Step 2: 克隆文档（传入 fontConfig，注入字体到克隆文档）
  const { iframe, cloneRoot } = await createClonedDocument(element, fontConfig);

  let nodes;
  try {
    nodes = collectNodes(element, cloneRoot);
    await preloadImages(nodes); // 在 iframe 销毁前预加载图片
  } finally {
    destroyClonedDocument(iframe);
  }

  // Step 3: 加载自定义字体到 jsPDF
  await loadFontsToJsPDF(doc, fontConfig);

  // Pass0: 坐标修正（page-break + repeat-header）
  processPageBreaks(nodes, pageHeightPx);
  const extraNodes = processRepeatHeaders(nodes, pageHeightPx);
  nodes.push(...extraNodes);
  console.log('[htmlpdf] Pass0 done, extraNodes:', extraNodes.length);

  // Pass1 & 2: 创建页 + 渲染内容节点
  const totalPages = createPages(doc, nodes, toMM, contentHeight);
  renderNodes({ doc, nodes, ctx, contentHeight, fontConfig });

  // Pass3: 逐页调用 header/footer render 回调
  if (header || footer) {
    renderHeaderFooter(doc, { totalPages, ctx, header, footer });
  }

  // 输出
  if (output === 'dataurl') return doc.output('datauristring');

  if (output === 'arraybuffer') return doc.output('arraybuffer');

  return doc.output('blob');
}
