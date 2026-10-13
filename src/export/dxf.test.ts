import { describe, expect, it } from 'vitest';
import { createDrawing } from '../model';
import { toDxf } from './dxf';

describe('toDxf', () => {
  it('LINE と画層を R12 形式で書き出す', () => {
    const d = createDrawing();
    d.entities.push({ id: '1', kind: 'line', layer: '0', a: { x: 0, y: 0 }, b: { x: 910, y: 455.5 } });
    const text = toDxf(d);
    const lines = text.split('\r\n');

    expect(text).toContain('AC1009');
    expect(text.endsWith('0\r\nEOF\r\n')).toBe(true);

    const i = lines.indexOf('LINE');
    expect(i).toBeGreaterThan(0);
    // 0/LINE の後に 8/画層, 10/x1, 20/y1, 30/z1, 11/x2, 21/y2, 31/z2
    expect(lines.slice(i + 1, i + 15)).toEqual([
      '8', '0', '10', '0.0', '20', '0.0', '30', '0.0', '11', '910.0', '21', '455.5', '31', '0.0',
    ]);
  });

  it('グループコードと値が必ずペアになる', () => {
    const d = createDrawing();
    d.entities.push({ id: '1', kind: 'line', layer: 'WALL', a: { x: -1.25, y: 3 }, b: { x: 2, y: -0 } });
    const lines = toDxf(d).split('\r\n').filter((l) => l !== '');
    expect(lines.length % 2).toBe(0);
    for (let i = 0; i < lines.length; i += 2) {
      expect(lines[i]).toMatch(/^\d+$/);
    }
    // 整数コード（色62・フラグ70など）に小数を書かない
    for (let i = 0; i < lines.length; i += 2) {
      const code = Number(lines[i]);
      if ((code >= 60 && code <= 99) || (code >= 170 && code <= 179)) {
        expect(lines[i + 1]).toMatch(/^-?\d+$/);
      }
    }
    // 未登録の画層も LAYER テーブルに追加される
    expect(lines).toContain('WALL');
  });
});
