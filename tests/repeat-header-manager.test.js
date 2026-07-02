import { describe, it, expect } from 'vitest';
import {
  createRepeatHeaderManager,
  shouldSkipOriginalHeader,
  generateRepeatHeaderPlacements,
} from '../src/core/repeat-header-manager.js';

// ── createRepeatHeaderManager ───────────────────────────────────────────────

describe('createRepeatHeaderManager', () => {
  it('无 tables 配置：返回 null', () => {
    const nodes = [];
    const tables = [];
    expect(createRepeatHeaderManager(nodes, tables)).toBeNull();
  });

  it('tables 无 repeatHeader 配置：返回 null', () => {
    const nodes = [];
    const tables = [{ selector: '#table', pageBreakBorder: '1px solid #ccc' }];
    expect(createRepeatHeaderManager(nodes, tables)).toBeNull();
  });

  it('有 repeatHeader 配置：返回管理器', () => {
    // 创建模拟节点
    const tableEl = { tagName: 'TABLE', id: 'my-table', contains: () => false };
    const headerEl = { tagName: 'THEAD', id: 'header', contains: () => false };

    // 设置 contains 逻辑
    tableEl.contains = (el) => el === headerEl;

    const nodes = [
      { _origEl: tableEl, y: 0, height: 500 },
      { _origEl: headerEl, y: 0, height: 50 },
    ];

    const tables = [{ selector: '#my-table', repeatHeader: '#header' }];

    const manager = createRepeatHeaderManager(nodes, tables);

    expect(manager).not.toBeNull();
    expect(manager.headerMetas).toHaveLength(1);
    expect(manager.getHeaderMetaForNode).toBeDefined();
  });

  it('找不到表格容器：打印警告，返回空 metas', () => {
    const nodes = [];
    const tables = [{ selector: '#non-existent', repeatHeader: '#header' }];

    const manager = createRepeatHeaderManager(nodes, tables);

    expect(manager).not.toBeNull();
    expect(manager.headerMetas).toHaveLength(0);
  });

  it('找不到表头：打印警告，跳过该表格', () => {
    const tableEl = { tagName: 'TABLE', id: 'table', contains: () => false };
    const nodes = [{ _origEl: tableEl, y: 0, height: 500 }];
    const tables = [{ selector: '#table', repeatHeader: '#non-existent' }];

    const manager = createRepeatHeaderManager(nodes, tables);

    expect(manager).not.toBeNull();
    expect(manager.headerMetas).toHaveLength(0);
  });

  it('多个表格配置', () => {
    const table1El = { tagName: 'TABLE', id: 'table1', contains: () => false };
    const header1El = {
      tagName: 'THEAD',
      id: 'header1',
      contains: () => false,
    };
    const table2El = { tagName: 'TABLE', id: 'table2', contains: () => false };
    const header2El = {
      tagName: 'THEAD',
      id: 'header2',
      contains: () => false,
    };

    table1El.contains = (el) => el === header1El;
    table2El.contains = (el) => el === header2El;

    const nodes = [
      { _origEl: table1El, y: 0, height: 500 },
      { _origEl: header1El, y: 0, height: 50 },
      { _origEl: table2El, y: 600, height: 500 },
      { _origEl: header2El, y: 600, height: 50 },
    ];

    const tables = [
      { selector: '#table1', repeatHeader: '#header1' },
      { selector: '#table2', repeatHeader: '#header2' },
    ];

    const manager = createRepeatHeaderManager(nodes, tables);

    expect(manager.headerMetas).toHaveLength(2);
  });
});

// ── shouldSkipOriginalHeader ────────────────────────────────────────────────

describe('shouldSkipOriginalHeader', () => {
  it('无 headerMeta：返回 false', () => {
    const node = { _origEl: {} };
    expect(shouldSkipOriginalHeader(node, null)).toBe(false);
  });

  it('是表头节点本身：返回 true', () => {
    const headerEl = { tagName: 'THEAD' };
    const headerMeta = {
      headerNode: { _origEl: headerEl },
      headerChildren: [],
    };
    const node = { _origEl: headerEl };

    expect(shouldSkipOriginalHeader(node, headerMeta)).toBe(true);
  });

  it('是表头子节点：返回 true', () => {
    const headerEl = {
      tagName: 'THEAD',
      contains: (el) => el.tagName === 'TR',
    };
    const childEl = { tagName: 'TR' };

    const headerMeta = {
      headerNode: { _origEl: headerEl },
      headerChildren: [{ _origEl: childEl }],
    };
    const node = { _origEl: childEl };

    expect(shouldSkipOriginalHeader(node, headerMeta)).toBe(true);
  });

  it('不是表头相关节点：返回 false', () => {
    const headerEl = { tagName: 'THEAD', contains: () => false };
    const otherEl = { tagName: 'TBODY' };

    const headerMeta = {
      headerNode: { _origEl: headerEl },
      headerChildren: [],
    };
    const node = { _origEl: otherEl };

    expect(shouldSkipOriginalHeader(node, headerMeta)).toBe(false);
  });

  it('节点无 _origEl：返回 false', () => {
    const headerMeta = {
      headerNode: { _origEl: {} },
      headerChildren: [],
    };
    const node = { _origEl: null };

    expect(shouldSkipOriginalHeader(node, headerMeta)).toBe(false);
  });
});

// ── generateRepeatHeaderPlacements ──────────────────────────────────────────

describe('generateRepeatHeaderPlacements', () => {
  it('生成表头渲染计划（无子节点）', () => {
    const headerMeta = {
      headerNode: { _origEl: {}, y: 100, height: 50, type: 'element' },
      headerChildren: [],
    };

    const { placements, headerHeightPx } = generateRepeatHeaderPlacements(
      headerMeta,
      2, // 第 2 页
      1000, // 累计 Y 坐标
    );

    expect(headerHeightPx).toBe(50);
    expect(placements).toHaveLength(1);
    expect(placements[0]).toEqual({
      page: 2,
      node: expect.objectContaining({ y: 1000, height: 50 }),
      offsetYpx: 1000,
      type: 'repeat-header',
      isLastSpill: true,
    });
  });

  it('生成表头渲染计划（含子节点）', () => {
    const headerMeta = {
      headerNode: { _origEl: {}, y: 100, height: 50 },
      headerChildren: [
        { _origEl: {}, y: 110, height: 20, type: 'element' }, // 偏移 10
        { _origEl: {}, y: 130, height: 20, type: 'element' }, // 偏移 30
      ],
    };

    const { placements, headerHeightPx } = generateRepeatHeaderPlacements(
      headerMeta,
      2,
      1000,
    );

    expect(headerHeightPx).toBe(50);
    expect(placements).toHaveLength(3); // 1 表头 + 2 子节点

    // 验证表头
    expect(placements[0].type).toBe('repeat-header');
    expect(placements[0].node.y).toBe(1000);

    // 验证子节点
    expect(placements[1].type).toBe('repeat-header-child');
    expect(placements[1].node.y).toBe(1010); // 1000 + 10

    expect(placements[2].type).toBe('repeat-header-child');
    expect(placements[2].node.y).toBe(1030); // 1000 + 30
  });

  it('浅拷贝节点（不修改原始节点）', () => {
    const originalHeaderNode = { _origEl: {}, y: 100, height: 50, foo: 'bar' };
    const headerMeta = {
      headerNode: originalHeaderNode,
      headerChildren: [],
    };

    const { placements } = generateRepeatHeaderPlacements(headerMeta, 2, 1000);

    // 验证原始节点未被修改
    expect(originalHeaderNode.y).toBe(100);

    // 验证新节点继承了其他属性
    expect(placements[0].node.foo).toBe('bar');
    expect(placements[0].node.y).toBe(1000); // 但 y 被覆盖
  });

  it('正确计算子节点相对偏移', () => {
    const headerMeta = {
      headerNode: { y: 200, height: 100 },
      headerChildren: [
        { y: 210, height: 30 }, // 偏移 10
        { y: 250, height: 40 }, // 偏移 50
      ],
    };

    const { placements } = generateRepeatHeaderPlacements(headerMeta, 3, 2000);

    expect(placements[1].node.y).toBe(2010); // 2000 + (210 - 200)
    expect(placements[2].node.y).toBe(2050); // 2000 + (250 - 200)
  });
});
