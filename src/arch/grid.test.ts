import { describe, expect, it } from 'vitest';
import { createDrawing, type StructuralGrid } from '../model';
import { decomposeGrid, formatDim, gridIntersections, gridPositions, parseSpans } from './grid';
import { toDxf } from '../export/dxf';

const g: StructuralGrid = { xSpans: [6000, 7200, 6000], ySpans: [6500, 6500], xPrefix: 'X', yPrefix: 'Y', origin: { x: 0, y: 0 } };

describe('parseSpans', () => {
  it('カンマ・読点・空白・全角を受け付け、*n で繰り返す', () => {
    expect(parseSpans('6000, 7200*2,6000')).toEqual([6000, 7200, 7200, 6000]);
    expect(parseSpans('６０００、７２００×２')).toEqual([6000, 7200, 7200]);
    expect(parseSpans('6000 6500.5')).toEqual([6000, 6500.5]);
    expect(parseSpans('')).toEqual([]);
  });
  it('数字以外や 0 は不正', () => {
    expect(parseSpans('6000, abc')).toBeNull();
    expect(parseSpans('0')).toBeNull();
  });
});

describe('通り芯', () => {
  it('位置と交点', () => {
    expect(gridPositions(g)).toEqual({ xs: [0, 6000, 13200, 19200], ys: [0, 6500, 13000] });
    expect(gridIntersections(g)).toHaveLength(12);
  });

  it('寸法表記', () => {
    expect(formatDim(6000)).toBe('6,000');
    expect(formatDim(19200)).toBe('19,200');
    expect(formatDim(450)).toBe('450');
  });

  it('分解: 一点鎖線・符号（両端）・通り芯間寸法と総寸法', () => {
    const prims = decomposeGrid(g, 50);
    const centers = prims.filter((p) => p.t === 'line' && p.ltype === 'CENTER');
    expect(centers).toHaveLength(4 + 3);
    const circles = prims.filter((p) => p.t === 'circle');
    expect(circles).toHaveLength((4 + 3) * 2);
    const texts = prims.filter((p) => p.t === 'text').map((p) => (p.t === 'text' ? p.s : ''));
    expect(texts).toContain('X1');
    expect(texts).toContain('Y3');
    expect(texts.filter((s) => s === '7,200')).toHaveLength(1);
    expect(texts).toContain('19,200'); // X 総寸法
    expect(texts).toContain('13,000'); // Y 総寸法
    // 符号の丸は 1/50 で半径 4.5mm×50
    expect(circles[0].t === 'circle' && circles[0].r).toBe(225);
  });

  it('DXF に一点鎖線・円・文字が出る', () => {
    const d = createDrawing();
    d.grid = g;
    const text = toDxf(d);
    expect(text).toMatch(/\r\nCENTER\r\n/);
    expect(text).toMatch(/\r\nCIRCLE\r\n/);
    expect(text).toMatch(/\r\nTEXT\r\n/);
    expect(text).toMatch(/\r\nGRID\r\n/);
  });
});
