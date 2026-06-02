// document-cloner.js
// 把整个 documentElement 克隆进隐藏 iframe，在克隆副本上加 margin-top 实现强制分页
// 原始 DOM 完全不受影响

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
 */
function loadImageAsBase64(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx2d = canvas.getContext('2d');
      ctx2d.drawImage(img, 0, 0);

      // 检测是否有透明像素（alpha < 255）
      let hasAlpha = false;
      try {
        const pixels = ctx2d.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        for (let i = 3; i < pixels.length; i += 4) {
          if (pixels[i] < 255) {
            hasAlpha = true;
            break;
          }
        }
      } catch (_) {
        // 跨域图片无法读取像素，保守用 PNG
        hasAlpha = true;
      }

      resolve({
        src: hasAlpha
          ? canvas.toDataURL('image/png')
          : canvas.toDataURL('image/jpeg', 0.92),
        format: hasAlpha ? 'PNG' : 'JPEG',
        w: img.naturalWidth,
        h: img.naturalHeight,
      });
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
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

      // IMG 标签 src → base64
      if (e.tag === 'IMG' && e._el?.src) {
        tasks.push(
          new Promise((resolve) => {
            const imgEl = e._el;
            const canvas = document.createElement('canvas');
            canvas.width = imgEl.naturalWidth || imgEl.width;
            canvas.height = imgEl.naturalHeight || imgEl.height;
            canvas.getContext('2d').drawImage(imgEl, 0, 0);
            e.src = canvas.toDataURL('image/jpeg', 0.92);
            resolve();
          }),
        );
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
 * @param {Element} element      - 原始根元素
 * @param {Array}   fontConfig   - 字体配置数组
 * @returns {Promise<{iframe: HTMLIFrameElement, cloneRoot: Element}>}
 */
export async function createClonedDocument(element, fontConfig = []) {
  const ownerDoc = element.ownerDocument;

  // Step 1: 先打标记再克隆，clone 里会带有该标记
  const markAttr = 'data-htmlpdf-root';
  element.setAttribute(markAttr, '1');
  const docElClone = ownerDoc.documentElement.cloneNode(true);
  element.removeAttribute(markAttr); // 立即从原始 DOM 移除，不影响页面

  // Step 2: 创建隐藏 iframe
  const iframe = ownerDoc.createElement('iframe');
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
  iframeDoc.open();
  iframeDoc.write('<!DOCTYPE html><html></html>');
  iframeDoc.close();

  iframeDoc.replaceChild(
    iframeDoc.adoptNode(docElClone),
    iframeDoc.documentElement,
  );

  // Step 3.5: 注入字体样式（新增）
  await injectFontsToDocument(iframeDoc, fontConfig);

  // Step 4: 等待 layout 稳定 + 图片加载
  await waitForLayout();
  await waitForImages(iframeDoc);

  // Step 5: 找到克隆根元素
  const cloneRoot = iframeDoc.querySelector(`[${markAttr}]`);
  if (!cloneRoot) {
    throw new Error('[htmlpdf] 无法在克隆文档中定位根元素');
  }

  return { iframe, cloneRoot };
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
