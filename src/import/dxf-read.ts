import type { Prim } from '../arch/primitives';
import type { Vec2 } from '../model';

/**
 * 設計から来た DXF を読み込み、線・円・円弧・文字（Prim）の集まりにする。
 * 目的は「下敷き」として表示・スナップに使うことなので、見た目の再現を優先し、
 * 塗り（HATCH）や点（POINT）など下敷きに不要なものは読まない。
 *
 * 対応: LINE / LWPOLYLINE / POLYLINE(+VERTEX) / CIRCLE / ARC / ELLIPSE / SPLINE /
 *       TEXT / ATTRIB / MTEXT / INSERT(ブロック、入れ子可) / DIMENSION（寸法ブロック）/ SOLID / TRACE / 3DFACE
 * 文字コード: UTF-8 として読めなければ Shift_JIS（Jw_cad・古いAutoCADのDXF）
 * 単位: $INSUNITS を見て mm に換算（無ければ mm とみなす）
 * 除外: ペーパー空間（67=1）、非表示・フリーズの画層
 */

export type DxfImport = {
  prims: Prim[];
  /** 元の単位から mm への倍率 */
  unitScale: number;
  encoding: 'utf-8' | 'shift_jis';
  stats: { lines: number; arcs: number; texts: number; skipped: Record<string, number> };
  warnings: string[];
};

type Pair = [number, string];
type Ent = { type: string; pairs: Pair[]; children: Ent[] };
type Block = { name: string; base: Vec2; ents: Ent[] };
type M = [number, number, number, number, number, number]; // x' = a x + c y + e, y' = b x + d y + f

const ID: M = [1, 0, 0, 1, 0, 0];

// ---------- 文字コード ----------

export function decodeDxf(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'shift_jis' } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text: text.replace(/^﻿/, ''), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('shift_jis').decode(bytes), encoding: 'shift_jis' };
  }
}

/** R2000〜2004 の DXF にある \U+XXXX 形式の文字を戻す */
function unescapeUnicode(s: string): string {
  return s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// ---------- 読み込み本体 ----------

export function readDxf(input: Uint8Array | string): DxfImport {
  const { text, encoding } = typeof input === 'string' ? { text: input, encoding: 'utf-8' as const } : decodeDxf(input);
  const pairs = toPairs(text);
  const warnings: string[] = [];

  // セクションごとに分ける
  const sections = new Map<string, Pair[]>();
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 0 && pairs[i][1] === 'SECTION' && pairs[i + 1]?.[0] === 2) {
      const name = pairs[i + 1][1];
      const start = i + 2;
      let j = start;
      while (j < pairs.length && !(pairs[j][0] === 0 && pairs[j][1] === 'ENDSEC')) j++;
      sections.set(name, pairs.slice(start, j));
      i = j;
    }
  }
  if (!sections.has('ENTITIES')) {
    throw new Error('DXF として読めませんでした（ENTITIES セクションがありません）');
  }

  // 単位
  const header = sections.get('HEADER') ?? [];
  const insunits = headerInt(header, '$INSUNITS');
  const unitScale = unitToMm(insunits);
  if (insunits !== undefined && unitScale === 1 && insunits !== 4 && insunits !== 0) {
    warnings.push(`図面の単位（$INSUNITS=${insunits}）が分からないので mm として読みました`);
  }

  // 非表示の画層
  const hidden = hiddenLayers(sections.get('TABLES') ?? []);

  // ブロック
  const blocks = new Map<string, Block>();
  for (const b of parseBlocks(sections.get('BLOCKS') ?? [])) blocks.set(b.name.toUpperCase(), b);

  const ctx: Ctx = {
    prims: [],
    blocks,
    hidden,
    stats: { lines: 0, arcs: 0, texts: 0, skipped: {} },
    depth: 0,
  };
  const top: M = [unitScale, 0, 0, unitScale, 0, 0];
  for (const e of groupEntities(sections.get('ENTITIES')!)) {
    if (num(e, 67, 0) === 1) continue; // ペーパー空間
    emit(ctx, e, top, null);
  }

  if (ctx.prims.length === 0) warnings.push('表示できる図形がありませんでした');
  return { prims: ctx.prims, unitScale, encoding, stats: ctx.stats, warnings };
}

function toPairs(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) {
      // 壊れた行はひとつずらして読み直す
      i -= 1;
      continue;
    }
    out.push([code, code === 1 || code === 3 ? lines[i + 1].replace(/\s+$/, '') : lines[i + 1].trim()]);
  }
  return out;
}

function headerInt(header: Pair[], name: string): number | undefined {
  const i = header.findIndex(([c, v]) => c === 9 && v === name);
  if (i < 0) return undefined;
  const v = parseInt(header[i + 1]?.[1] ?? '', 10);
  return Number.isNaN(v) ? undefined : v;
}

/** $INSUNITS → mm 倍率 */
function unitToMm(u: number | undefined): number {
  switch (u) {
    case 1:
      return 25.4; // インチ
    case 2:
      return 304.8; // フィート
    case 5:
      return 10; // cm
    case 6:
      return 1000; // m
    default:
      return 1; // 0=単位なし, 4=mm, その他は mm とみなす
  }
}

function hiddenLayers(tables: Pair[]): Set<string> {
  const hidden = new Set<string>();
  for (let i = 0; i < tables.length; i++) {
    if (tables[i][0] !== 0 || tables[i][1] !== 'LAYER') continue;
    let name = '';
    let color = 1;
    let flags = 0;
    for (let j = i + 1; j < tables.length && tables[j][0] !== 0; j++) {
      const [c, v] = tables[j];
      if (c === 2) name = v;
      else if (c === 62) color = parseInt(v, 10);
      else if (c === 70) flags = parseInt(v, 10);
    }
    if (name && (color < 0 || flags & 1)) hidden.add(name);
  }
  return hidden;
}

/** 0 で始まる塊に分け、POLYLINE→VERTEX… と INSERT→ATTRIB… を親子にまとめる */
function groupEntities(pairs: Pair[]): Ent[] {
  const flat: Ent[] = [];
  let cur: Ent | null = null;
  for (const p of pairs) {
    if (p[0] === 0) {
      cur = { type: p[1], pairs: [], children: [] };
      flat.push(cur);
    } else if (cur) {
      cur.pairs.push(p);
    }
  }
  const out: Ent[] = [];
  for (let i = 0; i < flat.length; i++) {
    const e = flat[i];
    if (e.type === 'POLYLINE' || (e.type === 'INSERT' && num(e, 66, 0) === 1)) {
      let j = i + 1;
      while (j < flat.length && flat[j].type !== 'SEQEND') {
        e.children.push(flat[j]);
        j++;
      }
      i = j; // SEQEND まで飛ばす
    }
    out.push(e);
  }
  return out;
}

function parseBlocks(pairs: Pair[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < pairs.length) {
    if (pairs[i][0] === 0 && pairs[i][1] === 'BLOCK') {
      let name = '';
      let bx = 0;
      let by = 0;
      let j = i + 1;
      for (; j < pairs.length && pairs[j][0] !== 0; j++) {
        const [c, v] = pairs[j];
        if (c === 2) name = v;
        else if (c === 10) bx = parseFloat(v);
        else if (c === 20) by = parseFloat(v);
      }
      const start = j;
      while (j < pairs.length && !(pairs[j][0] === 0 && pairs[j][1] === 'ENDBLK')) j++;
      if (!/^\*paper_space/i.test(name)) {
        blocks.push({ name, base: { x: bx, y: by }, ents: groupEntities(pairs.slice(start, j)) });
      }
      i = j;
    }
    i++;
  }
  return blocks;
}

// ---------- 図形 → Prim ----------

type Ctx = {
  prims: Prim[];
  blocks: Map<string, Block>;
  hidden: Set<string>;
  stats: DxfImport['stats'];
  depth: number;
};

function get(e: Ent, code: number): string | undefined {
  for (const [c, v] of e.pairs) if (c === code) return v;
  return undefined;
}
function num(e: Ent, code: number, def: number): number {
  const v = get(e, code);
  const n = v === undefined ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : def;
}
function all(e: Ent, code: number): number[] {
  const out: number[] = [];
  for (const [c, v] of e.pairs) if (c === code) out.push(parseFloat(v));
  return out;
}

function apply(m: M, p: Vec2): Vec2 {
  return { x: round(m[0] * p.x + m[2] * p.y + m[4]), y: round(m[1] * p.x + m[3] * p.y + m[5]) };
}
function mul(a: M, b: M): M {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
function scaleOf(m: M): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}
function rotationOf(m: M): number {
  return (Math.atan2(m[1], m[0]) * 180) / Math.PI;
}
function mirrored(m: M): boolean {
  return m[0] * m[3] - m[1] * m[2] < 0;
}
/** 0.01mm に丸めて保存サイズを抑える */
function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 画層 "0" の図形はブロック参照の画層を引き継ぐ（AutoCAD の規則） */
function layerOf(e: Ent, inherited: string | null): string {
  const l = get(e, 8) ?? '0';
  return l === '0' && inherited ? inherited : l;
}

function line(ctx: Ctx, layer: string, a: Vec2, b: Vec2) {
  if (a.x === b.x && a.y === b.y) return;
  ctx.prims.push({ t: 'line', layer, a, b });
  ctx.stats.lines++;
}

function polyline(ctx: Ctx, layer: string, m: M, pts: Vec2[], bulges: number[], closed: boolean) {
  const n = pts.length;
  if (n < 2) return;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % n];
    const bulge = bulges[i] ?? 0;
    if (Math.abs(bulge) < 1e-9) {
      line(ctx, layer, apply(m, p0), apply(m, p1));
    } else {
      // ふくらみ（bulge）付きの区間は円弧
      const theta = 4 * Math.atan(bulge);
      const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
      const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const h = Math.sqrt(Math.max(r * r - (chord / 2) ** 2, 0));
      const dir = { x: (p1.x - p0.x) / chord, y: (p1.y - p0.y) / chord };
      const side = bulge > 0 ? 1 : -1;
      const sameSide = Math.abs(theta) > Math.PI ? -1 : 1;
      const c = { x: mid.x - dir.y * h * side * sameSide, y: mid.y + dir.x * h * side * sameSide };
      let a0 = (Math.atan2(p0.y - c.y, p0.x - c.x) * 180) / Math.PI;
      let a1 = (Math.atan2(p1.y - c.y, p1.x - c.x) * 180) / Math.PI;
      if (bulge < 0) [a0, a1] = [a1, a0];
      arc(ctx, layer, m, c, r, a0, a1);
    }
  }
}

function arc(ctx: Ctx, layer: string, m: M, c: Vec2, r: number, a0: number, a1: number) {
  const rot = rotationOf(m);
  let s0 = a0 + rot;
  let s1 = a1 + rot;
  if (mirrored(m)) {
    // 鏡像のブロックでは回転の向きが逆になる
    [s0, s1] = [2 * rot - a1, 2 * rot - a0];
  }
  ctx.prims.push({ t: 'arc', layer, c: apply(m, c), r: round(r * scaleOf(m)), a0: norm(s0), a1: norm(s1) });
  ctx.stats.arcs++;
}

function norm(a: number): number {
  const v = a % 360;
  return round(v < 0 ? v + 360 : v);
}

function text(ctx: Ctx, layer: string, m: M, p: Vec2, h: number, s: string, rot: number, align: 'left' | 'center' | 'right', valign: 'bottom' | 'middle') {
  const clean = s.trim();
  if (!clean) return;
  ctx.prims.push({
    t: 'text',
    layer,
    p: apply(m, p),
    h: round(h * scaleOf(m)),
    s: clean,
    align,
    valign,
    rot: round(rot + rotationOf(m)),
  });
  ctx.stats.texts++;
}

/** MTEXT の書式コードを取り除いて1行目を返す */
export function plainMtext(raw: string): string {
  const s = unescapeUnicode(raw)
    .replace(/\\P/g, '\n')
    .replace(/\\[ACcFfHhQqTtWw][^;]*;/g, '')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/\\S([^;]*);/g, (_, f: string) => f.replace(/[#^]/, '/'))
    .replace(/\\~/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\\\\/g, '\\');
  return s.split('\n')[0];
}

function emit(ctx: Ctx, e: Ent, m: M, inherited: string | null) {
  const layer = layerOf(e, inherited);
  if (ctx.hidden.has(layer)) return;

  switch (e.type) {
    case 'LINE':
      line(ctx, layer, apply(m, { x: num(e, 10, 0), y: num(e, 20, 0) }), apply(m, { x: num(e, 11, 0), y: num(e, 21, 0) }));
      return;

    case 'LWPOLYLINE': {
      // 頂点ごとに 10, 20, (42) が並ぶ
      const pts: Vec2[] = [];
      const bulges: number[] = [];
      for (const [c, v] of e.pairs) {
        if (c === 10) {
          pts.push({ x: parseFloat(v), y: 0 });
          bulges.push(0);
        } else if (c === 20 && pts.length) pts[pts.length - 1].y = parseFloat(v);
        else if (c === 42 && pts.length) bulges[bulges.length - 1] = parseFloat(v);
      }
      polyline(ctx, layer, m, pts, bulges, (num(e, 70, 0) & 1) === 1);
      return;
    }

    case 'POLYLINE': {
      const flags = num(e, 70, 0);
      if (flags & (16 | 64)) {
        bump(ctx, 'POLYLINE(メッシュ)');
        return;
      }
      const verts = e.children.filter((c) => c.type === 'VERTEX' && !(num(c, 70, 0) & 16));
      polyline(
        ctx,
        layer,
        m,
        verts.map((v) => ({ x: num(v, 10, 0), y: num(v, 20, 0) })),
        verts.map((v) => num(v, 42, 0)),
        (flags & 1) === 1,
      );
      return;
    }

    case 'CIRCLE': {
      const c = { x: num(e, 10, 0), y: num(e, 20, 0) };
      const r = num(e, 40, 0);
      if (r <= 0) return;
      if (Math.abs(m[0] - m[3]) > 1e-9 || Math.abs(m[1] + m[2]) > 1e-9) {
        // 縦横の倍率が違うブロックでは円が楕円になるので折れ線で近似
        ellipseLines(ctx, layer, m, c, { x: r, y: 0 }, 1, 0, Math.PI * 2);
        return;
      }
      ctx.prims.push({ t: 'circle', layer, c: apply(m, c), r: round(r * scaleOf(m)) });
      ctx.stats.arcs++;
      return;
    }

    case 'ARC': {
      const r = num(e, 40, 0);
      if (r <= 0) return;
      arc(ctx, layer, m, { x: num(e, 10, 0), y: num(e, 20, 0) }, r, num(e, 50, 0), num(e, 51, 360));
      return;
    }

    case 'ELLIPSE': {
      const c = { x: num(e, 10, 0), y: num(e, 20, 0) };
      const major = { x: num(e, 11, 0), y: num(e, 21, 0) };
      ellipseLines(ctx, layer, m, c, major, num(e, 40, 1), num(e, 41, 0), num(e, 42, Math.PI * 2));
      return;
    }

    case 'SPLINE': {
      // 通過点があればそれを、無ければ制御点を折れ線でつなぐ（下敷き用の近似）
      const fx = all(e, 11);
      const fy = all(e, 21);
      const cx = all(e, 10);
      const cy = all(e, 20);
      const xs = fx.length >= 2 ? fx : cx;
      const ys = fx.length >= 2 ? fy : cy;
      const pts = xs.map((x, i) => ({ x, y: ys[i] ?? 0 }));
      polyline(ctx, layer, m, pts, [], (num(e, 70, 0) & 1) === 1);
      return;
    }

    case 'SOLID':
    case 'TRACE':
    case '3DFACE': {
      const p = [10, 11, 12, 13].map((k) => ({ x: num(e, k, 0), y: num(e, k + 10, 0) }));
      // SOLID は 3,4 番目の点の順番が入れ替わっている
      const order = e.type === '3DFACE' ? [0, 1, 2, 3] : [0, 1, 3, 2];
      polyline(ctx, layer, m, order.map((i) => p[i]), [], true);
      return;
    }

    case 'TEXT':
    case 'ATTRIB': {
      if (e.type === 'ATTRIB' && num(e, 70, 0) & 1) return; // 非表示の属性
      const h72 = num(e, 72, 0);
      const v73 = num(e, e.type === 'ATTRIB' ? 74 : 73, 0);
      const aligned = h72 !== 0 || v73 !== 0;
      const p = aligned && get(e, 11) !== undefined ? { x: num(e, 11, 0), y: num(e, 21, 0) } : { x: num(e, 10, 0), y: num(e, 20, 0) };
      text(
        ctx,
        layer,
        m,
        p,
        num(e, 40, 2.5),
        unescapeUnicode(get(e, 1) ?? '').replace(/%%[cC]/g, 'φ').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±'),
        num(e, 50, 0),
        h72 === 1 || h72 === 4 ? 'center' : h72 === 2 ? 'right' : 'left',
        v73 === 2 || h72 === 4 ? 'middle' : 'bottom',
      );
      return;
    }

    case 'MTEXT': {
      let raw = '';
      for (const [c, v] of e.pairs) if (c === 3 || c === 1) raw += v;
      const attach = num(e, 71, 1); // 1〜9: 上中下 × 左中右
      let rot = num(e, 50, NaN);
      if (!Number.isFinite(rot) && get(e, 11) !== undefined) rot = (Math.atan2(num(e, 21, 0), num(e, 11, 1)) * 180) / Math.PI;
      text(
        ctx,
        layer,
        m,
        { x: num(e, 10, 0), y: num(e, 20, 0) },
        num(e, 40, 2.5),
        plainMtext(raw),
        Number.isFinite(rot) ? rot : 0,
        attach % 3 === 2 ? 'center' : attach % 3 === 0 ? 'right' : 'left',
        attach >= 4 && attach <= 6 ? 'middle' : 'bottom',
      );
      return;
    }

    case 'INSERT':
    case 'DIMENSION': {
      const name = get(e, 2);
      const block = name ? ctx.blocks.get(name.toUpperCase()) : undefined;
      if (!block) {
        if (e.type === 'INSERT') bump(ctx, 'INSERT(ブロック無し)');
        return;
      }
      if (ctx.depth > 12) {
        bump(ctx, 'INSERT(入れ子が深すぎる)');
        return;
      }
      let local: M = ID;
      if (e.type === 'INSERT') {
        const ins = { x: num(e, 10, 0), y: num(e, 20, 0) };
        const sx = num(e, 41, 1);
        const sy = num(e, 42, 1);
        const rot = (num(e, 50, 0) * Math.PI) / 180;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        // ins + R * S * (p - base)
        const rs: M = [cos * sx, sin * sx, -sin * sy, cos * sy, 0, 0];
        const t = apply(rs, block.base);
        local = [rs[0], rs[1], rs[2], rs[3], ins.x - t.x, ins.y - t.y];
      }
      const next = mul(m, local);
      ctx.depth++;
      for (const child of block.ents) emit(ctx, child, next, layer);
      ctx.depth--;
      for (const attr of e.children) if (attr.type === 'ATTRIB') emit(ctx, attr, m, layer);
      return;
    }

    case 'ATTDEF':
    case 'VERTEX':
    case 'SEQEND':
      return;

    default:
      bump(ctx, e.type);
  }
}

function ellipseLines(ctx: Ctx, layer: string, m: M, c: Vec2, major: Vec2, ratio: number, t0: number, t1: number) {
  let end = t1;
  if (end <= t0) end += Math.PI * 2;
  const n = Math.max(8, Math.ceil(((end - t0) / (Math.PI * 2)) * 48));
  const minor = { x: -major.y * ratio, y: major.x * ratio };
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((end - t0) * i) / n;
    pts.push({ x: c.x + major.x * Math.cos(t) + minor.x * Math.sin(t), y: c.y + major.y * Math.cos(t) + minor.y * Math.sin(t) });
  }
  polyline(ctx, layer, m, pts, [], false);
}

function bump(ctx: Ctx, type: string) {
  ctx.stats.skipped[type] = (ctx.stats.skipped[type] ?? 0) + 1;
}
