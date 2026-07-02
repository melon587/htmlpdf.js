/**
 * @file document-cloner.js
 * DOM 克隆和伪元素物化模块
 *
 * ## 核心功能
 *
 * 1. **DOM 克隆**：将目标元素克隆到隐藏 iframe，避免影响原始页面
 * 2. **伪元素物化**：将 CSS 伪元素（::before / ::after）转换为真实 DOM 元素
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
 *   │
 *   ├─ 4. 注入字体样式              injectFontsToDocument(iframeDoc, fonts)
 *   │   └─ 目的：确保 PDF 和浏览器使用相同字体
 *   │
 *   ├─ 5. 物化伪元素               materializePseudoElements(cloneRoot)
 *   │   ├─ TreeWalker 遍历所有元素
 *   │   ├─ getComputedStyle(el, '::before/::after')
 *   │   ├─ 创建 <span data-pseudo="before/after">
 *   │   ├─ copyPseudoStyles() 复制样式（从 utils 导入）
 *   │   └─ 注入 CSS 禁用原始伪元素（避免重复）
 *   │
 *   ├─ 6. 等待布局稳定              waitForLayout() → rAF + setTimeout
 *   │
 *   └─ 7. 等待图片加载              waitForImages(iframeDoc)
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
 * 将伪元素物化为真实 <span> 元素
 *
 * 策略:
 * 1. 复制原始样式，让浏览器自然布局
 * 2. 标记 data-pseudo 属性，供 node-parser 识别
 * 3. 给处理过的元素添加标记，并注入 CSS 规则禁用原始伪元素（避免重复渲染）
 *
 * 性能优化：直接在 TreeWalker 循环中处理，避免额外的数组分配和遍历
 */
function materializePseudoElements(root) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

  // 标记是否需要注入禁用样式
  let hasProcessedBefore = false;
  let hasProcessedAfter = false;

  // 直接在遍历中处理，不收集到数组
  let el;
  while ((el = walker.nextNode())) {
    // 处理 ::before
    const beforeStyle = doc.defaultView.getComputedStyle(el, '::before');
    const beforeContent = beforeStyle.content;

    if (
      beforeContent &&
      beforeContent !== 'none' &&
      beforeContent !== 'normal'
    ) {
      const span = doc.createElement('span');
      span.setAttribute('data-pseudo', 'before');
      span.textContent = decodeCSSContent(beforeContent);

      copyPseudoStyles(span, beforeStyle);

      // 插入到父元素开头
      el.insertBefore(span, el.firstChild);

      // 标记父元素已处理 ::before
      el.setAttribute('data-pseudo-before-processed', '');
      hasProcessedBefore = true;
    }

    // 处理 ::after
    const afterStyle = doc.defaultView.getComputedStyle(el, '::after');
    const afterContent = afterStyle.content;

    if (afterContent && afterContent !== 'none' && afterContent !== 'normal') {
      const span = doc.createElement('span');
      span.setAttribute('data-pseudo', 'after');
      span.textContent = decodeCSSContent(afterContent);

      copyPseudoStyles(span, afterStyle);

      // 追加到父元素末尾
      el.appendChild(span);

      // 标记父元素已处理 ::after
      el.setAttribute('data-pseudo-after-processed', '');
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
 *   3. 注入字体样式 → 等待字体加载（新增）
 *   4. waitForLayout 让浏览器完成一次 layout
 *   5. waitForImages 等待图片加载
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

    // Step 3.5: 注入字体样式，等待字体加载完成后布局才稳定
    await injectFontsToDocument(iframeDoc, fonts);

    // Step 3.6: 找到克隆根元素并物化伪元素
    const cloneRoot = iframeDoc.querySelector(`[${markAttr}]`);
    if (!cloneRoot) {
      throw new Error('无法在克隆文档中定位根元素');
    }

    materializePseudoElements(cloneRoot);

    // Step 4: 等待 layout 稳定 + 图片加载
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
