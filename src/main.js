/**
 * @file main.js
 * htmlpdf 主入口：HTML → PDF 转换流程编排
 *
 * htmlpdf(element, options)
 * ├─ 1. initContext()               初始化 jsPDF、计算页面尺寸
 * ├─ 2. createClonedDocument()      克隆 DOM 到 iframe，注入字体
 * ├─ 3. collectNodes()              DOM → 节点树（带坐标、样式）
 * │   └─ preloadImages()            预加载图片（iframe 销毁前）
 * ├─ 4. destroyClonedDocument()     释放 iframe
 * ├─ 5. loadFontsToJsPDF()          注册自定义字体
 * ├─ 6. createRepeatHeaderManager() 建立 repeat-header 管理器
 * │   getPageBreakLinesMap()        建立 pageBreakBorder 映射
 * ├─ 7. streamPaginate()            流式分页，生成 allPlacements
 * ├─ 8. collectPageBreakLines()     收集跨页表格闭合线
 * ├─ 9. renderNode()                逐 placement 渲染节点
 * ├─ 10. drawSpillClosingLines()    逐页绘制出口闭合线
 * ├─ 11. renderHeaderFooter()       渲染页眉页脚
 * └─ 12. ctx.output()               输出 Blob/DataURL/ArrayBuffer
 */

import {
  initContext,
  createClonedDocument,
  collectNodes,
  preloadImages,
  destroyClonedDocument,
  loadFontsToJsPDF,
  renderHeaderFooter,
  createRepeatHeaderManager,
  streamPaginate,
  collectPageBreakLines,
  getPageBreakLinesMap,
} from './core';
import { renderNode, drawSpillClosingLines } from './render';

/** 进度追踪器，返回 tick(stage, progress)，支持 debug 计时和 onProgress 回调 */
function initProgressTracker(options) {
  const { debug = false, onProgress } = options;
  const startTime = performance.now();
  let lastT = startTime;

  return function tick(stage, progress) {
    const now = performance.now();
    if (debug) {
      const total = (now - startTime).toFixed(1);
      const delta = (now - lastT).toFixed(1);
      console.log(`[htmlpdf] ${stage}: ${total}ms (+${delta}ms)`);
    }

    if (onProgress) onProgress({ stage, progress });

    lastT = now;
  };
}

/**
 * 确保 PDF 文档存在目标页并切换到该页
 * @param {Object} doc - jsPDF 实例
 * @param {number} targetPage - 目标页码（1-based）
 * @param {number} currentPage - 当前页码（0 表示尚未渲染任何页）
 */
function ensurePage(doc, targetPage, currentPage) {
  if (targetPage <= currentPage) {
    doc.setPage(targetPage);

    return;
  }

  // 第一页由 jsPDF 自动创建，pagesToAdd 从 max(currentPage,1) 开始计算
  const pagesToAdd = targetPage - Math.max(currentPage, 1);
  for (let i = 0; i < pagesToAdd; i += 1) {
    doc.addPage();
  }

  doc.setPage(targetPage);
}

/**
 * 将 HTML 元素转换为 PDF
 *
 * @param {Element} element - 要转换的 DOM 元素
 * @param {Object} [options]
 * @param {string} [options.output='blob'] - 'blob' | 'dataurl' | 'arraybuffer'
 * @param {string} [options.format='a4'] - 页面格式
 * @param {string} [options.orientation='portrait'] - 'portrait' | 'landscape'
 * @param {number} [options.margin=0] - 页边距（px）
 * @param {boolean} [options.compress=true] - 是否压缩
 * @param {Object} [options.header] - { height: mm, render: (doc, info) => void }
 * @param {Object} [options.footer] - { height: mm, render: (doc, info) => void }
 * @param {Array}  [options.fonts] - 字体配置数组
 * @param {Array}  [options.tables] - 表格配置数组 [{ selector, repeatHeader, pageBreakBorder }]
 * @param {boolean} [options.debug=false] - 输出分段计时日志
 * @param {Function} [options.onProgress] - ({ stage, progress: 0~1 }) => void
 * @returns {Promise<Blob|string|ArrayBuffer>}
 */
export async function htmlpdf(element, options = {}) {
  // 初始化进度监控
  const tick = initProgressTracker(options);

  const { output = 'blob', fonts = [], header, footer, tables = [] } = options;

  // 初始化jsPDF上下文 用于调用api
  const ctx = initContext(element, options);
  const { doc, toMM } = ctx;

  // 克隆目标元素（传入 fonts，注入字体到克隆文档）
  const { iframe, cloneRoot } = await createClonedDocument(element, fonts);
  tick('clone', 0.2);

  let nodes;
  try {
    nodes = collectNodes(element, cloneRoot);
    await preloadImages(nodes); // 在 iframe 销毁前预加载图片
  } finally {
    destroyClonedDocument(iframe);
  }
  tick('images', 0.4);

  // 加载自定义字体到 jsPDF 用于渲染pdf时可以选择对应的字体
  await loadFontsToJsPDF(ctx, fonts);
  tick('fonts', 0.5);

  // ── tables 配置预处理（与分页无关，提前建立映射）────────────────────────────
  // 创建 repeat-header 管理器（无 repeatHeader 配置时返回 null）
  const repeatHeaderManager = createRepeatHeaderManager(nodes, tables);
  // 构建 pageBreakLines 映射（WeakMap，不污染 node）
  const pageBreakBorderMap = getPageBreakLinesMap(nodes, tables);

  // 使用流式分页计算渲染方案
  const { totalPages, allPlacements, sortedFontConfig } = streamPaginate({
    nodes,
    ctx,
    fonts,
    repeatHeaderManager,
  });

  tick('paginate', 0.7);

  // 收集 spill 闭合线（按页分组）
  const spillClosingLinesByPage = collectPageBreakLines({
    nodes,
    allPlacements,
    ctx,
    pageBreakBorderMap,
  });

  // 执行渲染
  let currentPage = 0;
  for (const placement of allPlacements) {
    if (placement.page !== currentPage) {
      ensurePage(doc, placement.page, currentPage);
      currentPage = placement.page;
    }

    renderNode({
      node: placement.node,
      ctx,
      offsetYpx: placement.offsetYpx,
      sortedFontConfig,
      isLastSpill: placement.isLastSpill,
    });
  }

  // 逐页绘制出口闭合线（在所有节点渲染完后画，避免被覆盖）
  if (spillClosingLinesByPage.size > 0) {
    for (let page = 1; page <= totalPages; page += 1) {
      const spillLines = spillClosingLinesByPage.get(page);
      if (!spillLines || spillLines.length === 0) continue;

      doc.setPage(page);
      for (const { node, offsetYpx, exitAtPx } of spillLines) {
        const clipBottomMM = toMM(exitAtPx - offsetYpx);
        drawSpillClosingLines({
          node,
          ctx,
          clipBottom: clipBottomMM,
          pageBreakBorder: pageBreakBorderMap.get(node),
        });
      }
    }
  }

  // 逐页调用 header/footer render 回调
  if (header || footer) {
    renderHeaderFooter(doc, { totalPages, ctx, header, footer });
  }

  tick('render', 0.9);

  const result = ctx.output(output);

  tick('output', 1.0);

  return result;
}
