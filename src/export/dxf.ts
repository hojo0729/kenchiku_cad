import type { Drawing, Layer, Vec2 } from '../model';
import { encodeShiftJis } from './sjis';
import { centerPattern, decompose, hiddenPattern, primExtents, type Prim } from '../arch/primitives';

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
 * 建築部材は decompose() で線・円・文字に分解してから書く。
 *
 * 注意: R12 では日本語の画層名/文字は Shift_JIS が前提。
 * 今はASCIIのみ想定（寸法値・通り芯符号は ASCII）。
 */

export type DxfOptions = {
  /** 用紙サイズ(mm)。既定は A3 横 */
  paper?: { width: number; height: number };
  /** 縮尺の分母。既定は図面の縮尺 */
  scale?: number;
};

/**
 * Jw_cad は DXF を開くとき $LIMMIN/$LIMMAX（図面の用紙範囲）から縮尺を決めるため、
 * 用紙サイズ × 縮尺 の範囲を図形の中心に合わせて書き込む。
 * （図形範囲そのままを書くと 1/4 などの半端な縮尺で開かれた）
 */
export function toDxf(drawing: Drawing, options: DxfOptions = {}): string {
  const paper = options.paper ?? { width: 420, height: 297 };
  const scale = options.scale ?? drawing.scale ?? 100;
  const prims = decompose(drawing);

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

  const ext = primExtents(prims) ?? { min: { x: 0, y: 0 }, max: { x: 10000, y: 10000 } };
  const { min, max } = ext;

  // ---------- HEADER ----------
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$DWGCODEPAGE');
  g(3, 'ANSI_932'); // 日本語は Shift_JIS（toDxfBytes で変換）
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
  g(9, '$LTSCALE');
  g(40, 1);
  g(0, 'ENDSEC');

  // ---------- TABLES ----------
  g(0, 'SECTION');
  g(2, 'TABLES');

  // VPORT（*ACTIVE を図面範囲に合わせる）
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
  g(12, lcx);
  g(22, lcy);
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

  // LTYPE（実線と一点鎖線。鎖線のピッチは縮尺に合わせた実寸）
  const cp = centerPattern(scale);
  g(0, 'TABLE');
  g(2, 'LTYPE');
  g(70, 3);
  g(0, 'LTYPE');
  g(2, 'CONTINUOUS');
  g(70, 0);
  g(3, 'Solid line');
  g(72, 65);
  g(73, 0);
  g(40, 0);
  g(0, 'LTYPE');
  g(2, 'CENTER');
  g(70, 0);
  g(3, 'Center ____ _ ____ _');
  g(72, 65);
  g(73, 4);
  g(40, cp.reduce((s, v) => s + v, 0));
  g(49, cp[0]);
  g(49, -cp[1]);
  g(49, cp[2]);
  g(49, -cp[3]);
  const hp = hiddenPattern(scale);
  g(0, 'LTYPE');
  g(2, 'HIDDEN');
  g(70, 0);
  g(3, 'Hidden __ __ __ __');
  g(72, 65);
  g(73, 2);
  g(40, hp[0] + hp[1]);
  g(49, hp[0]);
  g(49, -hp[1]);
  g(0, 'ENDTAB');

  // LAYER
  const layers = collectLayers(drawing.layers, prims);
  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, layers.length);
  for (const l of layers) {
    g(0, 'LAYER');
    g(2, l.name);
    g(70, 0);
    g(62, l.color);
    g(6, l.linetype ?? 'CONTINUOUS');
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
  for (const p of prims) {
    switch (p.t) {
      case 'line':
        g(0, 'LINE');
        g(8, p.layer);
        if (p.ltype) g(6, p.ltype);
        point(10, p.a);
        point(11, p.b);
        break;
      case 'circle':
        g(0, 'CIRCLE');
        g(8, p.layer);
        point(10, p.c);
        g(40, p.r);
        break;
      case 'arc':
        g(0, 'ARC');
        g(8, p.layer);
        point(10, p.c);
        g(40, p.r);
        g(50, p.a0);
        g(51, p.a1);
        break;
      case 'text': {
        g(0, 'TEXT');
        g(8, p.layer);
        point(10, p.p);
        g(40, p.h);
        g(1, p.s);
        if (p.rot) g(50, p.rot);
        const h = p.align === 'center' ? 1 : p.align === 'right' ? 2 : 0;
        const v = p.valign === 'middle' ? 2 : 0;
        if (h || v) {
          g(72, h);
          point(11, p.p);
          g(73, v);
        }
        break;
      }
    }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');

  // DXFはCRLFが最も無難
  return out.join('\r\n') + '\r\n';
}

function collectLayers(base: readonly Layer[], prims: readonly Prim[]): Layer[] {
  const layers = [...base];
  const names = new Set(layers.map((l) => l.name));
  for (const p of prims) {
    if (!names.has(p.layer)) {
      names.add(p.layer);
      layers.push({ name: p.layer, color: 7 });
    }
  }
  return layers;
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

/** ファイルに書くバイト列（日本語は Shift_JIS） */
export function toDxfBytes(drawing: Drawing, options: DxfOptions = {}): Uint8Array<ArrayBuffer> {
  return encodeShiftJis(toDxf(drawing, options));
}
