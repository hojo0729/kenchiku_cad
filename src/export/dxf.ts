import type { Drawing } from '../model';

/**
 * DXF R12 (AC1009) ASCII 形式で書き出す。
 * R12 を選んでいる理由: Jw_cad・AutoCAD・ODA File Converter など
 * ほぼ全てのCADが読める最も互換性の高い版のため。
 *
 * 注意: R12 では日本語の画層名/文字は Shift_JIS が前提。
 * 今はASCIIのみ想定（日本語対応は文字実装時に Shift_JIS エンコードを追加）。
 */
export function toDxf(drawing: Drawing): string {
  const out: string[] = [];
  const g = (code: number, value: string | number) => {
    let text: string;
    if (typeof value === 'string') text = value;
    else if (isFloatCode(code)) text = num(value);
    else text = String(Math.round(value));
    out.push(String(code), text);
  };

  // HEADER
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$MEASUREMENT');
  g(70, 1); // メートル法
  g(0, 'ENDSEC');

  // TABLES
  g(0, 'SECTION');
  g(2, 'TABLES');

  g(0, 'TABLE');
  g(2, 'LTYPE');
  g(70, 1);
  g(0, 'LTYPE');
  g(2, 'CONTINUOUS');
  g(70, 0);
  g(3, 'Solid line');
  g(72, 65);
  g(73, 0);
  g(40, 0);
  g(0, 'ENDTAB');

  const layerNames = new Set(drawing.layers.map((l) => l.name));
  const layers = [...drawing.layers];
  for (const e of drawing.entities) {
    if (!layerNames.has(e.layer)) {
      layerNames.add(e.layer);
      layers.push({ name: e.layer, color: 7 });
    }
  }
  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, layers.length);
  for (const l of layers) {
    g(0, 'LAYER');
    g(2, l.name);
    g(70, 0);
    g(62, l.color);
    g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  // ENTITIES
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  for (const e of drawing.entities) {
    switch (e.kind) {
      case 'line':
        g(0, 'LINE');
        g(8, e.layer);
        g(10, e.a.x);
        g(20, e.a.y);
        g(30, 0);
        g(11, e.b.x);
        g(21, e.b.y);
        g(31, 0);
        break;
    }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');

  // DXFはCRLFが最も無難
  return out.join('\r\n') + '\r\n';
}

/** 実数を書くべきグループコードか（それ以外の数値コードは整数で書く必要がある） */
function isFloatCode(code: number): boolean {
  return (
    (code >= 10 && code <= 59) ||
    (code >= 110 && code <= 149) ||
    (code >= 210 && code <= 239) ||
    (code >= 1010 && code <= 1059)
  );
}

/** 小数点以下を最大6桁、末尾の0を落とす（-0 は 0 に） */
function num(v: number): string {
  if (Object.is(v, -0)) v = 0;
  if (Number.isInteger(v)) return v.toFixed(1);
  return v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0');
}
