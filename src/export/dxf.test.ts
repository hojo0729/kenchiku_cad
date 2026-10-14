import { describe, expect, it } from 'vitest';
import { createDrawing } from '../model';
import { toDxf } from './dxf';

/** DXFを [コード, 値] の組に分解（前後空白は除去） */
function pairs(text: string): [number, string][] {
  const lines = text.split('\r\n');
  if (lines[lines.length - 1] === '') lines.pop();
  expect(lines.length % 2).toBe(0);
  const out: [number, string][] = [];
  for (let i = 0; i < lines.length; i += 2) {
    expect(lines[i]).toMatch(/^ *\d+$/);
    out.push([Number(lines[i]), lines[i + 1].trim()]);
  }
  return out;
}

function sample() {
  const d = createDrawing();
  d.entities.push({ id: '1', kind: 'line', layer: '0', a: { x: 0, y: 0 }, b: { x: 910, y: 455.5 } });
  return d;
}

describe('toDxf', () => {
  it('LINE を R12 形式で書き出す', () => {
    const p = pairs(toDxf(sample()));
    const i = p.findIndex(([c, v]) => c === 0 && v === 'LINE');
    expect(i).toBeGreaterThan(0);
    expect(p.slice(i + 1, i + 8)).toEqual([
      [8, '0'],
      [10, '0.0'],
      [20, '0.0'],
      [30, '0.0'],
      [11, '910.0'],
      [21, '455.5'],
      [31, '0.0'],
    ]);
    expect(p[p.length - 1]).toEqual([0, 'EOF']);
  });

  it('グループコードは右寄せ3桁（AutoCAD と同じ書式）', () => {
    const lines = toDxf(sample()).split('\r\n');
    expect(lines[0]).toBe('  0');
    expect(lines[1]).toBe('SECTION');
  });

  it('Jw_cad が必要とするヘッダ・テーブル・BLOCKS を含む', () => {
    const p = pairs(toDxf(sample()));
    const vars = p.filter(([c]) => c === 9).map(([, v]) => v);
    expect(vars).toEqual(['$ACADVER', '$INSBASE', '$EXTMIN', '$EXTMAX', '$LIMMIN', '$LIMMAX', '$LTSCALE']);
    const sections = p.filter(([c], i) => c === 2 && p[i - 1]?.[1] === 'SECTION').map(([, v]) => v);
    expect(sections).toEqual(['HEADER', 'TABLES', 'BLOCKS', 'ENTITIES']);
    const tables = p.filter(([c], i) => c === 2 && p[i - 1]?.[1] === 'TABLE').map(([, v]) => v);
    expect(tables).toEqual(['VPORT', 'LTYPE', 'LAYER', 'STYLE', 'VIEW', 'UCS']);

    const ext = p.findIndex(([, v]) => v === '$EXTMAX');
    expect(p.slice(ext + 1, ext + 3)).toEqual([
      [10, '910.0'],
      [20, '455.5'],
    ]);
  });

  it('$LIMMIN/$LIMMAX は 用紙×縮尺 の範囲を図形中心に置く（既定 A3・1/100）', () => {
    const p = pairs(toDxf(sample(), { scale: 100 }));
    const at = (name: string) => {
      const i = p.findIndex(([, v]) => v === name);
      return [Number(p[i + 1][1]), Number(p[i + 2][1])];
    };
    const [x0, y0] = at('$LIMMIN');
    const [x1, y1] = at('$LIMMAX');
    expect(x1 - x0).toBeCloseTo(42000);
    expect(y1 - y0).toBeCloseTo(29700);
    expect((x0 + x1) / 2).toBeCloseTo(455);
    expect((y0 + y1) / 2).toBeCloseTo(227.75);
  });

  it('整数コードに小数を書かず、未登録の画層も LAYER に追加する', () => {
    const d = createDrawing();
    d.entities.push({ id: '1', kind: 'line', layer: 'WALL', a: { x: -1.25, y: 3 }, b: { x: 2, y: -0 } });
    const p = pairs(toDxf(d));
    for (const [c, v] of p) {
      if ((c >= 60 && c <= 99) || (c >= 170 && c <= 179)) expect(v).toMatch(/^-?\d+$/);
    }
    expect(p).toContainEqual([2, 'WALL']);
  });
});
