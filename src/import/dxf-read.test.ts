import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Prim } from '../arch/primitives';
import { plainMtext, readDxf } from './dxf-read';

const fixture = (name: string) => new Uint8Array(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name)));

const lines = (prims: Prim[]) => prims.filter((p): p is Extract<Prim, { t: 'line' }> => p.t === 'line');
const hasPoint = (prims: Prim[], x: number, y: number, tol = 0.05) =>
  lines(prims).some((l) => [l.a, l.b].some((p) => Math.abs(p.x - x) < tol && Math.abs(p.y - y) < tol));
const texts = (prims: Prim[]) => prims.filter((p) => p.t === 'text').map((p) => (p.t === 'text' ? p.s : ''));

for (const [name, enc] of [
  ['sample_r2018.dxf', 'utf-8'],
  ['sample_r12_sjis.dxf', 'shift_jis'],
] as const) {
  describe(`readDxf: ${name}`, () => {
    const r = readDxf(fixture(name));

    it(`文字コードを判定（${enc}）して日本語の文字・画層を読む`, () => {
      expect(r.encoding).toBe(enc);
      expect(texts(r.prims)).toContain('事務室');
      expect(r.prims.some((p) => p.layer === '通り芯')).toBe(true);
    });

    it('非表示の画層は読まない', () => {
      expect(r.prims.some((p) => p.layer === '非表示')).toBe(false);
      expect(hasPoint(r.prims, 99999, 99999)).toBe(false);
    });

    it('入れ子のブロックを展開する（基点が柱の中心）', () => {
      // 柱セット(0,0) → 柱C1 を (0,0) と (6000,0) に。左下の角は中心から (-400,-400)
      expect(hasPoint(r.prims, -400, -400)).toBe(true);
      expect(hasPoint(r.prims, 5600, -400)).toBe(true);
      // ブロック内の画層 0 の図形は、参照した画層（躯体）になる
      const corner = lines(r.prims).find((l) => Math.abs(l.a.x + 400) < 0.05 && Math.abs(l.a.y + 400) < 0.05);
      expect(corner?.layer).toBe('躯体');
    });

    it('回転・拡大したブロック', () => {
      // (13200,6500) に 1.5倍・30°。中心から (-400,-400)×1.5 を 30° 回転
      const c = Math.cos(Math.PI / 6);
      const s = Math.sin(Math.PI / 6);
      const x = 13200 + (-600 * c - -600 * s);
      const y = 6500 + (-600 * s + -600 * c);
      expect(hasPoint(r.prims, x, y)).toBe(true);
    });

    it('鏡像のブロック（X方向 -1 倍）', () => {
      // 中心から (-400,-400) が (400,-400) に
      expect(hasPoint(r.prims, 6400, 6100)).toBe(true);
    });

    it('ふくらみ（bulge）付きの区間を円弧にする', () => {
      // (0,3000)→(3000,3000)、bulge 0.5 → 中心 (1500,4125)、半径 1875、216.87°→323.13°
      const arc = r.prims.find((p) => p.t === 'arc' && Math.abs(p.r - 1875) < 0.1);
      expect(arc).toBeDefined();
      if (arc?.t !== 'arc') return;
      expect(arc.c.x).toBeCloseTo(1500, 1);
      expect(arc.c.y).toBeCloseTo(4125, 1);
      expect(arc.a0).toBeCloseTo(216.87, 1);
      expect(arc.a1).toBeCloseTo(323.13, 1);
    });

    it('円と円弧', () => {
      expect(r.prims.some((p) => p.t === 'circle' && p.r === 300)).toBe(true);
      expect(r.prims.some((p) => p.t === 'arc' && p.r === 600 && p.a0 === 0 && p.a1 === 90)).toBe(true);
    });
  });
}

describe('R2018 だけにある図形', () => {
  const r = readDxf(fixture('sample_r2018.dxf'));
  it('MTEXT の書式を外して1行目を読む', () => {
    expect(texts(r.prims)).toContain('設計GL');
  });
  it('寸法（DIMENSION）を寸法ブロックから描く', () => {
    // ezdxf の既定寸法スタイルは値を 100 倍して書くので、ファイル上の文字は 600000
    expect(texts(r.prims)).toContain('600000');
    expect(hasPoint(r.prims, 6000, -600)).toBe(true);
  });
  it('塗り（HATCH）は読まずに数える', () => {
    expect(r.stats.skipped.HATCH).toBe(1);
  });
});

describe('単位と壊れたファイル', () => {
  const minimal = (insunits: number) =>
    ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', String(insunits), '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', 'A', '10', '1', '20', '2', '11', '3', '21', '4', '0', 'ENDSEC', '0', 'EOF'].join('\n');

  it('m 単位の図面は mm に換算', () => {
    const r = readDxf(minimal(6));
    expect(r.unitScale).toBe(1000);
    expect(lines(r.prims)[0].b).toEqual({ x: 3000, y: 4000 });
  });

  it('DXF でないファイルはエラー', () => {
    expect(() => readDxf('hello')).toThrow(/DXF/);
  });

  it('MTEXT の書式コード', () => {
    expect(plainMtext('{\\fArial|b1;太字}\\P2行目')).toBe('太字');
    expect(plainMtext('\\A1;1\\S2^3;')).toBe('12/3');
  });
});
