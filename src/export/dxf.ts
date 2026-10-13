import type { Drawing, Vec2 } from '../model';

/**
 * DXF R12 (AC1009) ASCII 形式で書き出す。
 * R12 を選んでいる理由: Jw_cad・AutoCAD・ODA File Converter など
 * ほぼ全てのCADが読める最も互換性の高い版のため。
 *
 * Jw_cad は最小構成の DXF（HEADER に $ACADVER だけ等）を読めず
 * 「図形がありません」になったため、AutoCAD R12 が出力する形に寄せている:
 *  - グループコードは右寄せ3桁（"  0", " 10"）
 *  - HEADER に $INSBASE / $EXTMIN / $EXTMAX / $LIMMIN / $LIMMAX
 *  - TABLES に VPORT / LTYPE / LAYER / STYLE / VIEW / UCS
 *  - 空の BLOCKS セクション
 *  - R12 に存在しない変数（$MEASUREMENT 等）は書かない
 *
 * 注意: R12 では日本語の画層名/文字は Shift_JIS が前提。
 * 今はASCIIのみ想定（日本語対応は文字実装時に Shift_JIS エンコードを追加）。
 */
export type DxfOptions = {
  /** 用紙サイズ(mm)。既定は A3 横 */
  paper?: { width: number; height: number };
  /** 縮尺の分母。既定は 100（1/100） */
  scale?: number;
};

/**
 * Jw_cad は DXF を開くとき $LIMMIN/$LIMMAX（図面の用紙範囲）から縮尺を決めるため、
 * 用紙サイズ × 縮尺 の範囲を図形の中心に合わせて書き込む。
 * （図形範囲そのままを書くと 1/4 などの半端な縮尺で開かれた）
 */
export function toDxf(drawing: Drawing, options: DxfOptions = {}): string {
  const paper = options.paper ?? { width: 420, height: 297 };
  const scale = options.scale ?? 100;
  const out: string[] = [];
  const g = (code: number, value: string | number) => {
    let text: string;
    if (typeof value === 'string') text = value;
    else if (isFloatCode(code)) text = num(value);
    else text = String(Math.round(value)).padStart(6, ' ');
    out.push(String(code).padStart(3, ' '), text);
  };
  const point = (base: number, p: Vec2) => {
    g(base, p.x);
    g(base + 10, p.y);
    g(base + 20, 0);
  };

  const { min, max } = extents(drawing);

  // ---------- HEADER ----------
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$INSBASE');
  point(10, { x: 0, y: 0 });
  g(9, '$EXTMIN');
  point(10, min);
  g(9, '$EXTMAX');
  point(10, max);
  const lw = paper.width * scale;
  const lh = paper.height * scale;
  const lcx = (min.x + max.x) / 2;
  const lcy = (min.y + max.y) / 2;
  g(9, '$LIMMIN');
  g(10, lcx - lw / 2);
  g(20, lcy - lh / 2);
  g(9, '$LIMMAX');
  g(10, lcx + lw / 2);
  g(20, lcy + lh / 2);
  g(0, 'ENDSEC');

  // ---------- TABLES ----------
  g(0, 'SECTION');
  g(2, 'TABLES');

  // VPORT（*ACTIVE を図面範囲に合わせる）
  const cx = (min.x + max.x) / 2;
  const cy = (min.y + max.y) / 2;
  const height = Math.max(max.y - min.y, (max.x - min.x) / 1.5, 1) * 1.1;
  g(0, 'TABLE');
  g(2, 'VPORT');
  g(70, 1);
  g(0, 'VPORT');
  g(2, '*ACTIVE');
  g(70, 0);
  g(10, 0);
  g(20, 0);
  g(11, 1);
  g(21, 1);
  g(12, cx);
  g(22, cy);
  g(13, 0);
  g(23, 0);
  g(14, 1);
  g(24, 1);
  g(15, 0);
  g(25, 0);
  g(16, 0);
  g(26, 0);
  g(36, 1);
  g(17, 0);
  g(27, 0);
  g(37, 0);
  g(40, height);
  g(41, 1.5);
  g(42, 50);
  g(43, 0);
  g(44, 0);
  g(50, 0);
  g(51, 0);
  g(71, 0);
  g(72, 100);
  g(73, 1);
  g(74, 1);
  g(75, 0);
  g(76, 0);
  g(77, 0);
  g(78, 0);
  g(0, 'ENDTAB');

  // LTYPE
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

  // LAYER
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

  // STYLE
  g(0, 'TABLE');
  g(2, 'STYLE');
  g(70, 1);
  g(0, 'STYLE');
  g(2, 'STANDARD');
  g(70, 0);
  g(40, 0);
  g(41, 1);
  g(50, 0);
  g(71, 0);
  g(42, 2.5);
  g(3, 'txt');
  g(4, '');
  g(0, 'ENDTAB');

  // VIEW / UCS（空）
  for (const name of ['VIEW', 'UCS']) {
    g(0, 'TABLE');
    g(2, name);
    g(70, 0);
    g(0, 'ENDTAB');
  }

  g(0, 'ENDSEC');

  // ---------- BLOCKS（空） ----------
  g(0, 'SECTION');
  g(2, 'BLOCKS');
  g(0, 'ENDSEC');

  // ---------- ENTITIES ----------
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  for (const e of drawing.entities) {
    switch (e.kind) {
      case 'line':
        g(0, 'LINE');
        g(8, e.layer);
        point(10, e.a);
        point(11, e.b);
        break;
    }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');

  // DXFはCRLFが最も無難
  return out.join('\r\n') + '\r\n';
}

/** 図形全体の範囲。空なら原点付近の 10m 四方 */
export function extents(drawing: Drawing): { min: Vec2; max: Vec2 } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const e of drawing.entities) {
    if (e.kind === 'line') {
      for (const p of [e.a, e.b]) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
  }
  if (!Number.isFinite(minX)) return { min: { x: 0, y: 0 }, max: { x: 10000, y: 10000 } };
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
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
