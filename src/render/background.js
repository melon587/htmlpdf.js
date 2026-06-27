import { parseColor, parseBgSizeVal, parseBgPosVal } from '../utils';
import { parseLinearGradient, renderGradientSlice } from './gradient';

// ─── 背景图尺寸/位置计算 ─────────────────────────────────────────────────────

/**
 * 根据 backgroundSize / 元素尺寸 / 图片原始尺寸，计算实际渲染的 imgW/imgH（单位 mm）
 *
 * CSS background-size 语义：
 * - cover / contain：按比例缩放覆盖/包含
 * - auto auto（或单值 auto）：图片保持原始尺寸
 * - auto <length>：高度固定，宽度按原始比例等比
 * - <length> auto：宽度固定，高度按原始比例等比
 * - <length> <length>：两个方向独立指定
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
  const px = parts[0] ?? '50%';
  const py = parts[1] ?? '50%';

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
 * @param {boolean} isLastSpill - 是否是该节点的最后一个 spill placement
 *   - true（默认）：背景色只画到节点实际底部
 *   - false（中间 spill 页）：背景色延伸到整页高度（clipBottom），后续内容会覆盖在上面
 */
function drawBackground({ doc, node, ctx, clipBottom, isLastSpill = true }) {
  const { style } = node;
  const nodeTop = ctx.toMM(node.y);
  const nodeBottom = ctx.toMM(node.y + node.height);

  // clipTop 固定为 0（页面顶部），背景从页面顶部开始
  const drawTop = Math.max(nodeTop, 0);
  // 中间 spill 页：背景延伸到整页高度；最后一页：到节点实际底部
  const drawBottom = isLastSpill
    ? Math.min(nodeBottom, clipBottom)
    : clipBottom;
  if (drawBottom <= drawTop) return;

  const x = ctx.toPdfX(node.x);
  const y = ctx.toPdfYmm(drawTop);
  const w = ctx.toMM(node.width);
  const h = drawBottom - drawTop;

  // 1. 先画背景色
  const color = parseColor(style.backgroundColor);
  if (color) {
    doc.setFillColor(color[0], color[1], color[2]);
    doc.rect(x, y, w, h, 'F');
  }

  // 2. 渐变背景（linear-gradient）：解析 → 直接绘制当前页片段 canvas → addImage
  const gradient = parseLinearGradient(style?.backgroundImage);
  if (gradient) {
    // canvas 尺寸使用节点的 CSS 像素尺寸（width/height 已是 px）
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
        doc.rect(x, y, w, h, null);
        doc.clip();
        doc.discardPath();
        doc.addImage(dataUrl, format, x, y, w, h);
        doc.restoreGraphicsState();
      } catch (e) {
        console.warn('[htmlpdf] gradient addImage failed:', e);
      }
    }
  }

  // 3. 再画背景图（叠加在背景色/渐变上）
  if (node.bgSrc) {
    const elW = ctx.toMM(node.width);
    const elH = ctx.toMM(node.height);
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
      const imgX = ctx.toPdfX(node.x) + offX;
      const imgY = ctx.toPdfYmm(nodeTop + offY);

      try {
        // 用裁剪区域限制背景图只在当前页可见范围内绘制，防止跨页溢出
        // style=null：putStyle(null) 直接 return，只建路径不执行 stroke/fill，
        // 避免 style=undefined 时走 defaultPathOperation="S" 产生意外描边
        doc.saveGraphicsState();
        doc.rect(x, y, w, h, null);
        doc.clip();
        doc.discardPath();
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
