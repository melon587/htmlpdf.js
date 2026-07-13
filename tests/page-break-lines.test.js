import { describe, it, expect } from 'vitest';
import { findLastTrBottomPx } from '../src/core/page-break-lines.js';

describe('findLastTrBottomPx', () => {
  it('无 TR 在当前页范围内：返回 null', () => {
    const trNodes = [{ y: 2000, height: 100 }];
    expect(findLastTrBottomPx(trNodes, 0, 1000)).toBeNull();
  });

  it('TR 底部超出页底（跨页）：不计入，返回 null', () => {
    const trNodes = [{ y: 800, height: 300 }]; // 底部 1100 > 1000
    expect(findLastTrBottomPx(trNodes, 0, 1000)).toBeNull();
  });

  it('单个完整 TR 在页内：返回其底部', () => {
    const trNodes = [{ y: 200, height: 300 }]; // 底部 500
    expect(findLastTrBottomPx(trNodes, 0, 1000)).toBe(500);
  });

  it('多个完整 TR，返回底部最大值', () => {
    const trNodes = [
      { y: 100, height: 200 }, // 底部 300
      { y: 400, height: 300 }, // 底部 700
      { y: 200, height: 100 }, // 底部 300
    ];
    expect(findLastTrBottomPx(trNodes, 0, 1000)).toBe(700);
  });

  it('TR 顶部不在页面范围内（顶部 < pageTopGlobal）：不计入', () => {
    // pageTopGlobal = 1000（第2页起始），TR 在第1页
    const trNodes = [{ y: 500, height: 200 }]; // 顶部 500 < 1000
    expect(findLastTrBottomPx(trNodes, 1000, 2000)).toBeNull();
  });

  it('空 TR 数组：返回 null', () => {
    expect(findLastTrBottomPx([], 0, 1000)).toBeNull();
  });
});
