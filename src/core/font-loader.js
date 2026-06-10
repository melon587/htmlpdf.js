import { buildFontFaceRule } from '../utils';

// 字体缓存（模块级，跨调用共享）
const fontCache = new Map();

/**
 * 从 URL 获取字体文件并转换为 Base64（带缓存）
 */
export async function fetchFontAsBase64(url) {
  if (fontCache.has(url)) {
    console.log(`[htmlpdf] Font loaded from cache: ${url}`);

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
  console.log(`[htmlpdf] Font loaded from URL: ${url}`);

  return base64;
}

/**
 * 加载字体到 jsPDF
 * @param {Object} doc - jsPDF 实例
 * @param {Array} fonts - 字体配置数组
 */
export async function loadFontsToJsPDF(doc, fonts) {
  if (!fonts || fonts.length === 0) {
    return;
  }

  for (const config of fonts) {
    let fontBase64 = config.fontBase64;

    if (!fontBase64 && config.fontUrl) {
      try {
        fontBase64 = await fetchFontAsBase64(config.fontUrl);
      } catch (error) {
        console.error(
          `[htmlpdf] Failed to load font: ${config.fontUrl}`,
          error,
        );
        continue;
      }
    }

    if (fontBase64) {
      doc.addFileToVFS(`${config.fontFamily}.ttf`, fontBase64);
      doc.addFont(
        `${config.fontFamily}.ttf`,
        config.fontFamily,
        config.fontStyle,
        config.fontWeight,
      );
      console.log(`[htmlpdf] Font registered: ${config.fontFamily}`);
    }
  }
}

/**
 * 在克隆的 iframe 文档中注入字体样式
 * @param {Document} iframeDoc - iframe 的 document
 * @param {Array} fonts - 字体配置数组
 * @returns {Promise<void>}
 */
export async function injectFontsToDocument(iframeDoc, fonts) {
  if (!fonts || fonts.length === 0) {
    return;
  }

  const fontFaceRules = [];

  for (const config of fonts) {
    let fontBase64 = config.fontBase64;

    if (!fontBase64 && config.fontUrl) {
      try {
        fontBase64 = await fetchFontAsBase64(config.fontUrl);
      } catch (error) {
        console.error(
          `[htmlpdf] Failed to load font for cloned document: ${config.fontUrl}`,
          error,
        );
        continue;
      }
    }

    if (fontBase64) {
      // 生成 unicode-range（如果 config 里有 charRanges）
      const rule = buildFontFaceRule(config, fontBase64);

      fontFaceRules.push(rule);
    }
  }

  if (fontFaceRules.length > 0) {
    const styleEl = iframeDoc.createElement('style');
    styleEl.setAttribute('data-htmlpdf-fonts', '1');
    styleEl.textContent = fontFaceRules.join('\n');
    iframeDoc.head.appendChild(styleEl);
    console.log(
      `[htmlpdf] Injected ${fontFaceRules.length} fonts into cloned document`,
    );

    if (iframeDoc.fonts && iframeDoc.fonts.ready) {
      await iframeDoc.fonts.ready;
      console.log('[htmlpdf] Cloned document fonts loaded');
    }

    // 修改 body 的 font-family，让它使用注入的字体（按顺序排列，优先使用注入字体）
    const fontFamilies = fonts.map((c) => `'${c.fontFamily}'`).join(', ');
    if (iframeDoc.body) {
      const currentFontFamily = iframeDoc.defaultView.getComputedStyle(
        iframeDoc.body,
      ).fontFamily;

      const newFontFamily = `${fontFamilies}, ${currentFontFamily}`;
      iframeDoc.body.style.setProperty('font-family', newFontFamily);

      console.log(`[htmlpdf] Updated body font-family: ${newFontFamily}`);
    }
  }
}
