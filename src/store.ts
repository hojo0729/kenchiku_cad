import Dexie, { type Table } from 'dexie';
import type { Drawing } from './model';

/**
 * 端末内の保存（IndexedDB。Dexie で扱う）。
 * 図面・下敷き・バックアップを入れる。前の版の localStorage にあるデータは、初回に移してから消す。
 * 他の端末や他の人とは共有されない（この端末のブラウザの中だけ）。
 */

type KvRow = { key: string; value: unknown };
export type BackupRow = { id?: number; at: number; data: Drawing };

class CadDb extends Dexie {
  kv!: Table<KvRow, string>;
  backups!: Table<BackupRow, number>;

  constructor() {
    super('kenchiku-cad');
    this.version(1).stores({ kv: 'key', backups: '++id, at' });
  }
}

const db = new CadDb();
let opened: Promise<void> | null = null;

const OLD_KEYS = {
  drawing: 'kenchiku-cad:drawing',
  underlay: 'kenchiku-cad:underlay',
  backups: 'kenchiku-cad:backups',
} as const;

/** 開く（最初の1回だけ。前の版の localStorage のデータを移す） */
export function openStore(): Promise<void> {
  if (!opened) opened = migrate();
  return opened;
}

async function migrate(): Promise<void> {
  await db.open();
  for (const key of ['drawing', 'underlay'] as const) {
    const old = readOld(OLD_KEYS[key]);
    if (old === null) continue;
    if ((await db.kv.get(key)) === undefined) await db.kv.put({ key, value: JSON.parse(old) });
    removeOld(OLD_KEYS[key]);
  }
  const oldBackups = readOld(OLD_KEYS.backups);
  if (oldBackups !== null) {
    const arr = JSON.parse(oldBackups) as unknown;
    if (Array.isArray(arr) && arr.length > 0 && (await db.backups.count()) === 0) {
      await db.backups.bulkAdd((arr as BackupRow[]).map((b) => ({ at: b.at, data: b.data })));
    }
    removeOld(OLD_KEYS.backups);
  }
}

function readOld(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeOld(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 消せなくても、次回は移すものが無いだけ */
  }
}

export async function getValue<T>(key: string): Promise<T | null> {
  await openStore();
  const row = await db.kv.get(key);
  return row === undefined || row.value === null ? null : (row.value as T);
}

export async function putValue(key: string, value: unknown): Promise<void> {
  await openStore();
  await db.kv.put({ key, value });
}

export async function listBackups(): Promise<BackupRow[]> {
  await openStore();
  return db.backups.orderBy('at').toArray();
}

/** バックアップを1件足し、古いものから keep 件まで減らす。容量が足りなければさらに古いものから消して入れ直す */
export async function addBackupRow(row: { at: number; data: Drawing }, keep: number): Promise<void> {
  await openStore();
  for (;;) {
    try {
      await db.backups.add(row);
      break;
    } catch (e) {
      const oldest = await db.backups.orderBy('at').limit(1).primaryKeys();
      if (oldest.length === 0) throw e;
      await db.backups.bulkDelete(oldest);
    }
  }
  const count = await db.backups.count();
  if (count > keep) {
    const extra = await db.backups.orderBy('at').limit(count - keep).primaryKeys();
    await db.backups.bulkDelete(extra);
  }
}
