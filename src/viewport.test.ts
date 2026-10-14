import { describe, expect, it } from 'vitest';
import { Viewport } from './viewport';
import { snapCandidates, snapPoint } from './snap';
import { createDrawing } from './model';

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
  const d = createDrawing();
  d.entities.push({ id: '1', kind: 'line', layer: '0', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } });
  const lines = snapCandidates(d);

  it('近くの端点を優先する', () => {
    const r = snapPoint({ x: 990, y: 8 }, lines, 20, 455);
    expect(r).toEqual({ point: { x: 1000, y: 0 }, kind: 'endpoint' });
  });

  it('端点がなければグリッドに吸着', () => {
    const r = snapPoint({ x: 470, y: 300 }, lines, 20, 455);
    expect(r).toEqual({ point: { x: 455, y: 455 }, kind: 'grid' });
  });

  it('通り芯の交点を拾う', () => {
    const g = createDrawing();
    g.grid = { xSpans: [6000], ySpans: [6500], xPrefix: 'X', yPrefix: 'Y', origin: { x: 0, y: 0 } };
    const r = snapPoint({ x: 5980, y: 6510 }, snapCandidates(g), 50, 100);
    expect(r).toEqual({ point: { x: 6000, y: 6500 }, kind: 'intersection' });
  });
});

describe('交点の優先', () => {
  it('柱の角と通り芯の交点が同じくらい近いときは交点を選ぶ', () => {
    const r = snapPoint(
      { x: -70, y: -70 },
      [
        { p: { x: -150, y: -150 }, kind: 'endpoint' },
        { p: { x: 0, y: 0 }, kind: 'intersection' },
      ],
      200,
      0,
    );
    expect(r.kind).toBe('intersection');
  });
});

describe('線上スナップ', () => {
  const seg = [{ a: { x: 0, y: 0 }, b: { x: 10000, y: 0 } }];
  it('点が無いところでは線の上のいちばん近い点に吸着', () => {
    const r = snapPoint({ x: 3333, y: 40 }, [], 100, 100, seg);
    expect(r).toEqual({ point: { x: 3333, y: 0 }, kind: 'online' });
  });
  it('端点が近ければ端点が優先', () => {
    const r = snapPoint({ x: 9960, y: 40 }, [{ p: { x: 10000, y: 0 }, kind: 'endpoint' }], 100, 100, seg);
    expect(r.kind).toBe('endpoint');
  });
  it('線から遠ければグリッド', () => {
    expect(snapPoint({ x: 3333, y: 400 }, [], 100, 100, seg).kind).toBe('grid');
  });
});

describe('点と線の比べ方', () => {
  it('遠くの交点より、指の真下の線を選ぶ', () => {
    const r = snapPoint(
      { x: 3000, y: 50 },
      [{ p: { x: 5000, y: 0 }, kind: 'intersection' }],
      2500,
      0,
      [{ a: { x: 0, y: 0 }, b: { x: 10000, y: 0 } }],
    );
    expect(r).toEqual({ point: { x: 3000, y: 0 }, kind: 'online' });
  });
  it('点のすぐ近くなら、線より点を選ぶ', () => {
    const r = snapPoint(
      { x: 4950, y: 40 },
      [{ p: { x: 5000, y: 0 }, kind: 'intersection' }],
      2500,
      0,
      [{ a: { x: 0, y: 0 }, b: { x: 10000, y: 0 } }],
    );
    expect(r.kind).toBe('intersection');
  });
});
