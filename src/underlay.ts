import type { Prim } from './arch/primitives';
import { primExtents } from './arch/primitives';
import type { Vec2 } from './model';
import type { Segment, SnapCandidate } from './snap';
import type { Viewport } from './viewport';

/**
 * 下敷き（設計から来た図面）。線の集まりとして薄く表示し、スナップに使う。
 * 自分の図面（Drawing）とは別に持つ: 元に戻す・DXF保存の対象外、端末内に別キーで保存。
 */
export type Underlay = {
  name: string;
  prims: Prim[];
  /** 位置合わせのずらし量(mm) */
  dx: number;
  dy: number;
  visible: boolean;
  /** 濃さ 0.1〜1 */
  opacity: number;
};

const KEY = 'kenchiku-cad:underlay';

export function loadUnderlay(): Underlay | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as Underlay;
    return Array.isArray(u?.prims) ? u : null;
  } catch {
    return null;
  }
}

/** 保存できたら true（大きすぎる図面は保存できないことがある） */
export function saveUnderlay(u: Underlay | null): boolean {
  try {
    if (u) localStorage.setItem(KEY, JSON.stringify(u));
    else localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

export function underlayExtents(u: Underlay): { min: Vec2; max: Vec2 } | null {
  const e = primExtents(u.prims);
  if (!e) return null;
  return { min: { x: e.min.x + u.dx, y: e.min.y + u.dy }, max: { x: e.max.x + u.dx, y: e.max.y + u.dy } };
}

// ---------- スナップ候補 ----------

const rawCache = new WeakMap<Prim[], SnapCandidate[]>();
let shifted: { prims: Prim[]; dx: number; dy: number; list: SnapCandidate[] } | null = null;

/** 下敷きのスナップ候補（端点・円の中心・長い線どうしの交点）。ずらし量込み */
export function underlaySnapCandidates(u: Underlay): SnapCandidate[] {
  if (shifted && shifted.prims === u.prims && shifted.dx === u.dx && shifted.dy === u.dy) return shifted.list;
  let raw = rawCache.get(u.prims);
  if (!raw) {
    raw = rawCandidates(u.prims);
    rawCache.set(u.prims, raw);
  }
  const list = raw.map((c) => ({ p: { x: c.p.x + u.dx, y: c.p.y + u.dy }, kind: c.kind }));
  shifted = { prims: u.prims, dx: u.dx, dy: u.dy, list };
  return list;
}

/**
 * 交点は全部の線どうしで計算すると重いので、長い線（通り芯・外壁など）に絞る。
 * 設計図の通り芯は交点に端点が無いことが多いので、これが無いと位置合わせができない。
 */
const MAX_INTERSECT_LINES = 400;

export function rawCandidates(prims: readonly Prim[]): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  const seen = new Set<string>();
  const add = (p: Vec2, kind: SnapCandidate['kind']) => {
    const key = `${Math.round(p.x)},${Math.round(p.y)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ p, kind });
  };
  const lines: { a: Vec2; b: Vec2; len: number }[] = [];
  for (const p of prims) {
    if (p.t === 'line') {
      add(p.a, 'endpoint');
      add(p.b, 'endpoint');
      lines.push({ a: p.a, b: p.b, len: Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y) });
    } else if (p.t === 'circle') {
      add(p.c, 'endpoint');
    } else if (p.t === 'arc') {
      add(p.c, 'endpoint');
      for (const deg of [p.a0, p.a1]) {
        const r = (deg * Math.PI) / 180;
        add({ x: p.c.x + p.r * Math.cos(r), y: p.c.y + p.r * Math.sin(r) }, 'endpoint');
      }
    }
  }
  lines.sort((a, b) => b.len - a.len);
  const long = lines.slice(0, MAX_INTERSECT_LINES);
  for (let i = 0; i < long.length; i++) {
    for (let j = i + 1; j < long.length; j++) {
      const p = segmentIntersection(long[i].a, long[i].b, long[j].a, long[j].b);
      if (p) add(p, 'intersection');
    }
  }
  return out;
}

export function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null; // 平行
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: Math.round((a.x + t * r.x) * 100) / 100, y: Math.round((a.y + t * r.y) * 100) / 100 };
}

let segCache: { prims: Prim[]; dx: number; dy: number; list: Segment[] } | null = null;

/** 下敷きの線分（線上スナップ用）。ずらし量込み */
export function underlaySegments(u: Underlay): Segment[] {
  if (segCache && segCache.prims === u.prims && segCache.dx === u.dx && segCache.dy === u.dy) return segCache.list;
  const list: Segment[] = [];
  for (const p of u.prims) {
    if (p.t === 'line') list.push({ a: { x: p.a.x + u.dx, y: p.a.y + u.dy }, b: { x: p.b.x + u.dx, y: p.b.y + u.dy } });
  }
  segCache = { prims: u.prims, dx: u.dx, dy: u.dy, list };
  return list;
}

// ---------- 描画 ----------

export function renderUnderlay(ctx: CanvasRenderingContext2D, w: number, h: number, u: Underlay, view: Viewport, color: string, font: string) {
  if (!u.visible) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0.1, u.opacity));
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  const S = (p: Vec2) => view.toScreen({ x: p.x + u.dx, y: p.y + u.dy });
  const out = (a: Vec2, b: Vec2) =>
    (a.x < 0 && b.x < 0) || (a.x > w && b.x > w) || (a.y < 0 && b.y < 0) || (a.y > h && b.y > h);

  // 線はまとめて1回で描く（数千本でも軽い）
  ctx.beginPath();
  for (const p of u.prims) {
    if (p.t !== 'line') continue;
    const a = S(p.a);
    const b = S(p.b);
    if (out(a, b)) continue;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();

  for (const p of u.prims) {
    if (p.t === 'circle' || p.t === 'arc') {
      const c = S(p.c);
      const r = p.r * view.scale;
      if (r < 0.5 || c.x + r < 0 || c.x - r > w || c.y + r < 0 || c.y - r > h) continue;
      ctx.beginPath();
      if (p.t === 'circle') ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      else ctx.arc(c.x, c.y, r, (-p.a0 * Math.PI) / 180, (-p.a1 * Math.PI) / 180, true);
      ctx.stroke();
    } else if (p.t === 'text') {
      const px = p.h * view.scale;
      if (px < 5) continue; // 下敷きの小さい文字は省略（自分の図面より目立たせない）
      const pt = S(p.p);
      if (pt.x < -200 || pt.x > w + 200 || pt.y < -200 || pt.y > h + 200) continue;
      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.rotate((-p.rot * Math.PI) / 180);
      ctx.font = `${px}px ${font}`;
      ctx.textAlign = p.align;
      ctx.textBaseline = p.valign === 'middle' ? 'middle' : 'alphabetic';
      ctx.fillText(p.s, 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();
}
