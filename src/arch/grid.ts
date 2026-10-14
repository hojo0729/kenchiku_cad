import type { StructuralGrid, Vec2 } from '../model';
import { LAYER_DIM, LAYER_GRID } from '../model';
import type { Prim } from './primitives';

/** 通り芯の位置（X1, X2… の x 座標と Y1, Y2… の y 座標） */
export function gridPositions(g: StructuralGrid): { xs: number[]; ys: number[] } {
  const acc = (start: number, spans: number[]) => {
    const out = [start];
    for (const s of spans) out.push(out[out.length - 1] + s);
    return out;
  };
  return { xs: acc(g.origin.x, g.xSpans), ys: acc(g.origin.y, g.ySpans) };
}

/** 通り芯同士の交点（スナップ用） */
export function gridIntersections(g: StructuralGrid): Vec2[] {
  const { xs, ys } = gridPositions(g);
  const out: Vec2[] = [];
  for (const x of xs) for (const y of ys) out.push({ x, y });
  return out;
}

/**
 * スパン入力を解釈する。区切りはカンマ・読点・空白。
 * 「7200*3」「7200x3」「7200×3」で同じスパンの繰り返し。
 * 例: "6000, 7200*2, 6000" → [6000, 7200, 7200, 6000]
 */
export function parseSpans(input: string): number[] | null {
  const text = input.normalize('NFKC').trim();
  if (text === '') return [];
  const out: number[] = [];
  for (const token of text.split(/[\s,、]+/).filter(Boolean)) {
    const m = token.match(/^(\d+(?:\.\d+)?)(?:[*x×X](\d+))?$/);
    if (!m) return null;
    const value = Number(m[1]);
    const count = m[2] ? Number(m[2]) : 1;
    if (!(value > 0) || count < 1 || count > 100) return null;
    for (let i = 0; i < count; i++) out.push(value);
  }
  return out;
}

/** 数値を図面の寸法表記に（6000 → "6,000"） */
export function formatDim(v: number): string {
  const r = Math.round(v * 10) / 10;
  const [i, f] = String(Math.abs(r)).split('.');
  const withComma = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (r < 0 ? '-' : '') + withComma + (f ? `.${f}` : '');
}

/**
 * 通り芯を線・円・文字に分解する。
 * 寸法・符号の大きさは「用紙上の mm × 縮尺」で決める（1/50 なら 2.5mm の文字 = 実寸 125mm）。
 *
 * 配置（用紙上の mm）:
 *   外側の通り芯から 12mm に通り芯間寸法、20mm に総寸法、28mm まで通り芯を延ばし、その先に符号の丸。
 *   寸法は下（X方向）と左（Y方向）、符号は上下左右の両端。
 */
export function decomposeGrid(g: StructuralGrid, scale: number): Prim[] {
  const k = scale; // 用紙mm → 実寸mm
  const { xs, ys } = gridPositions(g);
  const minX = xs[0];
  const maxX = xs[xs.length - 1];
  const minY = ys[0];
  const maxY = ys[ys.length - 1];

  const dim1 = 12 * k;
  const dim2 = 20 * k;
  const ext = 28 * k;
  const r = 4.5 * k;
  const labelH = 3.5 * k;
  const dimH = 2.5 * k;
  const tick = 1.5 * k;
  const gap = 1 * k;

  const prims: Prim[] = [];

  // 通り芯（一点鎖線）と符号
  xs.forEach((x, i) => {
    const label = `${g.xPrefix}${i + 1}`;
    prims.push({ t: 'line', layer: LAYER_GRID, a: { x, y: minY - ext }, b: { x, y: maxY + ext }, ltype: 'CENTER' });
    for (const cy of [minY - ext - r, maxY + ext + r]) {
      prims.push({ t: 'circle', layer: LAYER_GRID, c: { x, y: cy }, r });
      prims.push({ t: 'text', layer: LAYER_GRID, p: { x, y: cy }, h: labelH, s: label, align: 'center', valign: 'middle', rot: 0 });
    }
  });
  ys.forEach((y, i) => {
    const label = `${g.yPrefix}${i + 1}`;
    prims.push({ t: 'line', layer: LAYER_GRID, a: { x: minX - ext, y }, b: { x: maxX + ext, y }, ltype: 'CENTER' });
    for (const cx of [minX - ext - r, maxX + ext + r]) {
      prims.push({ t: 'circle', layer: LAYER_GRID, c: { x: cx, y }, r });
      prims.push({ t: 'text', layer: LAYER_GRID, p: { x: cx, y }, h: labelH, s: label, align: 'center', valign: 'middle', rot: 0 });
    }
  });

  // 寸法（下: X方向）
  const xRow = (y: number, stops: number[]) => {
    if (stops.length < 2) return;
    prims.push({ t: 'line', layer: LAYER_DIM, a: { x: stops[0], y }, b: { x: stops[stops.length - 1], y } });
    for (const x of stops) {
      prims.push({ t: 'line', layer: LAYER_DIM, a: { x: x - tick, y: y - tick }, b: { x: x + tick, y: y + tick } });
    }
    for (let i = 0; i < stops.length - 1; i++) {
      prims.push({
        t: 'text', layer: LAYER_DIM, p: { x: (stops[i] + stops[i + 1]) / 2, y: y + gap },
        h: dimH, s: formatDim(stops[i + 1] - stops[i]), align: 'center', valign: 'bottom', rot: 0,
      });
    }
  };
  // 寸法（左: Y方向）。文字は下から上に読む向き（90°）
  const yRow = (x: number, stops: number[]) => {
    if (stops.length < 2) return;
    prims.push({ t: 'line', layer: LAYER_DIM, a: { x, y: stops[0] }, b: { x, y: stops[stops.length - 1] } });
    for (const y of stops) {
      prims.push({ t: 'line', layer: LAYER_DIM, a: { x: x - tick, y: y - tick }, b: { x: x + tick, y: y + tick } });
    }
    for (let i = 0; i < stops.length - 1; i++) {
      prims.push({
        t: 'text', layer: LAYER_DIM, p: { x: x - gap, y: (stops[i] + stops[i + 1]) / 2 },
        h: dimH, s: formatDim(stops[i + 1] - stops[i]), align: 'center', valign: 'bottom', rot: 90,
      });
    }
  };

  xRow(minY - dim1, xs);
  if (xs.length > 2) xRow(minY - dim2, [minX, maxX]);
  yRow(minX - dim1, ys);
  if (ys.length > 2) yRow(minX - dim2, [minY, maxY]);

  return prims;
}
