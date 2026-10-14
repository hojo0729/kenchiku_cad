import type { Drawing, Vec2, Wall, WallType } from '../model';
import { LAYER_WALL } from '../model';
import { columnRect } from './column';
import { gridPositions } from './grid';
import type { Prim } from './primitives';

/**
 * 壁。通り芯の上にスパン単位で置き、厚さは符号（W18 など）で決める。
 *
 * 躯体図らしい見た目にするための処理:
 * - 直交する壁がある交点では、その壁の外面まで延ばす（L字の出隅が欠けないように）
 * - 壁どうしが重なる・接するところの線は消して、外形を1本の線にする（L・T・十字・一直線）
 * - 柱の中に入る部分の線は消す（壁は柱の面で止まる）
 * - 同じ直線上に並んだ線はつなげる
 */

export type Rect = { min: Vec2; max: Vec2 };

function typeOf(d: Drawing, w: Wall): WallType | undefined {
  return d.wallTypes.find((t) => t.id === w.typeId);
}

/** 通り芯に直交する方向の、壁の厚み範囲（[左面または下面, 右面または上面]） */
function thicknessRange(d: Drawing, w: Wall, linePos: number): [number, number] | null {
  const t = typeOf(d, w);
  if (!t) return null;
  const off = w.offset ?? t.t / 2;
  return [linePos - off, linePos - off + t.t];
}

/** 壁の外形（交点で直交する壁の外面まで延長済み）。通り芯が無い・範囲外なら null */
export function wallRect(d: Drawing, w: Wall): Rect | null {
  if (!d.grid) return null;
  const { xs, ys } = gridPositions(d.grid);
  const [along, across] = w.axis === 'x' ? [ys, xs] : [xs, ys];
  if (w.line < 0 || w.line >= across.length || w.from < 0 || w.to >= along.length || w.from >= w.to) return null;
  const th = thicknessRange(d, w, across[w.line]);
  if (!th) return null;

  let s0 = along[w.from];
  let s1 = along[w.to];
  // 端の交点で直交する壁があれば、その外面まで延ばす
  for (const o of d.walls) {
    if (o.axis === w.axis || o.id === w.id) continue;
    const pos = along; // 直交する壁は「along」側の通りの上にある
    for (const [end, idx] of [
      [0, w.from],
      [1, w.to],
    ] as const) {
      if (o.line !== idx || o.from > w.line || o.to < w.line) continue;
      const oth = thicknessRange(d, o, pos[idx]);
      if (!oth) continue;
      if (end === 0) s0 = Math.min(s0, oth[0]);
      else s1 = Math.max(s1, oth[1]);
    }
  }
  return w.axis === 'x'
    ? { min: { x: th[0], y: s0 }, max: { x: th[1], y: s1 } }
    : { min: { x: s0, y: th[0] }, max: { x: s1, y: th[1] } };
}

const EPS = 0.5;

function inside(r: Rect, p: Vec2): boolean {
  return p.x >= r.min.x - 1e-6 && p.x <= r.max.x + 1e-6 && p.y >= r.min.y - 1e-6 && p.y <= r.max.y + 1e-6;
}

type Seg = { a: Vec2; b: Vec2 };

/** 壁の外形線（交差部・柱で処理済み、同じ直線上はつないだもの） */
export function wallOutline(d: Drawing): Seg[] {
  const rects: Rect[] = [];
  for (const w of d.walls) {
    const r = wallRect(d, w);
    if (r) rects.push(r);
  }
  if (!rects.length) return [];
  const cols: Rect[] = [];
  for (const c of d.columns) {
    const r = columnRect(d, c);
    if (r) cols.push(r);
  }

  // 水平線は y ごと、垂直線は x ごとに区間を集める
  const horiz = new Map<number, [number, number][]>();
  const vert = new Map<number, [number, number][]>();
  const key = (v: number) => Math.round(v * 100) / 100;

  rects.forEach((r, i) => {
    const others = rects.filter((_, j) => j !== i);
    const edges: { fixed: number; from: number; to: number; horizontal: boolean; out: Vec2 }[] = [
      { fixed: r.min.y, from: r.min.x, to: r.max.x, horizontal: true, out: { x: 0, y: -1 } },
      { fixed: r.max.y, from: r.min.x, to: r.max.x, horizontal: true, out: { x: 0, y: 1 } },
      { fixed: r.min.x, from: r.min.y, to: r.max.y, horizontal: false, out: { x: -1, y: 0 } },
      { fixed: r.max.x, from: r.min.y, to: r.max.y, horizontal: false, out: { x: 1, y: 0 } },
    ];
    for (const e of edges) {
      // 他の壁・柱の境目で区切る
      const cuts = new Set<number>([e.from, e.to]);
      for (const o of [...others, ...cols]) {
        for (const v of e.horizontal ? [o.min.x, o.max.x] : [o.min.y, o.max.y]) if (v > e.from && v < e.to) cuts.add(v);
      }
      const ts = [...cuts].sort((a, b) => a - b);
      for (let k = 0; k + 1 < ts.length; k++) {
        const t0 = ts[k];
        const t1 = ts[k + 1];
        if (t1 - t0 < 1e-6) continue;
        const m = (t0 + t1) / 2;
        const mid = e.horizontal ? { x: m, y: e.fixed } : { x: e.fixed, y: m };
        // 柱の中（面上を含む）は柱が描くので消す
        if (cols.some((c) => inside(c, mid))) continue;
        // 外側すぐの点が他の壁の中なら、壁どうしの内側なので消す
        const outPt = { x: mid.x + e.out.x * EPS, y: mid.y + e.out.y * EPS };
        if (others.some((o) => inside(o, outPt))) continue;
        const map = e.horizontal ? horiz : vert;
        const k2 = key(e.fixed);
        if (!map.has(k2)) map.set(k2, []);
        map.get(k2)!.push([t0, t1]);
      }
    }
  });

  const out: Seg[] = [];
  const emit = (map: Map<number, [number, number][]>, horizontal: boolean) => {
    for (const [fixed, list] of map) {
      list.sort((a, b) => a[0] - b[0]);
      let cur: [number, number] | null = null;
      const flush = () => {
        if (!cur) return;
        out.push(
          horizontal
            ? { a: { x: cur[0], y: fixed }, b: { x: cur[1], y: fixed } }
            : { a: { x: fixed, y: cur[0] }, b: { x: fixed, y: cur[1] } },
        );
      };
      for (const iv of list) {
        if (cur && iv[0] <= cur[1] + 1e-6) cur[1] = Math.max(cur[1], iv[1]);
        else {
          flush();
          cur = [iv[0], iv[1]];
        }
      }
      flush();
    }
  };
  emit(horiz, true);
  emit(vert, false);
  return out;
}

/** 壁を外形線と符号の文字に分解 */
export function decomposeWalls(d: Drawing): Prim[] {
  const prims: Prim[] = wallOutline(d).map((s) => ({ t: 'line', layer: LAYER_WALL, a: s.a, b: s.b }));
  for (const w of d.walls) {
    const r = wallRect(d, w);
    const t = typeOf(d, w);
    if (!r || !t) continue;
    // 符号は壁の中ほど（柱から離れた、通り芯の区間の中央）に。縦の壁は回転
    const cx = (r.min.x + r.max.x) / 2;
    const cy = (r.min.y + r.max.y) / 2;
    prims.push({
      t: 'text',
      layer: LAYER_WALL,
      p: { x: cx, y: cy },
      h: Math.min(2 * d.scale, t.t * 0.7),
      s: t.mark,
      align: 'center',
      valign: 'middle',
      rot: w.axis === 'x' ? 90 : 0,
    });
  }
  return prims;
}

/** 壁の外形線の端点（スナップ用） */
export function wallCorners(d: Drawing): Vec2[] {
  const out: Vec2[] = [];
  for (const s of wallOutline(d)) out.push(s.a, s.b);
  return out;
}

/** 通り芯のスパン（交点〜交点）の線分。壁を置く場所を選ぶのに使う */
export type GridSpan = { axis: 'x' | 'y'; line: number; from: number; to: number; a: Vec2; b: Vec2 };

export function gridSpans(d: Drawing): GridSpan[] {
  if (!d.grid) return [];
  const { xs, ys } = gridPositions(d.grid);
  const out: GridSpan[] = [];
  xs.forEach((x, line) => {
    for (let i = 0; i + 1 < ys.length; i++) out.push({ axis: 'x', line, from: i, to: i + 1, a: { x, y: ys[i] }, b: { x, y: ys[i + 1] } });
  });
  ys.forEach((y, line) => {
    for (let i = 0; i + 1 < xs.length; i++) out.push({ axis: 'y', line, from: i, to: i + 1, a: { x: xs[i], y }, b: { x: xs[i + 1], y } });
  });
  return out;
}

export function nextWallMark(types: readonly WallType[], t: number): string {
  const base = `W${Math.round(t / 10)}`;
  const used = new Set(types.map((x) => x.mark));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** 壁の場所の名前（Y1通り X1〜X2） */
export function wallName(d: Drawing, w: Wall): string {
  const g = d.grid;
  if (!g) return '';
  return w.axis === 'x'
    ? `${g.xPrefix}${w.line + 1}通り ${g.yPrefix}${w.from + 1}〜${g.yPrefix}${w.to + 1}`
    : `${g.yPrefix}${w.line + 1}通り ${g.xPrefix}${w.from + 1}〜${g.xPrefix}${w.to + 1}`;
}

/** 通り芯が減ったときに、範囲外になった壁を除く */
export function wallsInRange(walls: readonly Wall[], nx: number, ny: number): Wall[] {
  return walls.filter((w) => (w.axis === 'x' ? w.line < nx && w.to < ny : w.line < ny && w.to < nx));
}
