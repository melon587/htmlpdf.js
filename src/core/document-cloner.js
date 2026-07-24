/**
 * @file document-cloner.js
 * DOM 克隆和增强模块
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
 */
import { decodeCSSContent, copyPseudoStyles } from '../utils';
import { injectFontsToDocument } from './font-loader.js';
import { waitForLayout, waitForImages, waitForStyleSheets } from './wait.js';

/**
 * 传播 pdf-font 属性到当前元素（如果父元素有且当前元素没有）
 * 同时修改 CSS font-family，确保浏览器测量时的字体宽度与 PDF 渲染时一致
 * @param {Element} el - 当前元素
 */
function propagatePdfFontToElement(el) {
  if (
    !el.hasAttribute('pdf-font') &&
    el.parentElement?.hasAttribute('pdf-font')
  ) {
    el.setAttribute('pdf-font', el.parentElement.getAttribute('pdf-font'));
  }
}

/**
 * 物化元素的伪元素（::before 或 ::after）为真实 <span>
 * @param {Element} el - 父元素
 * @param {Document} doc - 文档对象
 * @param {'before'|'after'} pseudo - 伪元素类型
 * @returns {boolean} 是否创建了伪元素
 */
function materializePseudoElement(el, doc, pseudo) {
  const style = doc.defaultView.getComputedStyle(el, `::${pseudo}`);
  const content = style.content;

  if (!content || content === 'none' || content === 'normal') {
    return false;
  }

  const span = doc.createElement('span');
  span.setAttribute('data-pseudo', pseudo);
  span.textContent = decodeCSSContent(content);

  // 继承父元素的 pdf-font 属性
  if (el.hasAttribute('pdf-font')) {
    span.setAttribute('pdf-font', el.getAttribute('pdf-font'));
  }

  copyPseudoStyles(span, style);
  if (pseudo === 'before') {
    el.insertBefore(span, el.firstChild);
  } else {
    el.appendChild(span);
  }

  el.setAttribute(`data-pseudo-${pseudo}-processed`, '');

  return true;
}

/**
 * 增强克隆的 DOM：pdf-font 传播 + 伪元素物化
 * 1. 传播 pdf-font 时，父元素已经处理过了，只需从直接父元素复制
 * 2. 物化伪元素时，父元素已经有 pdf-font 属性，子 span 可以直接继承
 * 3. 禁用原来的伪元素
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
    if (materializePseudoElement(el, doc, 'before')) {
      hasProcessedBefore = true;
    }

    // 任务 3: 物化 ::after 伪元素
    if (materializePseudoElement(el, doc, 'after')) {
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
 * 创建克隆文档
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
    // getBoundingClientRect().width 为 0 时（元素隐藏或未布局）回退到 offsetWidth，
    // 最终兜底 800px，避免 iframe 宽度为 0 导致所有 getComputedStyle 测量失效。
    const elWidth =
      element.getBoundingClientRect().width || element.offsetWidth || 800;
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
      throw new Error('[htmlpdf] Failed to access iframe contentDocument');
    }

    // open/write/close 仅用于将文档置为可写状态，随后由 replaceChild 完整替换内容。
    // 严格 CSP（script-src）环境下 document.write() 可能抛出，此处可安全忽略。
    try {
      iframeDoc.open();
      iframeDoc.write('<!DOCTYPE html><html></html>');
      iframeDoc.close();
    } catch (_) {
      // CSP 阻止了 document.write()；replaceChild 会覆盖文档内容，无需处理。
    }

    iframeDoc.replaceChild(
      iframeDoc.adoptNode(docElClone),
      iframeDoc.documentElement,
    );

    // 设置 base URL，确保 CSS 和资源路径正确（修复 iframe 嵌套 + 相对路径问题）
    // 必须在 replaceChild 之后添加，否则会被覆盖
    const baseEl = iframeDoc.createElement('base');
    baseEl.href = ownerDoc.baseURI;
    // 插入到 <head> 的最前面，让所有后续的 <link> 标签使用正确的 base URL
    if (iframeDoc.head) {
      iframeDoc.head.insertBefore(baseEl, iframeDoc.head.firstChild);
    }

    // Step 3.5: 注入字体样式，等待字体加载完成后布局才稳定
    await injectFontsToDocument(iframeDoc, fonts);

    // Step 3.6: 找到克隆根元素，增强 DOM（传播 pdf-font + 物化伪元素）
    const cloneRoot = iframeDoc.querySelector(`[${markAttr}]`);
    if (!cloneRoot) {
      throw new Error(
        '[htmlpdf] Could not locate root element in cloned document',
      );
    }

    // 增强克隆的 DOM
    enhanceClonedDOM(cloneRoot);

    // Step 4: 等待样式表加载
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
