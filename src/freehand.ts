import type { Vec2 } from './model';

/** 点から線分までの距離 */
function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * なぞった点列を間引く（Ramer–Douglas–Peucker）。
 * tol より大きくずれる点だけを残すので、手ぶれの細かい点が消え、曲がり角は残る。
 */
export function simplifyPolyline(pts: Vec2[], tol: number): Vec2[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [i, j] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = distToSegment(pts[k], pts[i], pts[j]);
      if (d > maxD) {
        maxD = d;
        idx = k;
      }
    }
    if (idx >= 0 && maxD > tol) {
      keep[idx] = true;
      stack.push([i, idx], [idx, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

/** なぞり線を線分の列にする（同じ点どうしや短すぎる線分は除く） */
export function strokeToSegments(pts: Vec2[], tol: number, minLen: number): { a: Vec2; b: Vec2 }[] {
  const simple = simplifyPolyline(pts, tol);
  const out: { a: Vec2; b: Vec2 }[] = [];
  for (let k = 1; k < simple.length; k++) {
    const a = simple[k - 1];
    const b = simple[k];
    if (Math.hypot(b.x - a.x, b.y - a.y) >= minLen) out.push({ a, b });
  }
  return out;
}
