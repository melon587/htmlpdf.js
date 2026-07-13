/**
 * @file image-loader.js
 * 图片加载模块
 *
 * 负责在 iframe 销毁前将所有图片数据缓存到 node 上，供渲染层使用：
 * - IMG 标签    → canvas.drawImage → base64 + _srcCanvas
 * - CANVAS 标签 → 直接保存 canvas 引用（检测透明度选择 PNG/JPEG）
 * - background-image → loadImageAsBase64() → base64 + 原始尺寸
 */

import { canvasHasAlpha, parseBgImageUrl } from '../utils';

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

      // IMG 标签：将 iframe 内已加载的图片绘到 canvas，保存 base64 和像素尺寸。
      // _srcCanvas 直接作为裁切源，drawImage 无需重新解码 Image 对象。
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
          e._srcCanvas = canvas;
          e._srcFormat = 'JPEG';
        } catch (err) {
          console.warn(
            '[htmlpdf] preloadImages: canvas.drawImage failed:',
            err,
          );
        }
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
