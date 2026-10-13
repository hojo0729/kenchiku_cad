import { createDrawing, distance, newId, type Drawing, type Entity, type Vec2 } from './model';
import { Viewport } from './viewport';
import { snapPoint, type SnapResult } from './snap';
import { readTheme, render, type Theme } from './renderer';
import { toDxf } from './export/dxf';

const STORAGE_KEY = 'kenchiku-cad:drawing';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const statusEl = document.getElementById('status')!;
const gridSelect = document.getElementById('grid') as HTMLSelectElement;

const view = new Viewport();
let drawing: Drawing = loadDrawing();
let history: Entity[][] = [];
let grid = Number(gridSelect.value);
let pending: Vec2 | null = null;
let cursor: SnapResult | null = null;
let theme: Theme = readTheme();
let cssW = 0;
let cssH = 0;
let needsRender = true;

// ---------- 保存・読み込み ----------

function loadDrawing(): Drawing {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Drawing;
      if (d && d.version === 1 && Array.isArray(d.entities)) return d;
    }
  } catch {
    /* 読めなければ新規 */
  }
  return createDrawing();
}

function saveDrawing() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drawing));
  } catch {
    /* 保存できない環境では無視 */
  }
}

function commit(mutator: () => void) {
  history.push(drawing.entities.map((e) => structuredClone(e)));
  if (history.length > 200) history.shift();
  mutator();
  saveDrawing();
  requestRender();
}

// ---------- 描画ループ ----------

function requestRender() {
  if (needsRender) return;
  needsRender = true;
  requestAnimationFrame(frame);
}

function frame() {
  needsRender = false;
  render(ctx, cssW, cssH, { drawing, view, grid, pending, cursor }, theme);
  updateStatus();
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const first = cssW === 0;
  // リサイズ時は画面中央を保つ
  if (!first) view.panBy((rect.width - cssW) / 2, (rect.height - cssH) / 2);
  cssW = rect.width;
  cssH = rect.height;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (first) fitView();
  needsRender = false;
  requestRender();
}

function fitView() {
  if (drawing.entities.length === 0) {
    // 何もなければ原点付近の 10m 四方を表示
    view.fit({ x: -1000, y: -1000 }, { x: 9000, y: 9000 }, cssW, cssH);
    return;
  }
  let min = { x: Infinity, y: Infinity };
  let max = { x: -Infinity, y: -Infinity };
  for (const e of drawing.entities) {
    for (const p of [e.a, e.b]) {
      min = { x: Math.min(min.x, p.x), y: Math.min(min.y, p.y) };
      max = { x: Math.max(max.x, p.x), y: Math.max(max.y, p.y) };
    }
  }
  view.fit(min, max, cssW, cssH);
}

function updateStatus() {
  const parts: string[] = [];
  if (cursor) {
    parts.push(`X ${fmt(cursor.point.x)}  Y ${fmt(cursor.point.y)}`);
    if (cursor.kind === 'endpoint') parts.push('端点');
  }
  if (pending && cursor) parts.push(`長さ ${fmt(distance(pending, cursor.point))}`);
  parts.push(`線 ${drawing.entities.length}本`);
  parts.push(pending ? '次の点をタップ（Escで終了）' : '始点をタップ');
  statusEl.textContent = parts.join('　|　');
}

function fmt(v: number) {
  return `${Math.round(v * 10) / 10}`;
}

// ---------- 入力 ----------

type Ptr = { x: number; y: number; sx: number; sy: number; type: string };
const pointers = new Map<number, Ptr>();
let gesture: 'none' | 'pan' | 'pinch' = 'none';
let tapCandidate = false;
let pinchDist = 0;
let pinchMid: Vec2 = { x: 0, y: 0 };

function localPos(e: PointerEvent | WheelEvent): Vec2 {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function snapRadiusPx(type: string) {
  return type === 'touch' ? 28 : 12;
}

function updateCursor(screen: Vec2, type: string) {
  const world = view.toWorld(screen);
  const radius = snapRadiusPx(type) / view.scale;
  cursor = snapPoint(world, drawing.entities, radius, grid, pending ? [pending] : []);
  requestRender();
}

function twoPointers(): [Ptr, Ptr] {
  const [a, b] = [...pointers.values()];
  return [a, b];
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = localPos(e);
  pointers.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, type: e.pointerType });

  if (pointers.size === 1) {
    gesture = 'none';
    tapCandidate = e.button === 0;
    if (e.button === 1 || e.button === 2) {
      gesture = 'pan';
      tapCandidate = false;
    }
    updateCursor(p, e.pointerType);
  } else if (pointers.size === 2) {
    gesture = 'pinch';
    tapCandidate = false;
    const [a, b] = twoPointers();
    pinchDist = Math.hypot(b.x - a.x, b.y - a.y);
    pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = localPos(e);
  const ptr = pointers.get(e.pointerId);

  if (!ptr) {
    // ホバー（マウス・ペン）
    if (e.pointerType !== 'touch') updateCursor(p, e.pointerType);
    return;
  }

  const dx = p.x - ptr.x;
  const dy = p.y - ptr.y;
  ptr.x = p.x;
  ptr.y = p.y;

  if (gesture === 'pinch' && pointers.size >= 2) {
    const [a, b] = twoPointers();
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    view.panBy(mid.x - pinchMid.x, mid.y - pinchMid.y);
    if (pinchDist > 0) view.zoomAt(mid, dist / pinchDist);
    pinchDist = dist;
    pinchMid = mid;
    requestRender();
    return;
  }

  if (pointers.size === 1) {
    const moved = Math.hypot(p.x - ptr.sx, p.y - ptr.sy);
    const threshold = ptr.type === 'touch' ? 10 : 5;
    if (gesture === 'none' && moved > threshold) {
      gesture = 'pan';
      tapCandidate = false;
    }
    if (gesture === 'pan') {
      view.panBy(dx, dy);
    }
    updateCursor(p, ptr.type);
  }
});

function endPointer(e: PointerEvent, allowTap: boolean) {
  const ptr = pointers.get(e.pointerId);
  if (!ptr) return;
  if (allowTap && tapCandidate && pointers.size === 1) {
    handleTap({ x: ptr.x, y: ptr.y }, ptr.type);
  }
  pointers.delete(e.pointerId);
  if (pointers.size === 0) gesture = 'none';
  tapCandidate = false;
  if (ptr.type === 'touch' && pointers.size === 0 && !pending) {
    // 指を離したらマーカーは消す（作図中は残す）
    cursor = null;
  }
  requestRender();
}

canvas.addEventListener('pointerup', (e) => endPointer(e, true));
canvas.addEventListener('pointercancel', (e) => endPointer(e, false));
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType !== 'touch' && !pointers.has(e.pointerId)) {
    cursor = null;
    requestRender();
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const p = localPos(e);
    if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
      // ホイール・トラックパッドのピンチ
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      view.zoomAt(p, factor);
    } else {
      view.panBy(-e.deltaX, -e.deltaY);
    }
    updateCursor(p, 'mouse');
  },
  { passive: false },
);

function handleTap(screen: Vec2, type: string) {
  updateCursor(screen, type);
  if (!cursor) return;
  const pt = { ...cursor.point };
  if (!pending) {
    pending = pt;
  } else if (distance(pending, pt) > 1e-6) {
    const a = pending;
    commit(() => {
      drawing.entities.push({ id: newId(), kind: 'line', layer: '0', a, b: pt });
    });
    pending = pt; // 連続線
  }
  requestRender();
}

// ---------- ツールバー・キー ----------

const actions: Record<string, () => void> = {
  line() {
    /* 現状は線ツールのみ */
  },
  endChain() {
    pending = null;
    requestRender();
  },
  undo() {
    const prev = history.pop();
    if (!prev) return;
    drawing.entities = prev;
    pending = null;
    saveDrawing();
    requestRender();
  },
  fit() {
    fitView();
    requestRender();
  },
  clear() {
    if (drawing.entities.length === 0) return;
    if (!confirm('すべての線を消去しますか？（「戻す」で元に戻せます）')) return;
    commit(() => {
      drawing.entities = [];
    });
    pending = null;
  },
  exportDxf() {
    const blob = new Blob([toDxf(drawing)], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drawing-${timestamp()}.dxf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

function timestamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
  btn.addEventListener('click', () => actions[btn.dataset.action!]?.());
});

gridSelect.addEventListener('change', () => {
  grid = Number(gridSelect.value);
  requestRender();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') actions.endChain();
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    actions.undo();
  } else if (e.key === 'f' || e.key === 'F') actions.fit();
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  theme = readTheme();
  requestRender();
});

new ResizeObserver(resize).observe(canvas);
