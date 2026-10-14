import { describe, expect, it } from 'vitest';
import { createDrawing, type Wall } from '../model';
import { gridSpans, nextWallMark, wallOutline, wallRect, wallsInRange } from './wall';
import { toDxf } from '../export/dxf';

function drawing() {
  const d = createDrawing();
  d.grid = { xSpans: [6000, 6000], ySpans: [6000], xPrefix: 'X', yPrefix: 'Y', origin: { x: 0, y: 0 } };
  d.wallTypes = [{ id: 'w20', mark: 'W20', t: 200 }];
  return d;
}
const W = (axis: 'x' | 'y', line: number, from: number, to: number, offset: number | null = null): Wall => ({
  id: `${axis}${line}-${from}`,
  typeId: 'w20',
  axis,
  line,
  from,
  to,
  offset,
});

/** 線分を比べやすい文字に（向きはそろえる） */
const norm = (segs: { a: { x: number; y: number }; b: { x: number; y: number } }[]) =>
  segs
    .map(({ a, b }) => {
      const [p, q] = a.x < b.x || (a.x === b.x && a.y <= b.y) ? [a, b] : [b, a];
      return `${p.x},${p.y}-${q.x},${q.y}`;
    })
    .sort();

describe('壁の外形', () => {
  it('振り分けと寄り', () => {
    const d = drawing();
    d.walls = [W('y', 0, 0, 1), W('x', 2, 0, 1, 50)];
    expect(wallRect(d, d.walls[0])).toEqual({ min: { x: 0, y: -100 }, max: { x: 6000, y: 100 } });
    // X3通りの縦の壁、左面が通り芯から 50 → x = 12000-50 〜 12150
    expect(wallRect(d, d.walls[1])!.min.x).toBe(11950);
  });

  it('L字: 出隅が欠けず、重なった線が消える', () => {
    const d = drawing();
    d.walls = [W('y', 0, 0, 1), W('x', 0, 0, 1)];
    expect(norm(wallOutline(d))).toEqual(
      norm([
        { a: { x: -100, y: -100 }, b: { x: 6000, y: -100 } }, // 外側の横
        { a: { x: 100, y: 100 }, b: { x: 6000, y: 100 } }, // 内側の横
        { a: { x: -100, y: -100 }, b: { x: -100, y: 6000 } }, // 外側の縦
        { a: { x: 100, y: 100 }, b: { x: 100, y: 6000 } }, // 内側の縦
        { a: { x: 6000, y: -100 }, b: { x: 6000, y: 100 } }, // 横の壁の端
        { a: { x: -100, y: 6000 }, b: { x: 100, y: 6000 } }, // 縦の壁の端
      ]),
    );
  });

  it('一直線に続く壁は1本の線になり、つなぎ目の線は出ない', () => {
    const d = drawing();
    d.walls = [W('y', 0, 0, 1), W('y', 0, 1, 2)];
    expect(norm(wallOutline(d))).toEqual(
      norm([
        { a: { x: 0, y: -100 }, b: { x: 12000, y: -100 } },
        { a: { x: 0, y: 100 }, b: { x: 12000, y: 100 } },
        { a: { x: 0, y: -100 }, b: { x: 0, y: 100 } },
        { a: { x: 12000, y: -100 }, b: { x: 12000, y: 100 } },
      ]),
    );
  });

  it('T字: 突き当たる側の線が切れ、下面は一本につながる', () => {
    const d = drawing();
    d.walls = [W('y', 0, 0, 1), W('y', 0, 1, 2), W('x', 1, 0, 1)];
    const segs = norm(wallOutline(d));
    expect(segs).toContain('0,-100-12000,-100'); // 下面は通しで1本
    expect(segs).toContain('0,100-5900,100'); // 上面は縦の壁で切れる
    expect(segs).toContain('6100,100-12000,100');
    expect(segs).toContain('5900,100-5900,6000');
    expect(segs).not.toContain('5900,-100-5900,100'); // 横の壁の中に縦の壁の線は残らない
  });

  it('柱の中に入る部分の線は消える', () => {
    const d = drawing();
    d.columns = [{ id: 'c', typeId: 'ct1', xi: 1, yi: 0, left: null, bottom: null }]; // 800角
    d.walls = [W('y', 0, 0, 1), W('y', 0, 1, 2)];
    const segs = norm(wallOutline(d));
    expect(segs).toContain('0,100-5600,100');
    expect(segs).toContain('6400,100-12000,100');
    expect(segs.some((s) => s.startsWith('5600,100-6400'))).toBe(false);
  });

  it('符号の厚さを変えると全部の壁が変わる', () => {
    const d = drawing();
    d.walls = [W('y', 0, 0, 1), W('x', 0, 0, 1)];
    d.wallTypes[0].t = 300;
    expect(wallRect(d, d.walls[0])).toEqual({ min: { x: -150, y: -150 }, max: { x: 6000, y: 150 } });
  });

  it('DXF の WALL 画層に出る', () => {
    const d = drawing();
    d.walls = [W('y', 0, 0, 1)];
    expect(toDxf(d)).toMatch(/\r\nWALL\r\n/);
  });
});

describe('壁の補助', () => {
  it('通り芯のスパン一覧', () => {
    const d = drawing();
    // X通り3本×1スパン + Y通り2本×2スパン
    expect(gridSpans(d)).toHaveLength(3 + 4);
  });
  it('次の符号', () => {
    expect(nextWallMark([{ id: '1', mark: 'W18', t: 180 }], 180)).toBe('W18-2');
    expect(nextWallMark([], 250)).toBe('W25');
  });
  it('通り芯が減ったら範囲外の壁を除く', () => {
    const walls = [W('y', 0, 1, 2), W('y', 0, 0, 1)];
    expect(wallsInRange(walls, 2, 2)).toHaveLength(1);
  });
});
