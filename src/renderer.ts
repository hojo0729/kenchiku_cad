import type { Vec2 } from './model';
import { LAYER_COLUMN, LAYER_DIM, LAYER_DIM_OFFSET, LAYER_GRID, LAYER_WALL } from './model';
import type { Prim } from './arch/primitives';
import { formatDim } from './arch/grid';
import type { Curve, SnapResult } from './snap';
import type { MeasureKind } from './measure';
import type { Viewport } from './viewport';
import { renderUnderlay, type Underlay } from './underlay';

export type Theme = {
  canvas: string;
  grid: string;
  gridMajor: string;
  axis: string;
  ink: string;
  gridLine: string;
  dim: string;
  preview: string;
  snap: string;
  underlay: string;
  font: string;
  /** 白黒で描く（印刷）。true のとき個別の色（ピン）も画層の色にする */
  mono?: boolean;
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
    gridLine: v('--grid-line'),
    dim: v('--dim'),
    preview: v('--preview'),
    snap: v('--snap'),
    underlay: v('--underlay'),
    font: v('--font-num') || 'monospace',
  };
}

export type RenderState = {
  prims: readonly Prim[];
  view: Viewport;
  grid: number;
  /** 一点鎖線のパターン（実寸mm）。縮尺に比例 */
  centerPattern: number[];
  /** 破線（梁）のパターン（実寸mm） */
  hiddenPattern: number[];
  /** 縮尺の分母（寄り寸法を描くかの判断に使う） */
  scale: number;
  /** 作図中の始点 */
  pending: Vec2 | null;
  /** カーソル位置（スナップ済み） */
  cursor: SnapResult | null;
  underlay: Underlay | null;
  /** 位置合わせで選んだ下敷き側の点 */
  alignFrom: Vec2 | null;
  /** 測る（pts は確定した点＋カーソル位置。fixed は確定した点の数） */
  measure: { kind: MeasureKind; pts: Vec2[]; fixed: number; curve: Curve | null } | null;
};

export function render(ctx: CanvasRenderingContext2D, w: number, h: number, st: RenderState, theme: Theme): void {
  const { view } = st;
  ctx.fillStyle = theme.canvas;
  ctx.fillRect(0, 0, w, h);

  drawSnapGrid(ctx, w, h, view, st.grid, theme);
  if (st.underlay) renderUnderlay(ctx, w, h, st.underlay, view, theme.underlay, theme.font);

  const colorOf = (layer: string) =>
    layer === LAYER_GRID ? theme.gridLine : layer === LAYER_DIM || layer === LAYER_DIM_OFFSET ? theme.dim : theme.ink;
  // 寄り寸法は、文字が実寸で 5px 未満になるほど縮小しているときは描かない（建物全体を見ると数字が重なって読めないため）
  const showOffsetDims = 2 * st.scale * view.scale >= 5;

  ctx.lineCap = 'round';
  for (const p of st.prims) {
    if (p.layer === LAYER_DIM_OFFSET && !showOffsetDims) continue;
    if (p.t === 'line') {
      const a = view.toScreen(p.a);
      const b = view.toScreen(p.b);
      ctx.strokeStyle = colorOf(p.layer);
      ctx.lineWidth = p.layer === LAYER_COLUMN ? 2 : p.layer === LAYER_WALL ? 1.6 : p.layer === '0' ? 1.4 : 1;
      if (p.ltype === 'CENTER' || p.ltype === 'HIDDEN') {
        const dash = (p.ltype === 'CENTER' ? st.centerPattern : st.hiddenPattern).map((v) => v * view.scale);
        ctx.setLineDash(dash.reduce((s, v) => s + v, 0) >= 6 ? dash : []);
      } else {
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else if (p.t === 'circle' || p.t === 'arc') {
      const c = view.toScreen(p.c);
      ctx.setLineDash([]);
      ctx.strokeStyle = p.t === 'circle' && p.pen && !theme.mono ? p.pen.hex : colorOf(p.layer);
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (p.t === 'circle') ctx.arc(c.x, c.y, p.r * view.scale, 0, Math.PI * 2);
      // 画面はY下向きなので角度の符号を反転し、反時計回り→時計回りとして描く
      else ctx.arc(c.x, c.y, p.r * view.scale, (-p.a0 * Math.PI) / 180, (-p.a1 * Math.PI) / 180, true);
      ctx.stroke();
    } else {
      // スマホで全体を見たときも符号・寸法が読めるよう、画面上は最小 9px で表示する
      // （図面データ・DXF の文字高さは縮尺どおりのまま）
      const natural = p.h * view.scale;
      if (natural < 1) continue; // 縮小しすぎて潰れる場合だけ省略
      const px = Math.max(natural, 9);
      const pt = view.toScreen(p.p);
      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.rotate((-p.rot * Math.PI) / 180);
      ctx.fillStyle = p.pen && !theme.mono ? p.pen.hex : colorOf(p.layer);
      ctx.font = `${px}px ${theme.font}`;
      ctx.textAlign = p.align;
      ctx.textBaseline = p.valign === 'middle' ? 'middle' : 'alphabetic';
      ctx.fillText(p.s, 0, 0);
      ctx.restore();
    }
  }
  ctx.setLineDash([]);

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

  // 測る
  if (st.measure) drawMeasure(ctx, st.measure, view, theme);

  // 位置合わせ: 選んだ下敷きの点からカーソルまで
  if (st.alignFrom) {
    const a = view.toScreen(st.alignFrom);
    ctx.save();
    ctx.strokeStyle = theme.preview;
    ctx.fillStyle = theme.preview;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 6, 0, Math.PI * 2);
    ctx.stroke();
    if (st.cursor) {
      const b = view.toScreen(st.cursor.point);
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // スナップマーカー（□=端点、×=交点、砂時計=線上、+=グリッド）
  if (st.cursor) {
    const p = view.toScreen(st.cursor.point);
    ctx.save();
    ctx.strokeStyle = theme.snap;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (st.cursor.kind === 'endpoint') {
      ctx.rect(p.x - 6, p.y - 6, 12, 12);
    } else if (st.cursor.kind === 'online') {
      // 線上: 砂時計形
      ctx.moveTo(p.x - 6, p.y - 6);
      ctx.lineTo(p.x + 6, p.y - 6);
      ctx.lineTo(p.x - 6, p.y + 6);
      ctx.lineTo(p.x + 6, p.y + 6);
      ctx.closePath();
    } else if (st.cursor.kind === 'intersection') {
      ctx.moveTo(p.x - 7, p.y - 7);
      ctx.lineTo(p.x + 7, p.y + 7);
      ctx.moveTo(p.x + 7, p.y - 7);
      ctx.lineTo(p.x - 7, p.y + 7);
    } else {
      ctx.moveTo(p.x - 7, p.y);
      ctx.lineTo(p.x + 7, p.y);
      ctx.moveTo(p.x, p.y - 7);
      ctx.lineTo(p.x, p.y + 7);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function drawSnapGrid(ctx: CanvasRenderingContext2D, w: number, h: number, view: Viewport, grid: number, theme: Theme) {
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

/**
 * 長押し中のルーペ。カーソルのまわりを拡大して、指で隠れないよう斜め上に表示する。
 * canvas 自身を拡大コピーするので、描画した後に呼ぶ。
 */
export function drawLoupe(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, at: Vec2, w: number, theme: Theme) {
  const dpr = canvas.width / w || 1;
  const r = 58;
  const zoom = 2.5;
  // 基本はカーソルの左上。画面外に出るなら右や下へ逃がす
  let cx = at.x - 70;
  let cy = at.y - 90;
  if (cx - r < 4) cx = at.x + 70;
  if (cy - r < 4) cy = at.y + 90;
  const src = r / zoom;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = theme.canvas;
  ctx.fill();
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, (at.x - src) * dpr, (at.y - src) * dpr, src * 2 * dpr, src * 2 * dpr, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = theme.preview;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy);
  ctx.lineTo(cx + 8, cy);
  ctx.moveTo(cx, cy - 8);
  ctx.lineTo(cx, cy + 8);
  ctx.stroke();
  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawMeasure(ctx: CanvasRenderingContext2D, m: NonNullable<RenderState['measure']>, view: Viewport, theme: Theme) {
  ctx.save();
  ctx.strokeStyle = theme.preview;
  ctx.fillStyle = theme.preview;
  ctx.lineWidth = 2;

  const label = (text: string, x: number, y: number) => {
    ctx.font = `600 14px ${theme.font}`;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = theme.canvas;
    ctx.fillRect(x - tw / 2 - 4, y - 11, tw + 8, 18);
    ctx.fillStyle = theme.preview;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y - 2);
  };

  if (m.kind === 'curve') {
    if (m.curve) {
      const c = view.toScreen(m.curve.c);
      const r = m.curve.r * view.scale;
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      if (m.curve.a0 === undefined || m.curve.a1 === undefined) ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      else ctx.arc(c.x, c.y, r, (-m.curve.a0 * Math.PI) / 180, (-m.curve.a1 * Math.PI) / 180, true);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      // 中心から半径の線（円弧なら始点へ、円なら右へ）
      const ang = ((m.curve.a0 ?? 0) * Math.PI) / 180;
      const e = { x: c.x + r * Math.cos(ang), y: c.y - r * Math.sin(ang) };
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
      ctx.fill();
      label(`R ${formatDim(m.curve.r)}`, (c.x + e.x) / 2, (c.y + e.y) / 2 - 14);
    }
    ctx.restore();
    return;
  }

  const pts = m.pts.map((p) => view.toScreen(p));
  if (pts.length === 0) {
    ctx.restore();
    return;
  }
  const closed = m.kind === 'area' && pts.length >= 3;
  if (closed) {
    ctx.globalAlpha = 0.12;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.setLineDash([8, 4]);
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  if (closed) ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  pts.forEach((p, i) => {
    if (i >= m.fixed) return; // カーソル位置には点を打たない
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
  // 区間ごとの長さ（面積のときは周りの各辺）
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = m.pts[i];
    const b = m.pts[(i + 1) % m.pts.length];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d <= 0) continue;
    const sa = pts[i];
    const sb = pts[(i + 1) % pts.length];
    if (Math.hypot(sb.x - sa.x, sb.y - sa.y) < 40 && m.kind !== 'dist') continue; // 短すぎる区間は数字を省く
    label(formatDim(d), (sa.x + sb.x) / 2, (sa.y + sb.y) / 2 - 14);
  }
  ctx.restore();
}
