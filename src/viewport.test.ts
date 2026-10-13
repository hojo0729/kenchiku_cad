import { describe, expect, it } from 'vitest';
import { Viewport } from './viewport';
import { snapPoint } from './snap';

describe('Viewport', () => {
  it('ワールド⇔スクリーンが往復で一致し、Yが反転する', () => {
    const v = new Viewport();
    v.scale = 0.5;
    v.ox = 100;
    v.oy = 400;
    const s = v.toScreen({ x: 200, y: 100 });
    expect(s).toEqual({ x: 200, y: 350 });
    expect(v.toWorld(s)).toEqual({ x: 200, y: 100 });
  });

  it('zoomAt はカーソル下の点を動かさない', () => {
    const v = new Viewport();
    const screen = { x: 320, y: 240 };
    const before = v.toWorld(screen);
    v.zoomAt(screen, 2.5);
    const after = v.toWorld(screen);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
});

describe('snapPoint', () => {
  const lines = [{ id: '1', kind: 'line' as const, layer: '0', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } }];

  it('近くの端点を優先する', () => {
    const r = snapPoint({ x: 990, y: 8 }, lines, 20, 455);
    expect(r).toEqual({ point: { x: 1000, y: 0 }, kind: 'endpoint' });
  });

  it('端点がなければグリッドに吸着', () => {
    const r = snapPoint({ x: 470, y: 300 }, lines, 20, 455);
    expect(r).toEqual({ point: { x: 455, y: 455 }, kind: 'grid' });
  });
});
