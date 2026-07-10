import { describe, it, expect } from 'vitest';
import {
  parsePdfFontNames,
  buildEffectiveFontConfig,
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
