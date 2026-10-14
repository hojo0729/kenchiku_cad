import { normalizeDrawing, type Drawing } from '../model';

/**
 * 図面データ（部材のまま）を DXF に埋め込む / 取り出す。
 *
 * DXF は線・円・文字に分解した結果なので、そのままでは柱・壁などとして編集し直せない。
 * そこで「0 EOF」の後ろに、999（コメント）の組として図面データの JSON を書いておく。
 *  - DXF を読むソフト（Jw_cad・AutoCAD・ezdxf）は EOF で読むのをやめるので影響しない
 *  - このアプリで開いたときだけ、EOF の後ろを探して部材データとして戻す
 * JSON は ASCII だけにする（日本語は \uXXXX）。DXF 全体を Shift_JIS にしても壊れないように。
 */

const BEGIN = 'KENCHIKU-CAD-DATA 1';
const END = 'KENCHIKU-CAD-END';
const CHUNK = 200;

/** 図面を ASCII だけの JSON にする */
export function drawingToJson(d: Drawing): string {
  const json = JSON.stringify({ app: 'kenchiku-cad', format: 1, drawing: d });
  return json.replace(/[\u0080-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

/** JSON から図面に戻す（形が違えば null） */
export function drawingFromJson(text: string): Drawing | null {
  try {
    const obj = JSON.parse(text) as { app?: string; drawing?: Drawing };
    const d = obj?.app === 'kenchiku-cad' ? obj.drawing : (obj as unknown as Drawing);
    if (!d || d.version !== 1 || !Array.isArray(d.entities)) return null;
    return normalizeDrawing(d);
  } catch {
    return null;
  }
}

/** DXF の EOF の後ろに付ける行（CRLF で区切る前の配列） */
export function embedLines(d: Drawing): string[] {
  const json = drawingToJson(d);
  const out = ['999', BEGIN];
  for (let i = 0; i < json.length; i += CHUNK) out.push('999', json.slice(i, i + CHUNK));
  out.push('999', END);
  return out;
}

/** DXF（文字列）から埋め込んだ図面を取り出す。無ければ null */
export function extractEmbedded(dxf: string): Drawing | null {
  const start = dxf.lastIndexOf(BEGIN);
  if (start < 0) return null;
  const end = dxf.indexOf(END, start);
  if (end < 0) return null;
  const lines = dxf.slice(start + BEGIN.length, end).split(/\r?\n/);
  let json = '';
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '999' && i + 1 < lines.length) {
      json += lines[i + 1];
      i++;
    }
  }
  return drawingFromJson(json);
}

/**
 * 無圧縮(STORE)の ZIP から最初のファイルを取り出す。
 * 公開ページで保存した zip（このアプリが作ったもの）をそのまま開けるようにするため。
 * 圧縮された zip は読めない（null）。
 */
export function unzipFirst(bytes: Uint8Array): { name: string; data: Uint8Array } | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  while (p + 30 <= bytes.length && v.getUint32(p, true) === 0x04034b50) {
    const method = v.getUint16(p + 8, true);
    const size = v.getUint32(p + 18, true);
    const nameLen = v.getUint16(p + 26, true);
    const extraLen = v.getUint16(p + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nameLen));
    const dataStart = p + 30 + nameLen + extraLen;
    if (method === 0 && !name.endsWith('/') && !name.startsWith('__MACOSX')) {
      return { name, data: bytes.subarray(dataStart, dataStart + size) };
    }
    p = dataStart + size;
  }
  return null;
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}
