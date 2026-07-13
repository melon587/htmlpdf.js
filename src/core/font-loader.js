import { buildFontFaceRule } from '../utils';

// 字体缓存（模块级，跨调用共享）
const fontCache = new Map();

/**
 * 从 URL 获取字体文件并转换为 Base64（带缓存）
 */
export async function fetchFontAsBase64(url) {
  if (fontCache.has(url)) {
    return fontCache.get(url);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch font: ${url} (${response.status})`);
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }

  const base64 = btoa(binary);

  fontCache.set(url, base64);

  return base64;
}

/**
 * 获取单个字体的 Base64 数据：优先使用内联 fontBase64，否则从 fontUrl fetch。
 * 失败时打印错误并返回 null（不抛出，避免中断其他字体的加载）。
 * @param {Object} config - 字体配置对象
 * @returns {Promise<string|null>}
 */
async function getFontBase64(config) {
  if (config.fontBase64) return config.fontBase64;

  if (config.fontUrl) {
    try {
      return await fetchFontAsBase64(config.fontUrl);
    } catch (error) {
      console.error(`[htmlpdf] Failed to load font: ${config.fontUrl}`, error);
    }
  }

  return null;
}

/**
 * 加载字体到 jsPDF
 * @param {Object} ctx - ctx实例
 * @param {Array} fonts - 字体配置数组
 */
export async function loadFontsToJsPDF(ctx, fonts) {
  if (!fonts || fonts.length === 0) {
    return;
  }

  const { doc } = ctx;

  await Promise.all(
    fonts.map(async (config) => {
      const fontBase64 = await getFontBase64(config);

      if (fontBase64) {
        doc.addFileToVFS(`${config.fontFamily}.ttf`, fontBase64);
        doc.addFont(
          `${config.fontFamily}.ttf`,
          config.fontFamily,
          config.fontStyle,
          config.fontWeight,
        );
      }
    }),
  );
}

/**
 * 在克隆的 iframe 文档中注入字体样式
 *
 * 目的：让 iframe 内 getComputedStyle 返回正确的 fontFamily，以及让
 * getClientRects() 的宽度测量与真实渲染一致（依赖正确字体 + unicode-range）。
 *
 * 注入完整 @font-face（含 base64 src + unicode-range），等 fonts.ready 后
 * 字体已可用于布局测量。iframe 销毁时未完成的 fetch 显示为 canceled，这是
 * 浏览器的正常清理行为，不影响功能——字体数据已通过 fontCache 缓存，
 * loadFontsToJsPDF 复用同一份 base64，不会重复 fetch。
 *
 * @param {Document} iframeDoc - iframe 的 document
 * @param {Array} fonts - 字体配置数组
 * @returns {Promise<void>}
 */
export async function injectFontsToDocument(iframeDoc, fonts) {
  if (!fonts || fonts.length === 0) return;

  // 1. 获取所有字体的 base64，过滤掉加载失败的
  const allRules = await Promise.all(
    fonts.map(async (config) => {
      const base64 = await getFontBase64(config);

      return base64 ? buildFontFaceRule(config, base64) : null;
    }),
  );
  const rules = allRules.filter(Boolean);

  if (rules.length === 0) return;

  // 2. 注入 @font-face 样式到 iframe
  const styleEl = iframeDoc.createElement('style');
  styleEl.setAttribute('data-htmlpdf-fonts', '1');
  styleEl.textContent = rules.join('\n');
  iframeDoc.head.appendChild(styleEl);

  // 3. 主动触发字体加载并等待完成
  // unicode-range 字体是懒加载的——fonts.ready 在字体未被使用时会立即 resolve，
  // 必须用 fonts.load() 强制加载，确保 getClientRects() 使用正确的字体 metrics
  if (iframeDoc.fonts?.load) {
    await Promise.all(
      fonts.map((c) =>
        iframeDoc.fonts.load(`${c.fontWeight || 400} 16px '${c.fontFamily}'`),
      ),
    );
  }

  // 4. 将注入字体前置到 body font-family，确保测量时优先命中注入字体
  if (iframeDoc.body) {
    const current = iframeDoc.defaultView.getComputedStyle(
      iframeDoc.body,
    ).fontFamily;
    const injected = fonts.map((c) => `'${c.fontFamily}'`).join(', ');
    iframeDoc.body.style.setProperty('font-family', `${injected}, ${current}`);
  }
}
