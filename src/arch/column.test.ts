import { describe, expect, it } from 'vitest';
import { createDrawing } from '../model';
import { columnRect, decomposeColumns, nearestIntersection, nextColumnMark } from './column';
import { toDxf } from '../export/dxf';

function drawing() {
  const d = createDrawing();
  d.grid = { xSpans: [6000, 7200], ySpans: [6500], xPrefix: 'X', yPrefix: 'Y', origin: { x: 0, y: 0 } };
  return d;
}

describe('柱', () => {
  it('振り分けと寄り', () => {
    const d = drawing();
    d.columns.push({ id: 'a', typeId: 'ct1', xi: 1, yi: 0, left: null, bottom: null });
    d.columns.push({ id: 'b', typeId: 'ct1', xi: 0, yi: 1, left: 150, bottom: 550 });
    expect(columnRect(d, d.columns[0])).toEqual({ min: { x: 5600, y: -400 }, max: { x: 6400, y: 400 } });
    expect(columnRect(d, d.columns[1])).toEqual({ min: { x: -150, y: 5950 }, max: { x: 650, y: 6750 } });
  });

  it('符号の大きさを変えると全部の柱が変わり、スパンを変えると一緒に動く', () => {
    const d = drawing();
    d.columns.push({ id: 'a', typeId: 'ct1', xi: 2, yi: 0, left: null, bottom: null });
    d.columnTypes[0].bx = 1000;
    expect(columnRect(d, d.columns[0])!.min.x).toBe(13200 - 500);
    d.grid!.xSpans = [6000, 8000];
    expect(columnRect(d, d.columns[0])!.min.x).toBe(14000 - 500);
  });

  it('通り芯が無い・範囲外の柱は描かない', () => {
    const d = drawing();
    d.columns.push({ id: 'a', typeId: 'ct1', xi: 5, yi: 0, left: null, bottom: null });
    expect(decomposeColumns(d)).toHaveLength(0);
  });

  it('外形4本＋符号に分解、DXF の COLUMN 画層に出る', () => {
    const d = drawing();
    d.columns.push({ id: 'a', typeId: 'ct1', xi: 0, yi: 0, left: null, bottom: null });
    const p = decomposeColumns(d);
    expect(p.filter((x) => x.t === 'line')).toHaveLength(4);
    expect(p.find((x) => x.t === 'text')).toMatchObject({ s: 'C1' });
    expect(toDxf(d)).toMatch(/\r\nCOLUMN\r\n/);
  });

  it('近い交点と次の符号', () => {
    const d = drawing();
    expect(nearestIntersection(d, { x: 6100, y: 80 }, 300)).toMatchObject({ xi: 1, yi: 0 });
    expect(nearestIntersection(d, { x: 3000, y: 3000 }, 300)).toBeNull();
    expect(nextColumnMark([{ id: '1', mark: 'C1', bx: 1, by: 1 }, { id: '2', mark: 'C3', bx: 1, by: 1 }])).toBe('C2');
  });
});
