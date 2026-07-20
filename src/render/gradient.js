// gradient.js
// linear-gradient CSS 解析 + Canvas 渲染工具

import { canvasHasAlpha } from '../utils';

// ─── linear-gradient 解析 ────────────────────────────────────────────────────

/**
 * 将 CSS "to <side/corner>" 关键字转换为角度（deg）
 * CSS gradient 角度定义：0deg = to top，顺时针递增
 */
const DIRECTION_TO_DEG = {
  'to top': 0,
  'to top right': 45,
  'to right': 90,
  'to bottom right': 135,
  'to bottom': 180,
  'to bottom left': 225,
  'to left': 270,
  'to top left': 315,
};

/**
 * 解析单个 color-stop token，返回 { color, pos }
 * pos 为 0~1 的小数（来自百分比），或 null（未指定）
 *
 * 示例输入：
 *   "#1677ff 0%"  → { color: '#1677ff', pos: 0 }
 *   "rgba(0,0,0,0) 100%" → { color: 'rgba(0,0,0,0)', pos: 1 }
 *   "red"         → { color: 'red', pos: null }
 */
function parseColorStop(token) {
  const s = token.trim();

  // 尝试从末尾匹配 <percentage> 或 <length>
  // 百分比：数字 + %；长度 px：先忽略（按 null 处理，均匀分布）
  const posMatch = s.match(/\s+([\d.]+)(%|px)$/);
  let pos = null;
  let colorStr = s;

  if (posMatch) {
    const val = parseFloat(posMatch[1]);
    pos = posMatch[2] === '%' ? val / 100 : null;
    colorStr = s.slice(0, s.length - posMatch[0].length);
  }

  const color = colorStr.trim() || null;
  if (!color) return null;

  return { color, pos };
}

/**
 * 按顶层逗号拆分字符串（忽略括号内的逗号，如 rgba(0,0,0,0) 里的逗号）
 */
function splitTopLevelCommas(str) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;

    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur) parts.push(cur);

  return parts;
}

/**
 * 补齐色标位置：
 * - 首个无 pos → 0
 * - 末个无 pos → 1
 * - 中间无 pos → 在前后已知 pos 之间均匀插值
 */
function fillStopPositions(stops) {
  const result = stops.map((s) => ({ ...s }));
  const n = result.length;

  if (result[0].pos === null) result[0].pos = 0;

  if (result[n - 1].pos === null) result[n - 1].pos = 1;

  let i = 0;
  while (i < n) {
    if (result[i].pos !== null) {
      i++;
      continue;
    }

    const prev = i - 1;
    let next = i + 1;
    while (next < n && result[next].pos === null) next++;
    const count = next - prev;
    for (let k = 1; k < count; k += 1) {
      result[prev + k].pos =
        result[prev].pos + (result[next].pos - result[prev].pos) * (k / count);
    }
    i = next;
  }

  return result;
}

function parseLinearGradientInner(inner) {
  if (!inner) return null;

  const parts = splitTopLevelCommas(inner);
  if (parts.length < 2) return null;

  let angle = 180; // 默认 to bottom
  let stopStart = 0;

  const first = parts[0].trim();

  if (/^to\s+/i.test(first)) {
    const key = first.toLowerCase().replace(/\s+/g, ' ');
    angle = DIRECTION_TO_DEG[key] ?? 180;
    stopStart = 1;
  } else if (/^-?[\d.]+deg$/i.test(first)) {
    angle = parseFloat(first);
    stopStart = 1;
  } else if (/^-?[\d.]+turn$/i.test(first)) {
    angle = parseFloat(first) * 360;
    stopStart = 1;
  }

  const rawStops = parts.slice(stopStart).map(parseColorStop).filter(Boolean);
  if (rawStops.length < 2) return null;

  return { angle, stops: fillStopPositions(rawStops) };
}

/**
 * 解析 CSS linear-gradient() 字符串
 *
 * @param {string} str - 完整的 backgroundImage 值，如
 *   "linear-gradient(135deg, #f00 0%, #00f 100%)"
 *   "linear-gradient(to right, red, blue)"
 *   "linear-gradient(red, blue)"
 * @returns {{ angle: number, stops: Array<{color:string, pos:number}> } | null}
 */
function parseLinearGradient(str) {
  if (!str || !str.includes('linear-gradient')) return null;

  const fnMatch = str.match(
    /linear-gradient\s*\((.+)\)\s*(?:,\s*linear-gradient|$)/s,
  );
  if (!fnMatch) {
    return parseLinearGradientInner(
      str.match(/linear-gradient\s*\((.+)\)$/s)?.[1],
    );
  }

  return parseLinearGradientInner(fnMatch[1]);
}

// ─── 渐变绘制到 Canvas ────────────────────────────────────────────────────────

/**
 * 将 CSS gradient 角度（0deg=to top，顺时针）转为 Canvas createLinearGradient 的两端点坐标
 *
 * 渐变线长度公式（CSS 规范）：|W·sin(a)| + |H·cos(a)|
 */
function gradientEndPoints(w, h, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  const cx = w / 2;
  const cy = h / 2;
  const len = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
  const halfLen = len / 2;

  return {
    x0: cx - Math.sin(a) * halfLen,
    y0: cy + Math.cos(a) * halfLen,
    x1: cx + Math.sin(a) * halfLen,
    y1: cy - Math.cos(a) * halfLen,
  };
}

/**
 * 将渐变直接绘制到当前页片段大小的 canvas 并返回 { dataUrl, format }
 *
 * 优化：只创建 natW × srcH 的 canvas（当前页片段），而非 natW × natH 的完整节点 canvas，
 * 省去先绘制整个节点再裁切的额外内存开销。
 *
 * 原理：渐变端点坐标依据完整节点尺寸（natW × natH）计算，保证方向/比例与 CSS 一致；
 * 绘制前将 canvas 坐标系向上平移 srcY，使渐变在片段内的位置与完整节点对齐。
 *
 * 格式选择：绘制后用 canvasHasAlpha 检测，有透明像素用 PNG，否则用 JPEG（体积更小）
 *
 * @param {object} params
 * @param {object} params.gradient - parseLinearGradient 返回的结果 { angle, stops }
 * @param {number} params.natW     - 节点完整宽度（px）
 * @param {number} params.natH     - 节点完整高度（px）
 * @param {number} params.srcY     - 当前页片段在完整节点中的起始 y（px）
 * @param {number} params.srcH     - 当前页片段高度（px）
 * @returns {{ dataUrl: string, format: 'PNG' | 'JPEG' }}
 */
function renderGradientSlice({ gradient, natW, natH, srcY, srcH }) {
  const { angle, stops } = gradient;
  const { x0, y0, x1, y1 } = gradientEndPoints(natW, natH, angle);

  const canvas = document.createElement('canvas');
  canvas.width = natW;
  canvas.height = srcH;
  const ctx2d = canvas.getContext('2d');

  // 向上平移 srcY：让渐变坐标系的原点对齐完整节点顶部
  ctx2d.translate(0, -srcY);

  const grad = ctx2d.createLinearGradient(x0, y0, x1, y1);
  for (const stop of stops) {
    grad.addColorStop(Math.max(0, Math.min(1, stop.pos)), stop.color);
  }
  ctx2d.fillStyle = grad;
  ctx2d.fillRect(0, srcY, natW, srcH);

  const hasAlpha = canvasHasAlpha(canvas);
  const format = hasAlpha ? 'PNG' : 'JPEG';
  const dataUrl = hasAlpha
    ? canvas.toDataURL('image/png')
    : canvas.toDataURL('image/jpeg', 0.92);

  return { dataUrl, format };
}

export { parseLinearGradient, renderGradientSlice };
