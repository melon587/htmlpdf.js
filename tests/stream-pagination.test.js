import { describe, it, expect } from 'vitest';
import {
  buildNodeLastPageMap,
  expandSpillPlacements,
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
