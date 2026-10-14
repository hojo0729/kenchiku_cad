import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { buildPdf, pdfString } from './pdf';

const dec = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

function sampleGray(w: number, h: number): Uint8Array {
  const g = new Uint8Array(w * h).fill(255);
  for (let x = 0; x < w; x++) g[(h >> 1) * w + x] = 0; // 中央に横線
  for (let y = 0; y < h; y++) g[y * w + 3] = 0; // 左に縦線
  return g;
}

describe('buildPdf', () => {
  it('xref の位置が、各オブジェクトの "n 0 obj" を指している', async () => {
    const pdf = await buildPdf({ widthPt: 1190.55, heightPt: 841.89, image: { width: 8, height: 6, gray: sampleGray(8, 6) } }, async () => null);
    const text = dec(pdf);
    const xref = Number(text.match(/startxref\n(\d+)\n%%EOF/)![1]);
    expect(text.slice(xref, xref + 5)).toBe('xref\n');
    const lines = text.slice(xref).split('\n');
    const count = Number(lines[1].split(' ')[1]);
    expect(count).toBe(7); // 0番（空き）＋6オブジェクト
    for (let i = 1; i < count; i++) {
      const off = Number(lines[2 + i].slice(0, 10));
      expect(text.slice(off, off + `${i} 0 obj`.length)).toBe(`${i} 0 obj`);
    }
  });

  it('用紙サイズ（MediaBox）と画像の大きさが入る', async () => {
    const pdf = await buildPdf({ widthPt: 1190.55, heightPt: 841.89, image: { width: 8, height: 6, gray: sampleGray(8, 6) } }, async () => null);
    const text = dec(pdf);
    expect(text).toContain('/MediaBox [0 0 1190.55 841.89]');
    expect(text).toContain('/Width 8 /Height 6 /ColorSpace /DeviceGray /BitsPerComponent 8');
    expect(text).toContain('/Length 48');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('無圧縮のとき、画像の画素がそのまま入っている', async () => {
    const gray = sampleGray(8, 6);
    const pdf = await buildPdf({ widthPt: 100, heightPt: 100, image: { width: 8, height: 6, gray }, compress: false }, async () => null);
    const text = dec(pdf);
    expect(text).not.toContain('FlateDecode');
    const start = text.indexOf('stream\n', text.indexOf('/Subtype /Image')) + 7;
    expect(Array.from(pdf.subarray(start, start + gray.length))).toEqual(Array.from(gray));
  });

  it('圧縮したとき、展開すると元の画素に戻る（Node の zlib と CompressionStream の両方で確かめる）', async () => {
    const gray = sampleGray(40, 30);
    const pdf = await buildPdf({ widthPt: 100, heightPt: 100, image: { width: 40, height: 30, gray } });
    const text = dec(pdf);
    expect(text).toContain('/Filter /FlateDecode');
    const head = text.indexOf('/Filter /FlateDecode');
    const lenMatch = text.slice(head).match(/\/Length (\d+)/)!;
    const len = Number(lenMatch[1]);
    const start = text.indexOf('stream\n', head) + 7;
    const packed = pdf.subarray(start, start + len);
    const back = inflateSync(packed);
    expect(Array.from(back)).toEqual(Array.from(gray));
  });

  it('画素数が合わないと例外', async () => {
    await expect(buildPdf({ widthPt: 1, heightPt: 1, image: { width: 2, height: 2, gray: new Uint8Array(3) } })).rejects.toThrow();
  });

  it('タイトルは ASCII に直して括弧をエスケープする', () => {
    // 日本語は ? になり、括弧と円記号はエスケープされる
    expect(pdfString('図(面)\\')).toBe('(?\\(?\\)\\\\)');
    expect(pdfString('a(b)')).toBe('(a\\(b\\))');
  });
});
