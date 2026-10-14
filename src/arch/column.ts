import type { Column, ColumnType, Drawing, Vec2 } from '../model';
import { LAYER_COLUMN } from '../model';
import { gridPositions } from './grid';
import type { Prim } from './primitives';

export type ColumnRect = { min: Vec2; max: Vec2 };

/** 柱の外形（通り芯が無い・番号が範囲外・符号が無いときは null） */
export function columnRect(d: Drawing, c: Column): ColumnRect | null {
  if (!d.grid) return null;
  const type = d.columnTypes.find((t) => t.id === c.typeId);
  if (!type) return null;
  const { xs, ys } = gridPositions(d.grid);
  if (c.xi < 0 || c.xi >= xs.length || c.yi < 0 || c.yi >= ys.length) return null;
  const left = c.left ?? type.bx / 2;
  const bottom = c.bottom ?? type.by / 2;
  const x0 = xs[c.xi] - left;
  const y0 = ys[c.yi] - bottom;
  return { min: { x: x0, y: y0 }, max: { x: x0 + type.bx, y: y0 + type.by } };
}

/** 柱を外形線と符号の文字に分解 */
export function decomposeColumns(d: Drawing): Prim[] {
  const prims: Prim[] = [];
  for (const c of d.columns) {
    const r = columnRect(d, c);
    const type = d.columnTypes.find((t) => t.id === c.typeId);
    if (!r || !type) continue;
    const p = [
      { x: r.min.x, y: r.min.y },
      { x: r.max.x, y: r.min.y },
      { x: r.max.x, y: r.max.y },
      { x: r.min.x, y: r.max.y },
    ];
    for (let i = 0; i < 4; i++) prims.push({ t: 'line', layer: LAYER_COLUMN, a: p[i], b: p[(i + 1) % 4] });
    prims.push({
      t: 'text',
      layer: LAYER_COLUMN,
      p: { x: (r.min.x + r.max.x) / 2, y: (r.min.y + r.max.y) / 2 },
      h: 2.5 * d.scale,
      s: type.mark,
      align: 'center',
      valign: 'middle',
      rot: 0,
    });
  }
  return prims;
}

/** 柱の角（スナップ用） */
export function columnCorners(d: Drawing): Vec2[] {
  const out: Vec2[] = [];
  for (const c of d.columns) {
    const r = columnRect(d, c);
    if (!r) continue;
    out.push(r.min, { x: r.max.x, y: r.min.y }, r.max, { x: r.min.x, y: r.max.y });
  }
  return out;
}

export function columnAt(d: Drawing, xi: number, yi: number): Column | undefined {
  return d.columns.find((c) => c.xi === xi && c.yi === yi);
}

/** 一番近い通り芯交点の番号（radius 以内に無ければ null） */
export function nearestIntersection(d: Drawing, p: Vec2, radius: number): { xi: number; yi: number; point: Vec2 } | null {
  if (!d.grid) return null;
  const { xs, ys } = gridPositions(d.grid);
  let best: { xi: number; yi: number; point: Vec2 } | null = null;
  let bestD = radius;
  xs.forEach((x, xi) =>
    ys.forEach((y, yi) => {
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist <= bestD) {
        bestD = dist;
        best = { xi, yi, point: { x, y } };
      }
    }),
  );
  return best;
}

/** 次の符号（C1, C2… の空いている最小の番号） */
export function nextColumnMark(types: readonly ColumnType[]): string {
  const used = new Set(types.map((t) => t.mark));
  for (let n = 1; ; n++) if (!used.has(`C${n}`)) return `C${n}`;
}

/** 交点の名前（X2・Y1） */
export function intersectionName(d: Drawing, xi: number, yi: number): string {
  const g = d.grid;
  return g ? `${g.xPrefix}${xi + 1}・${g.yPrefix}${yi + 1}` : '';
}
