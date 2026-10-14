import { describe, expect, it } from 'vitest';
import type { Prim } from './arch/primitives';
import { rawCandidates, segmentIntersection } from './underlay';

describe('下敷きのスナップ候補', () => {
  it('端点が無い通り芯どうしの交点も拾う', () => {
    const prims: Prim[] = [
      { t: 'line', layer: '通り芯', a: { x: -1000, y: 0 }, b: { x: 14000, y: 0 } },
      { t: 'line', layer: '通り芯', a: { x: 6000, y: -1000 }, b: { x: 6000, y: 8000 } },
    ];
    const c = rawCandidates(prims);
    expect(c).toContainEqual({ p: { x: 6000, y: 0 }, kind: 'intersection' });
    expect(c.filter((x) => x.kind === 'endpoint')).toHaveLength(4);
  });

  it('平行・離れた線は交点なし', () => {
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBeNull();
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: -5 }, { x: 20, y: 5 })).toBeNull();
  });

  it('同じ場所の候補は1つにまとめる', () => {
    const prims: Prim[] = [
      { t: 'line', layer: 'a', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { t: 'line', layer: 'a', a: { x: 10, y: 0 }, b: { x: 10, y: 10 } },
    ];
    expect(rawCandidates(prims).filter((c) => c.p.x === 10 && c.p.y === 0)).toHaveLength(1);
  });
});
