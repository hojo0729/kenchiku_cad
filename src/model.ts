// 図面データモデル。単位はすべて mm、Y軸は上向き（CAD/DXFと同じ）。
// 建築部材（通り芯など）は部材のまま持ち、表示・書き出し時に
// 線・円・文字（src/arch/primitives.ts）へ分解する。

export type Vec2 = { x: number; y: number };

export type LineEntity = {
  id: string;
  kind: 'line';
  layer: string;
  a: Vec2;
  b: Vec2;
};

export type Entity = LineEntity;

export type Layer = {
  name: string;
  /** AutoCAD Color Index (1-255)。7 = 白/黒 */
  color: number;
  /** 線種（DXFの LTYPE 名） */
  linetype?: 'CONTINUOUS' | 'CENTER';
};

/**
 * 通り芯。X通りは縦線（X1, X2…を左から）、Y通りは横線（Y1, Y2…を下から）。
 * 施工図ではスパンが不揃いなので、間隔のリストで持つ。
 */
export type StructuralGrid = {
  /** X1→X2→… の間隔(mm) */
  xSpans: number[];
  /** Y1→Y2→… の間隔(mm) */
  ySpans: number[];
  xPrefix: string;
  yPrefix: string;
  /** X1 と Y1 の交点 */
  origin: Vec2;
};

export type Drawing = {
  version: 1;
  units: 'mm';
  /** 縮尺の分母（50 なら 1/50）。符号や寸法の文字の大きさに使う */
  scale: number;
  layers: Layer[];
  entities: Entity[];
  grid?: StructuralGrid;
};

export const LAYER_GRID = 'GRID';
export const LAYER_DIM = 'DIM';

export function defaultLayers(): Layer[] {
  return [
    { name: '0', color: 7 },
    { name: LAYER_GRID, color: 1, linetype: 'CENTER' },
    { name: LAYER_DIM, color: 3 },
  ];
}

export function createDrawing(): Drawing {
  return {
    version: 1,
    units: 'mm',
    scale: 50,
    layers: defaultLayers(),
    entities: [],
  };
}

/** 古い保存データを今の形に揃える */
export function normalizeDrawing(d: Drawing): Drawing {
  const out: Drawing = { ...d };
  if (!out.scale || out.scale <= 0) out.scale = 50;
  const have = new Set((out.layers ?? []).map((l) => l.name));
  out.layers = [...(out.layers ?? [])];
  for (const l of defaultLayers()) if (!have.has(l.name)) out.layers.push(l);
  out.entities = out.entities ?? [];
  return out;
}

let seq = 0;
export function newId(): string {
  seq += 1;
  return `e${Date.now().toString(36)}${seq.toString(36)}`;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
