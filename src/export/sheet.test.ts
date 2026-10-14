import { describe, expect, it } from 'vitest';
import { PAPERS, sheetLayout, toGray } from './sheet';

describe('sheetLayout（用紙への配置）', () => {
  const ext = { min: { x: 0, y: 0 }, max: { x: 19200, y: 13000 } }; // 通り芯の範囲（mm）

  it('縮尺 1/50 で、図形の実寸が用紙上の mm どおりになる', () => {
    const L = sheetLayout('A3', 50, ext);
    const pxPerMm = PAPERS.A3.dpi / 25.4;
    // 実寸 1000mm は紙の上で 20mm = 20 × pxPerMm px
    const a = L.view.toScreen({ x: 0, y: 0 });
    const b = L.view.toScreen({ x: 1000, y: 0 });
    expect(b.x - a.x).toBeCloseTo(20 * pxPerMm, 3);
    expect(L.pxW).toBe(Math.round(420 * pxPerMm));
  });

  it('図形の中心が図面領域の中心に来る', () => {
    const L = sheetLayout('A3', 50, ext);
    const c = L.view.toScreen({ x: 9600, y: 6500 });
    expect(c.x).toBeCloseTo(L.area.x + L.area.w / 2, 3);
    expect(c.y).toBeCloseTo(L.area.y + L.area.h / 2, 3);
  });

  it('用紙に入らないときは fits が false', () => {
    // 19.2m を 1/20 にすると 960mm。A1 の図面領域（約805mm）にも入らない
    expect(sheetLayout('A3', 20, ext).fits).toBe(false);
    expect(sheetLayout('A1', 20, ext).fits).toBe(false);
    // 1/50 なら 384mm。A3 の図面領域ぎりぎり、A1 には余裕で入る
    expect(sheetLayout('A1', 50, ext).fits).toBe(true);
    expect(sheetLayout('A1', 100, ext).fits).toBe(true);
  });

  it('表題欄は図枠の右下、改訂欄は左下にある', () => {
    const L = sheetLayout('A3', 50, ext);
    expect(L.titleBlock.x + L.titleBlock.w).toBeCloseTo(L.frame.x + L.frame.w, 3);
    expect(L.titleBlock.y + L.titleBlock.h).toBeCloseTo(L.frame.y + L.frame.h, 3);
    expect(L.revBlock.x).toBeCloseTo(L.frame.x, 3);
  });

  it('図形が無いときも配置を返す', () => {
    expect(sheetLayout('A3', 50, null).fits).toBe(true);
  });
});

describe('toGray', () => {
  it('白い画素は255、黒は0、色は輝度にする', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
    expect(Array.from(toGray(rgba, 3, 1))).toEqual([255, 0, 76]);
  });
});
