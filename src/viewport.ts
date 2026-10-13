import type { Vec2 } from './model';

/**
 * ワールド座標(mm, Y上向き) ⇔ スクリーン座標(CSS px, Y下向き) の変換。
 * screen = origin + world * scale （Yは反転）
 */
export class Viewport {
  /** 1mm あたりの px */
  scale = 0.1;
  /** ワールド原点のスクリーン位置 */
  ox = 0;
  oy = 0;

  static readonly MIN_SCALE = 0.002;
  static readonly MAX_SCALE = 50;

  toScreen(p: Vec2): Vec2 {
    return { x: this.ox + p.x * this.scale, y: this.oy - p.y * this.scale };
  }

  toWorld(p: Vec2): Vec2 {
    return { x: (p.x - this.ox) / this.scale, y: (this.oy - p.y) / this.scale };
  }

  panBy(dx: number, dy: number): void {
    this.ox += dx;
    this.oy += dy;
  }

  /** スクリーン上の点を固定したままズーム */
  zoomAt(screen: Vec2, factor: number): void {
    const before = this.toWorld(screen);
    this.scale = Math.min(Viewport.MAX_SCALE, Math.max(Viewport.MIN_SCALE, this.scale * factor));
    const after = this.toScreen(before);
    this.ox += screen.x - after.x;
    this.oy += screen.y - after.y;
  }

  /** ワールド矩形を画面に収める */
  fit(min: Vec2, max: Vec2, width: number, height: number, margin = 40): void {
    const w = Math.max(max.x - min.x, 1);
    const h = Math.max(max.y - min.y, 1);
    const sx = (width - margin * 2) / w;
    const sy = (height - margin * 2) / h;
    this.scale = Math.min(Viewport.MAX_SCALE, Math.max(Viewport.MIN_SCALE, Math.min(sx, sy)));
    const cx = (min.x + max.x) / 2;
    const cy = (min.y + max.y) / 2;
    this.ox = width / 2 - cx * this.scale;
    this.oy = height / 2 + cy * this.scale;
  }
}
