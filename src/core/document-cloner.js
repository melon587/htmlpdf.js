/**
 * @file document-cloner.js
 * DOM 克隆和增强模块
 *
 * ## 核心功能
 *
 * 1. **DOM 克隆**：将目标元素克隆到隐藏 iframe，避免影响原始页面
 * 2. **DOM 增强**：传播 pdf-font 属性 + 物化伪元素（一次遍历完成）
 * 3. **图片预加载**：将图片转换为 base64，支持跨页裁切
 * 4. **字体注入**：注入自定义字体到克隆文档，确保布局一致
 *
 * ## 整体流程
 *
 * createClonedDocument(element, fonts)
 *   │
 *   ├─ 1. 标记 + 克隆              element.setAttribute → cloneNode(true)
 *   │   └─ 目的：在克隆文档中定位根元素
 *   │
 *   ├─ 2. 创建隐藏 iframe           iframe (position:fixed, left:-99999px)
 *   │   └─ 目的：独立测量环境，不影响原始页面布局
 *   │
 *   ├─ 3. 写入克隆文档              iframeDoc.replaceChild(docElClone)
 *   │   └─ 设置 base URL，确保资源路径正确
 *   │
 *   ├─ 4. 注入字体样式              injectFontsToDocument(iframeDoc, fonts)
 *   │   └─ 目的：确保 PDF 和浏览器使用相同字体
 *   │
 *   ├─ 5. 增强克隆 DOM              enhanceClonedDOM(cloneRoot)
 *   │   ├─ TreeWalker 一次遍历完成（优化：减少 50% 遍历开销）
 *   │   ├─ 任务 1: 传播 pdf-font 属性（支持继承和覆盖）
 *   │   ├─ 任务 2: 物化 ::before 伪元素
 *   │   │   ├─ getComputedStyle(el, '::before')
 *   │   │   ├─ 创建 <span data-pseudo="before">
 *   │   │   ├─ 继承父元素的 pdf-font 属性
 *   │   │   └─ copyPseudoStyles() 复制样式
 *   │   ├─ 任务 3: 物化 ::after 伪元素
 *   │   └─ 注入 CSS 禁用原始伪元素（避免重复渲染）
 *   │
 *   ├─ 6. 等待样式表加载            waitForStyleSheets(iframeDoc)
 *   │   └─ 确保外部 CSS 加载完成，避免样式丢失
 *   │
 *   ├─ 7. 等待布局稳定              waitForLayout() → rAF + setTimeout
 *   │
 *   └─ 8. 等待图片加载              waitForImages(iframeDoc)
 *
 * ## pdf-font 属性传播
 *
 * **问题：** CSS `font-family` 和 PDF 字体是两个独立命名空间，用户可能用相同名字指向不同字体文件
 * **解决：** 新增 `pdf-font` 自定义属性，类似 `page-break`，直接在 HTML 中指定 PDF 字体
 *
 * **特性：**
 * - ✅ 支持继承：容器设置 `pdf-font="noto-sans-arabic"`，子元素自动继承
 * - ✅ 支持覆盖：子元素可以设置自己的 `pdf-font` 覆盖父元素
 * - ✅ 伪元素继承：物化的 `::before/::after` <span> 自动继承父元素的 `pdf-font`
 *
 * **实现：** 利用 TreeWalker 深度优先遍历（父元素先于子元素被访问），
 * 只需从直接父元素复制 `pdf-font` 属性，无需向上循环查找所有祖先。
 *
 * ## 伪元素物化策略
 *
 * **问题：** CSS 伪元素无法通过 JS 获取位置和内容
 * **解决：** 物化为真实 DOM 元素（<span data-pseudo>）
 *
 * **关键设计：**
 * - 保留原始 position/display 属性，让浏览器自然布局
 * - 注入 CSS 规则禁用原始伪元素，避免重复渲染：
 *   ```css
 *   [data-pseudo-before-processed]::before { display: none !important; }
 *   ```
 * - 标记 data-pseudo 属性，供 node-parser 识别为 pseudo-element 节点
 * - 继承父元素的 pdf-font 属性，确保字体选择正确
 *
 * **content 属性支持：**
 * - ✅ 支持：字符串值（`"text"`）、Unicode 转义（`\2713`）
 * - ❌ 不支持：counter()、counters()、attr()、url()、open-quote/close-quote
 * - 替代方案：需要计数器或动态内容时，建议用 JavaScript 生成真实 DOM 元素
 *
 * ## 图片预加载策略
 *
 * preloadImages(nodes)
 *   ├─ IMG 标签    → canvas.drawImage → toDataURL('image/jpeg')
 *   ├─ CANVAS 标签 → 直接保存 canvas 引用（检测透明度选择 PNG/JPEG）
 *   └─ background-image → loadImageAsBase64() → base64 + 原始尺寸
 *
 * **优化：**
 * - 30秒超时机制（防止无响应 URL 永久阻塞）
 * - 透明度检测（PNG/JPEG 自动选择，减小体积）
 *
 * ## 性能优化
 *
 * - ✅ 合并 TreeWalker 遍历：从 2 次降低到 1 次，减少 50% DOM 遍历开销
 * - ✅ 并行异步加载：图片、样式表、字体并行加载
 * - ✅ 智能图片格式：透明度检测，PNG/JPEG 自动选择
 *
 * ## 异常安全
 *
 * - try-catch 包裹所有异步操作
 * - 异常时自动清理 iframe，防止内存泄漏
 * - 抛出友好错误消息：`[htmlpdf] Failed to create cloned document`
 */

// document-cloner.js
// 把整个 documentElement 克隆进隐藏 iframe，在克隆副本上加 margin-top 实现强制分页
// 原始 DOM 完全不受影响

import { canvasHasAlpha, decodeCSSContent, copyPseudoStyles } from '../utils';
import { injectFontsToDocument } from './font-loader.js';

/**
 * 等待一个 rAF + setTimeout(0)，让浏览器完成 layout
 */
function waitForLayout() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

/**
 * 等待 iframe 内的图片全部加载完成
 */
async function waitForImages(iframeDoc) {
  const imgs = Array.from(iframeDoc.images).filter((img) => !img.complete);

  await Promise.all(
    imgs.map(
      (img) =>
        new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        }),
    ),
  );
}

/**
 * 等待 iframe 内的样式表全部加载完成
 *
 * 关键修复：克隆后的 <link rel="stylesheet"> 需要重新加载 CSS 文件。
 * 如果不等待加载完成，getComputedStyle() 会返回浏览器默认样式，导致 PDF 样式丢失。
 *
 * @param {Document} iframeDoc - iframe 的 document
 * @param {number} timeout - 单个样式表超时时间（毫秒），默认 10000ms
 * @returns {Promise<void>}
 */
async function waitForStyleSheets(iframeDoc, timeout = 10000) {
  const linkTags = Array.from(
    iframeDoc.querySelectorAll('link[rel="stylesheet"]'),
  );

  if (linkTags.length === 0) return;

  await Promise.all(
    linkTags.map((link) => waitForSingleStyleSheet(link, timeout)),
  );
}

/**
 * 等待单个样式表加载完成
 * @param {HTMLLinkElement} link - link 标签元素
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<void>}
 */
function waitForSingleStyleSheet(link, timeout) {
  return new Promise((resolve) => {
    let timeoutId = null;

    // 清理函数：取消定时器和事件监听器
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
    };

    // 检查样式表是否已经加载
    // 注意：跨域 CSS 无法访问 cssRules，但 link.sheet 存在说明已加载
    const isLoaded = () => {
      if (!link.sheet) return false;

      try {
        // 同域 CSS：尝试访问 cssRules 确认加载完成
        return link.sheet.cssRules && link.sheet.cssRules.length >= 0;
      } catch (e) {
        // 跨域 CSS：link.sheet 存在但无法访问 cssRules（CORS 限制）
        // 这说明样式表已经加载完成
        return true;
      }
    };

    // 如果已经加载，直接 resolve
    if (isLoaded()) {
      resolve();

      return;
    }

    // 设置超时
    timeoutId = setTimeout(() => {
      cleanup();
      console.warn(
        `[htmlpdf] Stylesheet load timeout (${timeout}ms): ${link.href}`,
      );
      resolve();
    }, timeout);

    // 监听加载事件
    link.addEventListener(
      'load',
      () => {
        cleanup();
        resolve();
      },
      { once: true },
    );

    link.addEventListener(
      'error',
      () => {
        cleanup();
        console.warn(`[htmlpdf] Stylesheet load error: ${link.href}`);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * 从 CSS backgroundImage 字符串中提取第一个 url() 的地址
 */
function parseBgImageUrl(bgImage) {
  if (!bgImage || bgImage === 'none') return null;

  const m = bgImage.match(/url\(["']?([^"')]+)["']?\)/);

  return m ? m[1] : null;
}

/**
 * 用 Image 加载 url → canvas → base64，同时记录原始尺寸
 * 自动检测透明通道：有透明像素用 PNG，否则用 JPEG（更小）
 *
 * @param {string} url - 图片 URL
 * @param {number} timeout - 超时时间（毫秒），默认 30000ms (30秒)
 * @returns {Promise<{src, format, w, h}|null>} 加载成功返回图片数据，失败/超时返回 null
 */
function loadImageAsBase64(url, timeout = 30000) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    let timeoutId = null;

    // 清理函数：移除事件监听器和定时器
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);

      img.onload = null;
      img.onerror = null;
    };

    img.onload = () => {
      cleanup();

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx2d = canvas.getContext('2d');
      ctx2d.drawImage(img, 0, 0);

      const hasAlpha = canvasHasAlpha(canvas);

      resolve({
        src: hasAlpha
          ? canvas.toDataURL('image/png')
          : canvas.toDataURL('image/jpeg', 0.92),
        format: hasAlpha ? 'PNG' : 'JPEG',
        w: img.naturalWidth,
        h: img.naturalHeight,
      });
    };

    img.onerror = () => {
      cleanup();
      console.warn(`[htmlpdf] Image load failed: ${url}`);
      resolve(null);
    };

    // 超时处理：防止无响应的图片 URL 永久阻塞
    timeoutId = setTimeout(() => {
      cleanup();
      console.warn(`[htmlpdf] Image load timeout (${timeout}ms): ${url}`);
      resolve(null);
    }, timeout);

    img.src = url;
  });
}

/**
 * 传播 pdf-font 属性到当前元素（如果父元素有且当前元素没有）
 * 同时修改 CSS font-family，确保浏览器测量时的字体宽度与 PDF 渲染时一致
 *
 * @param {Element} el - 当前元素
 * @returns {boolean} 是否传播了属性
 */
function propagatePdfFontToElement(el) {
  if (
    !el.hasAttribute('pdf-font') &&
    el.parentElement?.hasAttribute('pdf-font')
  ) {
    const pdfFont = el.parentElement.getAttribute('pdf-font');
    el.setAttribute('pdf-font', pdfFont);

    return true;
  }

  return false;
}

/**
 * 物化元素的 ::before 伪元素为真实 <span>
 * @param {Element} el - 父元素
 * @param {Document} doc - 文档对象
 * @returns {boolean} 是否创建了伪元素
 */
function materializeBeforePseudoElement(el, doc) {
  const beforeStyle = doc.defaultView.getComputedStyle(el, '::before');
  const beforeContent = beforeStyle.content;

  if (
    !beforeContent ||
    beforeContent === 'none' ||
    beforeContent === 'normal'
  ) {
    return false;
  }

  const span = doc.createElement('span');
  span.setAttribute('data-pseudo', 'before');
  span.textContent = decodeCSSContent(beforeContent);

  // 继承父元素的 pdf-font 属性
  if (el.hasAttribute('pdf-font')) {
    const pdfFont = el.getAttribute('pdf-font');
    span.setAttribute('pdf-font', pdfFont);
  }

  copyPseudoStyles(span, beforeStyle);
  el.insertBefore(span, el.firstChild);
  el.setAttribute('data-pseudo-before-processed', '');

  return true;
}

/**
 * 物化元素的 ::after 伪元素为真实 <span>
 * @param {Element} el - 父元素
 * @param {Document} doc - 文档对象
 * @returns {boolean} 是否创建了伪元素
 */
function materializeAfterPseudoElement(el, doc) {
  const afterStyle = doc.defaultView.getComputedStyle(el, '::after');
  const afterContent = afterStyle.content;

  if (!afterContent || afterContent === 'none' || afterContent === 'normal') {
    return false;
  }

  const span = doc.createElement('span');
  span.setAttribute('data-pseudo', 'after');
  span.textContent = decodeCSSContent(afterContent);

  // 继承父元素的 pdf-font 属性
  if (el.hasAttribute('pdf-font')) {
    const pdfFont = el.getAttribute('pdf-font');
    span.setAttribute('pdf-font', pdfFont);
  }

  copyPseudoStyles(span, afterStyle);
  el.appendChild(span);
  el.setAttribute('data-pseudo-after-processed', '');

  return true;
}

/**
 * 增强克隆的 DOM：一次遍历完成 pdf-font 传播 + 伪元素物化
 *
 * 性能优化：合并两次 TreeWalker 遍历为一次，减少 DOM 遍历开销
 * 代码清晰：每个任务提取为独立函数,职责单一，易于测试和维护
 *
 * 利用 TreeWalker 深度优先遍历的特性（父节点先于子节点被访问）：
 * 1. 传播 pdf-font 时，父元素已经处理过了，只需从直接父元素复制
 * 2. 物化伪元素时，父元素已经有 pdf-font 属性，子 span 可以直接继承
 *
 * @param {Element} root - 克隆文档的根元素
 */
function enhanceClonedDOM(root) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

  let hasProcessedBefore = false;
  let hasProcessedAfter = false;

  let el;
  while ((el = walker.nextNode())) {
    // 任务 1: 传播 pdf-font 属性
    propagatePdfFontToElement(el);

    // 任务 2: 物化 ::before 伪元素
    if (materializeBeforePseudoElement(el, doc)) {
      hasProcessedBefore = true;
    }

    // 任务 3: 物化 ::after 伪元素
    if (materializeAfterPseudoElement(el, doc)) {
      hasProcessedAfter = true;
    }
  }

  // 注入 CSS 规则禁用原始伪元素（避免物化的 span 和原始伪元素重复显示）
  if (hasProcessedBefore || hasProcessedAfter) {
    const style = doc.createElement('style');
    let css = '';

    if (hasProcessedBefore) {
      css +=
        '[data-pseudo-before-processed]::before { display: none !important; }\n';
    }

    if (hasProcessedAfter) {
      css +=
        '[data-pseudo-after-processed]::after { display: none !important; }\n';
    }

    style.textContent = css;
    doc.head.appendChild(style);
  }
}

/**
 * 预加载图片节点的 src 为 base64，同时处理 backgroundImage url
 * @param {Array} nodes - 节点数组（会被修改：给 IMG 节点添加 node.src，给 bg 节点添加 node.bgSrc）
 */
export async function preloadImages(nodes) {
  await Promise.all(
    nodes.map((e) => {
      if (e.type !== 'element') return null;

      const tasks = [];

      // IMG 标签：将 iframe 内已加载的图片绘到 canvas，保存 base64 和像素尺寸供渲染层使用。
      // _srcCanvas 直接作为裁切源，drawImage 无需重新解码 Image 对象。
      // IMG 通常为照片（JPEG，无透明），使用 JPEG 编码以减小体积。
      if (e.tag === 'IMG' && e._el?.src) {
        const imgEl = e._el;
        const natW = imgEl.naturalWidth || imgEl.width;
        const natH = imgEl.naturalHeight || imgEl.height;
        const canvas = document.createElement('canvas');
        canvas.width = natW;
        canvas.height = natH;
        try {
          canvas.getContext('2d').drawImage(imgEl, 0, 0);
          e.src = canvas.toDataURL('image/jpeg', 0.92);
          e.naturalWidth = natW;
          e.naturalHeight = natH;
          e._srcCanvas = canvas; // 保存全图 canvas，供 drawImage 裁切用
          e._srcFormat = 'JPEG';
        } catch (err) {
          console.warn(
            '[htmlpdf] preloadImages: canvas.drawImage failed:',
            err,
          );
        }
      }

      // CANVAS 标签：cloneNode 不复制 canvas 像素内容，_el 已指向原始 DOM 的 canvas 元素。
      // 直接将原始 canvas 作为 _srcCanvas，无需额外绘制。
      // 透明检测：扫描 alpha 通道，有透明像素用 PNG，否则用 JPEG（体积更小）
      if (e.tag === 'CANVAS' && e._el) {
        const canvasEl = e._el;
        e._srcCanvas = canvasEl;
        e.naturalWidth = canvasEl.width;
        e.naturalHeight = canvasEl.height;
        e._srcFormat = canvasHasAlpha(canvasEl) ? 'PNG' : 'JPEG';
      }

      // backgroundImage url → base64 + 原始尺寸
      const bgUrl = parseBgImageUrl(e.style?.backgroundImage);
      if (bgUrl) {
        tasks.push(
          loadImageAsBase64(bgUrl).then((result) => {
            if (result) {
              e.bgSrc = result.src;
              e.bgFormat = result.format;
              e.bgNaturalWidth = result.w;
              e.bgNaturalHeight = result.h;
            }

            return;
          }),
        );
      }

      return tasks.length ? Promise.all(tasks) : null;
    }),
  );
}

/**
 * 创建克隆文档，处理 page-break 分页
 *
 * 时序：
 *   1. 打标记 → cloneNode(true) → 移除标记   （标记会随 clone 进入副本）
 *   2. 创建 iframe → replaceChild 写入 clone
 *   3. 注入字体样式 → 等待字体加载
 *   4. 增强克隆 DOM → 传播 pdf-font + 物化伪元素（一次遍历）
 *   5. 等待样式表加载（确保外部 CSS 加载完成）
 *   6. 等待布局稳定 + 图片加载
 *
 * @param {Element} element - 原始根元素
 * @param {Array} fonts - 字体配置数组
 * @returns {Promise<{iframe: HTMLIFrameElement, cloneRoot: Element}>}
 * @throws {Error} 克隆失败时抛出异常，并自动清理 iframe（防止内存泄漏）
 */
export async function createClonedDocument(element, fonts = []) {
  const ownerDoc = element.ownerDocument;
  let iframe = null;

  try {
    // Step 1: 先打标记再克隆，clone 里会带有该标记
    const markAttr = 'data-htmlpdf-root';
    element.setAttribute(markAttr, '1');
    const docElClone = ownerDoc.documentElement.cloneNode(true);
    element.removeAttribute(markAttr); // 立即从原始 DOM 移除，不影响页面

    // Step 2: 创建隐藏 iframe
    iframe = ownerDoc.createElement('iframe');
    const elWidth = element.getBoundingClientRect().width;
    iframe.style.cssText = [
      'position:fixed',
      'top:0',
      'left:-99999px',
      `width:${elWidth}px`,
      'height:100vh',
      'border:0',
      'visibility:hidden',
      'pointer-events:none',
    ].join(';');
    iframe.setAttribute('aria-hidden', 'true');
    ownerDoc.body.appendChild(iframe);

    // Step 3: 把 clone 写入 iframe document
    const iframeDoc = iframe.contentDocument;
    if (!iframeDoc) {
      throw new Error('Failed to access iframe contentDocument');
    }

    iframeDoc.open();
    iframeDoc.write('<!DOCTYPE html><html></html>');
    iframeDoc.close();

    iframeDoc.replaceChild(
      iframeDoc.adoptNode(docElClone),
      iframeDoc.documentElement,
    );

    // 设置 base URL，确保 CSS 和资源路径正确（修复 iframe 嵌套 + 相对路径问题）
    // 必须在 replaceChild 之后添加，否则会被覆盖
    const baseEl = iframeDoc.createElement('base');
    baseEl.href = ownerDoc.baseURI || ownerDoc.location.href;
    // 插入到 <head> 的最前面，让所有后续的 <link> 标签使用正确的 base URL
    if (iframeDoc.head) {
      iframeDoc.head.insertBefore(baseEl, iframeDoc.head.firstChild);
    }

    // Step 3.5: 注入字体样式，等待字体加载完成后布局才稳定
    await injectFontsToDocument(iframeDoc, fonts);

    // Step 3.6: 找到克隆根元素，增强 DOM（传播 pdf-font + 物化伪元素）
    const cloneRoot = iframeDoc.querySelector(`[${markAttr}]`);
    if (!cloneRoot) {
      throw new Error('无法在克隆文档中定位根元素');
    }

    // 增强克隆的 DOM（优化：一次遍历完成所有任务，减少 50% DOM 遍历开销）
    enhanceClonedDOM(cloneRoot);

    // Step 4: 等待样式表加载（关键修复：确保外部 CSS 加载完成）
    await waitForStyleSheets(iframeDoc);

    // Step 5: 等待 layout 稳定 + 图片加载
    await waitForLayout();
    await waitForImages(iframeDoc);

    return { iframe, cloneRoot };
  } catch (error) {
    // 异常时清理 iframe，防止内存泄漏
    if (iframe && iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }

    // 抛出友好的错误消息
    throw new Error(
      `[htmlpdf] Failed to create cloned document: ${error.message}`,
    );
  }
}

/**
 * 销毁克隆 iframe，释放资源
 * @param {HTMLIFrameElement} iframe
 */
export function destroyClonedDocument(iframe) {
  if (iframe && iframe.parentNode) {
    iframe.parentNode.removeChild(iframe);
  }
}
