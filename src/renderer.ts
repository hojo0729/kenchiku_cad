import type { Drawing, Vec2 } from './model';
import type { SnapResult } from './snap';
import type { Viewport } from './viewport';

export type Theme = {
  canvas: string;
  grid: string;
  gridMajor: string;
  axis: string;
  ink: string;
  preview: string;
  snap: string;
};

export function readTheme(): Theme {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    canvas: v('--canvas'),
    grid: v('--grid'),
    gridMajor: v('--grid-major'),
    axis: v('--axis'),
    ink: v('--ink'),
    preview: v('--preview'),
    snap: v('--snap'),
  };
}

export type RenderState = {
  drawing: Drawing;
  view: Viewport;
  grid: number;
  /** 作図中の始点 */
  pending: Vec2 | null;
  /** カーソル位置（スナップ済み） */
  cursor: SnapResult | null;
};

export function render(ctx: CanvasRenderingContext2D, w: number, h: number, st: RenderState, theme: Theme): void {
  const { view } = st;
  ctx.fillStyle = theme.canvas;
  ctx.fillRect(0, 0, w, h);

  drawGrid(ctx, w, h, view, st.grid, theme);

  // 図形
  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = 1.25;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const e of st.drawing.entities) {
    if (e.kind === 'line') {
      const a = view.toScreen(e.a);
      const b = view.toScreen(e.b);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
  }
  ctx.stroke();

  // ラバーバンド
  if (st.pending && st.cursor) {
    const a = view.toScreen(st.pending);
    const b = view.toScreen(st.cursor.point);
    ctx.save();
    ctx.strokeStyle = theme.preview;
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = theme.preview;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // スナップマーカー
  if (st.cursor) {
    const p = view.toScreen(st.cursor.point);
    ctx.save();
    ctx.strokeStyle = theme.snap;
    ctx.lineWidth = 1.5;
    if (st.cursor.kind === 'endpoint') {
      ctx.strokeRect(p.x - 6, p.y - 6, 12, 12);
    } else {
      ctx.beginPath();
      ctx.moveTo(p.x - 7, p.y);
      ctx.lineTo(p.x + 7, p.y);
      ctx.moveTo(p.x, p.y - 7);
      ctx.lineTo(p.x, p.y + 7);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, view: Viewport, grid: number, theme: Theme) {
  const tl = view.toWorld({ x: 0, y: 0 });
  const br = view.toWorld({ x: w, y: h });
  const minX = Math.min(tl.x, br.x);
  const maxX = Math.max(tl.x, br.x);
  const minY = Math.min(tl.y, br.y);
  const maxY = Math.max(tl.y, br.y);

  if (grid > 0) {
    let step = grid;
    while (step * view.scale < 10) step *= 2;
    const major = step * 10;
    const lines = (color: string, s: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.ceil(minX / s) * s; x <= maxX; x += s) {
        const sx = Math.round(view.toScreen({ x, y: 0 }).x) + 0.5;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, h);
      }
      for (let y = Math.ceil(minY / s) * s; y <= maxY; y += s) {
        const sy = Math.round(view.toScreen({ x: 0, y }).y) + 0.5;
        ctx.moveTo(0, sy);
        ctx.lineTo(w, sy);
      }
      ctx.stroke();
    };
    lines(theme.grid, step);
    if (major * view.scale >= 40) lines(theme.gridMajor, major);
  }

  // 原点の軸
  const o = view.toScreen({ x: 0, y: 0 });
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(o.x) + 0.5, 0);
  ctx.lineTo(Math.round(o.x) + 0.5, h);
  ctx.moveTo(0, Math.round(o.y) + 0.5);
  ctx.lineTo(w, Math.round(o.y) + 0.5);
  ctx.stroke();
}
