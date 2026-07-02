import { describe, it, expect } from 'vitest';
import {
  parseColor,
  parsePx,
  isVisible,
  getPageBreak,
  buildUnicodeRange,
  decodeCSSContent,
  parseBgSizeVal,
  parseBgPosVal,
  buildFontFaceRule,
  matchesSelector,
} from '../src/utils/index.js';

// ── parseColor ──────────────────────────────────────────────────────────────

describe('parseColor', () => {
  it('解析 rgb() 格式', () => {
    expect(parseColor('rgb(255, 0, 0)')).toEqual([255, 0, 0]);
    expect(parseColor('rgb(0, 255, 0)')).toEqual([0, 255, 0]);
    expect(parseColor('rgb(0, 0, 255)')).toEqual([0, 0, 255]);
  });

  it('解析 rgba() 格式（忽略 alpha）', () => {
    expect(parseColor('rgba(255, 0, 0, 0.5)')).toEqual([255, 0, 0]);
    expect(parseColor('rgba(0, 255, 0, 1)')).toEqual([0, 255, 0]);
  });

  it('解析 #RGB 短格式', () => {
    expect(parseColor('#f00')).toEqual([255, 0, 0]);
    expect(parseColor('#0f0')).toEqual([0, 255, 0]);
    expect(parseColor('#00f')).toEqual([0, 0, 255]);
    expect(parseColor('#abc')).toEqual([170, 187, 204]);
  });

  it('解析 #RRGGBB 长格式', () => {
    expect(parseColor('#ff0000')).toEqual([255, 0, 0]);
    expect(parseColor('#00ff00')).toEqual([0, 255, 0]);
    expect(parseColor('#0000ff')).toEqual([0, 0, 255]);
    expect(parseColor('#aabbcc')).toEqual([170, 187, 204]);
  });

  it('解析 #RRGGBBAA 带透明度（忽略 alpha）', () => {
    expect(parseColor('#ff000080')).toEqual([255, 0, 0]);
    expect(parseColor('#00ff00ff')).toEqual([0, 255, 0]);
  });

  it('大小写不敏感', () => {
    expect(parseColor('#FF0000')).toEqual([255, 0, 0]);
    expect(parseColor('#AbCdEf')).toEqual([171, 205, 239]);
  });

  it('处理 transparent', () => {
    expect(parseColor('transparent')).toBeNull();
  });

  it('处理 rgba(0, 0, 0, 0)', () => {
    expect(parseColor('rgba(0, 0, 0, 0)')).toBeNull();
  });

  it('处理空字符串', () => {
    expect(parseColor('')).toBeNull();
  });

  it('处理 null/undefined', () => {
    expect(parseColor(null)).toBeNull();
    expect(parseColor(undefined)).toBeNull();
  });

  it('处理无效颜色', () => {
    expect(parseColor('invalid')).toBeNull();
    expect(parseColor('rgb(a, b, c)')).toBeNull();
    expect(parseColor('#gggggg')).toBeNull();
  });
});

// ── parsePx ─────────────────────────────────────────────────────────────────

describe('parsePx', () => {
  it('解析 px 值', () => {
    expect(parsePx('10px')).toBe(10);
    expect(parsePx('100px')).toBe(100);
    expect(parsePx('0px')).toBe(0);
  });

  it('解析纯数字', () => {
    expect(parsePx('10')).toBe(10);
    expect(parsePx('100.5')).toBe(100.5);
  });

  it('解析小数', () => {
    expect(parsePx('10.5px')).toBe(10.5);
    expect(parsePx('0.5px')).toBe(0.5);
  });

  it('解析负数', () => {
    expect(parsePx('-10px')).toBe(-10);
    expect(parsePx('-0.5')).toBe(-0.5);
  });

  it('处理空字符串', () => {
    expect(parsePx('')).toBe(0);
  });

  it('处理无效值', () => {
    expect(parsePx('invalid')).toBe(0);
    expect(parsePx('abc')).toBe(0);
  });

  it('处理其他单位（返回数值部分）', () => {
    expect(parsePx('10em')).toBe(10);
    expect(parsePx('50%')).toBe(50);
  });
});

// ── isVisible ───────────────────────────────────────────────────────────────

describe('isVisible', () => {
  it('正常可见元素', () => {
    expect(
      isVisible({ display: 'block', visibility: 'visible', opacity: '1' }),
    ).toBe(true);
  });

  it('display: none', () => {
    expect(
      isVisible({ display: 'none', visibility: 'visible', opacity: '1' }),
    ).toBe(false);
  });

  it('visibility: hidden', () => {
    expect(
      isVisible({ display: 'block', visibility: 'hidden', opacity: '1' }),
    ).toBe(false);
  });

  it('opacity: 0', () => {
    expect(
      isVisible({ display: 'block', visibility: 'visible', opacity: '0' }),
    ).toBe(false);
  });

  it('opacity 小数值大于 0', () => {
    expect(
      isVisible({ display: 'block', visibility: 'visible', opacity: '0.5' }),
    ).toBe(true);
    expect(
      isVisible({ display: 'block', visibility: 'visible', opacity: '0.01' }),
    ).toBe(true);
  });

  it('多个条件同时不满足', () => {
    expect(
      isVisible({ display: 'none', visibility: 'hidden', opacity: '0' }),
    ).toBe(false);
  });
});

// ── getPageBreak ────────────────────────────────────────────────────────────

describe('getPageBreak', () => {
  it('有 page-break="before" 属性', () => {
    const el = { getAttribute: () => 'before', tagName: 'DIV' };
    expect(getPageBreak(el)).toBe('before');
  });

  it('有 page-break="avoid" 属性', () => {
    const el = { getAttribute: () => 'avoid', tagName: 'DIV' };
    expect(getPageBreak(el)).toBe('avoid');
  });

  it('有空 page-break 属性（默认 before）', () => {
    const el = { getAttribute: () => '', tagName: 'DIV' };
    expect(getPageBreak(el)).toBe('before');
  });

  it('有 page-break=true 属性（默认 before）', () => {
    const el = { getAttribute: () => true, tagName: 'DIV' };
    expect(getPageBreak(el)).toBe('before');
  });

  it('AUTO_AVOID_TAGS: TR', () => {
    const el = { getAttribute: () => null, tagName: 'TR' };
    expect(getPageBreak(el)).toBe('avoid');
  });

  it('AUTO_AVOID_TAGS: SVG', () => {
    const el = { getAttribute: () => null, tagName: 'SVG' };
    expect(getPageBreak(el)).toBe('avoid');
  });

  it('AUTO_AVOID_TAGS: VIDEO', () => {
    const el = { getAttribute: () => null, tagName: 'VIDEO' };
    expect(getPageBreak(el)).toBe('avoid');
  });

  it('无 page-break 属性且非特殊标签', () => {
    const el = { getAttribute: () => null, tagName: 'DIV' };
    expect(getPageBreak(el)).toBeNull();
  });
});

// ── buildUnicodeRange ───────────────────────────────────────────────────────

describe('buildUnicodeRange', () => {
  it('单个 Unicode 范围', () => {
    expect(buildUnicodeRange([[0x4e00, 0x9fff]])).toBe(
      'unicode-range: U+4E00-9FFF;',
    );
  });

  it('多个 Unicode 范围', () => {
    expect(
      buildUnicodeRange([
        [0x0600, 0x06ff],
        [0x0750, 0x077f],
      ]),
    ).toBe('unicode-range: U+600-6FF, U+750-77F;');
  });

  it('单字符范围', () => {
    expect(buildUnicodeRange([[0x20, 0x7e]])).toBe('unicode-range: U+20-7E;');
  });

  it('空数组', () => {
    expect(buildUnicodeRange([])).toBe('');
  });

  it('null/undefined', () => {
    expect(buildUnicodeRange(null)).toBe('');
    expect(buildUnicodeRange(undefined)).toBe('');
  });

  it('大写十六进制', () => {
    const result = buildUnicodeRange([[0xabcd, 0xef01]]);
    expect(result).toBe('unicode-range: U+ABCD-EF01;');
  });
});

// ── decodeCSSContent ────────────────────────────────────────────────────────

describe('decodeCSSContent', () => {
  it('解码字符串（双引号）', () => {
    expect(decodeCSSContent('"Hello"')).toBe('Hello');
    expect(decodeCSSContent('"World"')).toBe('World');
  });

  it('解码字符串（单引号）', () => {
    expect(decodeCSSContent("'Hello'")).toBe('Hello');
  });

  it('解码 Unicode 转义（4 位）', () => {
    expect(decodeCSSContent('"\\2713"')).toBe('✓');
    expect(decodeCSSContent('"\\2605"')).toBe('★');
  });

  it('解码 Unicode 转义（6 位）', () => {
    expect(decodeCSSContent('"\\01F600"')).toBe('😀');
  });

  it('解码 Unicode 转义（带空格作为终止符）', () => {
    // CSS 规范：转义后的空格作为终止符被消耗
    expect(decodeCSSContent('"\\2713 "')).toBe('✓');
    // 如果需要保留空格，需要两个空格（第一个被消耗，第二个保留）
    expect(decodeCSSContent('"\\2713  "')).toBe('✓ ');
  });

  it('解码转义字符', () => {
    expect(decodeCSSContent('"\\n"')).toBe('n'); // \n → n
    expect(decodeCSSContent('"\\\\"')).toBe('\\'); // \\ → \
    expect(decodeCSSContent('"\\""')).toBe('"'); // \" → "
  });

  it('混合文本和 Unicode', () => {
    expect(decodeCSSContent('"Hello \\2713"')).toBe('Hello ✓');
  });

  it('处理 none', () => {
    expect(decodeCSSContent('none')).toBe('');
  });

  it('处理 normal', () => {
    expect(decodeCSSContent('normal')).toBe('');
  });

  it('处理空字符串', () => {
    expect(decodeCSSContent('')).toBe('');
  });

  it('处理 null/undefined', () => {
    expect(decodeCSSContent(null)).toBe('');
    expect(decodeCSSContent(undefined)).toBe('');
  });

  it('不支持的语法：counter() 返回空', () => {
    expect(decodeCSSContent('counter(item)')).toBe('');
  });

  it('不支持的语法：attr() 返回空', () => {
    expect(decodeCSSContent('attr(data-label)')).toBe('');
  });

  it('不支持的语法：url() 返回空', () => {
    expect(decodeCSSContent('url(icon.png)')).toBe('');
  });

  it('不支持的语法：open-quote 返回空', () => {
    expect(decodeCSSContent('open-quote')).toBe('');
  });
});

// ── parseBgSizeVal ──────────────────────────────────────────────────────────

describe('parseBgSizeVal', () => {
  it('解析百分比', () => {
    expect(parseBgSizeVal('50%', 100)).toBe(50);
    expect(parseBgSizeVal('100%', 200)).toBe(200);
    expect(parseBgSizeVal('25%', 400)).toBe(100);
  });

  it('解析 px 值', () => {
    expect(parseBgSizeVal('100px', 0)).toBe(100);
    expect(parseBgSizeVal('50.5px', 0)).toBe(50.5);
  });

  it('解析纯数字', () => {
    expect(parseBgSizeVal('100', 0)).toBe(100);
  });
});

// ── parseBgPosVal ───────────────────────────────────────────────────────────

describe('parseBgPosVal', () => {
  it('关键字：left/top', () => {
    expect(parseBgPosVal('left', 100, 50)).toBe(0);
    expect(parseBgPosVal('top', 100, 50)).toBe(0);
  });

  it('关键字：right/bottom', () => {
    expect(parseBgPosVal('right', 100, 50)).toBe(50);
    expect(parseBgPosVal('bottom', 200, 50)).toBe(150);
  });

  it('关键字：center', () => {
    expect(parseBgPosVal('center', 100, 50)).toBe(25);
    expect(parseBgPosVal('center', 200, 100)).toBe(50);
  });

  it('百分比', () => {
    expect(parseBgPosVal('50%', 100, 50)).toBe(25);
    expect(parseBgPosVal('100%', 100, 50)).toBe(50);
    expect(parseBgPosVal('0%', 100, 50)).toBe(0);
  });

  it('px 值', () => {
    expect(parseBgPosVal('10px', 0, 0)).toBe(10);
    expect(parseBgPosVal('25.5px', 0, 0)).toBe(25.5);
  });
});

// ── buildFontFaceRule ───────────────────────────────────────────────────────

describe('buildFontFaceRule', () => {
  it('生成基础 @font-face', () => {
    const config = {
      fontFamily: 'Roboto',
      fontStyle: 'normal',
      fontWeight: 400,
    };
    const result = buildFontFaceRule(config, 'BASE64DATA');

    expect(result).toContain("font-family: 'Roboto'");
    expect(result).toContain('font-style: normal');
    expect(result).toContain('font-weight: 400');
    expect(result).toContain('BASE64DATA');
  });

  it('包含 charRanges', () => {
    const config = {
      fontFamily: 'NotoSansCJK',
      charRanges: [[0x4e00, 0x9fff]],
    };
    const result = buildFontFaceRule(config, 'BASE64');

    expect(result).toContain('unicode-range: U+4E00-9FFF;');
  });

  it('默认 font-style 和 font-weight', () => {
    const config = { fontFamily: 'TestFont' };
    const result = buildFontFaceRule(config, 'BASE64');

    expect(result).toContain('font-style: normal');
    expect(result).toContain('font-weight: 400');
  });
});

// ── matchesSelector ─────────────────────────────────────────────────────────

describe('matchesSelector', () => {
  it('ID 选择器（#my-id）', () => {
    const el = { id: 'my-id', matches: () => false };
    expect(matchesSelector(el, '#my-id')).toBe(true);
  });

  it('类选择器（.my-class）', () => {
    const el = {
      classList: { contains: (c) => c === 'my-class' },
      matches: () => false,
    };
    expect(matchesSelector(el, '.my-class')).toBe(true);
  });

  it('通用选择器（使用 matches）', () => {
    const el = { matches: (sel) => sel === 'div.container' };
    expect(matchesSelector(el, 'div.container')).toBe(true);
  });

  it('不匹配', () => {
    const el = { id: 'other', matches: () => false };
    expect(matchesSelector(el, '#my-id')).toBe(false);
  });

  it('处理 null 元素', () => {
    expect(matchesSelector(null, '#my-id')).toBe(false);
  });

  it('处理 undefined 元素', () => {
    expect(matchesSelector(undefined, '.my-class')).toBe(false);
  });
});
