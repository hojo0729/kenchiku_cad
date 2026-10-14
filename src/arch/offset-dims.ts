import type { Drawing } from '../model';
import { LAYER_DIM_OFFSET } from '../model';
import { columnRect } from './column';
import { formatDim, gridPositions } from './grid';
import type { Prim } from './primitives';
import { wallRect } from './wall';

/**
 * 寄り寸法: 通り芯から部材の各面までの寸法を自動で描く（躯体図の要）。
 * - 柱: 下に X方向（左面｜通り芯｜右面）、左に Y方向（下面｜通り芯｜上面）
 * - 壁: 区間の 1/4 の位置に、厚み方向（面｜通り芯｜面）
 * 部材が動けば寸法も一緒に変わる（毎回、部材から作り直すので）。
 */

/**
 * 寸法の連なり（chain）を作る。
 * @param stops 寸法の区切り位置（並び順は問わない。同じ位置は1つにまとめる）
 * @param fixed 寸法線の位置（横向きなら y、縦向きなら x）
 * @param horizontal 横向きの寸法か
 * @param k 縮尺（用紙 mm → 実寸 mm）
 */
export function dimChain(stops: number[], fixed: number, horizontal: boolean, k: number, textH = 2): Prim[] {
  const s = [...new Set(stops.map((v) => Math.round(v * 100) / 100))].sort((a, b) => a - b);
  if (s.length < 2) return [];
  const tick = 1 * k;
  const gap = 0.8 * k;
  const P = (along: number, across: number) => (horizontal ? { x: along, y: across } : { x: across, y: along });
  const prims: Prim[] = [{ t: 'line', layer: LAYER_DIM_OFFSET, a: P(s[0], fixed), b: P(s[s.length - 1], fixed) }];
  for (const v of s) {
    const a = horizontal ? { x: v - tick, y: fixed - tick } : { x: fixed - tick, y: v - tick };
    const b = horizontal ? { x: v + tick, y: fixed + tick } : { x: fixed + tick, y: v + tick };
    prims.push({ t: 'line', layer: LAYER_DIM_OFFSET, a, b });
  }
  // 区間が文字より狭いときは、製図の決まりどおり外側に出す（左端の区間は左へ、右端の区間は右へ）
  const charW = textH * k * 0.62;
  for (let i = 0; i + 1 < s.length; i++) {
    const label = formatDim(s[i + 1] - s[i]);
    const narrow = s[i + 1] - s[i] < label.length * charW * 1.3;
    let along = (s[i] + s[i + 1]) / 2;
    let align: 'left' | 'center' | 'right' = 'center';
    if (narrow && i === 0) {
      along = s[0] - tick * 1.5;
      align = 'right';
    } else if (narrow && i === s.length - 2) {
      along = s[s.length - 1] + tick * 1.5;
      align = 'left';
    }
    prims.push({
      t: 'text',
      layer: LAYER_DIM_OFFSET,
      p: horizontal ? { x: along, y: fixed + gap } : { x: fixed - gap, y: along },
      h: textH * k,
      s: label,
      align,
      valign: 'bottom',
      rot: horizontal ? 0 : 90,
    });
  }
  return prims;
}

export function decomposeOffsetDims(d: Drawing): Prim[] {
  if (!d.grid) return [];
  const k = d.scale;
  const { xs, ys } = gridPositions(d.grid);
  const prims: Prim[] = [];
  const away = 4 * k; // 部材の面から寸法線まで（用紙 4mm）

  for (const c of d.columns) {
    const r = columnRect(d, c);
    if (!r) continue;
    const gx = xs[c.xi];
    const gy = ys[c.yi];
    prims.push(...dimChain([r.min.x, gx, r.max.x], r.min.y - away, true, k));
    prims.push(...dimChain([r.min.y, gy, r.max.y], r.min.x - away, false, k));
  }

  for (const w of d.walls) {
    const r = wallRect(d, w);
    if (!r) continue;
    if (w.axis === 'y') {
      // 横の壁: 区間の 1/4 の位置に縦向きの寸法（下面｜通り芯｜上面）
      const x = xs[w.from] + (xs[w.to] - xs[w.from]) / 4;
      prims.push(...dimChain([r.min.y, ys[w.line], r.max.y], x, false, k));
    } else {
      const y = ys[w.from] + (ys[w.to] - ys[w.from]) / 4;
      prims.push(...dimChain([r.min.x, xs[w.line], r.max.x], y, true, k));
    }
  }
  return prims;
}
