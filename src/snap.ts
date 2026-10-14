import type { Drawing, Vec2 } from './model';
import { distance } from './model';
import { gridIntersections } from './arch/grid';
import { columnCorners } from './arch/column';

export type SnapKind = 'endpoint' | 'intersection' | 'grid' | 'none';
export type SnapResult = { point: Vec2; kind: SnapKind };
export type SnapCandidate = { p: Vec2; kind: 'endpoint' | 'intersection' };

/** スナップ候補点: 線の端点と通り芯の交点 */
export function snapCandidates(drawing: Drawing, extra: readonly Vec2[] = []): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  if (drawing.grid) for (const p of gridIntersections(drawing.grid)) out.push({ p, kind: 'intersection' });
  for (const p of columnCorners(drawing)) out.push({ p, kind: 'endpoint' });
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
 * 優先順位: 端点・交点 > グリッド > そのまま
 * @param radius 拾う半径（ワールド単位 mm）
 * @param grid グリッド間隔(mm)。0ならグリッドスナップなし
 */
export function snapPoint(raw: Vec2, candidates: readonly SnapCandidate[], radius: number, grid: number): SnapResult {
  let best: SnapCandidate | null = null;
  let bestD = radius;
  for (const c of candidates) {
    const d = distance(raw, c.p);
    if (d <= bestD) {
      bestD = d;
      best = c;
    }
  }
  if (best) return { point: { ...best.p }, kind: best.kind };

  if (grid > 0) {
    return {
      point: { x: Math.round(raw.x / grid) * grid, y: Math.round(raw.y / grid) * grid },
      kind: 'grid',
    };
  }
  return { point: raw, kind: 'none' };
}
