import type { Drawing, Vec2 } from '../model';
import { decomposeGrid } from './grid';
import { decomposeColumns } from './column';
import { decomposeBeams, decomposeWalls } from './wall';
import { decomposeOffsetDims } from './offset-dims';
import { decomposeAnnotations } from './annot';

/**
 * 図面を構成する最小単位。画面描画と DXF/JWW 書き出しはこれだけを扱う。
 * 建築部材（通り芯・壁・建具…）は decompose() でここに分解される。
 */
/** 個別の色: 画面用の色（hex）と DXF の色番号（aci） */
export type Pen = { hex: string; aci: number };

export type Prim =
  | { t: 'line'; layer: string; a: Vec2; b: Vec2; ltype?: 'CONTINUOUS' | 'CENTER' | 'HIDDEN' }
  | { t: 'circle'; layer: string; c: Vec2; r: number; pen?: Pen }
  /** 円弧。a0→a1 へ反時計回り（度） */
  | { t: 'arc'; layer: string; c: Vec2; r: number; a0: number; a1: number }
  | {
      t: 'text';
      layer: string;
      /** 個別の色（省略時は画層の色）。印刷は白黒で描く */
      pen?: Pen;
      /** 基準点 */
      p: Vec2;
      /** 文字高さ（実寸mm） */
      h: number;
      s: string;
      align: 'left' | 'center' | 'right';
      /** bottom = ベースライン基準 */
      valign: 'bottom' | 'middle';
      /** 回転角（度、反時計回り） */
      rot: number;
    };

/** 一点鎖線のパターン（実線, 空き, 点, 空き）。用紙上 12/1.5/1.5/1.5mm × 縮尺 */
export function centerPattern(scale: number): number[] {
  return [12, 1.5, 1.5, 1.5].map((v) => v * scale);
}

/** 破線（かくれ線）のパターン（実線, 空き）。用紙上 3/1.5mm × 縮尺 */
export function hiddenPattern(scale: number): number[] {
  return [3, 1.5].map((v) => v * scale);
}

export function decompose(drawing: Drawing): Prim[] {
  const prims: Prim[] = [];
  if (drawing.grid) prims.push(...decomposeGrid(drawing.grid, drawing.scale));
  prims.push(...decomposeBeams(drawing));
  prims.push(...decomposeWalls(drawing));
  prims.push(...decomposeColumns(drawing));
  if (drawing.showOffsetDims) prims.push(...decomposeOffsetDims(drawing));
  prims.push(...decomposeAnnotations(drawing));
  for (const e of drawing.entities) {
    if (e.kind === 'line') prims.push({ t: 'line', layer: e.layer, a: e.a, b: e.b });
  }
  return prims;
}

/** 図形全体の範囲。何もなければ null */
export function primExtents(prims: readonly Prim[]): { min: Vec2; max: Vec2 } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const p of prims) {
    if (p.t === 'line') {
      add(p.a.x, p.a.y);
      add(p.b.x, p.b.y);
    } else if (p.t === 'circle' || p.t === 'arc') {
      add(p.c.x - p.r, p.c.y - p.r);
      add(p.c.x + p.r, p.c.y + p.r);
    } else {
      add(p.p.x, p.p.y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}
