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
  await Promise.all(
    Array.from(doc.images).map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete) {
            resolve();

            return;
          }

          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        }),
    ),
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
    // link.sheet 存在即表示已加载（同域或跨域 CSS 均适用）
    if (link.sheet) {
      resolve();

      return;
    }

    const timeoutId = setTimeout(() => {
      console.warn(
        `[htmlpdf] Stylesheet load timeout (${timeout}ms): ${link.href}`,
      );
      resolve();
    }, timeout);

    link.addEventListener(
      'load',
      () => {
        clearTimeout(timeoutId);
        resolve();
      },
      { once: true },
    );
    link.addEventListener(
      'error',
      () => {
        clearTimeout(timeoutId);
        console.warn(`[htmlpdf] Stylesheet load error: ${link.href}`);
        resolve();
      },
      { once: true },
    );
  });
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
