/**
 * @file wait.js
 * 异步等待工具函数
 *
 * 封装浏览器资源加载的等待逻辑，供 document-cloner 等模块使用：
 * - waitForLayout    等待浏览器完成 layout（rAF + setTimeout）
 * - waitForImages    等待 document 内所有图片加载完成
 * - waitForStyleSheets  等待 document 内所有样式表加载完成
 */

/**
 * 等待一个 rAF + setTimeout(0)，让浏览器完成 layout
 * @returns {Promise<void>}
 */
export function waitForLayout() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

/**
 * 等待 document 内的图片全部加载完成
 * @param {Document} doc
 * @returns {Promise<void>}
 */
export async function waitForImages(doc) {
  const imgs = Array.from(doc.images).filter((img) => !img.complete);

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
 * 等待 document 内的样式表全部加载完成
 * 克隆后的 <link rel="stylesheet"> 需要重新加载 CSS 文件，
 * 不等待会导致 getComputedStyle() 返回浏览器默认样式。
 *
 * @param {Document} doc
 * @param {number} timeout - 单个样式表超时时间（毫秒），默认 10000ms
 * @returns {Promise<void>}
 */
export async function waitForStyleSheets(doc, timeout = 10000) {
  const linkTags = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));

  await Promise.all(
    linkTags.map((link) => waitForSingleStyleSheet(link, timeout)),
  );
}

/**
 * 等待单个样式表加载完成
 * @param {HTMLLinkElement} link
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<void>}
 */
function waitForSingleStyleSheet(link, timeout) {
  return new Promise((resolve) => {
    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
    };

    // link.sheet 存在即表示已加载（跨域 CSS 无法访问 cssRules 但 sheet 存在）
    const isLoaded = () => {
      if (!link.sheet) return false;

      try {
        return link.sheet.cssRules && link.sheet.cssRules.length >= 0;
      } catch (e) {
        return true; // 跨域 CSS：CORS 限制导致 cssRules 不可访问，但已加载
      }
    };

    if (isLoaded()) {
      resolve();

      return;
    }

    timeoutId = setTimeout(() => {
      cleanup();
      console.warn(
        `[htmlpdf] Stylesheet load timeout (${timeout}ms): ${link.href}`,
      );
      resolve();
    }, timeout);

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
