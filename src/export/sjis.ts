/**
 * 文字列を Shift_JIS（CP932）のバイト列にする。
 * DXF R12 の日本語（文字・画層名）は Shift_JIS が前提（Jw_cad も AutoCAD も）。
 * ブラウザには Shift_JIS のエンコーダーが無いので、TextDecoder('shift_jis') で
 * 2バイト文字の全範囲を一度だけ読み、逆引きの表を作る。
 */

let table: Map<string, number> | null = null;

function buildTable(): Map<string, number> {
  const map = new Map<string, number>();
  const leads: number[] = [];
  for (let b = 0x81; b <= 0x9f; b++) leads.push(b);
  for (let b = 0xe0; b <= 0xfc; b++) leads.push(b);
  const bytes: number[] = [];
  const codes: number[] = [];
  for (const lead of leads) {
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue;
      bytes.push(lead, trail);
      codes.push((lead << 8) | trail);
    }
  }
  // まとめて1回で読む（1文字ずつより速い）。読めない組は U+FFFD になる
  const text = new TextDecoder('shift_jis').decode(new Uint8Array(bytes));
  const chars = [...text];
  if (chars.length === codes.length) {
    chars.forEach((ch, i) => {
      if (ch !== '�' && !map.has(ch)) map.set(ch, codes[i]);
    });
  } else {
    // 念のため: 長さが合わないときは1文字ずつ
    const dec = new TextDecoder('shift_jis');
    for (const code of codes) {
      const ch = dec.decode(new Uint8Array([code >> 8, code & 0xff]));
      if (ch.length === 1 && ch !== '�' && !map.has(ch)) map.set(ch, code);
    }
  }
  // 半角カナ（1バイト）
  for (let b = 0xa1; b <= 0xdf; b++) {
    const ch = new TextDecoder('shift_jis').decode(new Uint8Array([b]));
    if (ch.length === 1) map.set(ch, b);
  }
  return map;
}

export function encodeShiftJis(text: string): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  let map: Map<string, number> | null = null;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) {
      out.push(c);
      continue;
    }
    map ??= table ??= buildTable();
    const code = map.get(ch);
    if (code === undefined) out.push(0x3f); // Shift_JIS に無い文字は「?」
    else if (code > 0xff) out.push(code >> 8, code & 0xff);
    else out.push(code);
  }
  return new Uint8Array(out);
}
