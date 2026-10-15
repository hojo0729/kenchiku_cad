import { describe, expect, it } from 'vitest';
import { simplifyPolyline, strokeToSegments } from './freehand';

describe('simplifyPolyline', () => {
  it('ほぼ直線の点列は両端だけになる', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: i * 10, y: i * 10 + (i % 2) * 0.3 }));
    const s = simplifyPolyline(pts, 1);
    expect(s).toHaveLength(2);
    expect(s[0]).toEqual(pts[0]);
    expect(s[1]).toEqual(pts[49]);
  });

  it('L字の曲がり角は残る', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 100, y: 100 },
    ];
    const s = simplifyPolyline(pts, 1);
    expect(s).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  });

  it('許容量より小さいずれは消す', () => {
    const pts = [{ x: 0, y: 0 }, { x: 50, y: 0.5 }, { x: 100, y: 0 }];
    expect(simplifyPolyline(pts, 1)).toHaveLength(2);
    expect(simplifyPolyline(pts, 0.1)).toHaveLength(3);
  });
});

describe('strokeToSegments', () => {
  it('短すぎる線分を除き、線分の列にする', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const segs = strokeToSegments(pts, 0.5, 1);
    expect(segs).toEqual([
      { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
      { a: { x: 100, y: 0 }, b: { x: 100, y: 100 } },
    ]);
  });

  it('点が1つ以下なら何も作らない', () => {
    expect(strokeToSegments([{ x: 0, y: 0 }], 1, 1)).toEqual([]);
  });
});
