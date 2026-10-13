import { describe, expect, it } from 'vitest';
import { crc32, zipStore } from './zip';

describe('zipStore', () => {
  it('CRC32 が既知の値と一致する', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('ローカルヘッダ・中央ディレクトリ・終端レコードを持つ', () => {
    const data = new TextEncoder().encode('  0\r\nEOF\r\n');
    const z = zipStore([{ name: 'a.dxf', data }]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const end = z.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(1);
    const cdOffset = v.getUint32(end + 16, true);
    expect(v.getUint32(cdOffset, true)).toBe(0x02014b50);
    // 無圧縮なので中身がそのまま入っている
    expect(new TextDecoder().decode(z.slice(30 + 5, 30 + 5 + data.length))).toBe('  0\r\nEOF\r\n');
  });
});
