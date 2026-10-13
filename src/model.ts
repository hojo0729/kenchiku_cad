// 図面データモデル。単位はすべて mm、Y軸は上向き（CAD/DXFと同じ）。
// 将来は壁・開口・通り芯などの「建築部材」をここに追加し、
// 書き出し時に線・円弧へ分解する方針（CLAUDE.md 参照）。

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
};

export type Drawing = {
  version: 1;
  units: 'mm';
  layers: Layer[];
  entities: Entity[];
};

export function createDrawing(): Drawing {
  return {
    version: 1,
    units: 'mm',
    layers: [{ name: '0', color: 7 }],
    entities: [],
  };
}

let seq = 0;
export function newId(): string {
  seq += 1;
  return `e${Date.now().toString(36)}${seq.toString(36)}`;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
