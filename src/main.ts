import { createDrawing, distance, newId, normalizeDrawing, type Drawing, type Vec2 } from './model';
import { Viewport } from './viewport';
import { snapCandidates, snapPoint, type SnapResult } from './snap';
import { centerPattern, decompose, primExtents } from './arch/primitives';
import { formatDim, gridPositions, parseSpans } from './arch/grid';
import { columnAt, columnRect, intersectionName, nearestIntersection, nextColumnMark } from './arch/column';
import { readDxf } from './import/dxf-read';
import { loadUnderlay, saveUnderlay, underlayExtents, underlaySnapCandidates, type Underlay } from './underlay';
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
let mode: 'line' | 'column' | 'align' = 'line';
let underlay: Underlay | null = loadUnderlay();
/** 位置合わせで選んだ下敷き側の点 */
let alignFrom: Vec2 | null = null;
let currentTypeId = drawing.columnTypes[0].id;
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
  // 柱: 内柱は C1（800角・振り分け）、外周は C2（700角・外面合わせ）の例
  d.columnTypes = [
    { id: 'ct1', mark: 'C1', bx: 800, by: 800 },
    { id: 'ct2', mark: 'C2', bx: 700, by: 700 },
  ];
  for (let xi = 0; xi < 4; xi++) {
    for (let yi = 0; yi < 3; yi++) {
      const edgeX = xi === 0 ? 150 : xi === 3 ? 550 : null; // 外面を通り芯から 150 外へ
      const edgeY = yi === 0 ? 150 : yi === 2 ? 550 : null;
      const inner = edgeX === null && edgeY === null;
      d.columns.push({ id: newId(), typeId: inner ? 'ct1' : 'ct2', xi, yi, left: edgeX, bottom: edgeY });
    }
  }
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
    {
      prims: decompose(drawing),
      view,
      grid,
      centerPattern: centerPattern(drawing.scale),
      pending,
      cursor,
      underlay,
      alignFrom,
    },
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
  const own = primExtents(decompose(drawing));
  const ul = underlay?.visible ? underlayExtents(underlay) : null;
  const ext =
    own && ul
      ? {
          min: { x: Math.min(own.min.x, ul.min.x), y: Math.min(own.min.y, ul.min.y) },
          max: { x: Math.max(own.max.x, ul.max.x), y: Math.max(own.max.y, ul.max.y) },
        }
      : own ?? ul;
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
  if (mode === 'align') {
    statusEl.textContent = alignFrom
      ? '合わせたい点（通り芯の交点など）をタップ'
      : '下敷きの点（設計図の通り芯の交点など）をタップ';
    return;
  }
  if (mode === 'column') {
    const t = drawing.columnTypes.find((c) => c.id === currentTypeId);
    statusEl.textContent = drawing.grid
      ? `柱 ${t ? `${t.mark}（${t.bx}×${t.by}）` : ''}: 交点をタップで配置／柱をタップで編集`
      : '柱を置くには、先に「通り芯」を描いてください';
    return;
  }
  if (isSample && !pending) {
    statusEl.textContent = 'サンプル（通り芯と柱）を表示中。「柱」で符号の大きさを変えられます';
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
  const ul = underlay?.visible ? underlaySnapCandidates(underlay) : [];
  // 位置合わせの1点目は下敷きの点だけ、2点目は自分の図面の点だけに吸着
  const candidates =
    mode === 'align' && !alignFrom ? ul : mode === 'align' ? snapCandidates(drawing) : snapCandidates(drawing, pending ? [pending] : [], ul);
  cursor = snapPoint(world, candidates, radius, mode === 'align' ? 0 : grid);
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
  if (mode === 'align') {
    alignTap(screen, type);
    return;
  }
  if (mode === 'column') {
    columnTap(screen, type);
    return;
  }
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
    setMode('line');
  },
  column() {
    setMode('column');
    openColumnSheet(null);
  },
  endChain() {
    if (mode === 'align') {
      setMode('line');
      flash('位置合わせをやめました');
      return;
    }
    pending = null;
    requestRender();
  },
  undo() {
    const prev = history.pop();
    if (!prev) return;
    drawing = prev;
    if (!drawing.columnTypes.some((t) => t.id === currentTypeId)) currentTypeId = drawing.columnTypes[0].id;
    syncGridForm();
    if (!colSheet.hidden) renderColumnTypes();
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
    if (drawing.entities.length === 0 && !drawing.grid && drawing.columns.length === 0) return;
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
      drawing.columns = [];
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
    showSheet(sheet);
  },
  underlayPanel() {
    syncUnderlayForm();
    showSheet(ulSheet);
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
    if (e.key === 'Escape') showSheet(null);
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
    // 通り芯が減ったら、無くなった交点の柱も消す
    drawing.columns = drawing.columns.filter((c) => c.xi <= xs.length && c.yi <= ys.length);
  });
  showSheet(null);
  fitView();
  const { xs: px, ys: py } = gridPositions(drawing.grid!);
  flash(`通り芯を描きました（X ${px.length}本・Y ${py.length}本、1/${scale}）`);
});

document.getElementById('grid-remove')!.addEventListener('click', () => {
  if (!drawing.grid) {
    showSheet(null);
    return;
  }
  commit(() => {
    drawing.grid = undefined;
    drawing.columns = [];
  });
  showSheet(null);
  flash('通り芯を消しました（「戻す」で元に戻せます）');
});

document.getElementById('grid-close')!.addEventListener('click', () => showSheet(null));

// ---------- シート（下から出るパネル） ----------

function showSheet(target: HTMLElement | null) {
  for (const el of [sheet, colSheet, ulSheet]) el.hidden = el !== target;
  requestRender();
}

function setMode(next: 'line' | 'column' | 'align') {
  mode = next;
  flashMsg = ''; // 前の操作のメッセージで、次の操作の案内が隠れないように
  pending = null;
  alignFrom = null;
  document.getElementById('btn-line')!.classList.toggle('active', next === 'line');
  document.getElementById('btn-column')!.classList.toggle('active', next === 'column');
  requestRender();
}

// ---------- 柱 ----------

const colSheet = document.getElementById('col-sheet') as HTMLElement;
const colTitle = document.getElementById('col-title') as HTMLElement;
const colTypes = document.getElementById('col-types') as HTMLElement;
const colLeft = document.getElementById('col-left') as HTMLInputElement;
const colBottom = document.getElementById('col-bottom') as HTMLInputElement;
const colMsg = document.getElementById('col-msg') as HTMLElement;
const colOk = document.getElementById('col-ok') as HTMLButtonElement;
const colAll = document.getElementById('col-all') as HTMLButtonElement;
const colDelete = document.getElementById('col-delete') as HTMLButtonElement;

/** 編集中の柱（null なら「配置」モード） */
let colEditId: string | null = null;
/** 配置時の寄り（入力欄の文字のまま覚えておく） */
let placeLeft = '';
let placeBottom = '';

function parseOffset(text: string): number | null | undefined {
  const t = text.normalize('NFKC').trim();
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
}

function editingColumn() {
  return colEditId ? drawing.columns.find((c) => c.id === colEditId) : undefined;
}

function openColumnSheet(columnId: string | null) {
  colEditId = columnId;
  const col = editingColumn();
  colMsg.textContent = '';
  if (col) {
    colTitle.textContent = `柱（${intersectionName(drawing, col.xi, col.yi)}）`;
    colLeft.value = col.left === null ? '' : String(col.left);
    colBottom.value = col.bottom === null ? '' : String(col.bottom);
    colOk.textContent = '変更を反映';
    colAll.hidden = true;
    colDelete.hidden = false;
  } else {
    colTitle.textContent = '柱';
    colLeft.value = placeLeft;
    colBottom.value = placeBottom;
    colOk.textContent = '交点をタップして配置';
    colAll.hidden = false;
    colDelete.hidden = true;
  }
  renderColumnTypes();
  showSheet(colSheet);
}

function renderColumnTypes() {
  const col = editingColumn();
  const selectedId = col ? col.typeId : currentTypeId;
  colTypes.replaceChildren();
  for (const t of drawing.columnTypes) {
    const count = drawing.columns.filter((c) => c.typeId === t.id).length;
    const row = document.createElement('div');
    row.className = 'type-row' + (t.id === selectedId ? ' selected' : '');

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'coltype';
    radio.id = `coltype-${t.id}`;
    radio.checked = t.id === selectedId;
    radio.setAttribute('aria-label', `${t.mark} を使う`);
    radio.addEventListener('change', () => selectColumnType(t.id));

    const mark = textInput(`colmark-${t.id}`, t.mark, 'mark', '符号');
    const bx = textInput(`colbx-${t.id}`, String(t.bx), 'size', 'X方向の幅');
    const by = textInput(`colby-${t.id}`, String(t.by), 'size', 'Y方向の幅');
    bx.inputMode = 'numeric';
    by.inputMode = 'numeric';
    const times = document.createElement('span');
    times.className = 'times';
    times.textContent = '×';
    const cnt = document.createElement('span');
    cnt.className = 'count';
    cnt.textContent = `${count}本`;

    const apply = () => updateColumnType(t.id, mark.value, bx.value, by.value);
    for (const el of [mark, bx, by]) {
      el.addEventListener('change', apply);
      el.addEventListener('focus', () => selectColumnType(t.id, false));
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '削除';
    del.setAttribute('aria-label', `${t.mark} を削除`);
    del.addEventListener('click', () => deleteColumnType(t.id));

    row.append(radio, mark, bx, times, by, cnt, del);
    colTypes.append(row);
  }
}

function textInput(id: string, value: string, cls: string, label: string) {
  const el = document.createElement('input');
  el.type = 'text';
  el.id = id;
  el.value = value;
  el.className = cls;
  el.autocomplete = 'off';
  el.setAttribute('aria-label', label);
  return el;
}

function selectColumnType(id: string, rerender = true) {
  const col = editingColumn();
  if (col) {
    if (col.typeId !== id) {
      commit(() => {
        col.typeId = id;
      });
    }
  } else {
    currentTypeId = id;
  }
  if (rerender) renderColumnTypes();
  else
    colTypes.querySelectorAll('.type-row').forEach((row, i) => {
      const on = drawing.columnTypes[i]?.id === id;
      row.classList.toggle('selected', on);
      (row.querySelector('input[type="radio"]') as HTMLInputElement).checked = on;
    });
  requestRender();
}

function updateColumnType(id: string, markText: string, bxText: string, byText: string) {
  const mark = markText.normalize('NFKC').trim();
  const bx = Number(bxText.normalize('NFKC'));
  const by = Number(byText.normalize('NFKC'));
  if (!mark) {
    colMsg.textContent = '符号を入力してください（例: C1）';
    renderColumnTypes();
    return;
  }
  if (drawing.columnTypes.some((t) => t.id !== id && t.mark === mark)) {
    colMsg.textContent = `符号 ${mark} はもう使われています`;
    renderColumnTypes();
    return;
  }
  if (!(bx > 0) || !(by > 0)) {
    colMsg.textContent = '柱の大きさは 0 より大きい数字で入力してください';
    renderColumnTypes();
    return;
  }
  colMsg.textContent = '';
  const t = drawing.columnTypes.find((c) => c.id === id);
  if (!t || (t.mark === mark && t.bx === bx && t.by === by)) return;
  commit(() => {
    t.mark = mark;
    t.bx = bx;
    t.by = by;
  });
  const count = drawing.columns.filter((c) => c.typeId === id).length;
  if (count) flash(`${mark} の柱 ${count}本を ${bx}×${by} に変更しました`);
  renderColumnTypes();
}

function deleteColumnType(id: string) {
  const t = drawing.columnTypes.find((c) => c.id === id);
  if (!t) return;
  if (drawing.columns.some((c) => c.typeId === id)) {
    colMsg.textContent = `${t.mark} は図面で使われているので削除できません。先にその柱を消してください`;
    return;
  }
  if (drawing.columnTypes.length === 1) {
    colMsg.textContent = '符号は最低1つ必要です';
    return;
  }
  commit(() => {
    drawing.columnTypes = drawing.columnTypes.filter((c) => c.id !== id);
  });
  if (currentTypeId === id) currentTypeId = drawing.columnTypes[0].id;
  colMsg.textContent = '';
  renderColumnTypes();
}

document.getElementById('col-type-add')!.addEventListener('click', () => {
  const t = { id: newId(), mark: nextColumnMark(drawing.columnTypes), bx: 800, by: 800 };
  commit(() => {
    drawing.columnTypes.push(t);
  });
  selectColumnType(t.id);
});

document.getElementById('col-form')!.addEventListener('submit', (e) => {
  e.preventDefault();
  const left = parseOffset(colLeft.value);
  const bottom = parseOffset(colBottom.value);
  if (left === undefined || bottom === undefined) {
    colMsg.textContent = '寄りは数字で入力してください（空欄なら振り分け）';
    return;
  }
  const col = editingColumn();
  if (col) {
    if (col.left !== left || col.bottom !== bottom) {
      commit(() => {
        col.left = left;
        col.bottom = bottom;
      });
    }
    flash(`${intersectionName(drawing, col.xi, col.yi)} の柱を変更しました`);
  } else {
    placeLeft = colLeft.value;
    placeBottom = colBottom.value;
    setMode('column');
  }
  showSheet(null);
});

colAll.addEventListener('click', () => {
  if (!drawing.grid) {
    colMsg.textContent = '先に「通り芯」を描いてください';
    return;
  }
  const left = parseOffset(colLeft.value);
  const bottom = parseOffset(colBottom.value);
  if (left === undefined || bottom === undefined) {
    colMsg.textContent = '寄りは数字で入力してください（空欄なら振り分け）';
    return;
  }
  placeLeft = colLeft.value;
  placeBottom = colBottom.value;
  const { xs, ys } = gridPositions(drawing.grid);
  let added = 0;
  commit(() => {
    xs.forEach((_, xi) =>
      ys.forEach((__, yi) => {
        if (columnAt(drawing, xi, yi)) return;
        drawing.columns.push({ id: newId(), typeId: currentTypeId, xi, yi, left, bottom });
        added++;
      }),
    );
  });
  setMode('column');
  showSheet(null);
  const t = drawing.columnTypes.find((c) => c.id === currentTypeId)!;
  flash(added ? `${t.mark} を ${added}か所に配置しました` : '全部の交点に柱があります');
});

colDelete.addEventListener('click', () => {
  const col = editingColumn();
  if (!col) return;
  const name = intersectionName(drawing, col.xi, col.yi);
  commit(() => {
    drawing.columns = drawing.columns.filter((c) => c.id !== col.id);
  });
  showSheet(null);
  flash(`${name} の柱を削除しました（「戻す」で元に戻せます）`);
});

document.getElementById('col-close')!.addEventListener('click', () => showSheet(null));

function columnTap(screen: Vec2, type: string) {
  if (!drawing.grid) {
    flash('柱を置くには、先に「通り芯」を描いてください');
    return;
  }
  const w = view.toWorld(screen);
  const r = snapRadiusPx(type) / view.scale;

  // 既にある柱をタップ → 編集
  const hit = drawing.columns.find((c) => {
    const rc = columnRect(drawing, c);
    return rc && w.x >= rc.min.x - r && w.x <= rc.max.x + r && w.y >= rc.min.y - r && w.y <= rc.max.y + r;
  });
  if (hit) {
    openColumnSheet(hit.id);
    return;
  }

  const t = drawing.columnTypes.find((c) => c.id === currentTypeId)!;
  const ix = nearestIntersection(drawing, w, Math.max(r, Math.max(t.bx, t.by)));
  if (!ix) {
    flash('通り芯の交点をタップしてください');
    return;
  }
  const left = parseOffset(placeLeft) ?? null;
  const bottom = parseOffset(placeBottom) ?? null;
  commit(() => {
    drawing.columns.push({ id: newId(), typeId: t.id, xi: ix.xi, yi: ix.yi, left, bottom });
  });
  flash(`${t.mark}（${t.bx}×${t.by}）を ${intersectionName(drawing, ix.xi, ix.yi)} に配置しました`);
}

// ---------- 下敷き ----------

const ulSheet = document.getElementById('ul-sheet') as HTMLElement;
const ulFile = document.getElementById('ul-file') as HTMLInputElement;
const ulInfo = document.getElementById('ul-info') as HTMLElement;
const ulMsg = document.getElementById('ul-msg') as HTMLElement;
const ulControls = document.getElementById('ul-controls') as HTMLElement;
const ulVisible = document.getElementById('ul-visible') as HTMLInputElement;
const ulOpacity = document.getElementById('ul-opacity') as HTMLInputElement;
const ulRemove = document.getElementById('ul-remove') as HTMLButtonElement;

function describeUnderlay(u: Underlay): string {
  let lines = 0;
  let arcs = 0;
  let texts = 0;
  for (const p of u.prims) {
    if (p.t === 'line') lines++;
    else if (p.t === 'text') texts++;
    else arcs++;
  }
  const e = underlayExtents(u);
  const size = e ? `　範囲 ${formatDim(e.max.x - e.min.x)} × ${formatDim(e.max.y - e.min.y)}` : '';
  return `${u.name}　線 ${lines}・円と円弧 ${arcs}・文字 ${texts}${size}`;
}

function syncUnderlayForm() {
  ulMsg.textContent = '';
  disarmUlRemove();
  ulControls.hidden = !underlay;
  if (underlay) {
    ulInfo.textContent = describeUnderlay(underlay);
    ulVisible.checked = underlay.visible;
    ulOpacity.value = String(Math.round(underlay.opacity * 100));
  } else {
    ulInfo.textContent = 'まだ読み込んでいません';
  }
}

ulFile.addEventListener('change', async () => {
  const file = ulFile.files?.[0];
  ulFile.value = '';
  if (!file) return;
  ulMsg.textContent = '';
  if (/\.jww$/i.test(file.name)) {
    ulMsg.textContent = 'JWW は今は直接読めません。Jw_cad で「DXF形式で保存」したファイルを選んでください';
    return;
  }
  if (/\.dwg$/i.test(file.name)) {
    ulMsg.textContent = 'DWG は直接読めません。PC で DXF に変換（ODA File Converter など）してから選んでください';
    return;
  }
  ulInfo.textContent = `${file.name} を読み込み中…`;
  try {
    const result = readDxf(new Uint8Array(await file.arrayBuffer()));
    const ext = primExtents(result.prims);
    if (!ext) throw new Error('表示できる図形がありませんでした');

    // 最初の位置: 自分の図面があればその中心に、無ければ左下を原点に置く（あとで「位置を合わせる」で正確に）
    const own = primExtents(decompose(drawing));
    const dx = own ? (own.min.x + own.max.x) / 2 - (ext.min.x + ext.max.x) / 2 : -ext.min.x;
    const dy = own ? (own.min.y + own.max.y) / 2 - (ext.min.y + ext.max.y) / 2 : -ext.min.y;
    underlay = { name: file.name, prims: result.prims, dx, dy, visible: true, opacity: 0.6 };
    const saved = saveUnderlay(underlay);
    syncUnderlayForm();

    const notes: string[] = [...result.warnings];
    const skipped = Object.entries(result.stats.skipped)
      .filter(([type]) => type !== 'POINT')
      .map(([type, n]) => `${type} ${n}`);
    if (skipped.length) notes.push(`表示していない図形: ${skipped.join('、')}`);
    if (!saved) notes.push('図面が大きくて端末に保存できませんでした。表示はできますが、ページを開き直すと消えます');
    ulMsg.textContent = notes.join('。');
    fitView();
    requestRender();
    flash(`${file.name} を下敷きにしました`);
  } catch (err) {
    syncUnderlayForm();
    ulMsg.textContent = err instanceof Error ? err.message : 'DXF として読めませんでした';
  }
});

ulVisible.addEventListener('change', () => {
  if (!underlay) return;
  underlay.visible = ulVisible.checked;
  saveUnderlay(underlay);
  requestRender();
});

ulOpacity.addEventListener('input', () => {
  if (!underlay) return;
  underlay.opacity = Number(ulOpacity.value) / 100;
  requestRender();
});
ulOpacity.addEventListener('change', () => {
  if (underlay) saveUnderlay(underlay);
});

document.getElementById('ul-align')!.addEventListener('click', () => {
  if (!underlay) return;
  if (!underlay.visible) {
    underlay.visible = true;
    saveUnderlay(underlay);
  }
  setMode('align');
  showSheet(null);
});

// 外すと読み込み直しになるので、2回タップで確定
let ulRemoveArmed = false;
let ulRemoveTimer = 0;
function disarmUlRemove() {
  ulRemoveArmed = false;
  clearTimeout(ulRemoveTimer);
  ulRemove.textContent = '下敷きを外す';
  ulRemove.classList.remove('danger');
}
ulRemove.addEventListener('click', () => {
  if (!underlay) return;
  if (!ulRemoveArmed) {
    ulRemoveArmed = true;
    ulRemove.textContent = 'もう一度で外す';
    ulRemove.classList.add('danger');
    ulRemoveTimer = window.setTimeout(disarmUlRemove, 3000);
    return;
  }
  disarmUlRemove();
  underlay = null;
  saveUnderlay(null);
  syncUnderlayForm();
  requestRender();
  flash('下敷きを外しました');
});

document.getElementById('ul-close')!.addEventListener('click', () => showSheet(null));

function alignTap(screen: Vec2, type: string) {
  if (!underlay) {
    setMode('line');
    return;
  }
  updateCursor(screen, type);
  if (!alignFrom) {
    if (!cursor || cursor.kind === 'none') {
      flash('下敷きの線の端点か交点をタップしてください（拡大すると選びやすくなります）');
      return;
    }
    alignFrom = { ...cursor.point };
    requestRender();
    return;
  }
  if (!cursor) return;
  const mx = cursor.point.x - alignFrom.x;
  const my = cursor.point.y - alignFrom.y;
  underlay.dx += mx;
  underlay.dy += my;
  saveUnderlay(underlay);
  setMode('line');
  flash(`下敷きを動かしました（X ${formatDim(mx)}・Y ${formatDim(my)}）`);
}

// 開発時だけ、自動テストから状態を見られるようにする（本番ビルドでは消える）
if (import.meta.env.DEV) {
  (window as unknown as { __cad: unknown }).__cad = {
    view,
    get underlay() {
      return underlay;
    },
    get drawing() {
      return drawing;
    },
  };
}

new ResizeObserver(resize).observe(canvas);
