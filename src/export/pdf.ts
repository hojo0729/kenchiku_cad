/**
 * 1ページだけの PDF を作る（白黒のラスター画像を1枚貼る、最小限の実装）。
 *
 * 図枠・文字は呼び出し側で canvas に描いて画像にする。日本語のフォントを
 * PDF に埋め込むのは大変なので、画面と同じ見た目を画像で持つ方式にした。
 * 代わりに拡大しても線はぼやける（印刷なら 150〜200dpi あれば十分）。
 *
 * 画像は 8bit グレー。圧縮（FlateDecode）は CompressionStream が使える環境では使い、
 * 無ければ無圧縮で書く（どちらも PDF として正しい）。
 */

export type PdfImage = {
  /** 画素数 */
  width: number;
  height: number;
  /** 1画素1バイトのグレー（0=黒, 255=白）、行ごとに width バイト、上から下 */
  gray: Uint8Array;
};

export type PdfOptions = {
  /** 用紙の大きさ（pt。1pt = 1/72 inch = 0.3528 mm） */
  widthPt: number;
  heightPt: number;
  image: PdfImage;
  title?: string;
  /** 圧縮するか（既定 true。対応していなければ自動で無圧縮） */
  compress?: boolean;
};

const enc = new TextEncoder();

/** ASCII だけの PDF 文字列（括弧とバックスラッシュはエスケープ） */
export function pdfString(s: string): string {
  const ascii = s.replace(/[^\x20-\x7e]/g, '?');
  return '(' + ascii.replace(/[\\()]/g, (c) => '\\' + c) + ')';
}

type Compressor = (data: Uint8Array) => Promise<Uint8Array | null>;

/** gray を zlib 形式に圧縮する。使えなければ null */
export const deflateZlib: Compressor = async (data) => {
  const CS = (globalThis as { CompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array> })
    .CompressionStream;
  if (!CS) return null;
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CS('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
};

export async function buildPdf(opts: PdfOptions, compressor: Compressor = deflateZlib): Promise<Uint8Array> {
  const { image } = opts;
  if (image.gray.length !== image.width * image.height) throw new Error('画像のサイズが合いません');

  let data: Uint8Array = image.gray;
  let filter = '';
  if (opts.compress !== false) {
    const z = await compressor(image.gray);
    if (z) {
      data = z;
      filter = ' /Filter /FlateDecode';
    }
  }

  const W = opts.widthPt.toFixed(2);
  const H = opts.heightPt.toFixed(2);
  const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q\n`;

  // オブジェクト番号は 1 から。本文は文字列か「文字列とバイト列の並び」
  type Body = string | (string | Uint8Array)[];
  const objects: Body[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageB /ImageC] >> /Contents 5 0 R >>`,
    [
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8${filter} /Length ${data.length} >>\nstream\n`,
      data,
      '\nendstream\n',
    ],
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    `<< /Producer ${pdfString('kenchiku-cad')} /Title ${pdfString(opts.title ?? '図面')} >>`,
  ];

  const parts: Uint8Array[] = [];
  let pos = 0;
  const put = (x: Uint8Array | string) => {
    const b = typeof x === 'string' ? enc.encode(x) : x;
    parts.push(b);
    pos += b.length;
  };

  put('%PDF-1.4\n%âãÏÓ\n');
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pos);
    put(`${i + 1} 0 obj\n`);
    if (typeof body === 'string') put(body + '\n');
    else for (const x of body) put(x);
    put('endobj\n');
  });

  const xref = pos;
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) table += `${String(off).padStart(10, '0')} 00000 n \n`;
  put(table);
  put(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(pos);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}
