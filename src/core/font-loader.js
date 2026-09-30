import { buildFontFaceRule } from '../utils';

// 字体缓存（模块级，跨调用共享）
const fontCache = new Map();

// jsPDF 支持的合法 fontStyle / fontWeight 值
const VALID_FONT_STYLES = ['normal', 'italic', undefined, null, ''];
const VALID_FONT_WEIGHTS = [400, 700, 'normal', 'bold', undefined, null, ''];

/**
 * 从 URL 获取字体文件并转换为 Base64（带缓存）
 * @param {string} url - 字体文件 URL
 * @returns {Promise<string>} Base64 编码的字体数据
 */
export async function fetchFontAsBase64(url) {
  if (fontCache.has(url)) {
    return fontCache.get(url);
  }

  const response = await fetch(url);
  if (response.ok) {
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
  } else {
    throw new Error(`Failed to fetch font: ${url} (${response.status})`);
  }
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
 * 校验字体配置的 fontStyle 和 fontWeight，不合法时打印警告
 * @param {Object} config - 字体配置对象
 * @param {string} config.fontFamily - 字体名称
 * @param {string} config.fontStyle - 字体样式
 * @param {number|string} config.fontWeight - 字体粗细
 * @returns {void}
 */
function warnInvalidFontConfig({ fontFamily, fontStyle, fontWeight }) {
  if (!VALID_FONT_STYLES.includes(fontStyle)) {
    console.warn(
      `[htmlpdf] Invalid fontStyle "${fontStyle}" for font "${fontFamily}". ` +
        `fontStyle only accepts "normal" or "italic". ` +
        `To set font weight, use fontWeight instead (e.g. fontWeight: 700).`,
    );
  }

  if (!VALID_FONT_WEIGHTS.includes(fontWeight)) {
    console.warn(
      `[htmlpdf] Unsupported fontWeight "${fontWeight}" for font "${fontFamily}". ` +
        `jsPDF only recognizes 400/"normal" and 700/"bold". ` +
        `Other values (e.g. 600) will register as a non-standard variant and likely fall back to the default font. ` +
        `Use fontWeight: 700 for bold, or 400 for normal.`,
    );
  }
}

/**
 * 将单个字体注册到 jsPDF 实例
 * @param {Object} doc - jsPDF 实例
 * @param {Object} config - 字体配置对象
 * @param {string} fontBase64 - Base64 编码的字体数据
 * @returns {void}
 */
function registerFontToJsPDF(doc, config, fontBase64) {
  const { fontFamily, fontStyle, fontWeight } = config;
  doc.addFileToVFS(`${fontFamily}.ttf`, fontBase64);
  doc.addFont(`${fontFamily}.ttf`, fontFamily, fontStyle, fontWeight);
}

/**
 * 注入单个字体配置到 jsPDF 实例（校验 + 注册）
 * @param {Object} doc - jsPDF 实例
 * @param {Object} config - 字体配置对象
 * @returns {Promise<void>}
 */
async function injectOneFontToJsPDF(doc, config) {
  const fontBase64 = await getFontBase64(config);

  if (fontBase64) {
    warnInvalidFontConfig(config);
    registerFontToJsPDF(doc, config, fontBase64);
  }
}

/**
 * 注入字体配置数组到 jsPDF 实例
 * @param {Object} ctx - Context 实例
 * @param {Array} fonts - 字体配置数组
 * @returns {Promise<void>}
 */
export async function injectFontsToJsPDF(ctx, fonts) {
  if (fonts && fonts.length > 0) {
    const { doc } = ctx;
    await Promise.all(fonts.map((config) => injectOneFontToJsPDF(doc, config)));
  }
}

/**
 * 获取所有字体的 @font-face 规则，过滤掉加载失败的
 * @param {Array} fonts - 字体配置数组
 * @returns {Promise<string[]>} 有效的 @font-face 规则数组
 */
async function buildFontFaceRules(fonts) {
  const allRules = await Promise.all(
    fonts.map(async (config) => {
      const base64 = await getFontBase64(config);

      return base64 ? buildFontFaceRule(config, base64) : null;
    }),
  );

  return allRules.filter(Boolean);
}

/**
 * 将 @font-face 规则注入 iframe 文档的 <head>
 * @param {Document} iframeDoc - iframe 的 document
 * @param {string[]} rules - @font-face 规则数组
 * @returns {void}
 */
function injectFontFaceStyle(iframeDoc, rules) {
  const styleEl = iframeDoc.createElement('style');
  styleEl.setAttribute('data-htmlpdf-fonts', '1');
  styleEl.textContent = rules.join('\n');
  iframeDoc.head.appendChild(styleEl);
}

/**
 * 强制触发单个字体在 iframe 内加载，CSP 拦截时降级跳过
 * @param {Document} iframeDoc - iframe 的 document
 * @param {Object} config - 字体配置对象
 * @returns {Promise<void>}
 */
function loadOneFontInDocument(iframeDoc, config) {
  return iframeDoc.fonts
    .load(`${config.fontWeight || 400} 16px '${config.fontFamily}'`)
    .catch((err) => {
      console.warn(
        `[htmlpdf] fonts.load failed for '${config.fontFamily}', skipping:`,
        err,
      );
    });
}

/**
 * 强制触发 iframe 内所有字体加载并等待完成
 * unicode-range 字体是懒加载的——fonts.ready 在字体未被使用时会立即 resolve，
 * 必须用 fonts.load() 强制加载，确保 getClientRects() 使用正确的字体 metrics。
 * @param {Document} iframeDoc - iframe 的 document
 * @param {Array} fonts - 字体配置数组
 * @returns {Promise<void>}
 */
async function waitForFontsLoad(iframeDoc, fonts) {
  if (iframeDoc.fonts?.load) {
    await Promise.all(
      fonts.map((config) => loadOneFontInDocument(iframeDoc, config)),
    );
  }
}

/**
 * 将注入字体前置到 body font-family，确保测量时优先命中注入字体
 * @param {Document} iframeDoc - iframe 的 document
 * @param {Array} fonts - 字体配置数组
 * @returns {void}
 */
function prependFontsToBody(iframeDoc, fonts) {
  if (iframeDoc.body) {
    const current = iframeDoc.defaultView.getComputedStyle(
      iframeDoc.body,
    ).fontFamily;
    const injected = fonts.map((c) => `'${c.fontFamily}'`).join(', ');
    iframeDoc.body.style.setProperty('font-family', `${injected}, ${current}`);
  }
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
 * injectFontsToJsPDF 复用同一份 base64，不会重复 fetch。
 *
 * @param {Document} iframeDoc - iframe 的 document
 * @param {Array} fonts - 字体配置数组
 * @returns {Promise<void>}
 */
export async function injectFontsToDocument(iframeDoc, fonts) {
  if (fonts && fonts.length > 0) {
    const rules = await buildFontFaceRules(fonts);

    if (rules.length > 0) {
      injectFontFaceStyle(iframeDoc, rules);
      await waitForFontsLoad(iframeDoc, fonts);
      prependFontsToBody(iframeDoc, fonts);
    }
  }
}
