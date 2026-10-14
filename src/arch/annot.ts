import type { Dim, Drawing, LevelMark, Note, Vec2 } from '../model';
import { LAYER_DIM, LAYER_LEVEL, LAYER_NOTE } from '../model';
import { formatDim } from './grid';
import type { Prim } from './primitives';

/**
 * 注記: 寸法・文字・レベル記号。文字の大きさは「用紙上の mm × 縮尺」で決める（実寸が縮尺で変わる）。
 */

/** 寸法の文字（用紙上 mm） */
const DIM_TEXT = 2.5;
/** 文字（注記）の高さ（用紙上 mm） */
const NOTE_TEXT = 3.5;
/** レベル記号の大きさ（用紙上 mm） */
const LEVEL_SIZE = 3;

/** 点 p から線分 a-b までの距離 */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** 寸法の a→b の単位ベクトル t と、その左側の法線 n */
function frameOf(a: Vec2, b: Vec2): { t: Vec2; n: Vec2; len: number } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const t = { x: dx / len, y: dy / len };
  return { t, n: { x: -t.y, y: t.x }, len };
}

/** 寸法線（オフセット後）の両端 */
export function dimLineEnds(dim: Dim): [Vec2, Vec2] | null {
  const f = frameOf(dim.a, dim.b);
  if (!f) return null;
  const { n } = f;
  return [
    { x: dim.a.x + n.x * dim.off, y: dim.a.y + n.y * dim.off },
    { x: dim.b.x + n.x * dim.off, y: dim.b.y + n.y * dim.off },
  ];
}

/** 寸法の値（mm、文字） */
export function dimValue(dim: Dim): string {
  const f = frameOf(dim.a, dim.b);
  return f ? formatDim(Math.round(f.len)) : '';
}

/** 寸法を描く（補助線・寸法線・斜線の終端・文字） */
export function decomposeDim(dim: Dim, scale: number): Prim[] {
  const f = frameOf(dim.a, dim.b);
  if (!f) return [];
  const { t, n } = f;
  const sign = dim.off < 0 ? -1 : 1;
  const gap = 1 * scale; // 対象物からの離れ（用紙 1mm）
  const over = 2 * scale; // 寸法線からの出（用紙 2mm）
  const tick = 1.2 * scale; // 終端の斜線の半分（用紙 1.2mm）
  const layer = LAYER_DIM;
  const at = (p: Vec2, k: number): Vec2 => ({ x: p.x + n.x * k, y: p.y + n.y * k });
  const prims: Prim[] = [];

  // 補助線（対象物の端から寸法線の少し先まで）
  for (const p of [dim.a, dim.b]) {
    prims.push({ t: 'line', layer, a: at(p, sign * gap), b: at(p, dim.off + sign * over) });
  }
  // 寸法線
  const [e0, e1] = dimLineEnds(dim) as [Vec2, Vec2];
  prims.push({ t: 'line', layer, a: e0, b: e1 });
  // 終端の斜線（45°）
  const u = { x: (t.x + n.x) * Math.SQRT1_2, y: (t.y + n.y) * Math.SQRT1_2 };
  for (const p of [e0, e1]) {
    prims.push({ t: 'line', layer, a: { x: p.x - u.x * tick, y: p.y - u.y * tick }, b: { x: p.x + u.x * tick, y: p.y + u.y * tick } });
  }
  // 文字（寸法線の上、読みやすい向きに）
  let deg = (Math.atan2(t.y, t.x) * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg <= -90) deg += 180;
  const rad = (deg * Math.PI) / 180;
  const up = { x: -Math.sin(rad), y: Math.cos(rad) };
  const h = DIM_TEXT * scale;
  const mid = { x: (e0.x + e1.x) / 2, y: (e0.y + e1.y) / 2 };
  prims.push({
    t: 'text',
    layer,
    p: { x: mid.x + up.x * h * 0.4, y: mid.y + up.y * h * 0.4 },
    h,
    s: dimValue(dim),
    align: 'center',
    valign: 'bottom',
    rot: deg,
  });
  return prims;
}

/** 文字の大まかな幅（ASCII は半角、それ以外は全角） */
export function noteWidth(s: string, h: number): number {
  let w = 0;
  for (const ch of s) w += /[\x20-\x7e]/.test(ch) ? h * 0.55 : h;
  return w;
}

export function decomposeNote(note: Note, scale: number): Prim[] {
  return [
    {
      t: 'text',
      layer: LAYER_NOTE,
      p: note.p,
      h: NOTE_TEXT * scale,
      s: note.s,
      align: 'left',
      valign: 'bottom',
      rot: 0,
    },
  ];
}

/** レベル記号: 頂点が位置 p の▽と、その上の横線、表記 */
export function decomposeLevel(lv: LevelMark, scale: number): Prim[] {
  const u = LEVEL_SIZE * scale;
  const p = lv.p;
  const L = (a: Vec2, b: Vec2): Prim => ({ t: 'line', layer: LAYER_LEVEL, a, b });
  const top = { y: p.y + u };
  return [
    L(p, { x: p.x - 0.6 * u, y: top.y }),
    L(p, { x: p.x + 0.6 * u, y: top.y }),
    L({ x: p.x - 1.5 * u, y: top.y }, { x: p.x + 1.5 * u, y: top.y }),
    {
      t: 'text',
      layer: LAYER_LEVEL,
      p: { x: p.x + 1.7 * u, y: top.y + 0.2 * u },
      h: 2.5 * scale,
      s: lv.s,
      align: 'left',
      valign: 'bottom',
      rot: 0,
    },
  ];
}

export function decomposeAnnotations(d: Drawing): Prim[] {
  const out: Prim[] = [];
  for (const dim of d.dims) out.push(...decomposeDim(dim, d.scale));
  for (const n of d.notes) out.push(...decomposeNote(n, d.scale));
  for (const lv of d.levels) out.push(...decomposeLevel(lv, d.scale));
  return out;
}

/** タップ位置に一番近い寸法（寸法線の上、r 以内） */
export function dimAt(d: Drawing, w: Vec2, r: number): Dim | undefined {
  let best: Dim | undefined;
  let bestD = r;
  for (const dim of d.dims) {
    const ends = dimLineEnds(dim);
    if (!ends) continue;
    const dist = distToSegment(w, ends[0], ends[1]);
    if (dist <= bestD) {
      bestD = dist;
      best = dim;
    }
  }
  return best;
}

/** タップ位置の文字（左下から右上の外側 r まで） */
export function noteAt(d: Drawing, w: Vec2, r: number): Note | undefined {
  return d.notes.find((n) => {
    const h = NOTE_TEXT * d.scale;
    const width = noteWidth(n.s, h);
    return w.x >= n.p.x - r && w.x <= n.p.x + width + r && w.y >= n.p.y - r && w.y <= n.p.y + h + r;
  });
}

/** タップ位置のレベル記号（頂点の近く） */
export function levelAt(d: Drawing, w: Vec2, r: number): LevelMark | undefined {
  const u = LEVEL_SIZE * d.scale;
  return d.levels.find((lv) => Math.hypot(w.x - lv.p.x, w.y - (lv.p.y + u * 0.5)) <= r + u);
}
