import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parsePdfFontNames,
  buildEffectiveFontConfig,
  drawText,
  getCombinedFontStyle,
  findFontForChar,
  isSameFont,
  segmentTextByFont,
  resolveTextLayout,
  applySegmentFont,
  measureSegmentWidths,
  drawSegmentAligned,
  drawMultiSegmentAligned,
} from '../src/render/text.js';

// ── parsePdfFontNames ────────────────────────────────────────────────────────

describe('parsePdfFontNames', () => {
  it('空值返回空数组', () => {
    expect(parsePdfFontNames(null)).toEqual([]);
    expect(parsePdfFontNames(undefined)).toEqual([]);
    expect(parsePdfFontNames('')).toEqual([]);
  });

  it('单字符串返回单元素数组', () => {
    expect(parsePdfFontNames('roboto')).toEqual(['roboto']);
  });

  it('逗号分隔字符串返回多元素数组', () => {
    expect(parsePdfFontNames('roboto,notoSansCJK')).toEqual([
      'roboto',
      'notoSansCJK',
    ]);
  });

  it('逗号分隔字符串去除空格', () => {
    expect(parsePdfFontNames('roboto, notoSansCJK , notoSansArabic')).toEqual([
      'roboto',
      'notoSansCJK',
      'notoSansArabic',
    ]);
  });

  it('数组直接返回（trim 每项）', () => {
    expect(parsePdfFontNames(['roboto', 'notoSansCJK'])).toEqual([
      'roboto',
      'notoSansCJK',
    ]);
  });

  it('数组过滤空字符串', () => {
    expect(parsePdfFontNames(['roboto', '', 'notoSansCJK'])).toEqual([
      'roboto',
      'notoSansCJK',
    ]);
  });
});

// ── buildEffectiveFontConfig ─────────────────────────────────────────────────

const roboto = { fontFamily: 'Roboto', isDefault: true };
const cjk = {
  fontFamily: 'NotoSansCJK',
  charRanges: [[0x4e00, 0x9fff]],
};
const arabic = {
  fontFamily: 'NotoSansArabic',
  charRanges: [[0x0600, 0x06ff]],
};
const globalConfig = [cjk, arabic, roboto];

describe('buildEffectiveFontConfig', () => {
  it('无 pdfFont 时返回全局配置原样', () => {
    const node = { pdfFont: null };
    expect(buildEffectiveFontConfig(node, globalConfig)).toBe(globalConfig);
  });

  it('pdfFont 中字体名不存在时返回全局配置', () => {
    const node = { pdfFont: 'unknownFont' };
    const result = buildEffectiveFontConfig(node, globalConfig);
    expect(result).toBe(globalConfig);
  });

  it('pdfFont 指定无 charRanges 字体时，替换为 isDefault', () => {
    const node = { pdfFont: 'Roboto' };
    const result = buildEffectiveFontConfig(node, globalConfig);
    // Roboto 无 charRanges，作为节点 isDefault
    const defaultEntry = result.find((f) => f.isDefault);
    expect(defaultEntry?.fontFamily).toBe('Roboto');
  });

  it('pdfFont 指定有 charRanges 字体时，插到列表最前', () => {
    const node = { pdfFont: 'NotoSansCJK' };
    const result = buildEffectiveFontConfig(node, globalConfig);
    // NotoSansCJK 有 charRanges，插到最前
    expect(result[0].fontFamily).toBe('NotoSansCJK');
  });

  it('pdfFont 同时指定有 charRanges 和无 charRanges 字体', () => {
    const node = { pdfFont: 'NotoSansCJK,Roboto' };
    const result = buildEffectiveFontConfig(node, globalConfig);
    // NotoSansCJK 有 charRanges → 最前
    expect(result[0].fontFamily).toBe('NotoSansCJK');
    // Roboto 无 charRanges → 替换全局 isDefault
    const defaultEntry = result.find((f) => f.isDefault);
    expect(defaultEntry?.fontFamily).toBe('Roboto');
  });

  it('pdfFont 指定多个有 charRanges 字体时，按声明顺序排列在最前', () => {
    const node = { pdfFont: 'NotoSansArabic,NotoSansCJK' };
    const result = buildEffectiveFontConfig(node, globalConfig);
    expect(result[0].fontFamily).toBe('NotoSansArabic');
    expect(result[1].fontFamily).toBe('NotoSansCJK');
  });

  it('节点 pdfFont 指定的字体不在结果中重复出现', () => {
    const node = { pdfFont: 'NotoSansCJK' };
    const result = buildEffectiveFontConfig(node, globalConfig);
    const cjkEntries = result.filter((f) => f.fontFamily === 'NotoSansCJK');
    expect(cjkEntries).toHaveLength(1);
  });

  it('pdfFont 为数组时同样生效', () => {
    const node = { pdfFont: ['NotoSansCJK', 'Roboto'] };
    const result = buildEffectiveFontConfig(node, globalConfig);
    expect(result[0].fontFamily).toBe('NotoSansCJK');
    const defaultEntry = result.find((f) => f.isDefault);
    expect(defaultEntry?.fontFamily).toBe('Roboto');
  });
});

// ── getCombinedFontStyle ─────────────────────────────────────────────────────

describe('getCombinedFontStyle', () => {
  it('默认返回 normal', () => {
    expect(getCombinedFontStyle('normal', '400')).toBe('normal');
  });

  it('fontWeight bold 关键字 → bold', () => {
    expect(getCombinedFontStyle('normal', 'bold')).toBe('bold');
  });

  it('fontWeight 字符串 700 → bold', () => {
    expect(getCombinedFontStyle('normal', '700')).toBe('bold');
  });

  it('fontWeight 数字 700 → bold', () => {
    expect(getCombinedFontStyle('normal', 700)).toBe('bold');
  });

  it('fontStyle italic → italic', () => {
    expect(getCombinedFontStyle('italic', '400')).toBe('italic');
  });

  it('bold + italic → bolditalic', () => {
    expect(getCombinedFontStyle('italic', 'bold')).toBe('bolditalic');
  });

  it('fontWeight 600 不算 bold', () => {
    expect(getCombinedFontStyle('normal', '600')).toBe('normal');
  });

  it('undefined 参数不崩溃，返回 normal', () => {
    expect(getCombinedFontStyle(undefined, undefined)).toBe('normal');
  });
});

// ── findFontForChar ──────────────────────────────────────────────────────────

const cjkFont = { fontFamily: 'NotoSansCJK', charRanges: [[0x4e00, 0x9fff]] };
const arabicFont = {
  fontFamily: 'NotoSansArabic',
  charRanges: [[0x0600, 0x06ff]],
};
const defaultFont = { fontFamily: 'Roboto', isDefault: true };
const sortedConfig = [cjkFont, arabicFont, defaultFont];

describe('findFontForChar', () => {
  it('CJK 码点命中 cjkFont', () => {
    expect(findFontForChar(0x4e00, sortedConfig)).toBe(cjkFont);
  });

  it('阿拉伯码点命中 arabicFont', () => {
    expect(findFontForChar(0x0600, sortedConfig)).toBe(arabicFont);
  });

  it('range 边界（end）命中', () => {
    expect(findFontForChar(0x9fff, sortedConfig)).toBe(cjkFont);
  });

  it('范围外码点回落到 isDefault', () => {
    expect(findFontForChar(0x0041 /* A */, sortedConfig)).toBe(defaultFont);
  });

  it('无 charRanges 条目被跳过', () => {
    const config = [defaultFont]; // 只有 isDefault，无 charRanges
    expect(findFontForChar(0x4e00, config)).toBe(defaultFont);
  });

  it('无匹配且无 isDefault → null', () => {
    const config = [cjkFont]; // 无 isDefault
    expect(findFontForChar(0x0041, config)).toBeNull();
  });

  it('空配置 → null', () => {
    expect(findFontForChar(0x4e00, [])).toBeNull();
  });
});

// ── isSameFont ───────────────────────────────────────────────────────────────

describe('isSameFont', () => {
  it('同一对象引用 → true', () => {
    expect(isSameFont(cjkFont, cjkFont)).toBe(true);
  });

  it('两者均 null → true', () => {
    expect(isSameFont(null, null)).toBe(true);
  });

  it('一个 null，另一个非 null → false', () => {
    expect(isSameFont(null, cjkFont)).toBe(false);
    expect(isSameFont(cjkFont, null)).toBe(false);
  });

  it('不同对象但属性完全相同 → true', () => {
    const a = { fontFamily: 'Roboto', fontStyle: 'normal', fontWeight: '400' };
    const b = { fontFamily: 'Roboto', fontStyle: 'normal', fontWeight: '400' };
    expect(isSameFont(a, b)).toBe(true);
  });

  it('fontFamily 不同 → false', () => {
    const a = { fontFamily: 'Roboto', fontStyle: 'normal', fontWeight: '400' };
    const b = { fontFamily: 'Arial', fontStyle: 'normal', fontWeight: '400' };
    expect(isSameFont(a, b)).toBe(false);
  });

  it('fontStyle 不同 → false', () => {
    const a = { fontFamily: 'Roboto', fontStyle: 'italic', fontWeight: '400' };
    const b = { fontFamily: 'Roboto', fontStyle: 'normal', fontWeight: '400' };
    expect(isSameFont(a, b)).toBe(false);
  });

  it('fontWeight 不同 → false', () => {
    const a = { fontFamily: 'Roboto', fontStyle: 'normal', fontWeight: '700' };
    const b = { fontFamily: 'Roboto', fontStyle: 'normal', fontWeight: '400' };
    expect(isSameFont(a, b)).toBe(false);
  });
});

// ── segmentTextByFont ────────────────────────────────────────────────────────

describe('segmentTextByFont', () => {
  it('空文本返回 []', () => {
    expect(segmentTextByFont('', sortedConfig)).toEqual([]);
    expect(segmentTextByFont(null, sortedConfig)).toEqual([]);
  });

  it('无字体配置 → 单段 font:null', () => {
    expect(segmentTextByFont('Hello', [])).toEqual([
      { text: 'Hello', font: null },
    ]);
    expect(segmentTextByFont('Hello', null)).toEqual([
      { text: 'Hello', font: null },
    ]);
  });

  it('纯 Latin 文本 → 单段，font = isDefault', () => {
    const segs = segmentTextByFont('Hello', sortedConfig);
    expect(segs).toHaveLength(1);
    expect(segs[0].font).toBe(defaultFont);
    expect(segs[0].text).toBe('Hello');
  });

  it('纯 CJK 文本 → 单段，font = cjkFont', () => {
    const segs = segmentTextByFont('你好', sortedConfig);
    expect(segs).toHaveLength(1);
    expect(segs[0].font).toBe(cjkFont);
  });

  it('Latin + CJK 混合 → 2 段，按脚本边界分割', () => {
    const segs = segmentTextByFont('Hi你好', sortedConfig);
    expect(segs).toHaveLength(2);
    expect(segs[0].text).toBe('Hi');
    expect(segs[0].font).toBe(defaultFont);
    expect(segs[1].text).toBe('你好');
    expect(segs[1].font).toBe(cjkFont);
  });

  it('CJK + Arabic + Latin → 3 段', () => {
    const segs = segmentTextByFont('你\u0600A', sortedConfig);
    expect(segs).toHaveLength(3);
    expect(segs[0].font).toBe(cjkFont);
    expect(segs[1].font).toBe(arabicFont);
    expect(segs[2].font).toBe(defaultFont);
  });

  it('单字符 → 1 段', () => {
    const segs = segmentTextByFont('A', sortedConfig);
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe('A');
  });
});

// ── resolveTextLayout ────────────────────────────────────────────────────────

// 简单的坐标转换 mock
const makeCtx = () => ({
  toPdfX: (px) => px * 0.1,
  toPdfY: (px) => px * 0.1,
  toMM: (px) => px * 0.1,
  toPt: (px) => px * 0.75,
  doc: null, // resolveTextLayout 不使用 doc
});

describe('resolveTextLayout', () => {
  const node = { x: 100, y: 50, width: 200, height: 20 };

  it('textAlign left → x = toPdfX(node.x)', () => {
    const ctx = makeCtx();
    const style = {
      textAlign: 'left',
      direction: 'ltr',
      fontStyle: 'normal',
      fontWeight: '400',
      fontSize: '12px',
    };
    const { x } = resolveTextLayout(node, style, 12, ctx);
    expect(x).toBeCloseTo(10); // 100 * 0.1
  });

  it('textAlign right → x = toPdfX(node.x + node.width)', () => {
    const ctx = makeCtx();
    const style = {
      textAlign: 'right',
      direction: 'ltr',
      fontStyle: 'normal',
      fontWeight: '400',
    };
    const { x } = resolveTextLayout(node, style, 12, ctx);
    expect(x).toBeCloseTo(30); // (100 + 200) * 0.1
  });

  it('textAlign center → x = toPdfX(node.x + node.width / 2)', () => {
    const ctx = makeCtx();
    const style = {
      textAlign: 'center',
      direction: 'ltr',
      fontStyle: 'normal',
      fontWeight: '400',
    };
    const { x } = resolveTextLayout(node, style, 12, ctx);
    expect(x).toBeCloseTo(20); // (100 + 100) * 0.1
  });

  it('y = toPdfY(node.y) + toMM(fontSize)', () => {
    const ctx = makeCtx();
    const style = {
      textAlign: 'left',
      direction: 'ltr',
      fontStyle: 'normal',
      fontWeight: '400',
    };
    const { y } = resolveTextLayout(node, style, 12, ctx);
    expect(y).toBeCloseTo(6.2); // 50*0.1 + 12*0.1 = 5 + 1.2
  });

  it('direction rtl → isRTL=true, rtlOptions 包含所有 BiDi 标志', () => {
    const ctx = makeCtx();
    const style = {
      textAlign: 'right',
      direction: 'rtl',
      fontStyle: 'normal',
      fontWeight: '400',
    };
    const { isRTL, rtlOptions } = resolveTextLayout(node, style, 12, ctx);
    expect(isRTL).toBe(true);
    expect(rtlOptions).toMatchObject({
      isInputVisual: false,
      isOutputVisual: true,
      isInputRtl: true,
      isOutputRtl: false,
      isSymmetricSwapping: true,
    });
  });

  it('direction ltr → isRTL=false, rtlOptions=undefined', () => {
    const ctx = makeCtx();
    const style = {
      textAlign: 'left',
      direction: 'ltr',
      fontStyle: 'normal',
      fontWeight: '400',
    };
    const { isRTL, rtlOptions } = resolveTextLayout(node, style, 12, ctx);
    expect(isRTL).toBe(false);
    expect(rtlOptions).toBeUndefined();
  });

  it('bold weight → fontStyle = bold', () => {
    const ctx = makeCtx();
    const style = {
      textAlign: 'left',
      direction: 'ltr',
      fontStyle: 'normal',
      fontWeight: 'bold',
    };
    const { fontStyle } = resolveTextLayout(node, style, 12, ctx);
    expect(fontStyle).toBe('bold');
  });
});

// ── applySegmentFont ─────────────────────────────────────────────────────────

describe('applySegmentFont', () => {
  let mockDoc;
  let ctx;

  beforeEach(() => {
    mockDoc = { setFont: vi.fn() };
    ctx = { doc: mockDoc };
  });

  it('segment 有 fontFamily → 使用该字体', () => {
    applySegmentFont(ctx, { font: { fontFamily: 'Roboto' } }, 'bold');
    expect(mockDoc.setFont).toHaveBeenCalledWith('Roboto', 'bold');
  });

  it('segment.font 为 null → 回退 helvetica', () => {
    applySegmentFont(ctx, { font: null }, 'normal');
    expect(mockDoc.setFont).toHaveBeenCalledWith('helvetica', 'normal');
  });

  it('segment.font 存在但 fontFamily 为 falsy → 回退 helvetica', () => {
    applySegmentFont(ctx, { font: { fontFamily: '' } }, 'italic');
    expect(mockDoc.setFont).toHaveBeenCalledWith('helvetica', 'italic');
  });
});

// ── measureSegmentWidths ─────────────────────────────────────────────────────

describe('measureSegmentWidths', () => {
  it('返回与 segments 等长的宽度数组，字体切换与顺序一致', () => {
    const calls = [];
    const mockDoc = {
      setFont: vi.fn((f) => calls.push(f)),
      getTextWidth: vi.fn((t) => t.length * 2), // 每字符 2mm
    };
    const ctx = { doc: mockDoc };
    const segments = [
      { text: 'AB', font: { fontFamily: 'Roboto' } },
      { text: 'CD', font: { fontFamily: 'Arial' } },
    ];
    const widths = measureSegmentWidths(segments, 'normal', ctx);
    expect(widths).toEqual([4, 4]);
    expect(calls).toEqual(['Roboto', 'Arial']);
  });

  it('null font 的 segment 回退 helvetica', () => {
    const mockDoc = {
      setFont: vi.fn(),
      getTextWidth: vi.fn(() => 5),
    };
    const ctx = { doc: mockDoc };
    const widths = measureSegmentWidths(
      [{ text: 'X', font: null }],
      'normal',
      ctx,
    );
    expect(widths).toHaveLength(1);
    expect(mockDoc.setFont).toHaveBeenCalledWith('helvetica', 'normal');
  });
});

// ── drawSegmentAligned ───────────────────────────────────────────────────────

describe('drawSegmentAligned', () => {
  let mockDoc;
  let ctx;

  beforeEach(() => {
    mockDoc = {
      setFont: vi.fn(),
      text: vi.fn(),
    };
    ctx = { doc: mockDoc };
  });

  it('textAlign right → doc.text 收到 align:right', () => {
    drawSegmentAligned({
      text: 'Hello',
      fontFamily: 'Roboto',
      ctx,
      x: 10,
      y: 20,
      fontStyle: 'normal',
      textAlign: 'right',
      rtlOptions: undefined,
    });
    expect(mockDoc.text).toHaveBeenCalledWith(
      'Hello',
      10,
      20,
      expect.objectContaining({ align: 'right' }),
    );
  });

  it('textAlign center → doc.text 收到 align:center', () => {
    drawSegmentAligned({
      text: 'Hello',
      fontFamily: null,
      ctx,
      x: 10,
      y: 20,
      fontStyle: 'normal',
      textAlign: 'center',
      rtlOptions: undefined,
    });
    expect(mockDoc.text).toHaveBeenCalledWith(
      'Hello',
      10,
      20,
      expect.objectContaining({ align: 'center' }),
    );
  });

  it('textAlign left → doc.text 不含 align 字段', () => {
    drawSegmentAligned({
      text: 'Hello',
      fontFamily: null,
      ctx,
      x: 10,
      y: 20,
      fontStyle: 'normal',
      textAlign: 'left',
      rtlOptions: undefined,
    });
    const opts = mockDoc.text.mock.calls[0][3];
    expect(opts.align).toBeUndefined();
  });

  it('rtlOptions 传入时被展开到 doc.text 选项', () => {
    const rtlOptions = { isInputRtl: true };
    drawSegmentAligned({
      text: 'مرحبا',
      fontFamily: 'Arabic',
      ctx,
      x: 50,
      y: 20,
      fontStyle: 'normal',
      textAlign: 'left',
      rtlOptions,
    });
    expect(mockDoc.text).toHaveBeenCalledWith(
      'مرحبا',
      50,
      20,
      expect.objectContaining({ isInputRtl: true }),
    );
  });

  it('fontFamily null → setFont 使用 helvetica', () => {
    drawSegmentAligned({
      text: 'X',
      fontFamily: null,
      ctx,
      x: 0,
      y: 0,
      fontStyle: 'normal',
      textAlign: 'left',
      rtlOptions: undefined,
    });
    expect(mockDoc.setFont).toHaveBeenCalledWith('helvetica', 'normal');
  });
});

// ── drawMultiSegmentAligned ──────────────────────────────────────────────────

describe('drawMultiSegmentAligned', () => {
  const makeDocCtx = (widthPerChar = 2) => {
    const calls = [];
    const mockDoc = {
      setFont: vi.fn(),
      getTextWidth: vi.fn((t) => t.length * widthPerChar),
      text: vi.fn((txt, x) => calls.push({ txt, x })),
    };

    return { ctx: { doc: mockDoc }, mockDoc, calls };
  };

  it('left: 从左锚点正向绘制两段', () => {
    const { ctx, calls } = makeDocCtx(2);
    drawMultiSegmentAligned({
      segments: [
        { text: 'AB', font: { fontFamily: 'R' } },
        { text: 'CD', font: { fontFamily: 'A' } },
      ],
      textAlign: 'left',
      x: 0,
      y: 10,
      fontStyle: 'normal',
      ctx,
    });
    expect(calls[0].x).toBeCloseTo(0);
    expect(calls[1].x).toBeCloseTo(4); // 2 chars × 2mm
  });

  it('center: 从中点左移半总宽', () => {
    const { ctx, calls } = makeDocCtx(2);
    drawMultiSegmentAligned({
      segments: [
        { text: 'AB', font: { fontFamily: 'R' } }, // width 4
        { text: 'CD', font: { fontFamily: 'A' } }, // width 4
      ],
      textAlign: 'center',
      x: 20, // 中点
      y: 10,
      fontStyle: 'normal',
      ctx,
    });
    // totalWidth=8, start=20-4=16
    expect(calls[0].x).toBeCloseTo(16);
    expect(calls[1].x).toBeCloseTo(20);
  });

  it('right (LTR): 从 x-totalWidth 开始正序绘制两段', () => {
    const { ctx, calls } = makeDocCtx(2);
    drawMultiSegmentAligned({
      segments: [
        { text: 'AB', font: { fontFamily: 'R' } }, // width 4
        { text: 'CD', font: { fontFamily: 'A' } }, // width 4
      ],
      textAlign: 'right',
      x: 30,
      y: 10,
      fontStyle: 'normal',
      ctx,
      // 无 rtlOptions → LTR 路径
    });
    // totalWidth=8, curX = 30-8=22, 正向: AB@22, CD@26
    expect(calls[0].txt).toBe('AB');
    expect(calls[0].x).toBeCloseTo(22);
    expect(calls[1].txt).toBe('CD');
    expect(calls[1].x).toBeCloseTo(26);
  });

  it('RTL + right: 所有段均注入 rtlOptions（BiDi 统一处理）', () => {
    const { ctx, mockDoc } = makeDocCtx(2);
    const rtlOptions = { isInputRtl: true };
    // 逻辑顺序：[مرحبا(有fontFamily, 10mm), test(无fontFamily, 8mm)]
    // right-align, x=30: curX 从 30 开始
    //   i=0: curX=30-10=20, draw مرحبا@20
    //   i=1: curX=20-8=12,  draw test@12
    drawMultiSegmentAligned({
      segments: [
        { text: 'مرحبا', font: { fontFamily: 'Arabic' } }, // width 10
        { text: 'test', font: null }, // width 8
      ],
      textAlign: 'right',
      x: 30,
      y: 10,
      fontStyle: 'normal',
      ctx,
      rtlOptions,
    });
    const calls = mockDoc.text.mock.calls;
    expect(calls[0][0]).toBe('مرحبا');
    expect(calls[0][1]).toBeCloseTo(20);
    expect(calls[0][3]).toMatchObject({ isInputRtl: true });
    expect(calls[1][0]).toBe('test');
    expect(calls[1][1]).toBeCloseTo(12);
    expect(calls[1][3]).toMatchObject({ isInputRtl: true }); // RTL 模式所有段均注入
  });

  it('RTL + left: 所有段均注入 rtlOptions（BiDi 统一处理）', () => {
    const { ctx, mockDoc } = makeDocCtx(2);
    const rtlOptions = { isInputRtl: true };
    // left-align, x=0: curX 从 0+18=18 开始
    //   i=0: curX=18-10=8, draw مرحبا@8
    //   i=1: curX=8-8=0,   draw test@0
    drawMultiSegmentAligned({
      segments: [
        { text: 'مرحبا', font: { fontFamily: 'Arabic' } }, // width 10
        { text: 'test', font: null }, // width 8
      ],
      textAlign: 'left',
      x: 0,
      y: 10,
      fontStyle: 'normal',
      ctx,
      rtlOptions,
    });
    const calls = mockDoc.text.mock.calls;
    expect(calls[0][0]).toBe('مرحبا');
    expect(calls[0][1]).toBeCloseTo(8);
    expect(calls[0][3]).toMatchObject({ isInputRtl: true });
    expect(calls[1][0]).toBe('test');
    expect(calls[1][1]).toBeCloseTo(0);
    expect(calls[1][3]).toMatchObject({ isInputRtl: true }); // RTL 模式所有段均注入
  });
});

// ── drawText ─────────────────────────────────────────────────────────────────

const makeFullCtx = (widthPerChar = 2) => {
  const mockDoc = {
    setFont: vi.fn(),
    setFontSize: vi.fn(),
    setTextColor: vi.fn(),
    getTextWidth: vi.fn((t) => t.length * widthPerChar),
    text: vi.fn(),
  };

  return {
    ctx: {
      doc: mockDoc,
      toPdfX: (px) => px * 0.1,
      toPdfY: (px) => px * 0.1,
      toMM: (px) => px * 0.1,
      toPt: (px) => px * 0.75,
    },
    mockDoc,
  };
};

describe('drawText', () => {
  it('node.text 为空时直接返回，不调用 doc.text', () => {
    const { ctx, mockDoc } = makeFullCtx();
    drawText({
      node: {
        text: '',
        x: 0,
        y: 0,
        width: 100,
        height: 20,
        style: {
          fontSize: '12px',
          textAlign: 'left',
          direction: 'ltr',
          color: '#000',
          fontStyle: 'normal',
          fontWeight: '400',
        },
        pdfFont: null,
      },
      ctx,
      clipTop: -999,
      sortedFontConfig: [],
    });
    expect(mockDoc.text).not.toHaveBeenCalled();
  });

  it('y < clipTop 时跳过渲染', () => {
    const { ctx, mockDoc } = makeFullCtx();
    drawText({
      node: {
        text: 'hi',
        x: 0,
        y: 5,
        width: 100,
        height: 20,
        style: {
          fontSize: '12px',
          textAlign: 'left',
          direction: 'ltr',
          color: '#000',
          fontStyle: 'normal',
          fontWeight: '400',
        },
        pdfFont: null,
      },
      ctx,
      clipTop: 999,
      sortedFontConfig: [],
    });
    expect(mockDoc.text).not.toHaveBeenCalled();
  });

  it('fontSize <= 0 时跳过渲染', () => {
    const { ctx, mockDoc } = makeFullCtx();
    drawText({
      node: {
        text: 'hi',
        x: 0,
        y: 0,
        width: 100,
        height: 20,
        style: {
          fontSize: '0px',
          textAlign: 'left',
          direction: 'ltr',
          color: '#000',
          fontStyle: 'normal',
          fontWeight: '400',
        },
        pdfFont: null,
      },
      ctx,
      clipTop: -999,
      sortedFontConfig: [],
    });
    expect(mockDoc.text).not.toHaveBeenCalled();
  });

  it('无字体配置 → 单段渲染（drawSegmentAligned 路径）', () => {
    const { ctx, mockDoc } = makeFullCtx();
    drawText({
      node: {
        text: 'Hello',
        x: 0,
        y: 0,
        width: 100,
        height: 20,
        style: {
          fontSize: '12px',
          textAlign: 'left',
          direction: 'ltr',
          color: '#000000',
          fontStyle: 'normal',
          fontWeight: '400',
        },
        pdfFont: null,
      },
      ctx,
      clipTop: -999,
      sortedFontConfig: [],
    });
    expect(mockDoc.text).toHaveBeenCalledTimes(1);
    expect(mockDoc.text.mock.calls[0][0]).toBe('Hello');
  });

  it('多字体配置且文本跨两种字体 → 多段渲染（drawMultiSegmentAligned 路径）', () => {
    const { ctx, mockDoc } = makeFullCtx();
    drawText({
      node: {
        text: 'Hi你好',
        x: 0,
        y: 0,
        width: 100,
        height: 20,
        style: {
          fontSize: '12px',
          textAlign: 'left',
          direction: 'ltr',
          color: '#000000',
          fontStyle: 'normal',
          fontWeight: '400',
        },
        pdfFont: null,
      },
      ctx,
      clipTop: -999,
      sortedFontConfig: [cjkFont, defaultFont],
    });
    // 两段：'Hi'(defaultFont) + '你好'(cjkFont)
    expect(mockDoc.text).toHaveBeenCalledTimes(2);
  });

  it('setTextColor 以 RGB 数组调用', () => {
    const { ctx, mockDoc } = makeFullCtx();
    drawText({
      node: {
        text: 'X',
        x: 0,
        y: 0,
        width: 50,
        height: 20,
        style: {
          fontSize: '10px',
          textAlign: 'left',
          direction: 'ltr',
          color: '#ff0000',
          fontStyle: 'normal',
          fontWeight: '400',
        },
        pdfFont: null,
      },
      ctx,
      clipTop: -999,
      sortedFontConfig: [],
    });
    expect(mockDoc.setTextColor).toHaveBeenCalledWith(255, 0, 0);
  });

  it('无效 color → setTextColor(0,0,0)', () => {
    const { ctx, mockDoc } = makeFullCtx();
    drawText({
      node: {
        text: 'X',
        x: 0,
        y: 0,
        width: 50,
        height: 20,
        style: {
          fontSize: '10px',
          textAlign: 'left',
          direction: 'ltr',
          color: 'not-a-color',
          fontStyle: 'normal',
          fontWeight: '400',
        },
        pdfFont: null,
      },
      ctx,
      clipTop: -999,
      sortedFontConfig: [],
    });
    expect(mockDoc.setTextColor).toHaveBeenCalledWith(0, 0, 0);
  });
});
