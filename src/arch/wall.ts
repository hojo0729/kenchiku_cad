import type { Beam, BeamType, Drawing, Opening, Vec2, Wall, WallType } from '../model';
import { LAYER_BEAM, LAYER_OPENING, LAYER_WALL } from '../model';
import { columnRect } from './column';
import { formatDim, gridPositions } from './grid';
import type { Prim } from './primitives';

/**
 * 壁と梁（どちらも「通り芯の区間に乗る線状の部材」）。
 *
 * 躯体図らしい見た目にするための処理:
 * - 直交する同じ種類の部材がある交点では、その外面まで延ばす（L字の出隅が欠けないように）
 * - 部材どうしが重なる・接するところの線は消して、外形を1本の線にする（L・T・十字・一直線）
 * - 柱の中に入る部分の線は消す（壁・梁は柱の面で止まる）
 * - 同じ直線上に並んだ線はつなげる
 * - 壁は開口の部分を抜く（開口の両端に見切りの線が出る）
 */

export type Rect = { min: Vec2; max: Vec2 };
type Linear = Wall | Beam;
type Seg = { a: Vec2; b: Vec2 };

// ---------- 共通: 線状部材の外形 ----------

/** 通り芯に直交する方向の、部材の厚み範囲（[左面または下面, 右面または上面]） */
function thicknessRange(t: number, offset: number | null, linePos: number): [number, number] {
  const off = offset ?? t / 2;
  return [linePos - off, linePos - off + t];
}

/**
 * 部材の外形。端の交点で直交する同種の部材があれば、その外面まで延ばす。
 * @param width 部材の厚さ（壁の厚さ・梁の幅）。符号が見つからなければ undefined
 */
function linearRect(d: Drawing, m: Linear, all: readonly Linear[], width: (m: Linear) => number | undefined): Rect | null {
  if (!d.grid) return null;
  const { xs, ys } = gridPositions(d.grid);
  const [along, across] = m.axis === 'x' ? [ys, xs] : [xs, ys];
  if (m.line < 0 || m.line >= across.length || m.from < 0 || m.to >= along.length || m.from >= m.to) return null;
  const w = width(m);
  if (w === undefined) return null;
  const th = thicknessRange(w, m.offset, across[m.line]);

  let s0 = along[m.from];
  let s1 = along[m.to];
  for (const o of all) {
    if (o.axis === m.axis || o.id === m.id) continue;
    const ow = width(o);
    if (ow === undefined) continue;
    for (const [end, idx] of [
      [0, m.from],
      [1, m.to],
    ] as const) {
      if (o.line !== idx || o.from > m.line || o.to < m.line) continue;
      const oth = thicknessRange(ow, o.offset, along[idx]);
      if (end === 0) s0 = Math.min(s0, oth[0]);
      else s1 = Math.max(s1, oth[1]);
    }
  }
  return m.axis === 'x'
    ? { min: { x: th[0], y: s0 }, max: { x: th[1], y: s1 } }
    : { min: { x: s0, y: th[0] }, max: { x: s1, y: th[1] } };
}

const EPS = 0.5;

function inside(r: Rect, p: Vec2): boolean {
  return p.x >= r.min.x - 1e-6 && p.x <= r.max.x + 1e-6 && p.y >= r.min.y - 1e-6 && p.y <= r.max.y + 1e-6;
}

/**
 * 矩形の集まりの「和」の外形線。cutters（柱）の中にある部分は除く。
 * 各矩形の辺を他の矩形・柱の境目で区切り、区間ごとに
 *  - 中点が柱の中 → 消す
 *  - 外側すぐの点が他の矩形の中 → 内側の線なので消す
 * 残った区間を、同じ直線ごとにつなげる。
 */
export function outlineRects(rects: readonly Rect[], cutters: readonly Rect[]): Seg[] {
  const horiz = new Map<number, [number, number][]>();
  const vert = new Map<number, [number, number][]>();
  const key = (v: number) => Math.round(v * 100) / 100;

  rects.forEach((r, i) => {
    const others = rects.filter((_, j) => j !== i);
    const edges = [
      { fixed: r.min.y, from: r.min.x, to: r.max.x, horizontal: true, out: { x: 0, y: -1 } },
      { fixed: r.max.y, from: r.min.x, to: r.max.x, horizontal: true, out: { x: 0, y: 1 } },
      { fixed: r.min.x, from: r.min.y, to: r.max.y, horizontal: false, out: { x: -1, y: 0 } },
      { fixed: r.max.x, from: r.min.y, to: r.max.y, horizontal: false, out: { x: 1, y: 0 } },
    ];
    for (const e of edges) {
      const cuts = new Set<number>([e.from, e.to]);
      for (const o of [...others, ...cutters]) {
        for (const v of e.horizontal ? [o.min.x, o.max.x] : [o.min.y, o.max.y]) if (v > e.from && v < e.to) cuts.add(v);
      }
      const ts = [...cuts].sort((a, b) => a - b);
      for (let k = 0; k + 1 < ts.length; k++) {
        const t0 = ts[k];
        const t1 = ts[k + 1];
        if (t1 - t0 < 1e-6) continue;
        const m = (t0 + t1) / 2;
        const mid = e.horizontal ? { x: m, y: e.fixed } : { x: e.fixed, y: m };
        if (cutters.some((c) => inside(c, mid))) continue;
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

function columnRects(d: Drawing): Rect[] {
  const out: Rect[] = [];
  for (const c of d.columns) {
    const r = columnRect(d, c);
    if (r) out.push(r);
  }
  return out;
}

// ---------- 壁 ----------

const wallWidth = (d: Drawing) => (m: Linear) => d.wallTypes.find((t) => t.id === m.typeId)?.t;

/** 壁の外形（交点で直交する壁の外面まで延長済み、開口は抜かない）。通り芯が無い・範囲外なら null */
export function wallRect(d: Drawing, w: Wall): Rect | null {
  return linearRect(d, w, d.walls, wallWidth(d));
}

/** 開口の範囲（壁の長さ方向の座標）。区間の始点からの距離で持っているのを座標にする */
export function openingRange(d: Drawing, o: Opening): { wall: Wall; s0: number; s1: number } | null {
  const wall = d.walls.find((w) => w.id === o.wallId);
  if (!wall || !d.grid) return null;
  const { xs, ys } = gridPositions(d.grid);
  const along = wall.axis === 'x' ? ys : xs;
  const base = along[wall.from];
  if (base === undefined) return null;
  return { wall, s0: base + o.start, s1: base + o.start + o.width };
}

/** 壁を開口で区切った矩形（開口が無ければ1つ） */
export function wallPieces(d: Drawing, w: Wall): Rect[] {
  const r = wallRect(d, w);
  if (!r) return [];
  const horiz = w.axis === 'y';
  let pieces: [number, number][] = [horiz ? [r.min.x, r.max.x] : [r.min.y, r.max.y]];
  for (const o of d.openings) {
    if (o.wallId !== w.id) continue;
    const range = openingRange(d, o);
    if (!range) continue;
    const next: [number, number][] = [];
    for (const [a, b] of pieces) {
      if (range.s1 <= a || range.s0 >= b) next.push([a, b]);
      else {
        if (range.s0 > a) next.push([a, range.s0]);
        if (range.s1 < b) next.push([range.s1, b]);
      }
    }
    pieces = next;
  }
  return pieces.map(([a, b]) => (horiz ? { min: { x: a, y: r.min.y }, max: { x: b, y: r.max.y } } : { min: { x: r.min.x, y: a }, max: { x: r.max.x, y: b } }));
}

/** 壁の外形線（交差部・柱・開口で処理済み） */
export function wallOutline(d: Drawing): Seg[] {
  const rects: Rect[] = [];
  for (const w of d.walls) rects.push(...wallPieces(d, w));
  if (!rects.length) return [];
  return outlineRects(rects, columnRects(d));
}

/** 壁を外形線・符号・開口の表示に分解 */
export function decomposeWalls(d: Drawing): Prim[] {
  const prims: Prim[] = wallOutline(d).map((s) => ({ t: 'line', layer: LAYER_WALL, a: s.a, b: s.b }));
  for (const w of d.walls) {
    const r = wallRect(d, w);
    const t = d.wallTypes.find((x) => x.id === w.typeId);
    if (!r || !t) continue;
    // 符号は区間の中ほど。開口と重なるなら開口の手前に
    let cx = (r.min.x + r.max.x) / 2;
    let cy = (r.min.y + r.max.y) / 2;
    for (const o of d.openings) {
      if (o.wallId !== w.id) continue;
      const range = openingRange(d, o);
      if (!range) continue;
      const c = w.axis === 'y' ? cx : cy;
      if (c >= range.s0 - 400 && c <= range.s1 + 400) {
        const shift = range.s0 - 600;
        if (w.axis === 'y') cx = Math.max(r.min.x + 300, shift);
        else cy = Math.max(r.min.y + 300, shift);
      }
    }
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
  // 開口: 壁の外（上または右）に「開口 幅」
  for (const o of d.openings) {
    const range = openingRange(d, o);
    if (!range) continue;
    const r = wallRect(d, range.wall);
    if (!r) continue;
    const mid = (range.s0 + range.s1) / 2;
    const gap = 1.5 * d.scale;
    const label = `開口${formatDim(o.width)}`;
    const h = 2 * d.scale;
    prims.push(
      range.wall.axis === 'y'
        ? { t: 'text', layer: LAYER_OPENING, p: { x: mid, y: r.max.y + gap }, h, s: label, align: 'center', valign: 'bottom', rot: 0 }
        : { t: 'text', layer: LAYER_OPENING, p: { x: r.min.x - gap, y: mid }, h, s: label, align: 'center', valign: 'bottom', rot: 90 },
    );
  }
  return prims;
}

/** 壁の外形線の端点（スナップ用） */
export function wallCorners(d: Drawing): Vec2[] {
  const out: Vec2[] = [];
  for (const s of wallOutline(d)) out.push(s.a, s.b);
  return out;
}

// ---------- 梁 ----------

const beamWidth = (d: Drawing) => (m: Linear) => d.beamTypes.find((t) => t.id === m.typeId)?.b;

export function beamRect(d: Drawing, b: Beam): Rect | null {
  return linearRect(d, b, d.beams, beamWidth(d));
}

/** 梁の外形線（梁どうしの交差部と柱で処理済み） */
export function beamOutline(d: Drawing): Seg[] {
  const rects: Rect[] = [];
  for (const b of d.beams) {
    const r = beamRect(d, b);
    if (r) rects.push(r);
  }
  if (!rects.length) return [];
  return outlineRects(rects, columnRects(d));
}

/** 梁を破線の外形と「G1 400×800」の表記に分解（伏図: 床より下に見える梁は破線） */
export function decomposeBeams(d: Drawing): Prim[] {
  const prims: Prim[] = beamOutline(d).map((s) => ({ t: 'line', layer: LAYER_BEAM, a: s.a, b: s.b, ltype: 'HIDDEN' }));
  for (const b of d.beams) {
    const r = beamRect(d, b);
    const t = d.beamTypes.find((x) => x.id === b.typeId);
    if (!r || !t) continue;
    // 表記は梁の外側（横の梁は上、縦の梁は左）、区間の 1/3 あたり（壁の符号と重ならないように）
    const gap = 1 * d.scale;
    const h = 2 * d.scale;
    const s = `${t.mark} ${t.b}×${t.d}`;
    prims.push(
      b.axis === 'y'
        ? { t: 'text', layer: LAYER_BEAM, p: { x: r.min.x + (r.max.x - r.min.x) / 3, y: r.max.y + gap }, h, s, align: 'center', valign: 'bottom', rot: 0 }
        : { t: 'text', layer: LAYER_BEAM, p: { x: r.min.x - gap, y: r.min.y + (r.max.y - r.min.y) / 3 }, h, s, align: 'center', valign: 'bottom', rot: 90 },
    );
  }
  return prims;
}

// ---------- 補助 ----------

/** 通り芯のスパン（交点〜交点）の線分。壁・梁を置く場所を選ぶのに使う */
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

export function nextBeamMark(types: readonly BeamType[]): string {
  const used = new Set(types.map((x) => x.mark));
  for (let n = 1; ; n++) if (!used.has(`G${n}`)) return `G${n}`;
}

/** 区間の名前（Y1通り X1〜X2） */
export function spanName(d: Drawing, m: { axis: 'x' | 'y'; line: number; from: number; to: number }): string {
  const g = d.grid;
  if (!g) return '';
  return m.axis === 'x'
    ? `${g.xPrefix}${m.line + 1}通り ${g.yPrefix}${m.from + 1}〜${g.yPrefix}${m.to + 1}`
    : `${g.yPrefix}${m.line + 1}通り ${g.xPrefix}${m.from + 1}〜${g.xPrefix}${m.to + 1}`;
}
export const wallName = spanName;

/** 通り芯が減ったときに、範囲外になった壁・梁を除く */
export function wallsInRange<T extends Linear>(list: readonly T[], nx: number, ny: number): T[] {
  return list.filter((w) => (w.axis === 'x' ? w.line < nx && w.to < ny : w.line < ny && w.to < nx));
}
