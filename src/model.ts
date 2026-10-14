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
  linetype?: 'CONTINUOUS' | 'CENTER' | 'HIDDEN';
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

/**
 * 柱の符号（部材リスト）。C1 = 800×800 のように大きさを決める。
 * 符号の大きさを直すと、その符号の柱が図面上で全部変わる。
 */
export type ColumnType = {
  id: string;
  mark: string;
  /** X方向の幅(mm) */
  bx: number;
  /** Y方向の幅(mm) */
  by: number;
};

/**
 * 配置した柱。通り芯の交点（何本目のX通り・Y通りか）に紐づくので、スパンを変えると一緒に動く。
 * 寄りは「通り芯から柱面まで」の距離。null は振り分け（芯が柱の中心）。
 */
export type Column = {
  id: string;
  typeId: string;
  /** X通りの番号（0 = X1） */
  xi: number;
  /** Y通りの番号（0 = Y1） */
  yi: number;
  /** X通りから柱の左面まで(mm) */
  left: number | null;
  /** Y通りから柱の下面まで(mm) */
  bottom: number | null;
};

/** 壁の符号（部材リスト）。W18 = 厚さ 180 のように決める */
export type WallType = {
  id: string;
  mark: string;
  /** 厚さ(mm) */
  t: number;
};

/**
 * 配置した壁。通り芯の1本の上で、交点から交点まで（スパン単位）。
 * axis 'x' = X通りの上の壁（縦の壁）: line = X通りの番号、from/to = Y通りの番号
 * axis 'y' = Y通りの上の壁（横の壁）: line = Y通りの番号、from/to = X通りの番号
 * offset は通り芯から壁の左面（縦の壁）／下面（横の壁）までの距離。null は振り分け。
 */
export type Wall = {
  id: string;
  typeId: string;
  axis: 'x' | 'y';
  line: number;
  from: number;
  to: number;
  offset: number | null;
};

/** 梁の符号（部材リスト）。G1 = 幅 400 × せい 800 のように決める */
export type BeamType = {
  id: string;
  mark: string;
  /** 幅(mm) */
  b: number;
  /** せい(mm) */
  d: number;
};

/** 配置した梁。壁と同じく通り芯の区間に紐づく（axis/line/from/to/offset の意味も同じ） */
export type Beam = {
  id: string;
  typeId: string;
  axis: 'x' | 'y';
  line: number;
  from: number;
  to: number;
  offset: number | null;
};

/**
 * 壁の開口。壁の区間の始点（from 側の交点、左または下）から開口の端までの距離と幅で持つ。
 * 壁の通り芯が動いても、始点からの距離が保たれる。
 */
export type Opening = {
  id: string;
  wallId: string;
  /** 区間の始点から開口の始まりまで(mm) */
  start: number;
  /** 開口の幅(mm) */
  width: number;
};

export type Drawing = {
  version: 1;
  units: 'mm';
  /** 縮尺の分母（50 なら 1/50）。符号や寸法の文字の大きさに使う */
  scale: number;
  layers: Layer[];
  entities: Entity[];
  grid?: StructuralGrid;
  columnTypes: ColumnType[];
  columns: Column[];
  wallTypes: WallType[];
  walls: Wall[];
  beamTypes: BeamType[];
  beams: Beam[];
  openings: Opening[];
  /** 柱・壁の寄り寸法（通り芯から各面まで）を描くか */
  showOffsetDims: boolean;
  /** 画面で隠している画層（DXF には全部出す） */
  hiddenLayers?: string[];
};

export const LAYER_GRID = 'GRID';
export const LAYER_DIM = 'DIM';
/** 寄り寸法（柱・壁の通り芯から各面まで）。縮小表示では描かない */
export const LAYER_DIM_OFFSET = 'DIM_OFFSET';
export const LAYER_COLUMN = 'COLUMN';
export const LAYER_WALL = 'WALL';
export const LAYER_BEAM = 'BEAM';
export const LAYER_OPENING = 'OPENING';

export function defaultBeamTypes(): BeamType[] {
  return [
    { id: 'bt1', mark: 'G1', b: 400, d: 800 },
    { id: 'bt2', mark: 'G2', b: 350, d: 700 },
  ];
}

export function defaultWallTypes(): WallType[] {
  return [
    { id: 'wt15', mark: 'W15', t: 150 },
    { id: 'wt18', mark: 'W18', t: 180 },
    { id: 'wt20', mark: 'W20', t: 200 },
  ];
}

export function defaultLayers(): Layer[] {
  return [
    { name: '0', color: 7 },
    { name: LAYER_GRID, color: 1, linetype: 'CENTER' },
    { name: LAYER_DIM, color: 3 },
    { name: LAYER_DIM_OFFSET, color: 3 },
    { name: LAYER_COLUMN, color: 4 },
    { name: LAYER_WALL, color: 5 },
    { name: LAYER_BEAM, color: 6, linetype: 'HIDDEN' },
    { name: LAYER_OPENING, color: 2 },
  ];
}

export function createDrawing(): Drawing {
  return {
    version: 1,
    units: 'mm',
    scale: 50,
    layers: defaultLayers(),
    entities: [],
    columnTypes: [{ id: 'ct1', mark: 'C1', bx: 800, by: 800 }],
    columns: [],
    wallTypes: defaultWallTypes(),
    walls: [],
    beamTypes: defaultBeamTypes(),
    beams: [],
    openings: [],
    showOffsetDims: true,
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
  out.columnTypes = out.columnTypes?.length ? out.columnTypes : [{ id: 'ct1', mark: 'C1', bx: 800, by: 800 }];
  out.columns = out.columns ?? [];
  out.wallTypes = out.wallTypes?.length ? out.wallTypes : defaultWallTypes();
  out.walls = out.walls ?? [];
  out.beamTypes = out.beamTypes?.length ? out.beamTypes : defaultBeamTypes();
  out.beams = out.beams ?? [];
  out.openings = out.openings ?? [];
  out.showOffsetDims = out.showOffsetDims ?? true;
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
