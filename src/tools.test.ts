import { describe, expect, it } from 'vitest';
import { nearestSegment, offsetSegment, orthoConstrain } from './tools';
import { detectGrid, toSpans } from './arch/grid-detect';
import type { Prim } from './arch/primitives';

describe('オフセット', () => {
  const seg = { a: { x: 0, y: 0 }, b: { x: 6000, y: 0 } };
  it('タップした側に平行線を作る', () => {
    expect(offsetSegment(seg, 150, { x: 3000, y: 500 })).toEqual({ a: { x: 0, y: 150 }, b: { x: 6000, y: 150 } });
    expect(offsetSegment(seg, 150, { x: 3000, y: -500 })).toEqual({ a: { x: 0, y: -150 }, b: { x: 6000, y: -150 } });
  });
  it('斜めの線も直角方向にずらす', () => {
    const r = offsetSegment({ a: { x: 0, y: 0 }, b: { x: 1000, y: 1000 } }, 100 * Math.SQRT2, { x: 0, y: 1000 });
    expect(r.a).toEqual({ x: -100, y: 100 });
  });
});

describe('いちばん近い線', () => {
  it('半径内でいちばん近い線分', () => {
    const segs = [
      { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } },
      { a: { x: 0, y: 100 }, b: { x: 1000, y: 100 } },
    ];
    expect(nearestSegment({ x: 500, y: 70 }, segs, 50)?.index).toBe(1);
    expect(nearestSegment({ x: 500, y: 300 }, segs, 50)).toBeNull();
  });
});

describe('直交', () => {
  it('水平・垂直の近い方に固定', () => {
    expect(orthoConstrain({ x: 0, y: 0 }, { x: 1000, y: 80 })).toEqual({ x: 1000, y: 0 });
    expect(orthoConstrain({ x: 0, y: 0 }, { x: 80, y: -1000 })).toEqual({ x: 0, y: -1000 });
  });
});

describe('下敷きから通り芯を拾う', () => {
  const L = (layer: string, ax: number, ay: number, bx: number, by: number): Prim => ({ t: 'line', layer, a: { x: ax, y: ay }, b: { x: bx, y: by } });

  it('通り芯らしい画層の縦線・横線から位置を拾う（外壁などの長い線は無視）', () => {
    const prims: Prim[] = [
      L('通り芯', 100, -1000, 100, 8000),
      L('通り芯', 6100, -1000, 6100, 8000),
      L('通り芯', 6102, 0, 6102, 7000), // 2mm ずれた重複は1本に
      L('通り芯', 13300, -1000, 13300, 8000),
      L('通り芯', -1000, 50, 14000, 50),
      L('通り芯', -1000, 6550, 14000, 6550),
      L('躯体', -300, -300, 13600, -300), // 外壁（長いが画層が違う）
    ];
    const g = detectGrid(prims)!;
    expect(g.byLayer).toBe(true);
    expect(g.xs).toEqual([100, 6101, 13300]);
    expect(g.ys).toEqual([50, 6550]);
    expect(toSpans(g.xs)).toEqual([6001, 7199]);
  });

  it('画層名で見つからなければ長い線から推定', () => {
    const prims: Prim[] = [
      L('A', 0, 0, 0, 9000),
      L('A', 6000, 0, 6000, 9000),
      L('A', 0, 0, 6000, 0),
      L('A', 0, 9000, 6000, 9000),
      L('A', 1000, 1000, 1000, 1500), // 短い線は無視
    ];
    const g = detectGrid(prims)!;
    expect(g.byLayer).toBe(false);
    expect(g.xs).toEqual([0, 6000]);
    expect(g.ys).toEqual([0, 9000]);
  });

  it('線が無ければ null', () => {
    expect(detectGrid([])).toBeNull();
  });
});
