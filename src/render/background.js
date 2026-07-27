import { parseColor, parseBgSizeVal, parseBgPosVal } from '../utils';
import { parseLinearGradient, renderGradientSlice } from './gradient';
import {
  parseRadius,
  hasRadius,
  addRoundedRectPath,
  addFirstPagePath,
  addLastPagePath,
} from './radius';

// ─── 背景图尺寸/位置计算 ─────────────────────────────────────────────────────

/**
 * 根据 backgroundSize / 元素尺寸 / 图片原始尺寸，计算实际渲染的 imgW/imgH（mm）
 * 支持 cover / contain / auto / 固定值
 */
function calcBgImageSize({ bgSize, elW, elH, natW, natH }) {
  const parts = (bgSize || 'auto').trim().split(/\s+/);
  const sx = parts[0];
  const sy = parts[1] ?? sx;

  if (sx === 'cover') {
    const scale = Math.max(elW / natW, elH / natH);

    return { imgW: natW * scale, imgH: natH * scale };
  }

  if (sx === 'contain') {
    const scale = Math.min(elW / natW, elH / natH);

    return { imgW: natW * scale, imgH: natH * scale };
  }

  // 先解析非 auto 的固定值
  const fixedW = sx !== 'auto' ? parseBgSizeVal(sx, elW) : null;
  const fixedH = sy !== 'auto' ? parseBgSizeVal(sy, elH) : null;

  // auto：保持原始尺寸；若另一维有固定值则按比例等比
  const imgW = fixedW ?? (fixedH !== null ? natW * (fixedH / natH) : natW);
  const imgH = fixedH ?? (fixedW !== null ? natH * (fixedW / natW) : natH);

  return { imgW, imgH };
}

/**
 * 根据 backgroundPosition 计算图片左上角偏移（单位 mm）
 */
function calcBgImagePos({ bgPos, elW, elH, imgW, imgH }) {
  const parts = (bgPos || '50% 50%').trim().split(/\s+/);
  const px = parts[0];
  const py = parts[1] ?? px;

  return {
    offX: parseBgPosVal(px, elW, imgW),
    offY: parseBgPosVal(py, elH, imgH),
  };
}

// ─── 主函数 ───────────────────────────────────────────────────────────────────

/**
 * 绘制背景色、渐变背景和背景图
 * clipTop/clipBottom（mm）：当前页可见范围，用于跨页裁剪，只绘制节点与当前页交叉的区域
 *
 * 绘制顺序：
 *   1. 纯色背景（backgroundColor）
 *   2. 渐变背景（linear-gradient，覆盖纯色）
 *   3. backgroundImage URL（bgSrc，叠加在渐变上）
 *
 * @param {number}  clipTop     - 当前页内容起点（mm）。repeat-header 存在时等于 header 高度，
 *                                避免 spill 背景画进 header 区域。默认 0。
 * @param {boolean} isLastSpill - 是否是该节点的最后一个 spill placement
 *   - true（默认）：背景色只画到节点实际底部
 *   - false（中间 spill 页）：背景色延伸到整页高度（clipBottom），后续内容会覆盖在上面
 */
function drawBackground({
  node,
  ctx,
  clipTop = 0,
  clipBottom,
  isLastSpill = true,
}) {
  const { doc, toMM, toPdfX, toPdfYmm } = ctx;
  const { style } = node;
  const nodeTop = toMM(node.y);
  const nodeBottom = toMM(node.y + node.height);

  // drawTop：节点顶部与 clipTop（repeat-header 底部）取较大值，避免画进 header 区域
  const drawTop = Math.max(nodeTop, clipTop);
  // 中间 spill 页：背景延伸到整页高度；最后一页：到节点实际底部
  // 两者都需要与 clipBottom 取较小值，防止节点底部早于页底部时多画一段空白
  const drawBottom = Math.min(isLastSpill ? nodeBottom : Infinity, clipBottom);
  if (drawBottom <= drawTop) return;

  const x = toPdfX(node.x);
  const y = toPdfYmm(drawTop);
  const w = toMM(node.width);
  const h = drawBottom - drawTop;

  // 圆角：根据节点在本页所处位置决定用哪段路径
  // isFirstPage：节点顶部在本页可见（本页是首页）
  // isLastPage ：节点底部在本页可见（本页是末页）
  const isFirstPage = nodeTop >= clipTop;
  const isLastPage = isLastSpill && nodeBottom <= clipBottom;
  // 完整节点高度（用于 parseRadius 的 clamp 基准）
  const fullH = toMM(node.height);
  const radius = parseRadius({ style, toMM, w, h: fullH });
  const useRadius = hasRadius(radius);

  /**
   * 建立当前片段的剪切路径（圆角或直角，三段式）
   * 调用方需自行 saveGraphicsState / restoreGraphicsState
   */
  function applyClip() {
    if (useRadius && isFirstPage && isLastPage) {
      addRoundedRectPath({ doc, x, y, w, h, r: radius });
    } else if (useRadius && isFirstPage) {
      addFirstPagePath({ doc, x, y, w, segH: h, r: radius });
    } else if (useRadius && isLastPage) {
      addLastPagePath({ doc, x, y, w, segH: h, r: radius });
    } else {
      doc.rect(x, y, w, h, null);
    }

    doc.clip();
    doc.discardPath();
  }

  // 1. 先画背景色
  const color = parseColor(style.backgroundColor);
  if (color) {
    doc.setFillColor(color[0], color[1], color[2]);
    doc.saveGraphicsState();
    applyClip();
    doc.rect(x, y, w, h, 'F');
    doc.restoreGraphicsState();
  }

  // 2. 渐变背景（linear-gradient）：解析 → 直接绘制当前页片段 canvas → addImage
  const gradient = parseLinearGradient(style?.backgroundImage);
  if (gradient) {
    // canvas 尺寸使用节点 CSS 像素尺寸
    const natW = Math.round(node.width);
    const natH = Math.round(node.height);
    const nodeHeightMM = nodeBottom - nodeTop;
    const ratioTop = (drawTop - nodeTop) / nodeHeightMM;
    const ratioBottom = (drawBottom - nodeTop) / nodeHeightMM;
    const srcY = Math.round(ratioTop * natH);
    const srcH = Math.round((ratioBottom - ratioTop) * natH);

    if (natW > 0 && natH > 0 && nodeHeightMM > 0 && srcH > 0) {
      const { dataUrl, format } = renderGradientSlice({
        gradient,
        natW,
        natH,
        srcY,
        srcH,
      });
      try {
        doc.saveGraphicsState();
        applyClip();
        doc.addImage(dataUrl, format, x, y, w, h);
        doc.restoreGraphicsState();
      } catch (e) {
        console.warn('[htmlpdf] gradient addImage failed:', e);
      }
    }
  }

  // 3. 再画背景图（叠加在背景色/渐变上）
  if (node.bgSrc) {
    const elW = toMM(node.width);
    const elH = toMM(node.height);
    const natW = node.bgNaturalWidth;
    const natH = node.bgNaturalHeight;

    if (natW > 0 && natH > 0) {
      const { imgW, imgH } = calcBgImageSize({
        bgSize: style.backgroundSize,
        elW,
        elH,
        natW,
        natH,
      });
      const { offX, offY } = calcBgImagePos({
        bgPos: style.backgroundPosition,
        elW,
        elH,
        imgW,
        imgH,
      });

      // 背景图左上角：基于节点原始顶部（nodeTop），跨页时可能在当前页之上
      const imgX = toPdfX(node.x) + offX;
      const imgY = toPdfYmm(nodeTop + offY);

      try {
        doc.saveGraphicsState();
        applyClip();
        doc.addImage(
          node.bgSrc,
          node.bgFormat || 'JPEG',
          imgX,
          imgY,
          imgW,
          imgH,
        );
        doc.restoreGraphicsState();
      } catch (e) {
        console.warn('[htmlpdf] bgImage addImage failed:', e);
      }
    }
  }
}

export { drawBackground };
