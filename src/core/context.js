import { jsPDF } from 'jspdf';
import { getOutputType } from '../utils';

// px 转 mm 的常量（96 DPI）
const PX_TO_MM = 25.4 / 96;

/**
 * 创建 PDF 渲染上下文，封装 jsPDF 实例、页面尺寸及坐标转换方法。
 * 所有方法均为闭包，支持解构后直接调用（无 this 绑定问题）。
 *
 * @param {Element} rootElement - 被转换的根元素
 * @param {Object} options - 配置项
 * @param {string} [options.format='a4'] - 页面尺寸规格
 * @param {string} [options.orientation='portrait'] - 页面方向
 * @param {number} [options.margin=0] - 页边距（px，默认 0）
 * @param {boolean} [options.compress=true] - 是否启用 PDF 压缩
 * @param {Object} [options.header] - 页眉配置 { height: mm, render: fn }
 * @param {Object} [options.footer] - 页脚配置 { height: mm, render: fn }
 * @returns {object} 渲染上下文对象
 */
export function initContext(rootElement, options = {}) {
  const {
    format = 'a4',
    orientation = 'portrait',
    margin = 0,
    compress = true,
    header,
    footer,
  } = options;

  const headerHeight = header?.height ?? 0;
  const footerHeight = footer?.height ?? 0;

  const doc = new jsPDF({ unit: 'mm', format, orientation, compress });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // 将 px 的 margin 转换为 mm
  const marginMM = margin * PX_TO_MM;

  // 内容区宽高（去掉页边距 + header/footer 占用高度）
  const contentWidth = pageWidth - marginMM * 2;
  const contentHeight =
    pageHeight - marginMM * 2 - (headerHeight + footerHeight);

  // 根元素屏幕宽度 → 计算缩放比例
  const rootRect = rootElement.getBoundingClientRect();
  if (rootRect.width === 0) {
    throw new Error(
      '[htmlpdf] Root element has zero width. ' +
        'Ensure the element is visible and laid out before calling htmlpdf().',
    );
  }

  const scale = contentWidth / rootRect.width;

  // 单页内容区高度（px）
  const contentHeightPx = contentHeight / scale;

  /**
   * px 长度 → mm（乘以缩放比）
   * @param {number} px - 像素值
   * @returns {number} 毫米值
   */
  function toMM(px) {
    return px * scale;
  }

  /**
   * 节点 x(px) → PDF x(mm)，加上页边距偏移
   * @param {number} x - 相对根元素左边的 x（px）
   * @returns {number} PDF 坐标系中的 x（mm）
   */
  function toPdfX(x) {
    return marginMM + x * scale;
  }

  /**
   * 节点 y(px) → PDF y(mm)，内容区基准 = margin + headerHeight
   * @param {number} y - 相对当前页顶部的 y（px）
   * @returns {number} PDF 坐标系中的 y（mm）
   */
  function toPdfY(y) {
    return marginMM + headerHeight + y * scale;
  }

  /**
   * mm 值直接转 PDF y（无需 *scale），内容区基准 = margin + headerHeight
   * @param {number} ymm - 相对当前页顶部的 mm 坐标
   * @returns {number} PDF 坐标系中的 y（mm）
   */
  function toPdfYmm(ymm) {
    return marginMM + headerHeight + ymm;
  }

  /**
   * px 字体大小 → PDF pt（jsPDF.setFontSize 使用 pt，1mm ≈ 2.8346pt）
   * @param {number} px - 像素字号
   * @returns {number} PDF pt 字号
   */
  function toPt(px) {
    return px * scale * 2.8346;
  }

  /**
   * 将 PDF 输出为指定格式
   * @param {string} outputFormat - 输出格式（'blob' | 'dataurl' | 'arraybuffer'）
   * @returns {Blob|string|ArrayBuffer} 对应格式的 PDF 数据
   */
  function output(outputFormat) {
    const outputType = getOutputType(outputFormat);

    return doc.output(outputType);
  }

  return {
    doc,
    pageWidth,
    pageHeight,
    marginMM,
    contentWidth,
    contentHeight,
    contentHeightPx,
    headerHeight,
    footerHeight,
    scale,
    toMM,
    toPdfX,
    toPdfY,
    toPdfYmm,
    toPt,
    output,
  };
}
