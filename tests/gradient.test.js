import { describe, it, expect } from 'vitest';
import {
  parseLinearGradient,
  splitTopLevelCommas,
} from '../src/render/gradient.js';

describe('parseLinearGradient', () => {
  // ── 基础语法 ──────────────────────────────────────────────────────────────

  it('默认方向（to bottom）', () => {
    const result = parseLinearGradient('linear-gradient(red, blue)');
    expect(result).toEqual({
      angle: 180,
      stops: [
        { color: 'red', pos: 0, posPx: null },
        { color: 'blue', pos: 1, posPx: null },
      ],
    });
  });

  it('两个颜色（无位置）', () => {
    const result = parseLinearGradient('linear-gradient(red, blue)');
    expect(result.stops).toHaveLength(2);
    expect(result.stops[0].pos).toBe(0);
    expect(result.stops[1].pos).toBe(1);
  });

  it('三个颜色（无位置，均匀分布）', () => {
    const result = parseLinearGradient('linear-gradient(red, yellow, blue)');
    expect(result.stops).toHaveLength(3);
    expect(result.stops[0].pos).toBe(0);
    expect(result.stops[1].pos).toBe(0.5);
    expect(result.stops[2].pos).toBe(1);
  });

  // ── 方向关键字 ────────────────────────────────────────────────────────────

  it('to top', () => {
    const result = parseLinearGradient('linear-gradient(to top, red, blue)');
    expect(result.angle).toBe(0);
  });

  it('to right', () => {
    const result = parseLinearGradient('linear-gradient(to right, red, blue)');
    expect(result.angle).toBe(90);
  });

  it('to bottom', () => {
    const result = parseLinearGradient('linear-gradient(to bottom, red, blue)');
    expect(result.angle).toBe(180);
  });

  it('to left', () => {
    const result = parseLinearGradient('linear-gradient(to left, red, blue)');
    expect(result.angle).toBe(270);
  });

  it('to top right', () => {
    const result = parseLinearGradient(
      'linear-gradient(to top right, red, blue)',
    );
    expect(result.angle).toBe(45);
  });

  it('to bottom right', () => {
    const result = parseLinearGradient(
      'linear-gradient(to bottom right, red, blue)',
    );
    expect(result.angle).toBe(135);
  });

  it('to bottom left', () => {
    const result = parseLinearGradient(
      'linear-gradient(to bottom left, red, blue)',
    );
    expect(result.angle).toBe(225);
  });

  it('to top left', () => {
    const result = parseLinearGradient(
      'linear-gradient(to top left, red, blue)',
    );
    expect(result.angle).toBe(315);
  });

  // ── 角度单位 ──────────────────────────────────────────────────────────────

  it('角度：0deg', () => {
    const result = parseLinearGradient('linear-gradient(0deg, red, blue)');
    expect(result.angle).toBe(0);
  });

  it('角度：45deg', () => {
    const result = parseLinearGradient('linear-gradient(45deg, red, blue)');
    expect(result.angle).toBe(45);
  });

  it('角度：90deg', () => {
    const result = parseLinearGradient('linear-gradient(90deg, red, blue)');
    expect(result.angle).toBe(90);
  });

  it('角度：180deg', () => {
    const result = parseLinearGradient('linear-gradient(180deg, red, blue)');
    expect(result.angle).toBe(180);
  });

  it('角度：负数 -45deg', () => {
    const result = parseLinearGradient('linear-gradient(-45deg, red, blue)');
    expect(result.angle).toBe(-45);
  });

  it('角度：小数 22.5deg', () => {
    const result = parseLinearGradient('linear-gradient(22.5deg, red, blue)');
    expect(result.angle).toBe(22.5);
  });

  it('角度：turn 单位（0.25turn = 90deg）', () => {
    const result = parseLinearGradient('linear-gradient(0.25turn, red, blue)');
    expect(result.angle).toBe(90);
  });

  it('角度：turn 单位（1turn = 360deg）', () => {
    const result = parseLinearGradient('linear-gradient(1turn, red, blue)');
    expect(result.angle).toBe(360);
  });

  // ── 颜色格式 ──────────────────────────────────────────────────────────────

  it('十六进制颜色', () => {
    const result = parseLinearGradient('linear-gradient(#ff0000, #0000ff)');
    expect(result.stops[0].color).toBe('#ff0000');
    expect(result.stops[1].color).toBe('#0000ff');
  });

  it('rgb() 颜色', () => {
    const result = parseLinearGradient(
      'linear-gradient(rgb(255,0,0), rgb(0,0,255))',
    );
    expect(result.stops[0].color).toBe('rgb(255,0,0)');
    expect(result.stops[1].color).toBe('rgb(0,0,255)');
  });

  it('rgba() 颜色', () => {
    const result = parseLinearGradient(
      'linear-gradient(rgba(255,0,0,0.5), rgba(0,0,255,1))',
    );
    expect(result.stops[0].color).toContain('rgba');
    expect(result.stops[1].color).toContain('rgba');
  });

  it('命名颜色', () => {
    const result = parseLinearGradient('linear-gradient(red, blue)');
    expect(result.stops[0].color).toBe('red');
    expect(result.stops[1].color).toBe('blue');
  });

  // ── 色标位置（百分比）─────────────────────────────────────────────────────

  it('色标位置：0% 和 100%', () => {
    const result = parseLinearGradient('linear-gradient(red 0%, blue 100%)');
    expect(result.stops[0].pos).toBe(0);
    expect(result.stops[1].pos).toBe(1);
  });

  it('色标位置：自定义百分比', () => {
    const result = parseLinearGradient('linear-gradient(red 25%, blue 75%)');
    expect(result.stops[0].pos).toBe(0.25);
    expect(result.stops[1].pos).toBe(0.75);
  });

  it('色标位置：50% 中间色', () => {
    const result = parseLinearGradient(
      'linear-gradient(red 0%, yellow 50%, blue 100%)',
    );
    expect(result.stops[1].pos).toBe(0.5);
  });

  it('色标位置：部分指定（自动补齐）', () => {
    const result = parseLinearGradient(
      'linear-gradient(red, yellow 50%, blue)',
    );
    expect(result.stops[0].pos).toBe(0); // 自动补齐
    expect(result.stops[1].pos).toBe(0.5);
    expect(result.stops[2].pos).toBe(1); // 自动补齐
  });

  it('色标位置：中间多个无位置（插值）', () => {
    const result = parseLinearGradient(
      'linear-gradient(red 0%, yellow, green, blue 100%)',
    );
    expect(result.stops[0].pos).toBe(0);
    expect(result.stops[1].pos).toBeCloseTo(0.333, 2);
    expect(result.stops[2].pos).toBeCloseTo(0.666, 2);
    expect(result.stops[3].pos).toBe(1);
  });

  // ── 多色停点 ──────────────────────────────────────────────────────────────

  it('4 个颜色', () => {
    const result = parseLinearGradient(
      'linear-gradient(red, yellow, green, blue)',
    );
    expect(result.stops).toHaveLength(4);
  });

  it('5 个颜色（均匀分布）', () => {
    const result = parseLinearGradient(
      'linear-gradient(red, orange, yellow, green, blue)',
    );
    expect(result.stops).toHaveLength(5);
    expect(result.stops[2].pos).toBeCloseTo(0.5, 2);
  });

  // ── 复杂组合 ──────────────────────────────────────────────────────────────

  it('完整语法（角度 + 多色 + 位置）', () => {
    const result = parseLinearGradient(
      'linear-gradient(135deg, #1677ff 0%, #52c41a 50%, #fa8c16 100%)',
    );
    expect(result.angle).toBe(135);
    expect(result.stops).toHaveLength(3);
    expect(result.stops[0].color).toBe('#1677ff');
    expect(result.stops[1].pos).toBe(0.5);
  });

  it('rgba + 百分比位置', () => {
    const result = parseLinearGradient(
      'linear-gradient(rgba(255,0,0,0) 0%, rgba(255,0,0,1) 100%)',
    );
    expect(result.stops[0].color).toContain('rgba(255,0,0,0)');
    expect(result.stops[1].color).toContain('rgba(255,0,0,1)');
  });

  // ── 边缘情况 ──────────────────────────────────────────────────────────────

  it('处理空字符串', () => {
    expect(parseLinearGradient('')).toBeNull();
  });

  it('处理 null', () => {
    expect(parseLinearGradient(null)).toBeNull();
  });

  it('处理无效语法（缺少颜色）', () => {
    expect(parseLinearGradient('linear-gradient(red)')).toBeNull();
  });

  it('处理无效语法（只有方向）', () => {
    expect(parseLinearGradient('linear-gradient(to right)')).toBeNull();
  });

  it('处理非 linear-gradient', () => {
    expect(parseLinearGradient('radial-gradient(red, blue)')).toBeNull();
  });

  it('处理包含 linear-gradient 的复杂字符串', () => {
    const result = parseLinearGradient(
      'background: linear-gradient(red, blue)',
    );
    expect(result).toBeTruthy();
    expect(result.stops).toHaveLength(2);
  });

  // ── 实际 CSS 样例 ─────────────────────────────────────────────────────────

  it('Ant Design 主色渐变', () => {
    const result = parseLinearGradient(
      'linear-gradient(135deg, #1677ff 0%, #69c0ff 100%)',
    );
    expect(result.angle).toBe(135);
    expect(result.stops[0].color).toBe('#1677ff');
  });

  it('Material UI 渐变', () => {
    const result = parseLinearGradient(
      'linear-gradient(45deg, #fe6b8b 30%, #ff8e53 90%)',
    );
    expect(result.angle).toBe(45);
    expect(result.stops[0].pos).toBe(0.3);
    expect(result.stops[1].pos).toBe(0.9);
  });

  it('透明渐变', () => {
    const result = parseLinearGradient(
      'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.8) 100%)',
    );
    expect(result.angle).toBe(180);
    expect(result.stops[0].color).toContain('rgba(0,0,0,0)');
  });
});

describe('splitTopLevelCommas', () => {
  it('单个 token，无逗号', () => {
    expect(splitTopLevelCommas('red')).toEqual(['red']);
  });

  it('两个顶层 token', () => {
    expect(splitTopLevelCommas('red, blue')).toEqual(['red', ' blue']);
  });

  it('括号内逗号不拆分', () => {
    const result = splitTopLevelCommas('rgba(0,0,0,0), red');
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('rgba(0,0,0,0)');
    expect(result[1]).toBe(' red');
  });

  it('两个 linear-gradient（多层 background）', () => {
    const input = 'linear-gradient(red, blue), linear-gradient(green, yellow)';
    const parts = splitTopLevelCommas(input);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe('linear-gradient(red, blue)');
    expect(parts[1]).toBe(' linear-gradient(green, yellow)');
  });

  it('嵌套括号（渐变 + rgba 色标）', () => {
    const input =
      'linear-gradient(rgba(255,0,0,0) 0%, rgba(0,0,0,0) 100%),' + ' #722ed1';
    const parts = splitTopLevelCommas(input);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe(
      'linear-gradient(rgba(255,0,0,0) 0%, rgba(0,0,0,0) 100%)',
    );
    expect(parts[1]).toBe(' #722ed1');
  });

  it('空字符串返回空数组', () => {
    expect(splitTopLevelCommas('')).toEqual([]);
  });
});
