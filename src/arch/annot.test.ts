import { describe, expect, it } from 'vitest';
import { createDrawing } from '../model';
import { decomposeAnnotations, decomposeDim, decomposeNote, decomposePin, dimAt, dimLabel, dimValue, distToSegment, memoAt, noteAt, noteBox, noteWidth, decomposeLevel, pinAt } from './annot';

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

describe('ピン', () => {
  const pin = { id: 'p1', no: 3, p: { x: 1000, y: 2000 }, kind: '指摘', status: '未対応' as const, text: '確認', assignee: '', date: '2026-10-15' };

  it('丸と番号を描く（番号は置いた順の番号）', () => {
    const prims = decomposePin(pin, 50);
    const circle = prims.find((p) => p.t === 'circle');
    const text = prims.find((p) => p.t === 'text');
    expect(circle && circle.t === 'circle' ? circle.r : 0).toBeCloseTo(200);
    expect(text && text.t === 'text' ? text.s : '').toBe('3');
  });

  it('丸の中（と少し外）をタップすると選べる', () => {
    const d = createDrawing();
    d.pins.push(pin);
    expect(pinAt(d, { x: 1010, y: 2000 }, 10)?.id).toBe('p1');
    expect(pinAt(d, { x: 3000, y: 2000 }, 10)).toBeUndefined();
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

describe('ピンの色と大きさ', () => {
  const base = { id: 'q', no: 1, p: { x: 0, y: 0 }, kind: '指摘', status: '未対応' as const, text: 't', assignee: '', date: '2026-10-15' };
  it('大きさ L は半径 6mm×縮尺、色は青の hex と ACI 5 になる', () => {
    const prims = decomposePin({ ...base, color: 'blue', size: 'L' }, 50);
    const c = prims.find((p) => p.t === 'circle');
    expect(c && c.t === 'circle' && c.r).toBe(300);
    expect(c && c.t === 'circle' && c.pen).toEqual({ hex: '#1565c0', aci: 5 });
  });
  it('未設定は赤・中（半径 200）', () => {
    const c = decomposePin(base, 50).find((p) => p.t === 'circle');
    expect(c && c.t === 'circle' && c.r).toBe(200);
    expect(c && c.t === 'circle' && c.pen?.aci).toBe(1);
  });
  it('大きさに合わせてヒット判定の半径も変わる', () => {
    const d = createDrawing();
    d.scale = 50;
    d.pins.push({ ...base, size: 'L' });
    // 中心から 250mm 離れた点（L の半径 300mm 以内、M の 200mm の外）
    expect(pinAt(d, { x: 250000 / 1000, y: 0 }, 0)).toBeDefined();
  });
});

describe('メモ（別レイヤー）', () => {
  it('メモは MEMO 画層に青で出る。注記は NOTE のまま', () => {
    const d = createDrawing();
    d.scale = 50;
    d.memos.push({ id: 'm1', p: { x: 1000, y: 2000 }, s: '次回確認' });
    d.notes.push({ id: 'n1', p: { x: 0, y: 0 }, s: '注記' });
    const prims = decomposeAnnotations(d);
    const memo = prims.find((p) => p.t === 'text' && p.s === '次回確認');
    const note = prims.find((p) => p.t === 'text' && p.s === '注記');
    expect(memo && memo.layer).toBe('MEMO');
    expect(memo && memo.t === 'text' && memo.pen?.hex).toBe('#1565c0');
    expect(note && note.layer).toBe('NOTE');
  });

  it('タップ位置のメモを見つける（注記は見つけない）', () => {
    const d = createDrawing();
    d.scale = 50;
    d.memos.push({ id: 'm1', p: { x: 1000, y: 2000 }, s: 'メモ' });
    expect(memoAt(d, { x: 1005, y: 2005 }, 0)?.id).toBe('m1');
    expect(noteAt(d, { x: 1005, y: 2005 }, 0)).toBeUndefined();
  });
});
