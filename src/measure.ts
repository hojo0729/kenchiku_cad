import type { Vec2 } from './model';
import { distance } from './model';
import type { Prim } from './arch/primitives';
import { nearestOnCurve, normDeg, type Curve } from './snap';

/**
 * 測る道具の計算。
 *  - dist   2点の距離（X・Y・角度）
 *  - chain  連続（折れ線の合計。区間ごとの長さと、曲がり角の角度）
 *  - curve  円・円弧（タップで半径・直径・弧の長さ・弦・開き角）
 *  - area   面積（点を順にタップ。閉じた多角形の面積と周長）
 */
export type MeasureKind = 'dist' | 'chain' | 'curve' | 'area';

/** 折れ線の長さ */
export function polylineLength(pts: readonly Vec2[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += distance(pts[i - 1], pts[i]);
  return s;
}

/** 多角形の面積（mm²、向きによらず正）。3点未満は 0 */
export function polygonArea(pts: readonly Vec2[]): number {
  if (pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** 多角形の周長（閉じる辺を含む） */
export function polygonPerimeter(pts: readonly Vec2[]): number {
  if (pts.length < 2) return 0;
  return polylineLength(pts) + (pts.length > 2 ? distance(pts[pts.length - 1], pts[0]) : 0);
}

/** a→b の向き（度）。水平右が 0、反時計回り。0〜180 に丸めた「水平からの傾き」も返す */
export function direction(a: Vec2, b: Vec2): { deg: number; fromHorizontal: number } {
  const deg = normDeg((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
  const h = deg % 180;
  return { deg, fromHorizontal: h > 90 ? 180 - h : h };
}

/** a-b-c の b での角度（0〜180度） */
export function cornerAngle(a: Vec2, b: Vec2, c: Vec2): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const l = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (l === 0) return 0;
  const cos = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / l));
  return (Math.acos(cos) * 180) / Math.PI;
}

export type CurveInfo = {
  r: number;
  diameter: number;
  /** 円弧のとき: 開き角（度）、弧の長さ、弦の長さ。円のとき: 円周 */
  sweep?: number;
  arcLength?: number;
  chord?: number;
  circumference?: number;
};

export function curveInfo(cv: Curve): CurveInfo {
  const out: CurveInfo = { r: cv.r, diameter: cv.r * 2 };
  if (cv.a0 === undefined || cv.a1 === undefined) {
    out.circumference = 2 * Math.PI * cv.r;
    return out;
  }
  const sweep = normDeg(cv.a1 - cv.a0) || 360;
  out.sweep = sweep;
  out.arcLength = (Math.PI * cv.r * sweep) / 180;
  out.chord = 2 * cv.r * Math.sin((sweep * Math.PI) / 360);
  return out;
}

/** p にいちばん近い円・円弧（半径 radius 以内）。無ければ null */
export function pickCurve(p: Vec2, curves: readonly Curve[], radius: number): Curve | null {
  let best: Curve | null = null;
  let bestD = radius;
  for (const cv of curves) {
    if (Math.abs(distance(p, cv.c) - cv.r) > bestD) continue;
    const d = distance(p, nearestOnCurve(p, cv));
    if (d <= bestD) {
      bestD = d;
      best = cv;
    }
  }
  return best;
}

/** Prim の円・円弧を Curve にする（dx, dy だけずらす。下敷きの位置合わせ量） */
export function primCurves(prims: readonly Prim[], dx = 0, dy = 0): Curve[] {
  const out: Curve[] = [];
  for (const p of prims) {
    if (p.t === 'circle') out.push({ c: { x: p.c.x + dx, y: p.c.y + dy }, r: p.r });
    else if (p.t === 'arc') out.push({ c: { x: p.c.x + dx, y: p.c.y + dy }, r: p.r, a0: p.a0, a1: p.a1 });
  }
  return out;
}

/** 面積の表示（㎡、小数2桁） */
export function formatArea(mm2: number): string {
  return `${(mm2 / 1e6).toFixed(2)}㎡`;
}

/** 角度の表示（小数1桁、.0 は省く） */
export function formatDeg(d: number): string {
  const s = d.toFixed(1);
  return `${s.endsWith('.0') ? s.slice(0, -2) : s}°`;
}
