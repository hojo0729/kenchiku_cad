import { describe, expect, it } from 'vitest';
import { cornerAngle, curveInfo, direction, formatArea, pickCurve, polygonArea, polygonPerimeter, polylineLength } from './measure';
import { nearestOnCurve, snapPoint } from './snap';

describe('測る', () => {
  it('連続: 折れ線の合計と曲がり角', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 6000, y: 0 },
      { x: 6000, y: 7200 },
    ];
    expect(polylineLength(pts)).toBe(13200);
    expect(cornerAngle(pts[0], pts[1], pts[2])).toBeCloseTo(90);
  });

  it('面積: 6000×7200 の長方形は 43.2㎡、周長 26400', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 6000, y: 0 },
      { x: 6000, y: 7200 },
      { x: 0, y: 7200 },
    ];
    expect(polygonArea(pts)).toBe(43_200_000);
    expect(formatArea(polygonArea(pts))).toBe('43.20㎡');
    expect(polygonPerimeter(pts)).toBe(26400);
    // 逆回りでも正
    expect(polygonArea([...pts].reverse())).toBe(43_200_000);
  });

  it('距離の傾き（水平から 0〜90度）', () => {
    expect(direction({ x: 0, y: 0 }, { x: 1000, y: 1000 }).fromHorizontal).toBeCloseTo(45);
    expect(direction({ x: 0, y: 0 }, { x: -1000, y: 0 }).fromHorizontal).toBeCloseTo(0);
    expect(direction({ x: 0, y: 0 }, { x: 0, y: -500 }).fromHorizontal).toBeCloseTo(90);
  });

  it('円弧: 半径・弧長・弦・開き角（350度→10度のように0度をまたぐ弧も）', () => {
    const q = curveInfo({ c: { x: 0, y: 0 }, r: 1000, a0: 0, a1: 90 });
    expect(q.sweep).toBe(90);
    expect(q.arcLength).toBeCloseTo((Math.PI * 1000) / 2);
    expect(q.chord).toBeCloseTo(Math.SQRT2 * 1000);
    expect(curveInfo({ c: { x: 0, y: 0 }, r: 1000, a0: 350, a1: 10 }).sweep).toBe(20);
    const c = curveInfo({ c: { x: 0, y: 0 }, r: 450 });
    expect(c.diameter).toBe(900);
    expect(c.circumference).toBeCloseTo(900 * Math.PI);
  });

  it('タップした近くの円・円弧を選ぶ', () => {
    const curves = [
      { c: { x: 0, y: 0 }, r: 1000 },
      { c: { x: 5000, y: 0 }, r: 500, a0: 0, a1: 180 },
    ];
    expect(pickCurve({ x: 1010, y: 0 }, curves, 50)).toBe(curves[0]);
    expect(pickCurve({ x: 5000, y: 505 }, curves, 50)).toBe(curves[1]);
    // 円弧の無い側（下半分）は端からの距離になる
    expect(pickCurve({ x: 5000, y: -505 }, curves, 50)).toBeNull();
  });
});

describe('円・円弧への吸着', () => {
  it('円の上のいちばん近い点', () => {
    const p = nearestOnCurve({ x: 2000, y: 0 }, { c: { x: 0, y: 0 }, r: 1000 });
    expect(p.x).toBeCloseTo(1000);
    expect(p.y).toBeCloseTo(0);
  });

  it('円弧の外側の角度なら近いほうの端', () => {
    const p = nearestOnCurve({ x: 1000, y: -100 }, { c: { x: 0, y: 0 }, r: 1000, a0: 0, a1: 90 });
    expect(p.x).toBeCloseTo(1000);
    expect(p.y).toBeCloseTo(0);
  });

  it('snapPoint で線上（円）に吸着する', () => {
    const s = snapPoint({ x: 0, y: 1020 }, [], 50, 0, [], [{ c: { x: 0, y: 0 }, r: 1000 }]);
    expect(s.kind).toBe('online');
    expect(s.point.y).toBeCloseTo(1000);
  });
});
