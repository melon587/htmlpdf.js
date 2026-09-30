import { jsPDF } from 'jspdf';
import { getOutputType } from '../utils';

// px 转 mm 的常量（96 DPI）
const PX_TO_MM = 25.4 / 96;

/**
 * PDF 渲染上下文，封装 jsPDF 实例、页面尺寸及坐标转换方法
 */
export class Context {
  /**
   * @param {Element} rootElement - 被转换的根元素
   * @param {Object} options - 配置项
   * @param {string} [options.format='a4'] - 页面尺寸规格
   * @param {string} [options.orientation='portrait'] - 页面方向
   * @param {number} [options.margin=0] - 页边距（px，默认 0）
   * @param {boolean} [options.compress=true] - 是否启用 PDF 压缩
   * @param {Object} [options.header] - 页眉配置 { height: mm, render: fn }
   * @param {Object} [options.footer] - 页脚配置 { height: mm, render: fn }
   */
  constructor(rootElement, options = {}) {
    const {
      format = 'a4',
      orientation = 'portrait',
      margin = 0,
      compress = true,
      header,
      footer,
    } = options;

    this.headerHeight = header?.height ?? 0;
    this.footerHeight = footer?.height ?? 0;

    this.doc = new jsPDF({ unit: 'mm', format, orientation, compress });

    this.pageWidth = this.doc.internal.pageSize.getWidth();
    this.pageHeight = this.doc.internal.pageSize.getHeight();

    // 将 px 的 margin 转换为 mm
    this.marginMM = margin * PX_TO_MM;

    // 内容区宽高（去掉页边距 + header/footer 占用高度）
    this.contentWidth = this.pageWidth - this.marginMM * 2;
    this.contentHeight =
      this.pageHeight -
      this.marginMM * 2 -
      (this.headerHeight + this.footerHeight);

    // 根元素屏幕宽度 → 计算缩放比例
    const rootRect = rootElement.getBoundingClientRect();
    if (rootRect.width === 0) {
      throw new Error(
        '[htmlpdf] Root element has zero width. ' +
          'Ensure the element is visible and laid out before calling htmlpdf().',
      );
    }

    this.scale = this.contentWidth / rootRect.width;

    // 单页内容区高度（px）
    this.contentHeightPx = this.contentHeight / this.scale;
  }

  /**
   * px 长度 → mm（乘以缩放比）
   * @param {number} px - 像素值
   * @returns {number} 毫米值
   */
  toMM(px) {
    return px * this.scale;
  }

  /**
   * 节点 x(px) → PDF x(mm)，加上页边距偏移
   * @param {number} x - 相对根元素左边的 x（px）
   * @returns {number} PDF 坐标系中的 x（mm）
   */
  toPdfX(x) {
    return this.marginMM + x * this.scale;
  }

  /**
   * 节点 y(px) → PDF y(mm)，内容区基准 = margin + headerHeight
   * @param {number} y - 相对当前页顶部的 y（px）
   * @returns {number} PDF 坐标系中的 y（mm）
   */
  toPdfY(y) {
    return this.marginMM + this.headerHeight + y * this.scale;
  }

  /**
   * mm 值直接转 PDF y（无需 *scale），内容区基准 = margin + headerHeight
   * @param {number} ymm - 相对当前页顶部的 mm 坐标
   * @returns {number} PDF 坐标系中的 y（mm）
   */
  toPdfYmm(ymm) {
    return this.marginMM + this.headerHeight + ymm;
  }

  /**
   * px 字体大小 → PDF pt（jsPDF.setFontSize 使用 pt，1mm ≈ 2.8346pt）
   * @param {number} px - 像素字号
   * @returns {number} PDF pt 字号
   */
  toPt(px) {
    return px * this.scale * 2.8346;
  }

  /**
   * 将 PDF 输出为指定格式
   * @param {string} outputFormat - 输出格式（'blob' | 'dataurl' | 'arraybuffer'）
   * @returns {Blob|string|ArrayBuffer} 对应格式的 PDF 数据
   */
  output(outputFormat) {
    const outputType = getOutputType(outputFormat);

    return this.doc.output(outputType);
  }
}
