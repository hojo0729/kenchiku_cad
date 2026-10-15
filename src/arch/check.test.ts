import { describe, expect, it } from 'vitest';
import { createDrawing } from '../model';
import { checkDrawing, parseDimText } from './check';

describe('寸法の文字の解釈', () => {
  it('数字だけ取り出す。数字が無ければ null', () => {
    expect(parseDimText('3,600')).toBe(3600);
    expect(parseDimText('約3600mm')).toBe(3600);
    expect(parseDimText('SL')).toBeNull();
  });
});

describe('整合チェック', () => {
  it('手で書いた寸法が実際の距離と違えば指摘する', () => {
    const d = createDrawing();
    d.dims.push({ id: 'd1', a: { x: 0, y: 0 }, b: { x: 3600, y: 0 }, off: 500, text: '3900' });
    d.dims.push({ id: 'd2', a: { x: 0, y: 0 }, b: { x: 3600, y: 0 }, off: 500, text: '3600' });
    d.dims.push({ id: 'd3', a: { x: 0, y: 0 }, b: { x: 3600, y: 0 }, off: 500 });
    const issues = checkDrawing(d);
    expect(issues.map((i) => i.id)).toEqual(['d1']);
    expect(issues[0].kind).toBe('dim');
    expect(issues[0].point).toEqual({ x: 1800, y: 0 });
  });

  it('許容差（1mm）以内の差は指摘しない', () => {
    const d = createDrawing();
    d.dims.push({ id: 'd1', a: { x: 0, y: 0 }, b: { x: 3600.4, y: 0 }, off: 500, text: '3600' });
    expect(checkDrawing(d)).toEqual([]);
  });

  it('通り芯が無ければ柱・開口は見ずに、寸法だけ見る', () => {
    const d = createDrawing();
    expect(checkDrawing(d)).toEqual([]);
  });
});

describe('柱と開口のチェック', () => {
  const withGrid = () => {
    const d = createDrawing();
    d.grid = { xSpans: [6000, 7200], ySpans: [6000], xPrefix: 'X', yPrefix: 'Y', origin: { x: 0, y: 0 } };
    return d;
  };

  it('柱が隣の通り芯をまたいだら指摘する', () => {
    const d = withGrid();
    d.columnTypes.push({ id: 't1', mark: 'C1', bx: 14000, by: 800 });
    d.columns.push({ id: 'c1', typeId: 't1', xi: 1, yi: 0, left: null, bottom: null });
    const issues = checkDrawing(d);
    expect(issues.some((i) => i.kind === 'column' && i.id === 'c1')).toBe(true);
  });

  it('普通の大きさの柱は指摘しない', () => {
    const d = withGrid();
    d.columnTypes.push({ id: 't1', mark: 'C1', bx: 800, by: 800 });
    d.columns.push({ id: 'c1', typeId: 't1', xi: 1, yi: 0, left: null, bottom: null });
    expect(checkDrawing(d).filter((i) => i.kind === 'column')).toEqual([]);
  });

  it('開口が壁の長さを越えたら指摘する', () => {
    const d = withGrid();
    d.wallTypes.push({ id: 'w1', mark: 'W18', t: 180 });
    d.walls.push({ id: 'wall1', typeId: 'w1', axis: 'x', line: 0, from: 0, to: 1, offset: null });
    d.openings.push({ id: 'o1', wallId: 'wall1', start: 5000, width: 2000 });
    const issues = checkDrawing(d).filter((i) => i.kind === 'opening');
    expect(issues.map((i) => i.id)).toEqual(['o1']);
  });
});
