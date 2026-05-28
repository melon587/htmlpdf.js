import { jsPDF } from 'jspdf';

// A4 尺寸（单位 mm）
// jsPDF 内部使用 pt，但我们统一用 mm 操作
// 屏幕 px → PDF mm 的转换比例：contentWidth(mm) / rootElement.width(px)

// px 转 mm 的常量（96 DPI 标准）
const PX_TO_MM = 25.4 / 96;

/**
 * 创建渲染上下文
 * @param {Element} rootElement - 被转换的根元素
 * @param {Object} options
 * @param {string} [options.format='a4']
 * @param {string} [options.orientation='portrait']
 * @param {number} [options.margin=0] - 页边距 px (默认 0，无边距)
 * @param {boolean} [options.compress=true] - 是否启用 PDF 压缩
 * @param {Object} [options.header] - 页眉配置 { height: mm, render: fn }
 * @param {Object} [options.footer] - 页脚配置 { height: mm, render: fn }
 * @returns {Object} ctx
 */
export function createContext(rootElement, options = {}) {
  const {
    format = 'a4',
    orientation = 'portrait',
    margin = 0,
    compress = true,
    header,
    footer,
  } = options;

  const headerHeight = header && header.height ? header.height : 0;
  const footerHeight = footer && footer.height ? footer.height : 0;

  const doc = new jsPDF({ unit: 'mm', format, orientation, compress });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // 将 px 的 margin 转换为 mm
  const marginMM = margin * PX_TO_MM;

  // 内容区宽高（去掉页边距 + header/footer 占用高度）
  const contentWidth = pageWidth - marginMM * 2;
  const contentHeight = pageHeight - marginMM * 2 - headerHeight - footerHeight;

  // 根元素屏幕宽度 → 计算缩放比例
  const rootRect = rootElement.getBoundingClientRect();
  const scale = contentWidth / rootRect.width;

  return {
    doc,
    scale,
    margin: marginMM, // 返回 mm 单位的 margin，供内部使用
    headerHeight,
    footerHeight,
    pageWidth,
    pageHeight,
    contentWidth,
    contentHeight,

    /** px → mm */
    toMM(px) {
      return px * scale;
    },

    /** 节点 x(px) → PDF x(mm)，加上页边距 */
    toPdfX(x) {
      return marginMM + x * scale;
    },

    /**
     * 节点 y(px) → PDF y(mm)
     * 内容区顶部基准 = margin + headerHeight
     * @param {number} y - 相对根元素的 y（px）
     * @param {number} pageOffsetY - 当前页顶部对应的 y（mm）
     */
    toPdfY(y, pageOffsetY = 0) {
      return marginMM + headerHeight + y * scale - pageOffsetY;
    },

    /**
     * mm 值直接转 PDF y（已经是 mm，不需要 *scale）
     * 内容区顶部基准 = margin + headerHeight
     * @param {number} ymm - mm 坐标
     * @param {number} pageOffsetY - 当前页顶部（mm）
     */
    toPdfYmm(ymm, pageOffsetY = 0) {
      return marginMM + headerHeight + ymm - pageOffsetY;
    },

    /**
     * px 字体大小 → PDF pt
     * jsPDF.setFontSize 使用 pt（1mm ≈ 2.8346pt）
     */
    toPt(px) {
      return px * scale * 2.8346;
    },
  };
}
