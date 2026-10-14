import type { Vec2 } from './model';
import type { Segment } from './snap';
import { nearestOnSegment } from './snap';

/** p にいちばん近い線分（radius 以内）。線分の番号も返す */
export function nearestSegment(p: Vec2, segs: readonly Segment[], radius: number): { seg: Segment; index: number; d: number } | null {
  let best: { seg: Segment; index: number; d: number } | null = null;
  segs.forEach((seg, index) => {
    const f = nearestOnSegment(p, seg.a, seg.b);
    const d = Math.hypot(p.x - f.x, p.y - f.y);
    if (d <= radius && (!best || d < best.d)) best = { seg, index, d };
  });
  return best;
}

/**
 * 線分を、side の点がある側へ dist だけ平行にずらす（オフセット）。
 * side が線のちょうど上なら左側（a→b の進行方向の左）へ。
 */
export function offsetSegment(seg: Segment, dist: number, side: Vec2): Segment {
  const dx = seg.b.x - seg.a.x;
  const dy = seg.b.y - seg.a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { a: { ...seg.a }, b: { ...seg.b } };
  // 左側の法線
  const nx = -dy / len;
  const ny = dx / len;
  const cross = dx * (side.y - seg.a.y) - dy * (side.x - seg.a.x);
  const s = cross < 0 ? -1 : 1;
  const ox = round(nx * dist * s);
  const oy = round(ny * dist * s);
  return { a: { x: round(seg.a.x + ox), y: round(seg.a.y + oy) }, b: { x: round(seg.b.x + ox), y: round(seg.b.y + oy) } };
}

/** 直交モード: from から見て、水平・垂直のうち近い方に固定 */
export function orthoConstrain(from: Vec2, p: Vec2): Vec2 {
  return Math.abs(p.x - from.x) >= Math.abs(p.y - from.y) ? { x: p.x, y: from.y } : { x: from.x, y: p.y };
}

function round(v: number) {
  return Math.round(v * 100) / 100;
}
