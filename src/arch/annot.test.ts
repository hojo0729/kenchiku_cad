import { describe, expect, it } from 'vitest';
import { createDrawing } from '../model';
import { decomposeDim, decomposeNote, dimAt, dimLabel, dimValue, distToSegment, noteBox, noteWidth, decomposeLevel } from './annot';

describe('寸法', () => {
  it('値は a と b の距離（丸めて、3桁ごとにカンマ）', () => {
    expect(dimValue({ id: 'x', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, off: 1000 })).toBe('6,000');
    expect(dimValue({ id: 'x', a: { x: 0, y: 0 }, b: { x: 3, y: 4 }, off: 0 })).toBe('5');
  });

  it('寸法線は a→b の法線方向に off ずれる', () => {
    const prims = decomposeDim({ id: 'x', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, off: 1000 }, 50);
    const dimLine = prims.find((p) => p.t === 'line' && p.a.y === p.b.y && p.a.y !== 0);
    expect(dimLine).toBeDefined();
    expect(dimLine && dimLine.t === 'line' ? dimLine.a.y : NaN).toBe(1000);
  });

  it('文字は寸法の値を持ち、縮尺どおりの高さになる（用紙 2.5mm × 縮尺）', () => {
    const prims = decomposeDim({ id: 'x', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, off: 1000 }, 50);
    const text = prims.find((p) => p.t === 'text');
    expect(text && text.t === 'text' ? text.s : '').toBe('6,000');
    expect(text && text.t === 'text' ? text.h : 0).toBeCloseTo(125);
  });

  it('長さ 0 の寸法は何も描かない', () => {
    expect(decomposeDim({ id: 'x', a: { x: 1, y: 1 }, b: { x: 1, y: 1 }, off: 0 }, 50)).toEqual([]);
  });

  it('寸法線の上（r 以内）なら選べる、遠ければ選べない', () => {
    const d = createDrawing();
    d.dims.push({ id: 'x', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, off: 1000 });
    expect(dimAt(d, { x: 3000, y: 1005 }, 10)?.id).toBe('x');
    expect(dimAt(d, { x: 3000, y: 0 }, 10)).toBeUndefined();
  });
});

describe('寸法の手入力と文字の複数行', () => {
  it('手で書いた値があれば、それを使う（空なら距離）', () => {
    expect(dimLabel({ id: 'x', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, off: 0, text: '6,000 (設計値)' })).toBe('6,000 (設計値)');
    expect(dimLabel({ id: 'x', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, off: 0, text: '  ' })).toBe('6,000');
  });

  it('改行で行が分かれ、先頭の行が一番上に来る', () => {
    const prims = decomposeNote({ id: 'n', p: { x: 0, y: 0 }, s: '上\n下', h: 3.5 }, 50);
    expect(prims.length).toBe(2);
    const [first, second] = prims;
    expect(first.t === 'text' && second.t === 'text' && first.p.y > second.p.y).toBe(true);
    expect(first.t === 'text' ? first.s : '').toBe('上');
  });

  it('文字の大きさを変えると高さも変わる（用紙 mm × 縮尺）', () => {
    const box = noteBox({ id: 'n', p: { x: 0, y: 0 }, s: 'A', h: 5 }, 50);
    expect(box.h).toBeCloseTo(250);
  });
});

describe('文字・レベル', () => {
  it('全角は半角の2倍の幅', () => {
    expect(noteWidth('A', 100)).toBeCloseTo(55);
    expect(noteWidth('あ', 100)).toBeCloseTo(100);
  });

  it('レベル記号は表記の文字を持つ', () => {
    const prims = decomposeLevel({ id: 'l', p: { x: 0, y: 0 }, s: 'FL±0' }, 50);
    const text = prims.find((p) => p.t === 'text');
    expect(text && text.t === 'text' ? text.s : '').toBe('FL±0');
  });

  it('点から線分までの距離', () => {
    expect(distToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3);
    expect(distToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5);
  });
});
