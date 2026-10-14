import type { Prim } from './primitives';

/**
 * 下敷き（設計図）から通り芯の位置を拾う。
 *
 * 1. 画層名が通り芯らしい（通り・芯・GRID・CENTER など）縦線・横線があればそれを使う
 * 2. 無ければ、図面全体の長さの半分以上ある縦線・横線を通り芯の候補にする
 * 3. 近い位置（5mm 以内）の線はまとめて1本とみなす
 *
 * 外壁線などを拾ってしまうこともあるので、結果は通り芯パネルに入れて人が確認してから描く。
 */
export type DetectedGrid = {
  /** X通りの x 座標（左から、下敷きの座標系） */
  xs: number[];
  /** Y通りの y 座標（下から） */
  ys: number[];
  /** 通り芯らしい画層名で見つけたか（false なら長い線から推定） */
  byLayer: boolean;
};

const GRID_LAYER = /通り|芯|grid|center|^cl$|^c\.l/i;
const MERGE = 5;

type L = { a: { x: number; y: number }; b: { x: number; y: number }; layer: string };

export function detectGrid(prims: readonly Prim[]): DetectedGrid | null {
  const lines: L[] = [];
  for (const p of prims) if (p.t === 'line') lines.push(p);

  const vertical = (l: L) => Math.abs(l.a.x - l.b.x) < 1 && Math.abs(l.a.y - l.b.y) > 1;
  const horizontal = (l: L) => Math.abs(l.a.y - l.b.y) < 1 && Math.abs(l.a.x - l.b.x) > 1;

  const named = lines.filter((l) => GRID_LAYER.test(l.layer));
  const namedV = named.filter(vertical);
  const namedH = named.filter(horizontal);
  if (namedV.length && namedH.length) {
    return { xs: cluster(namedV.map((l) => (l.a.x + l.b.x) / 2)), ys: cluster(namedH.map((l) => (l.a.y + l.b.y) / 2)), byLayer: true };
  }

  // 画層名で見つからないときは、図面全体の半分以上の長さの線
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const l of lines) {
    minX = Math.min(minX, l.a.x, l.b.x);
    maxX = Math.max(maxX, l.a.x, l.b.x);
    minY = Math.min(minY, l.a.y, l.b.y);
    maxY = Math.max(maxY, l.a.y, l.b.y);
  }
  if (!Number.isFinite(minX)) return null;
  const longV = lines.filter((l) => vertical(l) && Math.abs(l.a.y - l.b.y) >= (maxY - minY) * 0.5);
  const longH = lines.filter((l) => horizontal(l) && Math.abs(l.a.x - l.b.x) >= (maxX - minX) * 0.5);
  if (!longV.length || !longH.length) return null;
  return { xs: cluster(longV.map((l) => l.a.x)), ys: cluster(longH.map((l) => l.a.y)), byLayer: false };
}

/** 並べて、MERGE 以内の値を平均して1つにする */
function cluster(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[][] = [];
  for (const v of sorted) {
    const last = out[out.length - 1];
    if (last && v - last[last.length - 1] <= MERGE) last.push(v);
    else out.push([v]);
  }
  return out.map((g) => Math.round((g.reduce((s, v) => s + v, 0) / g.length) * 10) / 10);
}

/** 位置の並びからスパンへ */
export function toSpans(positions: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < positions.length; i++) out.push(Math.round((positions[i] - positions[i - 1]) * 10) / 10);
  return out;
}
