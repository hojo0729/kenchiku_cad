import type { Drawing, Vec2 } from './model';
import { distance } from './model';
import { gridIntersections } from './arch/grid';
import { columnCorners } from './arch/column';
import { wallCorners } from './arch/wall';

export type SnapKind = 'endpoint' | 'intersection' | 'online' | 'grid' | 'none';
/** 線分（線上スナップ用） */
export type Segment = { a: Vec2; b: Vec2 };
/** 円・円弧（線上スナップ用）。a0/a1 は反時計回りの度。無ければ円 */
export type Curve = { c: Vec2; r: number; a0?: number; a1?: number };
export type SnapResult = { point: Vec2; kind: SnapKind };
export type SnapCandidate = { p: Vec2; kind: 'endpoint' | 'intersection' };

/** スナップ候補点: 線の端点と通り芯の交点 */
export function snapCandidates(
  drawing: Drawing,
  extra: readonly Vec2[] = [],
  more: readonly SnapCandidate[] = [],
): SnapCandidate[] {
  const out: SnapCandidate[] = [...more];
  if (drawing.grid) for (const p of gridIntersections(drawing.grid)) out.push({ p, kind: 'intersection' });
  for (const p of columnCorners(drawing)) out.push({ p, kind: 'endpoint' });
  for (const p of wallCorners(drawing)) out.push({ p, kind: 'endpoint' });
  for (const e of drawing.entities) {
    if (e.kind === 'line') {
      out.push({ p: e.a, kind: 'endpoint' });
      out.push({ p: e.b, kind: 'endpoint' });
    }
  }
  for (const p of extra) out.push({ p, kind: 'endpoint' });
  return out;
}

/**
 * 吸着先の選び方: 点（端点・交点）と線上の点を「重み付きの距離」で比べ、いちばん近いものにする。
 * 交点は ×0.5、端点は ×0.7 として点を選ばれやすくする（線上は ×1）。
 * どれも半径外ならグリッド、グリッドも無ければそのまま。
 * @param radius 拾う半径（ワールド単位 mm）
 * @param grid グリッド間隔(mm)。0ならグリッドスナップなし
 * @param segments 線上スナップの対象（線の上のいちばん近い点に吸着）
 */
export function snapPoint(
  raw: Vec2,
  candidates: readonly SnapCandidate[],
  radius: number,
  grid: number,
  segments: readonly Segment[] = [],
  curves: readonly Curve[] = [],
): SnapResult {
  let best: SnapResult | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = distance(raw, c.p);
    if (d > radius) continue;
    const score = d * (c.kind === 'intersection' ? 0.5 : 0.7);
    if (score < bestScore) {
      bestScore = score;
      best = { point: { ...c.p }, kind: c.kind };
    }
  }
  for (const s of segments) {
    const f = nearestOnSegment(raw, s.a, s.b);
    const d = distance(raw, f);
    if (d > radius || d >= bestScore) continue;
    bestScore = d;
    best = { point: f, kind: 'online' };
  }
  for (const cv of curves) {
    // 中心から遠い円は先にはじく（数が多い下敷きでも軽く）
    if (Math.abs(distance(raw, cv.c) - cv.r) > radius) continue;
    const f = nearestOnCurve(raw, cv);
    const d = distance(raw, f);
    if (d > radius || d >= bestScore) continue;
    bestScore = d;
    best = { point: f, kind: 'online' };
  }
  if (best) return best;

  if (grid > 0) {
    return {
      point: { x: Math.round(raw.x / grid) * grid, y: Math.round(raw.y / grid) * grid },
      kind: 'grid',
    };
  }
  return { point: raw, kind: 'none' };
}

/** 線分 a-b の上で p にいちばん近い点 */
export function nearestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { ...a };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** 0〜360 に正規化した角度（度） */
export function normDeg(a: number): number {
  return ((a % 360) + 360) % 360;
}

/** 角度 deg が円弧 a0→a1（反時計回り）の範囲に入るか */
export function onArc(deg: number, a0: number, a1: number): boolean {
  const sweep = normDeg(a1 - a0) || 360;
  return normDeg(deg - a0) <= sweep + 1e-9;
}

/** 円・円弧の上で p にいちばん近い点（円弧の外なら近いほうの端） */
export function nearestOnCurve(p: Vec2, cv: Curve): Vec2 {
  const dx = p.x - cv.c.x;
  const dy = p.y - cv.c.y;
  const at = (deg: number) => ({ x: cv.c.x + cv.r * Math.cos((deg * Math.PI) / 180), y: cv.c.y + cv.r * Math.sin((deg * Math.PI) / 180) });
  const deg = dx === 0 && dy === 0 ? (cv.a0 ?? 0) : (Math.atan2(dy, dx) * 180) / Math.PI;
  if (cv.a0 === undefined || cv.a1 === undefined || onArc(deg, cv.a0, cv.a1)) return at(deg);
  const e0 = at(cv.a0);
  const e1 = at(cv.a1);
  return distance(p, e0) <= distance(p, e1) ? e0 : e1;
}
