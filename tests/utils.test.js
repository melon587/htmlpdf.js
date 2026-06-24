import { describe, it, expect } from 'vitest';

// comparePlacements 和 placementOrder 是 main.js 的内部函数，未导出。
// 这里直接内联相同逻辑进行测试，确保排序行为符合预期。
// 若未来提取为独立模块再改为直接 import。

function placementOrder(p) {
  if (p.type === 'spill') return 0;

  if (p.type === 'repeat-header' || p.type === 'repeat-header-child') return 1;

  return 2;
}

function comparePlacements(a, b) {
  if (a.page !== b.page) return a.page - b.page;

  return placementOrder(a) - placementOrder(b);
}

describe('comparePlacements', () => {
  it('不同页码：按页码升序', () => {
    const a = { page: 2, type: 'normal' };
    const b = { page: 1, type: 'normal' };
    expect(comparePlacements(a, b)).toBeGreaterThan(0);
    expect(comparePlacements(b, a)).toBeLessThan(0);
  });

  it('同页内：spill(0) < repeat-header(1) < normal(2)', () => {
    const spill = { page: 1, type: 'spill' };
    const header = { page: 1, type: 'repeat-header' };
    const headerChild = { page: 1, type: 'repeat-header-child' };
    const normal = { page: 1, type: 'normal' };

    expect(comparePlacements(spill, header)).toBeLessThan(0);
    expect(comparePlacements(header, normal)).toBeLessThan(0);
    expect(comparePlacements(spill, normal)).toBeLessThan(0);
    expect(comparePlacements(headerChild, normal)).toBeLessThan(0);
    expect(comparePlacements(spill, headerChild)).toBeLessThan(0);
  });

  it('同页同类型：返回 0', () => {
    const a = { page: 1, type: 'normal' };
    const b = { page: 1, type: 'normal' };
    expect(comparePlacements(a, b)).toBe(0);
  });

  it('数组排序结果验证', () => {
    const items = [
      { page: 2, type: 'normal' },
      { page: 1, type: 'normal' },
      { page: 1, type: 'spill' },
      { page: 2, type: 'repeat-header' },
      { page: 1, type: 'repeat-header' },
    ];
    const sorted = [...items].sort(comparePlacements);
    expect(sorted.map((p) => `${p.page}:${p.type}`)).toEqual([
      '1:spill',
      '1:repeat-header',
      '1:normal',
      '2:repeat-header',
      '2:normal',
    ]);
  });
});
