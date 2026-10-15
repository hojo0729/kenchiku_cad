import { describe, expect, it } from 'vitest';
import { createDrawing } from '../model';
import { toDxf, toDxfBytes } from './dxf';
import { extractEmbedded, isZip, unzipFirst } from './native';
import { zipStore } from './zip';
import { decodeDxf, readDxf } from '../import/dxf-read';

function sample() {
  const d = createDrawing();
  d.grid = { xSpans: [6000, 7200], ySpans: [6500], xPrefix: 'X', yPrefix: 'Y', origin: { x: 0, y: 0 } };
  d.columns.push({ id: 'c1', typeId: d.columnTypes[0].id, xi: 1, yi: 0, left: 150, bottom: null });
  d.walls = [{ id: 'w', typeId: 'wt18', axis: 'y', line: 0, from: 0, to: 1, offset: null }];
  d.openings = [{ id: 'o', wallId: 'w', start: 1000, width: 900 }];
  d.columnTypes[0].mark = '柱A'; // 日本語の符号も戻ること
  return d;
}

describe('DXF に部材データを埋め込む', () => {
  it('保存した DXF から同じ図面に戻る（Shift_JIS のバイト列から）', () => {
    const d = sample();
    const back = extractEmbedded(decodeDxf(toDxfBytes(d)).text);
    expect(back).not.toBeNull();
    expect(back!.grid).toEqual(d.grid);
    expect(back!.columns).toEqual(d.columns);
    expect(back!.walls).toEqual(d.walls);
    expect(back!.openings).toEqual(d.openings);
    expect(back!.columnTypes[0].mark).toBe('柱A');
  });

  it('埋め込みは EOF の後ろだけで、DXF としての読み込みには影響しない', () => {
    const d = sample();
    const plain = readDxf(toDxf(d));
    const withData = readDxf(toDxf(d, { embed: true }));
    expect(withData.prims.length).toBe(plain.prims.length);
    const text = toDxf(d, { embed: true });
    const eof = text.indexOf('\r\nEOF\r\n');
    expect(text.indexOf('KENCHIKU-CAD-DATA')).toBeGreaterThan(eof);
    // 埋め込み部分は ASCII だけ
    expect(/^[\x00-\x7f]*$/.test(text.slice(eof))).toBe(true);
  });

  it('部材データの無い DXF は null', () => {
    expect(extractEmbedded(toDxf(sample()))).toBeNull();
  });

  it('公開ページで保存した zip のままでも開ける', () => {
    const bytes = toDxfBytes(sample());
    const zip = zipStore([{ name: 'drawing.dxf', data: bytes }]);
    expect(isZip(zip)).toBe(true);
    const inner = unzipFirst(zip)!;
    expect(inner.name).toBe('drawing.dxf');
    expect(extractEmbedded(decodeDxf(inner.data).text)?.walls.length).toBe(1);
  });
});

describe('ピンの写真', () => {
  it('写真（data URL）は DXF の埋め込みデータを通って戻る', () => {
    const d = createDrawing();
    const photo = 'data:image/jpeg;base64,' + 'QUJD'.repeat(5000);
    d.pins.push({ id: 'p1', no: 1, p: { x: 100, y: 200 }, kind: '指摘', status: '未対応', text: '確認', assignee: '', date: '2026-10-15', photo });
    const dxf = toDxf(d, { embed: true });
    const back = extractEmbedded(dxf);
    expect(back?.pins[0].photo).toBe(photo);
  });
});
