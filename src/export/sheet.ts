import { render, type Theme } from '../renderer';
import { Viewport } from '../viewport';
import { centerPattern, hiddenPattern, type Prim } from '../arch/primitives';

/**
 * 印刷用の図面シート（図枠・表題欄・改訂欄つき）を canvas に描く。
 * 紙の上の寸法（mm）を基準にして、縮尺どおりの大きさで図形を置く。
 */

export type PaperSize = 'A3' | 'A2' | 'A1';

/** 横置きの用紙（mm）と、印刷用の画像の解像度（dpi）。大きい紙ほど dpi を下げて画像を小さく保つ */
export const PAPERS: Record<PaperSize, { w: number; h: number; dpi: number }> = {
  A3: { w: 420, h: 297, dpi: 200 },
  A2: { w: 594, h: 420, dpi: 180 },
  A1: { w: 841, h: 594, dpi: 140 },
};

const MARGIN = 10; // 用紙の端から外枠まで
const PAD = 8; // 外枠から図面までの余白
const BAND = 32; // 下の帯（改訂欄・表題欄）の高さ
const TB_W = 120; // 表題欄の幅
const REV_W = 120; // 改訂欄の幅
const FONT = '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif';

/** 印刷は白黒。画面の色は使わない */
export const PRINT_THEME: Theme = {
  canvas: '#ffffff',
  grid: '#ffffff',
  gridMajor: '#ffffff',
  axis: '#000000',
  ink: '#000000',
  gridLine: '#333333',
  dim: '#222222',
  preview: '#000000',
  snap: '#000000',
  underlay: '#000000',
  font: FONT,
  mono: true,
};

export type Rect = { x: number; y: number; w: number; h: number };

export type SheetLayout = {
  paper: PaperSize;
  /** 画像の大きさ（px） */
  pxW: number;
  pxH: number;
  /** 1mm あたりの px（紙の上） */
  pxPerMm: number;
  /** 図面を描く領域（px） */
  area: Rect;
  /** 外枠（px） */
  frame: Rect;
  /** 表題欄・改訂欄の帯（px） */
  band: Rect;
  /** 表題欄（px） */
  titleBlock: Rect;
  /** 改訂欄（px） */
  revBlock: Rect;
  /** 図面の座標を画像の座標に変換する（縮尺どおり） */
  view: Viewport;
  /** 図形が図面領域に収まるか */
  fits: boolean;
};

/**
 * 図形の範囲 ext を縮尺 scale で用紙に置いたときの配置を決める。
 * ext が無い（図形が無い）ときは図面領域の中心に何も描かない。
 */
export function sheetLayout(paper: PaperSize, scale: number, ext: { min: { x: number; y: number }; max: { x: number; y: number } } | null): SheetLayout {
  const p = PAPERS[paper];
  const pxPerMm = p.dpi / 25.4;
  const mm = (v: number) => v * pxPerMm;
  const rect = (x: number, y: number, w: number, h: number): Rect => ({ x: mm(x), y: mm(y), w: mm(w), h: mm(h) });

  const area = rect(MARGIN + PAD, MARGIN + PAD, p.w - 2 * (MARGIN + PAD), p.h - 2 * MARGIN - PAD - BAND - PAD / 2);
  const frame = rect(MARGIN, MARGIN, p.w - 2 * MARGIN, p.h - 2 * MARGIN);
  const bandY = p.h - MARGIN - BAND;
  const band = rect(MARGIN, bandY, p.w - 2 * MARGIN, BAND);
  const titleBlock = rect(p.w - MARGIN - TB_W, bandY, TB_W, BAND);
  const revBlock = rect(MARGIN, bandY, REV_W, BAND);

  // 1 紙の mm = scale の実寸 mm。よって 1 実寸 mm は pxPerMm / scale px
  const view = new Viewport();
  view.scale = pxPerMm / scale;
  let fits = true;
  if (ext) {
    const wMm = (ext.max.x - ext.min.x) / scale;
    const hMm = (ext.max.y - ext.min.y) / scale;
    fits = wMm <= area.w / pxPerMm && hMm <= area.h / pxPerMm;
    const cx = (ext.min.x + ext.max.x) / 2;
    const cy = (ext.min.y + ext.max.y) / 2;
    const acx = area.x + area.w / 2;
    const acy = area.y + area.h / 2;
    view.ox = acx - cx * view.scale;
    view.oy = acy + cy * view.scale;
  }
  return {
    paper,
    pxW: Math.round(mm(p.w)),
    pxH: Math.round(mm(p.h)),
    pxPerMm,
    area,
    frame,
    band,
    titleBlock,
    revBlock,
    view,
    fits,
  };
}

export type SheetInfo = {
  title: string;
  scale: number;
  date: string;
};

/** 図枠・表題欄・改訂欄・図形を描く（canvas は pxW × pxH にしてあること） */
export function drawSheet(ctx: CanvasRenderingContext2D, layout: SheetLayout, prims: readonly Prim[], info: SheetInfo, scaleForRender: number): void {
  const L = layout;
  const u = L.pxPerMm;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, L.pxW, L.pxH);

  // 図形（図面領域の外へははみ出さない）
  ctx.save();
  ctx.beginPath();
  ctx.rect(L.area.x, L.area.y, L.area.w, L.area.h);
  ctx.clip();
  render(
    ctx,
    L.pxW,
    L.pxH,
    {
      prims,
      view: L.view,
      grid: 0,
      centerPattern: centerPattern(scaleForRender),
      hiddenPattern: hiddenPattern(scaleForRender),
      scale: scaleForRender,
      pending: null,
      cursor: null,
      underlay: null,
      alignFrom: null,
      freeStroke: null,
      measure: null,
    },
    PRINT_THEME,
  );
  ctx.restore();

  // 枠線
  ctx.strokeStyle = '#000000';
  ctx.fillStyle = '#000000';
  ctx.lineWidth = Math.max(1, 0.35 * u);
  strokeRect(ctx, L.frame);
  // 外枠の内側にもう一本（太い外枠の表現）
  ctx.lineWidth = Math.max(1, 0.7 * u);
  strokeRect(ctx, { x: L.frame.x + 0.8 * u, y: L.frame.y + 0.8 * u, w: L.frame.w - 1.6 * u, h: L.frame.h - 1.6 * u });

  // 帯の上の線
  ctx.lineWidth = Math.max(1, 0.35 * u);
  line(ctx, L.frame.x, L.band.y, L.frame.x + L.frame.w, L.band.y);

  drawRevBlock(ctx, L, u);
  drawTitleBlock(ctx, L, info, u);
  ctx.restore();
}

function strokeRect(ctx: CanvasRenderingContext2D, r: Rect) {
  ctx.strokeRect(r.x, r.y, r.w, r.h);
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, mmSize: number, u: number, bold = false, align: CanvasTextAlign = 'left') {
  ctx.font = `${bold ? '600 ' : ''}${mmSize * u}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}

/** 改訂欄: 番号・日付・内容（手で書けるように空欄） */
function drawRevBlock(ctx: CanvasRenderingContext2D, L: SheetLayout, u: number) {
  const r = L.revBlock;
  const rowH = r.h / 4;
  const cols = [15, 30, 75].map((w) => w * u); // 番号・日付・内容（mm）
  ctx.lineWidth = Math.max(1, 0.25 * u);
  strokeRect(ctx, r);
  for (let i = 1; i < 4; i++) line(ctx, r.x, r.y + rowH * i, r.x + r.w, r.y + rowH * i);
  let x = r.x;
  for (let i = 0; i < cols.length - 1; i++) {
    x += cols[i];
    line(ctx, x, r.y, x, r.y + r.h);
  }
  const heads = ['改訂', '日付', '内容'];
  let hx = r.x;
  heads.forEach((h, i) => {
    text(ctx, h, hx + 1.5 * u, r.y + rowH * 0.72, 2.8, u, true);
    hx += cols[i];
  });
}

/** 表題欄: 図面名・縮尺・日付・図番と、作成・確認・承認の欄 */
function drawTitleBlock(ctx: CanvasRenderingContext2D, L: SheetLayout, info: SheetInfo, u: number) {
  const t = L.titleBlock;
  ctx.lineWidth = Math.max(1, 0.35 * u);
  strokeRect(ctx, t);
  const h = t.h / 4;
  // 図面名（上段）
  line(ctx, t.x, t.y + h * 2, t.x + t.w, t.y + h * 2);
  text(ctx, '図面名', t.x + 3 * u, t.y + h * 0.75, 2.4, u);
  text(ctx, info.title, t.x + 3 * u, t.y + h * 1.7, 6, u, true);
  // 中段: 縮尺・日付・図番
  const third = t.w / 3;
  line(ctx, t.x + third, t.y + h * 2, t.x + third, t.y + t.h);
  line(ctx, t.x + third * 2, t.y + h * 2, t.x + third * 2, t.y + t.h);
  line(ctx, t.x, t.y + h * 3, t.x + t.w, t.y + h * 3);
  const cell = (label: string, value: string, cx: number, cy: number) => {
    text(ctx, label, cx + 2 * u, cy + 3 * u, 2.2, u);
    text(ctx, value, cx + 2 * u, cy + h - 1.5 * u, 3.6, u);
  };
  cell('縮尺', `1/${info.scale}`, t.x, t.y + h * 2);
  cell('日付', info.date, t.x + third, t.y + h * 2);
  cell('図番', '', t.x + third * 2, t.y + h * 2);
  // 下段: 作成・確認・承認（押印欄）
  const sign = t.w / 3;
  for (let i = 1; i < 3; i++) line(ctx, t.x + sign * i, t.y + h * 3, t.x + sign * i, t.y + t.h);
  ['作成', '確認', '承認'].forEach((label, i) => text(ctx, label, t.x + sign * i + 2 * u, t.y + h * 3 + 3 * u, 2.2, u));
}

/** canvas の画素（RGBA）を 1画素1バイトのグレーにする（0=黒, 255=白） */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = Math.round(rgba[j] * 0.299 + rgba[j + 1] * 0.587 + rgba[j + 2] * 0.114);
  }
  return out;
}
