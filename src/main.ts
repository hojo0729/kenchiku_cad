import { createDrawing, distance, newId, normalizeDrawing, type Drawing, type Vec2 } from './model';
import { Viewport } from './viewport';
import { snapCandidates, snapPoint, type SnapResult } from './snap';
import { centerPattern, decompose, primExtents } from './arch/primitives';
import { formatDim, gridPositions, parseSpans } from './arch/grid';
import { readTheme, render, type Theme } from './renderer';
import { toDxf } from './export/dxf';
import { zipStore } from './export/zip';

const STORAGE_KEY = 'kenchiku-cad:drawing';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const statusEl = document.getElementById('status')!;
const gridSelect = document.getElementById('grid') as HTMLSelectElement;

const view = new Viewport();
let isSample = false;
let flashMsg = '';
let flashTimer = 0;
let drawing: Drawing = loadDrawing();
let history: Drawing[] = [];
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
      if (d && d.version === 1 && Array.isArray(d.entities)) return normalizeDrawing(d);
    }
  } catch {
    /* 読めなければ新規 */
  }
  return sampleDrawing();
}

/** 初回はサンプル（RC造の通り芯 3×2スパン）を表示して、何ができるか分かるようにする */
function sampleDrawing(): Drawing {
  const d = createDrawing();
  d.grid = { xSpans: [6000, 7200, 6000], ySpans: [6500, 6500], xPrefix: 'X', yPrefix: 'Y', origin: { x: 0, y: 0 } };
  isSample = true;
  return d;
}

function saveDrawing() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drawing));
  } catch {
    /* 保存できない環境では無視 */
  }
}

function commit(mutator: () => void) {
  isSample = false;
  history.push(structuredClone(drawing));
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
  render(
    ctx,
    cssW,
    cssH,
    { prims: decompose(drawing), view, grid, centerPattern: centerPattern(drawing.scale), pending, cursor },
    theme,
  );
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
  const ext = primExtents(decompose(drawing));
  if (!ext) {
    // 何もなければ原点付近の 10m 四方を表示
    view.fit({ x: -1000, y: -1000 }, { x: 9000, y: 9000 }, cssW, cssH);
    return;
  }
  view.fit(ext.min, ext.max, cssW, cssH, 16);
}

function flash(msg: string) {
  flashMsg = msg;
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    flashMsg = '';
    updateStatus();
  }, 3500);
  updateStatus();
}

function updateStatus() {
  statusEl.classList.toggle('flash', !!flashMsg);
  if (flashMsg) {
    statusEl.textContent = flashMsg;
    return;
  }
  if (isSample && !pending) {
    statusEl.textContent = 'サンプルの通り芯を表示中。「通り芯」でスパンを変更できます';
    return;
  }
  const parts: string[] = [];
  if (cursor) {
    parts.push(`X ${fmt(cursor.point.x)}  Y ${fmt(cursor.point.y)}`);
    if (cursor.kind === 'endpoint') parts.push('端点');
    if (cursor.kind === 'intersection') parts.push('通り芯交点');
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
  cursor = snapPoint(world, snapCandidates(drawing, pending ? [pending] : []), radius, grid);
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
    drawing = prev;
    syncGridForm();
    pending = null;
    saveDrawing();
    requestRender();
  },
  fit() {
    fitView();
    requestRender();
  },
  clear() {
    // confirm() が使えない環境（公開ページ）もあるので、2回タップで確定する
    if (drawing.entities.length === 0 && !drawing.grid) return;
    if (!clearArmed) {
      clearArmed = true;
      clearBtn.textContent = 'もう一度で消去';
      clearBtn.classList.add('danger');
      clearTimer = window.setTimeout(disarmClear, 3000);
      return;
    }
    disarmClear();
    commit(() => {
      drawing.entities = [];
      drawing.grid = undefined;
    });
    syncGridForm();
    pending = null;
    flash('全部消しました（「戻す」で元に戻せます）');
  },
  exportDxf() {
    void exportDxf();
  },
  gridPanel() {
    syncGridForm();
    sheet.hidden = false;
    gridX.focus();
  },
};

const clearBtn = document.getElementById('btn-clear') as HTMLButtonElement;
let clearArmed = false;
let clearTimer = 0;
function disarmClear() {
  clearArmed = false;
  clearTimeout(clearTimer);
  clearBtn.textContent = '全消去';
  clearBtn.classList.remove('danger');
}

type DownloadsApi = { save(req: { filename: string; data: Blob | Uint8Array | string }): Promise<unknown> };
type ClaudeHost = { use(name: string): Promise<unknown> };

async function exportDxf() {
  const name = `drawing-${timestamp()}`;
  const text = toDxf(drawing);
  const host = (window as unknown as { claude?: ClaudeHost }).claude;

  if (host?.use) {
    // claude.ai の公開ページ: .dxf は直接保存できないので zip に包む
    const downloads = (await host.use('downloads')) as DownloadsApi | null;
    if (!downloads) {
      flash('この画面では保存できません。PCのブラウザで開いてください');
      return;
    }
    const zip = zipStore([{ name: `${name}.dxf`, data: new TextEncoder().encode(text) }]);
    try {
      await downloads.save({ filename: `${name}.zip`, data: zip });
      flash('保存しました（zipを展開するとDXFが入っています）');
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code !== 'declined') flash('保存できませんでした。少し待ってからもう一度試してください');
    }
    return;
  }

  // 通常のブラウザ（npm run dev など）
  const blob = new Blob([text], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.dxf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  flash(`${name}.dxf を保存しました`);
}

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
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
    if (e.key === 'Escape') sheet.hidden = true;
    return;
  }
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

// ---------- 通り芯パネル ----------

const sheet = document.getElementById('grid-sheet') as HTMLElement;
const gridX = document.getElementById('grid-x') as HTMLInputElement;
const gridY = document.getElementById('grid-y') as HTMLInputElement;
const scaleSelect = document.getElementById('scale') as HTMLSelectElement;
const gridMsg = document.getElementById('grid-msg') as HTMLElement;
const gridSummary = document.getElementById('grid-summary') as HTMLElement;

function syncGridForm() {
  const g = drawing.grid;
  gridX.value = g ? g.xSpans.join(', ') : '';
  gridY.value = g ? g.ySpans.join(', ') : '';
  scaleSelect.value = String(drawing.scale);
  gridMsg.textContent = '';
  updateGridSummary();
}

function updateGridSummary() {
  const xs = parseSpans(gridX.value);
  const ys = parseSpans(gridY.value);
  if (!xs || !ys) {
    gridSummary.textContent = '';
    return;
  }
  const total = (v: number[]) => formatDim(v.reduce((a, b) => a + b, 0));
  gridSummary.textContent = `X1〜X${xs.length + 1}（計 ${total(xs)}）　Y1〜Y${ys.length + 1}（計 ${total(ys)}）`;
}

gridX.addEventListener('input', updateGridSummary);
gridY.addEventListener('input', updateGridSummary);

document.getElementById('grid-form')!.addEventListener('submit', (e) => {
  e.preventDefault();
  const xs = parseSpans(gridX.value);
  const ys = parseSpans(gridY.value);
  if (!xs || !ys) {
    gridMsg.textContent = '数字をカンマで区切って入力してください（例: 6000, 7200*2）';
    return;
  }
  const scale = Number(scaleSelect.value);
  commit(() => {
    drawing.scale = scale;
    drawing.grid = {
      xSpans: xs,
      ySpans: ys,
      xPrefix: 'X',
      yPrefix: 'Y',
      origin: drawing.grid?.origin ?? { x: 0, y: 0 },
    };
  });
  sheet.hidden = true;
  fitView();
  const { xs: px, ys: py } = gridPositions(drawing.grid!);
  flash(`通り芯を描きました（X ${px.length}本・Y ${py.length}本、1/${scale}）`);
});

document.getElementById('grid-remove')!.addEventListener('click', () => {
  if (!drawing.grid) {
    sheet.hidden = true;
    return;
  }
  commit(() => {
    drawing.grid = undefined;
  });
  sheet.hidden = true;
  flash('通り芯を消しました（「戻す」で元に戻せます）');
});

document.getElementById('grid-close')!.addEventListener('click', () => {
  sheet.hidden = true;
});

new ResizeObserver(resize).observe(canvas);
