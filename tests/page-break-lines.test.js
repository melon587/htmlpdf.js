import { describe, it, expect } from 'vitest';
import {
  findLastTrBottomPx,
  collectPageBreakLines,
} from '../src/core/page-break-lines.js';

// ── DOM mock helpers ─────────────────────────────────────────────────────────

/**
 * 创建带 parentElement 链的 mock 元素对象
 * @param {string} tag - 标签名（大写）
 * @param {Object|null} parent - 父 mock 元素
 */
function makeEl(tag, parent = null) {
  return { tagName: tag, parentElement: parent };
}

/**
 * 构造标准的单表格测试场景：
 *   TABLE
 *   └─ TBODY
 *      ├─ TR (trEl1)
 *      └─ TR (trEl2)
 *
 * contentHeightPx = 1000（每页高度）
 * 表格跨 2 页（tableNode.y=0, height=1800）
 * TR1: y=100, height=200 → 底部 300（第1页内）
 * TR2: y=700, height=200 → 底部 900（第1页内）
 * TR3: y=1100, height=200 → 底部 1300（第2页内）
 */
function makeScenario() {
  const tableEl = makeEl('TABLE');
  const tbodyEl = makeEl('TBODY', tableEl);
  const trEl1 = makeEl('TR', tbodyEl);
  const trEl2 = makeEl('TR', tbodyEl);
  const trEl3 = makeEl('TR', tbodyEl);

  const tableNode = {
    tag: 'TABLE',
    _origEl: tableEl,
    y: 0,
    height: 1800,
    type: 'element',
  };
  const trNode1 = { tag: 'TR', _origEl: trEl1, y: 100, height: 200 };
  const trNode2 = { tag: 'TR', _origEl: trEl2, y: 700, height: 200 };
  const trNode3 = { tag: 'TR', _origEl: trEl3, y: 1100, height: 200 };

  const nodes = [tableNode, trNode1, trNode2, trNode3];

  const pageBreakBorderMap = new WeakMap([[tableNode, '1px solid #ccc']]);

  // 第1页 placement（表格 spill 到第2页）
  const placement1 = {
    node: tableNode,
    page: 1,
    offsetYpx: 0,
    clipTopPx: 0,
    pageActualBottomPx: 1000,
  };
  // 第2页 placement（最后一页，表格底部在页内）
  const placement2 = {
    node: tableNode,
    page: 2,
    offsetYpx: 1000,
    clipTopPx: 0,
    pageActualBottomPx: 2000,
  };

  const ctx = { contentHeightPx: 1000 };

  return {
    nodes,
    tableNode,
    trNode1,
    trNode2,
    trNode3,
    pageBreakBorderMap,
    placement1,
    placement2,
    ctx,
  };
}

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

// ── collectPageBreakLines ────────────────────────────────────────────────────

describe('collectPageBreakLines', () => {
  it('非最后页有出口线，最后页无出口线', () => {
    const s = makeScenario();
    const allPlacements = [s.placement1, s.placement2];

    const result = collectPageBreakLines({
      nodes: s.nodes,
      allPlacements,
      ctx: s.ctx,
      pageBreakBorderMap: s.pageBreakBorderMap,
    });

    // 第1页：表格未结束，应有出口线
    expect(result.has(1)).toBe(true);
    expect(result.get(1)).toHaveLength(1);

    // 第2页：tableNode.y + height = 1800 <= pageBottomGlobal 2000，最后页
    expect(result.has(2)).toBe(false);
  });

  it('出口线的 exitAtPx 等于最后一个完整 TR 的底部', () => {
    const s = makeScenario();

    const result = collectPageBreakLines({
      nodes: s.nodes,
      allPlacements: [s.placement1],
      ctx: s.ctx,
      pageBreakBorderMap: s.pageBreakBorderMap,
    });

    // 第1页内完整 TR：trNode1(底300)、trNode2(底900)，最大底部 = 900
    expect(result.get(1)[0].exitAtPx).toBe(900);
  });

  it('出口线携带正确的 node 和 offsetYpx', () => {
    const s = makeScenario();

    const result = collectPageBreakLines({
      nodes: s.nodes,
      allPlacements: [s.placement1],
      ctx: s.ctx,
      pageBreakBorderMap: s.pageBreakBorderMap,
    });

    const line = result.get(1)[0];
    expect(line.node).toBe(s.tableNode);
    expect(line.offsetYpx).toBe(0);
  });

  it('无 pageBreakBorderMap 条目时返回空 Map', () => {
    const s = makeScenario();

    const result = collectPageBreakLines({
      nodes: s.nodes,
      allPlacements: [s.placement1],
      ctx: s.ctx,
      pageBreakBorderMap: new WeakMap(),
    });

    expect(result.size).toBe(0);
  });

  it('当前页内无完整 TR 时，exitAtPx 回退到 pageActualBottomPx', () => {
    const tableEl = makeEl('TABLE');
    const tbodyEl = makeEl('TBODY', tableEl);
    const bigTrEl = makeEl('TR', tbodyEl);

    const tableNode = {
      tag: 'TABLE',
      _origEl: tableEl,
      y: 0,
      height: 3000,
      type: 'element',
    };
    // TR 跨整页（底部 3000 > 1000），第1页内不完整
    const bigTrNode = { tag: 'TR', _origEl: bigTrEl, y: 0, height: 3000 };
    const borderMap = new WeakMap([[tableNode, '1px solid red']]);
    const placement = {
      node: tableNode,
      page: 1,
      offsetYpx: 0,
      clipTopPx: 0,
      pageActualBottomPx: 1000,
    };

    const result = collectPageBreakLines({
      nodes: [tableNode, bigTrNode],
      allPlacements: [placement],
      ctx: { contentHeightPx: 1000 },
      pageBreakBorderMap: borderMap,
    });

    // 无完整 TR → exitAtPx 回退到 pageActualBottomPx = 1000
    expect(result.get(1)[0].exitAtPx).toBe(1000);
  });

  it('多个表格各自独立产生出口线', () => {
    const tableElA = makeEl('TABLE');
    const tbodyElA = makeEl('TBODY', tableElA);
    const trElA = makeEl('TR', tbodyElA);
    const tableNodeA = {
      tag: 'TABLE',
      _origEl: tableElA,
      y: 0,
      height: 1500,
      type: 'element',
    };
    const trNodeA = { tag: 'TR', _origEl: trElA, y: 100, height: 200 };

    const tableElB = makeEl('TABLE');
    const tbodyElB = makeEl('TBODY', tableElB);
    const trElB = makeEl('TR', tbodyElB);
    const tableNodeB = {
      tag: 'TABLE',
      _origEl: tableElB,
      y: 0,
      height: 1500,
      type: 'element',
    };
    const trNodeB = { tag: 'TR', _origEl: trElB, y: 400, height: 200 };

    const borderMap = new WeakMap([
      [tableNodeA, '1px solid blue'],
      [tableNodeB, '2px solid green'],
    ]);
    const placements = [
      {
        node: tableNodeA,
        page: 1,
        offsetYpx: 0,
        clipTopPx: 0,
        pageActualBottomPx: 1000,
      },
      {
        node: tableNodeB,
        page: 1,
        offsetYpx: 0,
        clipTopPx: 0,
        pageActualBottomPx: 1000,
      },
    ];

    const result = collectPageBreakLines({
      nodes: [tableNodeA, trNodeA, tableNodeB, trNodeB],
      allPlacements: placements,
      ctx: { contentHeightPx: 1000 },
      pageBreakBorderMap: borderMap,
    });

    // 第1页应有 2 条出口线（分别来自 A 和 B）
    expect(result.get(1)).toHaveLength(2);
  });
});
