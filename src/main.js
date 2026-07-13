/**
 * @file main.js
 * htmlpdf 主入口：HTML → PDF 转换流程编排
 *
 * ## 整体流程
 *
 * htmlpdf(element, options)
 * │
 * ├─ 1. 创建上下文                      createContext() - 初始化 jsPDF、计算页面尺寸
 * │
 * ├─ 2. 克隆 DOM                        createClonedDocument() - 克隆到 iframe，注入字体
 * │
 * ├─ 3. 解析节点树                      collectNodes() - DOM → 节点树（带坐标、样式）
 * │   └─ 预加载图片                      preloadImages() - 确保图片加载完成
 * │
 * ├─ 4. 销毁克隆文档                    destroyClonedDocument() - 释放 iframe
 * │
 * ├─ 5. 加载字体到 jsPDF                loadFontsToJsPDF() - 注册自定义字体
 * │
 * ├─ 6. tables 配置预处理
 * │   ├─ createRepeatHeaderManager()    建立 repeat-header 管理器
 * │   └─ buildPageBreakBorderMap()      建立 pageBreakBorder 映射
 * │
 * ├─ 7. 流式分页                        streamPaginate() - 计算分页方案
 * │   └─ 返回 { nodePlacements, headerPlacements, totalPages, ... }
 * │
 * ├─ 8. 归并排序 placements             按页码、类型排序（spill < repeat-header < normal）
 * │
 * ├─ 9. 收集 spill 闭合线               collectPageBreakLines() - 跨页元素的底部边框
 * │
 * ├─ 10. 渲染所有节点                   逐个 placement 调用 renderNode()
 * │
 * ├─ 11. 绘制 spill 闭合线              drawSpillClosingLines() - 在页面底部绘制边框
 * │
 * ├─ 12. 渲染 header/footer             renderHeaderFooter() - 用户自定义页眉页脚
 * │
 * └─ 13. 输出                           doc.output() - 返回 Blob/DataURL/ArrayBuffer
 *
 * ## 核心概念
 *
 * ### placement（渲染计划）
 * 分页策略输出的渲染计划，每个 placement 描述"在哪一页、用什么偏移、渲染哪个节点"：
 * - type: 'normal' | 'spill' | 'repeat-header' | 'repeat-header-child'
 * - page: 页码（1-based）
 * - node: 要渲染的节点
 * - offsetYpx: 该页内容区起点的全局 Y 坐标（px）
 * - isLastSpill: 是否是最后一页的 spill（用于渲染底部边框）
 *
 * ### 渲染顺序（同页内）
 * spill(0) < repeat-header(1) < normal(2)
 * - spill 最先渲染：背景/边框垫底
 * - repeat-header 次之：表头在背景之上
 * - normal 最后渲染：内容覆盖在最上层
 *
 * ### spill 闭合线（pageBreakBorder）
 * 跨页元素在页面出口处的底部边框（视觉上"封闭"容器），避免内容看起来像被截断。
 * 在所有节点渲染完后绘制，避免被后续内容覆盖。
 *
 * ## 进度追踪
 *
 * 通过 tick(stage, progress) 函数报告进度：
 * - 0.2: clone - DOM 克隆完成
 * - 0.4: images - 图片预加载完成
 * - 0.5: fonts - 字体加载完成
 * - 0.7: paginate - 分页计算完成
 * - 0.9: render - 节点渲染完成
 * - 1.0: output - 输出完成
 */

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
  collectPageBreakLines,
  getPageBreakLinesMap,
} from './core';
import { renderNode, drawSpillClosingLines } from './render';
import { getOutputType } from './utils';

/**
 * 计算 placement 的渲染顺序权重（同页内）
 *
 * 权重规则：
 * - spill: 0（背景/边框，最先渲染）
 * - repeat-header / repeat-header-child: 1（表头，次之）
 * - normal: 2（正常内容，最后渲染）
 *
 * 目的：确保背景垫底，表头在背景之上，内容覆盖在最上层
 *
 * @param {Object} p - placement 对象
 * @returns {number} 权重值（0-2）
 */
function placementOrder(p) {
  if (p.type === 'spill') return 0;

  if (p.type === 'repeat-header' || p.type === 'repeat-header-child') return 1;

  return 2;
}

/**
 * placement 排序比较函数
 *
 * 排序规则：
 * 1. 先按页码升序排列（第1页 → 第2页 → ...）
 * 2. 同页内按 placementOrder 升序排列（spill → repeat-header → normal）
 *
 * @param {Object} a - placement A
 * @param {Object} b - placement B
 * @returns {number} 比较结果（负数/0/正数）
 */
function comparePlacements(a, b) {
  if (a.page !== b.page) return a.page - b.page;

  return placementOrder(a) - placementOrder(b);
}

/**
 * 创建进度追踪器
 *
 * 返回 tick(stage, progress) 函数，每次调用时：
 * 1. 输出分段计时日志（debug 模式下）：[htmlpdf] stage: totalMs (+deltaMs)
 * 2. 触发 onProgress 回调（如果有）
 *
 * @param {Object} options - htmlpdf 选项
 * @param {boolean} options.debug - 是否输出计时日志
 * @param {Function} options.onProgress - 进度回调 ({ stage, progress }) => void
 * @returns {Function} tick(stage, progress) - 进度报告函数
 */
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
 * 确保 PDF 文档有指定页，并切换到该页
 *
 * 逻辑：
 * - targetPage <= currentPage：直接 setPage（页面已存在）
 * - targetPage > currentPage：先 addPage 创建缺失页，再 setPage
 *
 * 注意：第一页由 jsPDF 自动创建，pagesToAdd 计算时需要考虑
 *
 * @param {Object} doc - jsPDF 实例
 * @param {number} targetPage - 目标页码（1-based）
 * @param {number} currentPage - 当前页码（0 表示还没渲染任何页）
 */
function ensurePage(doc, targetPage, currentPage) {
  if (targetPage <= currentPage) {
    doc.setPage(targetPage);

    return;
  }

  // 第一页由 jsPDF 自动创建，pagesToAdd 从 max(currentPage,1) 开始计算
  const pagesToAdd = targetPage - Math.max(currentPage, 1);
  for (let i = 0; i < pagesToAdd; i++) doc.addPage();

  doc.setPage(targetPage);
}

/**
 * 主函数：将 HTML 元素转换为 PDF
 *
 * 完整流程参见文件头部的流程图。
 *
 * @param {Element} element - 要转换的 DOM 元素
 * @param {Object} options - 配置选项
 *
 * @param {string} [options.output='blob'] - 输出格式
 *   - 'blob': Blob 对象（默认）
 *   - 'dataurl': Data URI 字符串
 *   - 'arraybuffer': ArrayBuffer
 *
 * @param {string} [options.format='a4'] - 页面格式（jsPDF 支持的任意格式，如 'a4', 'letter', [width, height]）
 * @param {string} [options.orientation='portrait'] - 页面方向（'portrait' | 'landscape'）
 * @param {number} [options.margin=0] - 页边距（px，默认 0 无边距）
 * @param {boolean} [options.compress=true] - 是否启用 PDF 压缩
 *
 * @param {Object} [options.header] - 页眉配置
 *   - height: number (mm) - 页眉高度
 *   - render: (doc, { pageNumber, totalPages, pageWidth, pageHeight, margin }) => void
 *
 * @param {Object} [options.footer] - 页脚配置
 *   - height: number (mm) - 页脚高度
 *   - render: (doc, { pageNumber, totalPages, pageWidth, pageHeight, margin }) => void
 *
 * @param {Array} [options.fonts] - 字体配置数组
 *   每项包含：{ fontFamily, url, format, priority, isDefault, unicodeRange }
 *
 * @param {Array} [options.tables] - 表格配置数组
 *   每项包含：{ selector, repeatHeader, pageBreakBorder }
 *   例如: [{ selector: '.my-table', repeatHeader: 'thead', pageBreakBorder: '1px solid #ccc' }]
 *
 * @param {boolean} [options.debug=false] - 是否输出分段计时日志
 * @param {Function} [options.onProgress] - 进度回调 ({ stage, progress: 0~1 }) => void
 *
 * @returns {Promise<Blob|string|ArrayBuffer>} PDF 输出（格式由 options.output 决定）
 */
export async function htmlpdf(element, options = {}) {
  const tick = initProgressTracker(options);

  const { output = 'blob', fonts = [], header, footer, tables = [] } = options;

  // 创建上下文 用于调用jsPDF的api
  const ctx = createContext(element, options);
  const { doc, contentHeight } = ctx;

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
  await loadFontsToJsPDF(doc, fonts);
  tick('fonts', 0.5);

  // ── tables 配置预处理（与分页无关，提前建立映射）────────────────────────────
  // 创建 repeat-header 管理器（无 repeatHeader 配置时返回 null）
  const repeatHeaderManager = createRepeatHeaderManager(nodes, tables);
  // 构建 pageBreakLines 映射（WeakMap，不污染 node）
  const pageBreakBorderMap = getPageBreakLinesMap(nodes, tables);

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

  // 合并所有 placement 并按页码、类型排序（spill < repeat-header < normal）
  const allPlacements = [...headerPlacements, ...nodePlacements].sort(
    comparePlacements,
  );
  tick('paginate', 0.7);

  // 收集 spill 闭合线（按页分组）
  const spillClosingLinesByPage = collectPageBreakLines({
    nodes,
    allPlacements,
    ctx,
    contentHeight,
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
      doc,
      node: placement.node,
      ctx,
      offsetYpx: placement.offsetYpx,
      contentHeight,
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
        pageBreakBorder: pageBreakBorderMap.get(node),
      });
    }
  }

  // 逐页调用 header/footer render 回调
  if (header || footer) {
    renderHeaderFooter(doc, { totalPages, ctx, header, footer });
  }

  tick('render', 0.9);

  const outputType = getOutputType(output);

  const result = doc.output(outputType);

  tick('output', 1.0);

  return result;
}
