import type { Entity, Vec2 } from './model';
import { distance } from './model';

export type SnapKind = 'endpoint' | 'grid' | 'none';
export type SnapResult = { point: Vec2; kind: SnapKind };

/**
 * 優先順位: 端点 > グリッド > そのまま
 * @param radius 端点を拾う半径（ワールド単位 mm）
 * @param grid グリッド間隔(mm)。0ならグリッドスナップなし
 */
export function snapPoint(
  raw: Vec2,
  entities: readonly Entity[],
  radius: number,
  grid: number,
  extraPoints: readonly Vec2[] = [],
): SnapResult {
  let best: Vec2 | null = null;
  let bestD = radius;
  const consider = (p: Vec2) => {
    const d = distance(raw, p);
    if (d <= bestD) {
      bestD = d;
      best = p;
    }
  };
  for (const e of entities) {
    if (e.kind === 'line') {
      consider(e.a);
      consider(e.b);
    }
  }
  for (const p of extraPoints) consider(p);
  if (best) return { point: { ...(best as Vec2) }, kind: 'endpoint' };

  if (grid > 0) {
    return {
      point: { x: Math.round(raw.x / grid) * grid, y: Math.round(raw.y / grid) * grid },
      kind: 'grid',
    };
  }
  return { point: raw, kind: 'none' };
}
