import { describe, it, expect } from 'vitest';
import {
  buildNodeLastPageMap,
  expandSpillPlacements,
  buildRepeatHeaderPageSet,
} from '../src/core/stream-pagination.js';

// ── buildNodeLastPageMap ────────────────────────────────────────────────────

describe('buildNodeLastPageMap', () => {
  it('单节点单页：返回该节点的页码', () => {
    const el = {};
    const placements = [{ page: 1, node: { _origEl: el } }];
    const map = buildNodeLastPageMap(placements);
    expect(map.get(el)).toBe(1);
  });

  it('同一节点跨多页（spill）：返回最大页码', () => {
    const el = {};
    const placements = [
      { page: 1, node: { _origEl: el } },
      { page: 3, node: { _origEl: el } },
      { page: 2, node: { _origEl: el } },
    ];
    const map = buildNodeLastPageMap(placements);
    expect(map.get(el)).toBe(3);
  });

  it('父子节点：子节点页码更大时，父节点应继承子节点最大页码', () => {
    const parentEl = { parentElement: null };
    const childEl = { parentElement: parentEl };

    const placements = [
      { page: 1, node: { _origEl: parentEl } },
      { page: 3, node: { _origEl: childEl } },
    ];
    const map = buildNodeLastPageMap(placements);
    expect(map.get(parentEl)).toBe(3);
    expect(map.get(childEl)).toBe(3);
  });

  it('无 _origEl 的节点跳过，不报错', () => {
    const placements = [{ page: 1, node: { _origEl: null } }];
    expect(() => buildNodeLastPageMap(placements)).not.toThrow();
  });

  it('空数组：返回空 Map', () => {
    const map = buildNodeLastPageMap([]);
    expect(map.size).toBe(0);
  });
});

// ── expandSpillPlacements ───────────────────────────────────────────────────

describe('expandSpillPlacements', () => {
  const contentHeightPx = 1000;

  // 构造 pageStartOffsets：每页从 (page-1)*1000 开始
  function makeOffsets(totalPages) {
    const offsets = new Map();
    for (let p = 1; p <= totalPages; p++) {
      const top = (p - 1) * contentHeightPx;
      offsets.set(p, { pageRawTopPx: top, pageContentTopPx: top });
    }

    return offsets;
  }

  it('节点不溢出（底部在页面内）：不生成 spill', () => {
    const el = {};
    const node = { _origEl: el, type: 'element', y: 0, height: 500 };
    const placements = [{ page: 1, node, offsetYpx: 0, type: 'normal' }];
    const offsets = makeOffsets(1);

    const spills = expandSpillPlacements(
      placements,
      offsets,
      contentHeightPx,
      1,
    );
    expect(spills).toHaveLength(0);
  });

  it('节点溢出到下一页：生成 1 条 spill，isLastSpill = true', () => {
    const el = {};
    const childEl = { parentElement: el };
    // node 本身在第1页，childEl 在第2页 → buildNodeLastPageMap 冒泡后 el 的 lastPage = 2
    const node = { _origEl: el, type: 'element', y: 800, height: 400 };
    const childNode = {
      _origEl: childEl,
      type: 'element',
      y: 1100,
      height: 100,
    };
    const placements = [
      { page: 1, node, offsetYpx: 0, type: 'normal' },
      { page: 2, node: childNode, offsetYpx: 1000, type: 'normal' },
    ];
    const offsets = makeOffsets(2);

    const spills = expandSpillPlacements(
      placements,
      offsets,
      contentHeightPx,
      2,
    );
    expect(spills).toHaveLength(1);
    expect(spills[0].page).toBe(2);
    expect(spills[0].type).toBe('spill');
    expect(spills[0].isLastSpill).toBe(true);
  });

  it('节点溢出跨 3 页：只有最后一条 isLastSpill = true', () => {
    const el = {};
    const childEl = { parentElement: el };
    // node 在第1页，child 在第4页 → el 的 lastPage = 4
    const node = { _origEl: el, type: 'element', y: 800, height: 2500 };
    const childNode = {
      _origEl: childEl,
      type: 'element',
      y: 3100,
      height: 100,
    };
    const placements = [
      { page: 1, node, offsetYpx: 0, type: 'normal' },
      { page: 4, node: childNode, offsetYpx: 3000, type: 'normal' },
    ];
    const offsets = makeOffsets(4);

    const spills = expandSpillPlacements(
      placements,
      offsets,
      contentHeightPx,
      4,
    );
    expect(spills).toHaveLength(3);
    expect(spills[0].isLastSpill).toBe(false);
    expect(spills[1].isLastSpill).toBe(false);
    expect(spills[2].isLastSpill).toBe(true);
  });

  it('text 节点不生成 spill（即使溢出）', () => {
    const el = {};
    const node = { _origEl: el, type: 'text', y: 800, height: 400 };
    const placements = [{ page: 1, node, offsetYpx: 0, type: 'normal' }];
    const offsets = makeOffsets(2);

    const spills = expandSpillPlacements(
      placements,
      offsets,
      contentHeightPx,
      2,
    );
    expect(spills).toHaveLength(0);
  });
});

// ── buildRepeatHeaderPageSet ────────────────────────────────────────────────

describe('buildRepeatHeaderPageSet', () => {
  // 构造 pageStartOffsets：每页高 1000px
  function makeOffsets(totalPages) {
    const offsets = new Map();
    for (let p = 1; p <= totalPages; p++) {
      const top = (p - 1) * 1000;
      offsets.set(p, {
        pageRawTopPx: top,
        pageContentTopPx: top,
        pageActualBottomPx: top + 1000,
        accumulatedYpx: top,
        headerHeightPx: 0,
      });
    }

    return offsets;
  }

  // 构造最小 repeatHeaderManager mock
  function makeManager(headerEl, containerEl) {
    const headerMeta = {
      headerNode: { _origEl: headerEl, y: 0, height: 50 },
      headerChildren: [],
    };

    return {
      getHeaderMetaForNode(node) {
        if (!node._origEl) return null;

        if (!containerEl.contains(node._origEl)) return null;

        return headerMeta;
      },
    };
  }

  it('repeatHeaderManager 为 null：返回空 Map', () => {
    const map = buildRepeatHeaderPageSet([], makeOffsets(3), null, []);
    expect(map.size).toBe(0);
  });

  it('数据行只在首页：不生成任何副本', () => {
    const headerEl = { contains: (el) => el === headerEl };
    const dataEl = {};
    const containerEl = {
      contains: (el) => el === headerEl || el === dataEl,
    };
    const manager = makeManager(headerEl, containerEl);

    // 表头 y=0（page 1），数据行 y=100（page 1）
    const nodes = [
      { _origEl: headerEl, y: 0, height: 50 },
      { _origEl: dataEl, y: 100, height: 20 },
    ];

    const placements = [];
    const map = buildRepeatHeaderPageSet(
      nodes,
      makeOffsets(1),
      manager,
      placements,
    );

    expect(map.size).toBe(0);
    expect(placements).toHaveLength(0);
  });

  it('数据行跨 page 1-3：page 2、3 各生成一个 repeat-header 副本', () => {
    const headerEl = { contains: (el) => el === headerEl };
    const dataEl1 = {};
    const dataEl2 = {};
    const containerEl = {
      contains: (el) => el === headerEl || el === dataEl1 || el === dataEl2,
    };
    const manager = makeManager(headerEl, containerEl);

    // 表头在 page 1，数据行分别在 page 2（y=1100）和 page 3（y=2100）
    const nodes = [
      { _origEl: headerEl, y: 0, height: 50 },
      { _origEl: dataEl1, y: 1100, height: 20 },
      { _origEl: dataEl2, y: 2100, height: 20 },
    ];

    const placements = [];
    const map = buildRepeatHeaderPageSet(
      nodes,
      makeOffsets(3),
      manager,
      placements,
    );

    // page 2 和 page 3 各有一个 origEl 的副本
    expect(map.get(2)?.has(headerEl)).toBe(true);
    expect(map.get(3)?.has(headerEl)).toBe(true);
    // 生成了 2 个 repeat-header placement（无子节点）
    expect(placements).toHaveLength(2);
    expect(placements.every((p) => p.type === 'repeat-header')).toBe(true);
  });

  it('两个表格互不干扰：各自只在自己的数据行页生成副本', () => {
    // table1：headerEl1，数据行在 page 2
    // table2：headerEl2，数据行在 page 3
    const headerEl1 = { id: 'h1', contains: (el) => el === headerEl1 };
    const headerEl2 = { id: 'h2', contains: (el) => el === headerEl2 };
    const dataEl1 = { id: 'd1' };
    const dataEl2 = { id: 'd2' };

    const meta1 = {
      headerNode: { _origEl: headerEl1, y: 0, height: 50 },
      headerChildren: [],
    };
    const meta2 = {
      headerNode: { _origEl: headerEl2, y: 500, height: 50 },
      headerChildren: [],
    };

    const manager = {
      getHeaderMetaForNode(node) {
        if (node._origEl === headerEl1 || node._origEl === dataEl1) {
          return meta1;
        }

        if (node._origEl === headerEl2 || node._origEl === dataEl2) {
          return meta2;
        }

        return null;
      },
    };

    // table1 表头 page1（y=0），数据行 page2（y=1100）
    // table2 表头 page1（y=500），数据行 page3（y=2100）
    const nodes = [
      { _origEl: headerEl1, y: 0, height: 50 },
      { _origEl: dataEl1, y: 1100, height: 20 },
      { _origEl: headerEl2, y: 500, height: 50 },
      { _origEl: dataEl2, y: 2100, height: 20 },
    ];

    const placements = [];
    const map = buildRepeatHeaderPageSet(
      nodes,
      makeOffsets(3),
      manager,
      placements,
    );

    // page 2 只有 table1 的副本
    expect(map.get(2)?.has(headerEl1)).toBe(true);
    expect(map.get(2)?.has(headerEl2)).toBe(false);

    // page 3 只有 table2 的副本
    expect(map.get(3)?.has(headerEl2)).toBe(true);
    expect(map.get(3)?.has(headerEl1)).toBe(false);

    // 共 2 个 placement
    expect(placements).toHaveLength(2);
  });
});
