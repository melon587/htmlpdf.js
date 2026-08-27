/**
 * @file image-loader.js
 * 图片加载模块
 *
 * 负责在 iframe 销毁前将所有图片数据缓存到 node 上，供渲染层使用：
 * - IMG 标签    → loadImageAsBase64(crossOrigin) → base64 + _srcCanvas（避免 canvas tainted）
 * - CANVAS 标签 → 直接保存 canvas 引用（检测透明度选择 PNG/JPEG）
 * - background-image → loadImageAsBase64() → base64 + 原始尺寸
 */

import { canvasHasAlpha, canvasToDataUrl, parseBgImageUrl } from '../utils';

/**
 * 用 Image 加载 url → canvas → base64，同时记录原始尺寸
 * 自动检测透明通道：有透明像素用 PNG，否则用 JPEG（更小）
 *
 * @param {string} url - 图片 URL
 * @param {number} timeout - 超时时间（毫秒），默认 30000ms
 * @returns {Promise<{src, format, w, h}|null>} 加载成功返回图片数据，失败/超时返回 null
 */
function loadImageAsBase64(url, timeout = 30000) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    let timeoutId = null;

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
      canvas.getContext('2d').drawImage(img, 0, 0);

      const hasAlpha = canvasHasAlpha(canvas);

      resolve({
        src: canvasToDataUrl(canvas, hasAlpha),
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

    timeoutId = setTimeout(() => {
      cleanup();
      console.warn(`[htmlpdf] Image load timeout (${timeout}ms): ${url}`);
      resolve(null);
    }, timeout);

    img.src = url;
  });
}

/**
 * 预加载所有节点的图片数据，在 iframe 销毁前调用
 *
 * IMG  → canvas.drawImage → node.src / node._srcCanvas
 * CANVAS → 直接保存 canvas 引用 → node._srcCanvas
 * background-image → loadImageAsBase64 → node.bgSrc / node.bgNaturalWidth 等
 *
 * @param {Array} nodes - 节点数组（会被修改，直接写入图片数据）
 * @returns {Promise<void>}
 */
export async function preloadImages(nodes) {
  await Promise.all(
    nodes.map((e) => {
      if (e.type !== 'element') return null;

      // IMG 标签：通过 loadImageAsBase64 重新加载（带 crossOrigin=anonymous），
      // 避免直接复用 iframe 内未带 CORS 属性的 imgEl 导致 canvas tainted 问题。
      if (e.tag === 'IMG' && e._el?.src) {
        const url = e._el.src;

        return loadImageAsBase64(url).then((result) => {
          if (!result) {
            console.warn(
              '[htmlpdf] preloadImages: IMG load failed (CORS or network):',
              url,
            );

            return null;
          }

          // 将 base64 解码为 canvas，供渲染层做跨页裁切
          return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = result.w;
              canvas.height = result.h;
              canvas.getContext('2d').drawImage(img, 0, 0);
              e.src = result.src;
              e.naturalWidth = result.w;
              e.naturalHeight = result.h;
              e._srcCanvas = canvas;
              e._srcFormat = result.format;
              resolve(null);
            };
            img.onerror = () => resolve(null);
            img.src = result.src; // base64，同域，不会 tainted
          });
        });
      }

      // CANVAS 标签：cloneNode 不复制像素，_el 指向原始 DOM canvas。
      // 透明检测：有透明像素用 PNG，否则用 JPEG（体积更小）
      if (e.tag === 'CANVAS' && e._el) {
        const canvasEl = e._el;
        e._srcCanvas = canvasEl;
        e.naturalWidth = canvasEl.width;
        e.naturalHeight = canvasEl.height;
        e._srcFormat = canvasHasAlpha(canvasEl) ? 'PNG' : 'JPEG';
      }

      // background-image url → base64 + 原始尺寸
      const bgUrl = parseBgImageUrl(e.style?.backgroundImage);
      if (bgUrl) {
        return loadImageAsBase64(bgUrl).then((result) => {
          if (result) {
            e.bgSrc = result.src;
            e.bgFormat = result.format;
            e.bgNaturalWidth = result.w;
            e.bgNaturalHeight = result.h;
          }

          return null;
        });
      }

      return null;
    }),
  );
}
