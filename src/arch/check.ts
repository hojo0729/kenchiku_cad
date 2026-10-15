import type { Drawing, Vec2 } from '../model';
import { columnRect } from './column';
import { formatDim, gridPositions } from './grid';
import { openingRange } from './wall';

/**
 * 図面の整合チェック。図形は変えず、怪しい箇所を一覧にする。
 * 位置（point）をタップすると、その場所へ移動できる。
 */
export type CheckIssue = {
  kind: 'dim' | 'column' | 'opening';
  id: string;
  /** 移動先（図面の座標） */
  point: Vec2;
  message: string;
};

/** 手で書いた寸法の値と、2点の実際の距離の差をこの値（mm）まで許す */
export const DIM_TOLERANCE = 1;

/** 寸法の文字から数値（mm）を取り出す。数字が無ければ null（「約」「SL」など文字だけの注記は見ない） */
export function parseDimText(text: string): number | null {
  const cleaned = text.replace(/[^0-9.\-]/g, '');
  if (!/\d/.test(cleaned)) return null;
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : null;
}

export function checkDrawing(d: Drawing): CheckIssue[] {
  const out: CheckIssue[] = [];

  // 1. 手で書き換えた寸法の値が、実際の距離と違う
  for (const dim of d.dims) {
    if (!dim.text || !dim.text.trim()) continue;
    const typed = parseDimText(dim.text);
    if (typed === null) continue;
    const len = Math.hypot(dim.b.x - dim.a.x, dim.b.y - dim.a.y);
    if (Math.abs(typed - len) > DIM_TOLERANCE) {
      out.push({
        kind: 'dim',
        id: dim.id,
        point: { x: (dim.a.x + dim.b.x) / 2, y: (dim.a.y + dim.b.y) / 2 },
        message: `寸法の値 ${dim.text.trim()} と実際の距離 ${formatDim(Math.round(len))} が違います`,
      });
    }
  }

  if (d.grid) {
    const { xs, ys } = gridPositions(d.grid);

    // 2. 柱が隣の通り芯をまたいでいる（寄りや大きさが大きすぎる）
    for (const c of d.columns) {
      const r = columnRect(d, c);
      if (!r) continue;
      const cx = (r.min.x + r.max.x) / 2;
      const cy = (r.min.y + r.max.y) / 2;
      const type = d.columnTypes.find((t) => t.id === c.typeId);
      const mark = type?.mark ?? '柱';
      const bad: string[] = [];
      if (c.xi > 0 && r.min.x < xs[c.xi - 1]) bad.push('左の通り芯');
      if (c.xi + 1 < xs.length && r.max.x > xs[c.xi + 1]) bad.push('右の通り芯');
      if (c.yi > 0 && r.min.y < ys[c.yi - 1]) bad.push('下の通り芯');
      if (c.yi + 1 < ys.length && r.max.y > ys[c.yi + 1]) bad.push('上の通り芯');
      if (bad.length) {
        out.push({
          kind: 'column',
          id: c.id,
          point: { x: cx, y: cy },
          message: `柱 ${mark} が${bad.join('・')}をまたいでいます（寄りか大きさを確認）`,
        });
      }
    }
  }

  // 3. 開口が壁の長さを越えている
  for (const o of d.openings) {
    const rng = openingRange(d, o);
    if (!rng || !d.grid) continue;
    const { xs, ys } = gridPositions(d.grid);
    const along = rng.wall.axis === 'x' ? ys : xs;
    const wallStart = along[rng.wall.from];
    const wallEnd = along[rng.wall.to];
    if (wallStart === undefined || wallEnd === undefined) continue;
    if (rng.s0 < wallStart - DIM_TOLERANCE || rng.s1 > wallEnd + DIM_TOLERANCE) {
      const mid = (rng.s0 + rng.s1) / 2;
      const line = rng.wall.axis === 'x' ? xs[rng.wall.line] : ys[rng.wall.line];
      out.push({
        kind: 'opening',
        id: o.id,
        point: rng.wall.axis === 'x' ? { x: line, y: mid } : { x: mid, y: line },
        message: `開口が壁の端（通り芯の区間の外）をはみ出しています`,
      });
    }
  }

  return out;
}
