import { createDrawing, distance, LAYER_DIM, LAYER_DIM_OFFSET, newId, normalizeDrawing, type Beam, type BeamType, type Drawing, type Vec2, type Wall, type WallType } from './model';
import { Viewport } from './viewport';
import { snapCandidates, snapPoint, type Segment, type SnapResult } from './snap';
import { centerPattern, decompose, hiddenPattern, primExtents } from './arch/primitives';
import { formatDim, gridPositions, parseSpans } from './arch/grid';
import { columnAt, columnRect, intersectionName, nearestIntersection, nextColumnMark } from './arch/column';
import { detectGrid, toSpans } from './arch/grid-detect';
import { beamRect, gridSpans, nextBeamMark, nextWallMark, openingRange, spanName, wallName, wallRect, wallsInRange, type Rect } from './arch/wall';
import { nearestSegment, offsetSegment, orthoConstrain } from './tools';
import { decodeDxf, readDxf } from './import/dxf-read';
import { drawingFromJson, extractEmbedded, isZip, unzipFirst } from './export/native';
import { loadUnderlay, saveUnderlay, underlayExtents, underlaySegments, underlaySnapCandidates, type Underlay } from './underlay';
import { drawLoupe, readTheme, render, type Theme } from './renderer';
import { toDxfBytes } from './export/dxf';
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
type Mode = 'line' | 'column' | 'wall' | 'beam' | 'opening' | 'align' | 'measure' | 'erase' | 'offset';
let mode: Mode = 'line';
/** 直交モード（線を水平・垂直に固定） */
let ortho = false;
/** 測る: 1点目と（確定した）2点目 */
let measureA: Vec2 | null = null;
let measureB: Vec2 | null = null;
/** オフセットの距離(mm) */
let offsetDist = 150;
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
  // 壁: 外周は W18（外面を柱と同じく通り芯から 150 外に）、中に W15 を1枚
  const outer = (axis: 'x' | 'y', line: number, from: number, offset: number) =>
    d.walls.push({ id: newId(), typeId: 'wt18', axis, line, from, to: from + 1, offset });
  for (let i = 0; i < 3; i++) {
    outer('y', 0, i, 150); // Y1: 下面が外 → 通り芯から下面まで 150
    outer('y', 2, i, 30); // Y3: 上面が外 → 下面は通り芯から 30（180-150）
  }
  for (let i = 0; i < 2; i++) {
    outer('x', 0, i, 150);
    outer('x', 3, i, 30);
  }
  d.walls.push({ id: newId(), typeId: 'wt15', axis: 'y', line: 1, from: 0, to: 1, offset: null });
  // 開口: Y1通り X2〜X3 に出入口 1800、Y3通り X1〜X2 に窓 2400
  const y1mid = d.walls.find((w) => w.axis === 'y' && w.line === 0 && w.from === 1)!;
  const y3left = d.walls.find((w) => w.axis === 'y' && w.line === 2 && w.from === 0)!;
  d.openings.push({ id: newId(), wallId: y1mid.id, start: 2700, width: 1800 });
  d.openings.push({ id: newId(), wallId: y3left.id, start: 1800, width: 2400 });
  // 梁: 内側の通り（X2・X3 と Y2）に G1 400×800
  for (const xi of [1, 2]) for (let i = 0; i < 2; i++) d.beams.push({ id: newId(), typeId: 'bt1', axis: 'x', line: xi, from: i, to: i + 1, offset: null });
  for (let i = 0; i < 3; i++) d.beams.push({ id: newId(), typeId: 'bt1', axis: 'y', line: 1, from: i, to: i + 1, offset: null });
  isSample = true;
  return d;
}

// ブラウザに「この保存データを勝手に消さないで」と頼む（効くかはブラウザ次第。Safari は使わない日が続くと消すことがある）
try {
  void navigator.storage?.persist?.().catch(() => {});
} catch {
  /* 無い環境では何もしない */
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
  // 壁が無くなった開口は消す
  drawing.openings = drawing.openings.filter((o) => drawing.walls.some((w) => w.id === o.wallId));
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
      hiddenPattern: hiddenPattern(drawing.scale),
      scale: drawing.scale,
      pending,
      cursor,
      underlay,
      alignFrom,
      measure: measureA ? { a: measureA, b: measureB ?? cursor?.point ?? measureA } : null,
    },
    theme,
  );
  if (gesture === 'press' && pressAt && cursor) drawLoupe(ctx, canvas, view.toScreen(cursor.point), cssW, theme);
  updateStatus();
  updateToolbar();
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
  // 長押し中の案内は、前の操作のメッセージより優先
  if (gesture === 'press') {
    statusEl.classList.remove('flash');
    const label = cursor ? { endpoint: '端点', intersection: '交点', online: '線上', grid: 'グリッド', none: '' }[cursor.kind] : '';
    statusEl.textContent = `${label ? `【${label}】` : ''}指を動かして合わせ、離すと決定`;
    return;
  }
  statusEl.classList.toggle('flash', !!flashMsg);
  if (flashMsg) {
    statusEl.textContent = flashMsg;
    return;
  }
  if (mode === 'measure') {
    const b = measureB ?? (measureA ? cursor?.point : null);
    statusEl.textContent =
      measureA && b
        ? `距離 ${formatDim(distance(measureA, b))}　X ${formatDim(Math.abs(b.x - measureA.x))}　Y ${formatDim(Math.abs(b.y - measureA.y))}`
        : '測る: 1点目をタップ（長押しで吸着）';
    return;
  }
  if (mode === 'erase') {
    statusEl.textContent = '消す: 線・柱・壁・開口・梁をタップ（下敷き・通り芯は消えません）';
    return;
  }
  if (mode === 'offset') {
    statusEl.textContent = `オフセット ${formatDim(offsetDist)}: 線をタップ（タップした側に作ります）`;
    return;
  }
  if (mode === 'align') {
    statusEl.textContent = alignFrom
      ? '合わせたい点（通り芯の交点など）をタップ'
      : '下敷きの点（設計図の通り芯の交点など）をタップ';
    return;
  }
  if (mode === 'wall' || mode === 'beam') {
    const panel = mode === 'wall' ? wallPanel : beamPanel;
    const name = mode === 'wall' ? '壁' : '梁';
    const t = panel.currentType;
    statusEl.textContent = drawing.grid
      ? `${name} ${t ? t.mark : ''}: 通り芯の区間をタップで配置／${name}をタップで編集`
      : `${name}を置くには、先に「通り芯」を描いてください`;
    return;
  }
  if (mode === 'opening') {
    statusEl.textContent = `開口 幅${formatDim(opDefaultWidth)}: 壁をタップで配置／開口をタップで変更`;
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
    statusEl.textContent = 'サンプル（通り芯・柱・壁・開口・梁）を表示中。各ボタンで符号の大きさを変えられます';
    return;
  }
  const parts: string[] = [];
  if (cursor) {
    parts.push(`X ${fmt(cursor.point.x)}  Y ${fmt(cursor.point.y)}`);
    if (cursor.kind === 'endpoint') parts.push('端点');
    if (cursor.kind === 'intersection') parts.push('交点');
    if (cursor.kind === 'online') parts.push('線上');
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
/** press = 長押し中（カーソルを指の上に出して吸着先を選ぶ） */
let gesture: 'none' | 'pan' | 'pinch' | 'press' = 'none';
let tapCandidate = false;
let pinchDist = 0;
let pinchMid: Vec2 = { x: 0, y: 0 };

/** 長押しと判定するまでの時間(ms) */
const PRESS_MS = 380;
/** 長押し中、カーソルを指から上にずらす量(px)。指で隠れないように */
const PRESS_OFFSET = 64;
let pressTimer = 0;
/** 長押し中のカーソル位置（画面座標、指からずらした点） */
let pressAt: Vec2 | null = null;

function localPos(e: PointerEvent | WheelEvent): Vec2 {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function snapRadiusPx(type: string) {
  if (type === 'press') return 36; // 長押しは広めに拾う（ルーペで確認できるので）
  return type === 'touch' ? 28 : 12;
}

/** 線上スナップの対象: 自分の図面の線（寸法線を除く）と下敷きの線 */
function ownSegments(): Segment[] {
  const out: Segment[] = [];
  for (const p of decompose(drawing)) {
    if (p.t === 'line' && p.layer !== LAYER_DIM && p.layer !== LAYER_DIM_OFFSET) out.push({ a: p.a, b: p.b });
  }
  return out;
}

function updateCursor(screen: Vec2, type: string) {
  const world = view.toWorld(screen);
  const radius = snapRadiusPx(type) / view.scale;
  const ulPts = underlay?.visible ? underlaySnapCandidates(underlay) : [];
  const ulSegs = underlay?.visible ? underlaySegments(underlay) : [];
  // 位置合わせの1点目は下敷きだけ、2点目は自分の図面だけに吸着
  if (mode === 'align') {
    cursor = alignFrom
      ? snapPoint(world, snapCandidates(drawing), radius, 0, ownSegments())
      : snapPoint(world, ulPts, radius, 0, ulSegs);
  } else {
    const segs = ownSegments();
    for (const s of ulSegs) segs.push(s);
    cursor = snapPoint(world, snapCandidates(drawing, pending ? [pending] : [], ulPts), radius, grid, segs);
    if (ortho && mode === 'line' && pending) cursor = { point: orthoConstrain(pending, cursor.point), kind: cursor.kind === 'none' ? 'none' : 'grid' };
  }
  requestRender();
}

function twoPointers(): [Ptr, Ptr] {
  const [a, b] = [...pointers.values()];
  return [a, b];
}

function cancelPress() {
  clearTimeout(pressTimer);
  pressTimer = 0;
}

function startPress(ptr: Ptr) {
  gesture = 'press';
  tapCandidate = false;
  pressAt = { x: ptr.x, y: ptr.y - PRESS_OFFSET };
  updateCursor(pressAt, 'press');
  try {
    navigator.vibrate?.(12);
  } catch {
    /* 振動できない端末は無視 */
  }
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = localPos(e);
  const ptr = { x: p.x, y: p.y, sx: p.x, sy: p.y, type: e.pointerType };
  pointers.set(e.pointerId, ptr);

  if (pointers.size === 1) {
    gesture = 'none';
    tapCandidate = e.button === 0;
    if (e.button === 1 || e.button === 2) {
      gesture = 'pan';
      tapCandidate = false;
    }
    // 指・ペンは長押しで吸着モード
    if (e.pointerType !== 'mouse' && e.button === 0) {
      cancelPress();
      pressTimer = window.setTimeout(() => {
        if (gesture === 'none' && pointers.size === 1) startPress(ptr);
      }, PRESS_MS);
    }
    updateCursor(p, e.pointerType);
  } else if (pointers.size === 2) {
    cancelPress();
    gesture = 'pinch';
    pressAt = null;
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

  if (gesture === 'press') {
    // 長押し中は画面を動かさず、カーソルだけ指に合わせて動かす
    pressAt = { x: p.x, y: p.y - PRESS_OFFSET };
    updateCursor(pressAt, 'press');
    return;
  }

  if (pointers.size === 1) {
    const moved = Math.hypot(p.x - ptr.sx, p.y - ptr.sy);
    const threshold = ptr.type === 'touch' ? 10 : 5;
    if (gesture === 'none' && moved > threshold) {
      gesture = 'pan';
      tapCandidate = false;
      cancelPress();
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
  cancelPress();
  if (gesture === 'press' && pressAt) {
    // 長押しを離したところで確定（ルーペで見ていた吸着先）
    const at = pressAt;
    pressAt = null;
    if (allowTap) handleTap(at, 'press');
  } else if (allowTap && tapCandidate && pointers.size === 1) {
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
  if (mode === 'measure') {
    measureTap(screen, type);
    return;
  }
  if (mode === 'erase') {
    eraseTap(screen, type);
    return;
  }
  if (mode === 'offset') {
    offsetTap(screen, type);
    return;
  }
  if (mode === 'align') {
    alignTap(screen, type);
    return;
  }
  if (mode === 'column') {
    columnTap(screen, type);
    return;
  }
  if (mode === 'wall') {
    wallPanel.tap(screen, type);
    return;
  }
  if (mode === 'beam') {
    beamPanel.tap(screen, type);
    return;
  }
  if (mode === 'opening') {
    openingTap(screen, type);
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
  wall() {
    setMode('wall');
    wallPanel.open(null);
  },
  beam() {
    setMode('beam');
    beamPanel.open(null);
  },
  opening() {
    openOpeningSheet(null);
  },
  openSample() {
    history.push(structuredClone(drawing));
    drawing = sampleDrawing();
    saveDrawing();
    syncGridForm();
    fitView();
    requestRender();
    flash('サンプルを開きました（「戻す」で前の図面に戻せます）');
  },
  ortho() {
    ortho = !ortho;
    document.getElementById('btn-ortho')!.setAttribute('aria-pressed', String(ortho));
    flash(ortho ? '直交モード: 線を水平・垂直に固定します' : '直交モードを切りました');
    requestRender();
  },
  offset() {
    offInput.value = String(offsetDist);
    offMsg.textContent = '';
    showSheet(offSheet);
  },
  measure() {
    setMode('measure');
  },
  erase() {
    setMode('erase');
  },
  endChain() {
    if (mode !== 'line' && mode !== 'align') {
      setMode('line');
      return;
    }
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
    if (!wallPanel.sheet.hidden) wallPanel.render();
    if (!beamPanel.sheet.hidden) beamPanel.render();
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
    if (drawing.entities.length === 0 && !drawing.grid && !drawing.columns.length && !drawing.walls.length && !drawing.beams.length) return;
    if (!clearArmed) {
      clearArmed = true;
      clearTitle.textContent = 'もう一度押すと全部消します';
      clearBtn.classList.add('danger');
      clearTimer = window.setTimeout(disarmClear, 3000);
      return;
    }
    disarmClear();
    commit(() => {
      drawing.entities = [];
      drawing.grid = undefined;
      drawing.columns = [];
      drawing.walls = [];
      drawing.beams = [];
    });
    syncGridForm();
    pending = null;
    flash('全部消しました（「戻す」で元に戻せます）');
  },
  exportDxf() {
    void exportDxf();
  },
  openFile() {
    setMenu(false);
    openInput.click();
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
const clearTitle = clearBtn.querySelector('.menu-title') as HTMLElement;
let clearArmed = false;
let clearTimer = 0;
function disarmClear() {
  clearArmed = false;
  clearTimeout(clearTimer);
  clearTitle.textContent = '全消去';
  clearBtn.classList.remove('danger');
}

type DownloadsApi = { save(req: { filename: string; data: Blob | Uint8Array | string }): Promise<unknown> };
type ClaudeHost = { use(name: string): Promise<unknown> };

async function exportDxf() {
  const name = `drawing-${timestamp()}`;
  const bytes = toDxfBytes(drawing);
  const host = (window as unknown as { claude?: ClaudeHost }).claude;

  if (host?.use) {
    // claude.ai の公開ページ: .dxf は直接保存できないので zip に包む
    const downloads = (await host.use('downloads')) as DownloadsApi | null;
    if (!downloads) {
      flash('この画面では保存できません。PCのブラウザで開いてください');
      return;
    }
    const zip = zipStore([{ name: `${name}.dxf`, data: bytes }]);
    try {
      await downloads.save({ filename: `${name}.zip`, data: zip });
      flash('保存しました（zipを展開するとDXF。「開く」ならzipのままで続きを編集できます）');
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code !== 'declined') flash('保存できませんでした。少し待ってからもう一度試してください');
    }
    return;
  }

  // 通常のブラウザ（npm run dev など）
  const blob = new Blob([bytes], { type: 'application/dxf' });
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

// ---------- 開く（このアプリで保存した DXF） ----------

const openInput = document.getElementById('open-file') as HTMLInputElement;

openInput.addEventListener('change', async () => {
  const file = openInput.files?.[0];
  openInput.value = '';
  if (!file) return;
  try {
    let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
    let name = file.name;
    if (isZip(bytes)) {
      const inner = unzipFirst(bytes);
      if (!inner) {
        flash('この zip は読めませんでした。展開してから中の DXF を選んでください');
        return;
      }
      bytes = inner.data;
      name = inner.name;
    }
    const opened = /\.json$/i.test(name) ? drawingFromJson(new TextDecoder().decode(bytes)) : extractEmbedded(decodeDxf(bytes).text);
    if (!opened) {
      flash('部材データが入っていないファイルです。設計図などは「下敷き」から読み込んでください');
      return;
    }
    history.push(structuredClone(drawing));
    drawing = opened;
    isSample = false;
    replaceDrawing();
    flash(`${name} を開きました（「戻す」で前の図面に戻せます）`);
  } catch {
    flash('ファイルを読めませんでした');
  }
});

/** drawing を丸ごと差し替えたあとに、パネルと表示を合わせる */
function replaceDrawing() {
  if (!drawing.columnTypes.some((t) => t.id === currentTypeId)) currentTypeId = drawing.columnTypes[0].id;
  if (!wallPanel.sheet.hidden) wallPanel.render();
  if (!beamPanel.sheet.hidden) beamPanel.render();
  if (!colSheet.hidden) renderColumnTypes();
  syncGridForm();
  pending = null;
  saveDrawing();
  fitView();
  requestRender();
}

function timestamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

// ---------- 下のバー: 道具パレット ----------

const toolsBtn = document.getElementById('btn-tools') as HTMLButtonElement;
const paletteEl = document.getElementById('palette') as HTMLElement;
const toolsCurrent = document.getElementById('tools-current') as HTMLElement;
const orthoBtn = document.getElementById('btn-ortho') as HTMLButtonElement;
const endBtn = document.getElementById('btn-end') as HTMLButtonElement;

const MODE_LABEL: Record<Mode, string> = {
  line: '線',
  column: '柱',
  wall: '壁',
  beam: '梁',
  opening: '開口',
  align: '位置合わせ',
  measure: '測る',
  erase: '消す',
  offset: 'オフセット',
};

function setPalette(open: boolean) {
  paletteEl.hidden = !open;
  toolsBtn.setAttribute('aria-expanded', String(open));
}

toolsBtn.addEventListener('click', () => {
  const open = paletteEl.hidden;
  if (open) {
    showSheet(null);
    setMenu(false);
  }
  setPalette(open);
});

document.addEventListener('pointerdown', (e) => {
  if (paletteEl.hidden) return;
  const t = e.target as Node;
  if (!paletteEl.contains(t) && !toolsBtn.contains(t)) setPalette(false);
});

/** 下のバーを今の状態に合わせる（道具の名前、直交は線のときだけ、「やめる」は操作中だけ） */
function updateToolbar() {
  toolsCurrent.textContent = MODE_LABEL[mode];
  orthoBtn.hidden = mode !== 'line';
  endBtn.hidden = !(pending || mode !== 'line');
  endBtn.textContent = mode === 'line' ? '線を終える' : 'やめる';
}

// ---------- 左上のメニュー ----------

const menuBtn = document.getElementById('btn-menu') as HTMLButtonElement;
const menuEl = document.getElementById('menu') as HTMLElement;

function setMenu(open: boolean) {
  menuEl.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
  if (!open) disarmClear();
}

const offsetDimsCheck = document.getElementById('menu-offset-dims') as HTMLInputElement;
offsetDimsCheck.addEventListener('change', () => {
  commit(() => {
    drawing.showOffsetDims = offsetDimsCheck.checked;
  });
  flash(offsetDimsCheck.checked ? '寄り寸法を表示します' : '寄り寸法を隠しました');
});

menuBtn.addEventListener('click', () => {
  const open = menuEl.hidden;
  if (open) setPalette(false);
  offsetDimsCheck.checked = drawing.showOffsetDims;
  if (open) showSheet(null);
  setMenu(open);
});

// メニューの外を触ったら閉じる
document.addEventListener('pointerdown', (e) => {
  if (menuEl.hidden) return;
  const t = e.target as Node;
  if (!menuEl.contains(t) && !menuBtn.contains(t)) setMenu(false);
});

document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action!;
    actions[action]?.();
    // 全消去の1回目（確認待ち）はメニューを開いたままにする
    if (menuEl.contains(btn) && !(action === 'clear' && clearArmed)) setMenu(false);
    if (paletteEl.contains(btn)) setPalette(false);
  });
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
  if (e.key === 'Escape' && !menuEl.hidden) {
    setMenu(false);
    return;
  }
  if (e.key === 'Escape' && !paletteEl.hidden) {
    setPalette(false);
    return;
  }
  if (e.key === 'Escape' && document.querySelector('.sheet:not([hidden])')) {
    showSheet(null);
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

/** 「下敷きから拾う」で決めた通り芯の原点（描くまで保留） */
let detectedOrigin: Vec2 | null = null;

function syncGridForm() {
  detectedOrigin = null;
  gridDetectMsg.hidden = true;
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
      origin: detectedOrigin ?? drawing.grid?.origin ?? { x: 0, y: 0 },
    };
    // 通り芯が減ったら、無くなった交点の柱も消す
    drawing.columns = drawing.columns.filter((c) => c.xi <= xs.length && c.yi <= ys.length);
    drawing.walls = wallsInRange(drawing.walls, xs.length + 1, ys.length + 1);
    drawing.beams = wallsInRange(drawing.beams, xs.length + 1, ys.length + 1);
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
    drawing.walls = [];
    drawing.beams = [];
  });
  showSheet(null);
  flash('通り芯を消しました（「戻す」で元に戻せます）');
});

document.getElementById('grid-close')!.addEventListener('click', () => showSheet(null));

// ---------- シート（下から出るパネル） ----------

function showSheet(target: HTMLElement | null) {
  for (const el of [sheet, colSheet, ulSheet, offSheet, wallPanel.sheet, beamPanel.sheet, opSheet]) el.hidden = el !== target;
  requestRender();
}

function setMode(next: Mode) {
  mode = next;
  measureA = null;
  measureB = null;
  flashMsg = ''; // 前の操作のメッセージで、次の操作の案内が隠れないように
  pending = null;
  alignFrom = null;
  document.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === next));
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
    if (extractEmbedded(decodeDxf(new Uint8Array(await file.arrayBuffer())).text)) {
      notes.push('このファイルはこのアプリで保存した図面です。続きを編集するならメニューの「開く」から開いてください');
    }
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

// ---------- 下敷きから通り芯を拾う ----------

const gridDetectMsg = document.getElementById('grid-detect-msg') as HTMLElement;

document.getElementById('grid-detect')!.addEventListener('click', () => {
  gridMsg.textContent = '';
  if (!underlay) {
    gridMsg.textContent = '先にメニューの「下敷き」で設計図のDXFを読み込んでください';
    return;
  }
  const g = detectGrid(underlay.prims);
  if (!g) {
    gridMsg.textContent = '下敷きから通り芯が見つかりませんでした。スパンを手で入力してください';
    return;
  }
  gridX.value = toSpans(g.xs).join(', ');
  gridY.value = toSpans(g.ys).join(', ');
  detectedOrigin = { x: g.xs[0] + underlay.dx, y: g.ys[0] + underlay.dy };
  updateGridSummary();
  gridDetectMsg.hidden = false;
  gridDetectMsg.textContent = g.byLayer
    ? `通り芯の画層から X ${g.xs.length}本・Y ${g.ys.length}本 を拾いました。位置も下敷きに合わせます。確認して「描く」を押してください。`
    : `通り芯の画層が見つからなかったので、長い縦線・横線から X ${g.xs.length}本・Y ${g.ys.length}本 を推定しました。外壁などが混ざっていないか確認してください。`;
});

// ---------- オフセット ----------

const offSheet = document.getElementById('off-sheet') as HTMLElement;
const offInput = document.getElementById('off-dist') as HTMLInputElement;
const offMsg = document.getElementById('off-msg') as HTMLElement;

document.getElementById('off-form')!.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = Number(offInput.value.normalize('NFKC').trim());
  if (!(v > 0)) {
    offMsg.textContent = '距離は 0 より大きい数字で入力してください';
    return;
  }
  offsetDist = v;
  setMode('offset');
  showSheet(null);
});
document.getElementById('off-close')!.addEventListener('click', () => showSheet(null));

/** オフセットの元にできる線: 自分の線・通り芯・柱の辺・下敷きの線（寸法線は除く） */
function offsetSources(): Segment[] {
  const segs: Segment[] = [];
  for (const p of decompose(drawing)) if (p.t === 'line' && p.layer !== LAYER_DIM && p.layer !== LAYER_DIM_OFFSET) segs.push({ a: p.a, b: p.b });
  if (underlay?.visible) for (const s of underlaySegments(underlay)) segs.push(s);
  return segs;
}

function offsetTap(screen: Vec2, type: string) {
  const w = view.toWorld(screen);
  const hit = nearestSegment(w, offsetSources(), snapRadiusPx(type) / view.scale);
  if (!hit) {
    flash('線の近くをタップしてください（長押しすると狙いやすいです）');
    return;
  }
  // 長押しはカーソルが線の上に乗るので、どちら側かは指の位置（カーソルより下）で決める
  const side = type === 'press' ? view.toWorld({ x: screen.x, y: screen.y + PRESS_OFFSET }) : w;
  const s = offsetSegment(hit.seg, offsetDist, side);
  commit(() => {
    drawing.entities.push({ id: newId(), kind: 'line', layer: '0', a: s.a, b: s.b });
  });
  flash(`${formatDim(offsetDist)} オフセットしました`);
}

// ---------- 測る ----------

function measureTap(screen: Vec2, type: string) {
  updateCursor(screen, type);
  if (!cursor) return;
  if (!measureA || measureB) {
    measureA = { ...cursor.point };
    measureB = null;
  } else {
    measureB = { ...cursor.point };
  }
  requestRender();
}

// ---------- 消す ----------

function eraseTap(screen: Vec2, type: string) {
  const w = view.toWorld(screen);
  const r = snapRadiusPx(type) / view.scale;
  const col = drawing.columns.find((c) => {
    const rc = columnRect(drawing, c);
    return rc && w.x >= rc.min.x && w.x <= rc.max.x && w.y >= rc.min.y && w.y <= rc.max.y;
  });
  const lines = drawing.entities.filter((e) => e.kind === 'line');
  const hit = nearestSegment(w, lines, r);
  if (hit) {
    const target = lines[hit.index];
    commit(() => {
      drawing.entities = drawing.entities.filter((e) => e.id !== target.id);
    });
    flash('線を消しました（「戻す」で元に戻せます）');
    return;
  }
  const op = openingAt(w, 0);
  if (op) {
    commit(() => {
      drawing.openings = drawing.openings.filter((x) => x.id !== op.id);
    });
    flash('開口を消しました（「戻す」で元に戻せます）');
    return;
  }
  const wall = wallPanel.hit(w) as Wall | undefined;
  const beam = beamPanel.hit(w) as Beam | undefined;
  if (col) {
    const name = intersectionName(drawing, col.xi, col.yi);
    commit(() => {
      drawing.columns = drawing.columns.filter((c) => c.id !== col.id);
    });
    flash(`${name} の柱を消しました（「戻す」で元に戻せます）`);
    return;
  }
  if (wall) {
    const name = wallName(drawing, wall);
    commit(() => {
      drawing.walls = drawing.walls.filter((x) => x.id !== wall.id);
    });
    flash(`${name} の壁を消しました（「戻す」で元に戻せます）`);
    return;
  }
  if (beam) {
    const name = spanName(drawing, beam);
    commit(() => {
      drawing.beams = drawing.beams.filter((x) => x.id !== beam.id);
    });
    flash(`${name} の梁を消しました（「戻す」で元に戻せます）`);
    return;
  }
  flash('ここには消せるものがありません（下敷き・通り芯は消えません）');
}

// ---------- 壁・梁（共通のパネル） ----------

type LinearMember = Wall | Beam;
type MemberType = { id: string; mark: string } & Record<string, unknown>;

type MemberCfg = {
  /** DOM の id の頭（wall-sheet, wall-types…） */
  prefix: 'wall' | 'beam';
  mode: Mode;
  name: string;
  unit: string;
  /** 符号の数値の項目（壁: 厚さ、梁: 幅とせい） */
  fields: { key: string; label: string; before?: string }[];
  types(): MemberType[];
  setTypes(list: MemberType[]): void;
  list(): LinearMember[];
  setList(list: LinearMember[]): void;
  rect(m: LinearMember): Rect | null;
  describe(t: MemberType): string;
  newType(types: MemberType[]): MemberType;
};

function createMemberPanel(cfg: MemberCfg) {
  const $ = <T extends HTMLElement>(suffix: string) => document.getElementById(`${cfg.prefix}-${suffix}`) as T;
  const sheetEl = $<HTMLElement>('sheet');
  const title = $<HTMLElement>('title');
  const typesEl = $<HTMLElement>('types');
  const offsetIn = $<HTMLInputElement>('offset');
  const msg = $<HTMLElement>('msg');
  const ok = $<HTMLButtonElement>('ok');
  const del = $<HTMLButtonElement>('delete');

  let currentTypeId = cfg.types()[0]?.id ?? '';
  let editId: string | null = null;
  let placeOffset = '';

  const editing = () => (editId ? cfg.list().find((m) => m.id === editId) : undefined);
  const typeOf = (id: string) => cfg.types().find((t) => t.id === id);

  function open(id: string | null) {
    editId = id;
    const m = editing();
    msg.textContent = '';
    if (m) {
      title.textContent = `${cfg.name}（${spanName(drawing, m)}）`;
      offsetIn.value = m.offset === null ? '' : String(m.offset);
      ok.textContent = '変更を反映';
      del.hidden = false;
    } else {
      title.textContent = cfg.name;
      offsetIn.value = placeOffset;
      ok.textContent = '通り芯の区間をタップして配置';
      del.hidden = true;
    }
    render();
    showSheet(sheetEl);
  }

  function render() {
    if (!cfg.types().some((t) => t.id === currentTypeId)) currentTypeId = cfg.types()[0]?.id ?? '';
    const m = editing();
    const selectedId = m ? m.typeId : currentTypeId;
    typesEl.replaceChildren();
    for (const t of cfg.types()) {
      const count = cfg.list().filter((x) => x.typeId === t.id).length;
      const row = document.createElement('div');
      row.className = 'type-row' + (t.id === selectedId ? ' selected' : '');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `${cfg.prefix}type`;
      radio.id = `${cfg.prefix}type-${t.id}`;
      radio.checked = t.id === selectedId;
      radio.setAttribute('aria-label', `${t.mark} を使う`);
      radio.addEventListener('change', () => select(t.id));
      const mark = textInput(`${cfg.prefix}mark-${t.id}`, t.mark, 'mark', '符号');
      const inputs = cfg.fields.map((f) => {
        const el = textInput(`${cfg.prefix}${f.key}-${t.id}`, String(t[f.key]), 'size', f.label);
        el.inputMode = 'numeric';
        return el;
      });
      const parts: HTMLElement[] = [radio, mark];
      cfg.fields.forEach((f, i) => {
        if (f.before) {
          const sep = document.createElement('span');
          sep.className = 'times';
          sep.textContent = f.before;
          parts.push(sep);
        }
        parts.push(inputs[i]);
      });
      const cnt = document.createElement('span');
      cnt.className = 'count';
      cnt.textContent = `${count}${cfg.unit}`;
      const apply = () => update(t.id, mark.value, inputs.map((x) => x.value));
      for (const el of [mark, ...inputs]) {
        el.addEventListener('change', apply);
        el.addEventListener('focus', () => select(t.id, false));
      }
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = '削除';
      delBtn.setAttribute('aria-label', `${t.mark} を削除`);
      delBtn.addEventListener('click', () => removeType(t.id));
      row.append(...parts, cnt, delBtn);
      typesEl.append(row);
    }
  }

  function select(id: string, rerender = true) {
    const m = editing();
    if (m) {
      if (m.typeId !== id)
        commit(() => {
          m.typeId = id;
        });
    } else currentTypeId = id;
    if (rerender) render();
    else
      typesEl.querySelectorAll('.type-row').forEach((row, i) => {
        const on = cfg.types()[i]?.id === id;
        row.classList.toggle('selected', on);
        (row.querySelector('input[type="radio"]') as HTMLInputElement).checked = on;
      });
    requestRender();
  }

  function update(id: string, markText: string, values: string[]) {
    const mark = markText.normalize('NFKC').trim();
    const nums = values.map((v) => Number(v.normalize('NFKC')));
    if (!mark) {
      msg.textContent = '符号を入力してください';
      render();
      return;
    }
    if (cfg.types().some((x) => x.id !== id && x.mark === mark)) {
      msg.textContent = `符号 ${mark} はもう使われています`;
      render();
      return;
    }
    if (nums.some((n) => !(n > 0))) {
      msg.textContent = '大きさは 0 より大きい数字で入力してください';
      render();
      return;
    }
    msg.textContent = '';
    const t = typeOf(id);
    if (!t || (t.mark === mark && cfg.fields.every((f, i) => t[f.key] === nums[i]))) return;
    commit(() => {
      t.mark = mark;
      cfg.fields.forEach((f, i) => (t[f.key] = nums[i]));
    });
    const count = cfg.list().filter((x) => x.typeId === id).length;
    if (count) flash(`${cfg.describe(t)} に変更しました（${count}${cfg.unit}）`);
    render();
  }

  function removeType(id: string) {
    const t = typeOf(id);
    if (!t) return;
    if (cfg.list().some((x) => x.typeId === id)) {
      msg.textContent = `${t.mark} は図面で使われているので削除できません。先にその${cfg.name}を消してください`;
      return;
    }
    if (cfg.types().length === 1) {
      msg.textContent = '符号は最低1つ必要です';
      return;
    }
    commit(() => cfg.setTypes(cfg.types().filter((x) => x.id !== id)));
    msg.textContent = '';
    render();
  }

  $<HTMLButtonElement>('type-add').addEventListener('click', () => {
    const t = cfg.newType(cfg.types());
    commit(() => cfg.setTypes([...cfg.types(), t]));
    select(t.id);
  });

  $<HTMLFormElement>('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const off = parseOffset(offsetIn.value);
    if (off === undefined) {
      msg.textContent = '寄りは数字で入力してください（空欄なら振り分け）';
      return;
    }
    const m = editing();
    if (m) {
      if (m.offset !== off)
        commit(() => {
          m.offset = off;
        });
      flash(`${spanName(drawing, m)} の${cfg.name}を変更しました`);
    } else {
      placeOffset = offsetIn.value;
      setMode(cfg.mode);
    }
    showSheet(null);
  });

  del.addEventListener('click', () => {
    const m = editing();
    if (!m) return;
    const name = spanName(drawing, m);
    commit(() => cfg.setList(cfg.list().filter((x) => x.id !== m.id)));
    showSheet(null);
    flash(`${name} の${cfg.name}を削除しました（「戻す」で元に戻せます）`);
  });

  $<HTMLButtonElement>('close').addEventListener('click', () => showSheet(null));

  function hit(w: Vec2): LinearMember | undefined {
    return cfg.list().find((x) => {
      const rc = cfg.rect(x);
      return rc && w.x >= rc.min.x && w.x <= rc.max.x && w.y >= rc.min.y && w.y <= rc.max.y;
    });
  }

  function tap(screen: Vec2, type: string) {
    if (!drawing.grid) {
      flash(`${cfg.name}を置くには、先に「通り芯」を描いてください`);
      return;
    }
    const w = view.toWorld(screen);
    const r = snapRadiusPx(type) / view.scale;
    const spans = gridSpans(drawing);
    const h = nearestSegment(w, spans, Math.max(r, 400));
    if (!h) {
      const inside = hit(w);
      if (inside) open(inside.id);
      else flash('通り芯の区間（交点と交点の間）をタップしてください');
      return;
    }
    const span = spans[h.index];
    const existing = cfg.list().find((x) => x.axis === span.axis && x.line === span.line && x.from === span.from);
    if (existing) {
      open(existing.id);
      return;
    }
    const t = typeOf(currentTypeId)!;
    const m: LinearMember = {
      id: newId(),
      typeId: t.id,
      axis: span.axis,
      line: span.line,
      from: span.from,
      to: span.to,
      offset: parseOffset(placeOffset) ?? null,
    };
    commit(() => cfg.setList([...cfg.list(), m]));
    flash(`${t.mark} を ${spanName(drawing, m)} に配置しました`);
  }

  return {
    sheet: sheetEl,
    open,
    render,
    tap,
    hit,
    get currentType() {
      return typeOf(currentTypeId);
    },
  };
}

const wallPanel = createMemberPanel({
  prefix: 'wall',
  mode: 'wall',
  name: '壁',
  unit: '枚',
  fields: [{ key: 't', label: '厚さ', before: '厚' }],
  types: () => drawing.wallTypes as unknown as MemberType[],
  setTypes: (list) => (drawing.wallTypes = list as unknown as WallType[]),
  list: () => drawing.walls,
  setList: (list) => (drawing.walls = list as Wall[]),
  rect: (m) => wallRect(drawing, m as Wall),
  describe: (t) => `${t.mark}（厚さ${t.t}）`,
  newType: (types) => ({ id: newId(), mark: nextWallMark(types as unknown as WallType[], 250), t: 250 }),
});

const beamPanel = createMemberPanel({
  prefix: 'beam',
  mode: 'beam',
  name: '梁',
  unit: '本',
  fields: [
    { key: 'b', label: '幅' },
    { key: 'd', label: 'せい', before: '×' },
  ],
  types: () => drawing.beamTypes as unknown as MemberType[],
  setTypes: (list) => (drawing.beamTypes = list as unknown as BeamType[]),
  list: () => drawing.beams,
  setList: (list) => (drawing.beams = list as Beam[]),
  rect: (m) => beamRect(drawing, m as Beam),
  describe: (t) => `${t.mark}（${t.b}×${t.d}）`,
  newType: (types) => ({ id: newId(), mark: nextBeamMark(types as unknown as BeamType[]), b: 400, d: 800 }),
});

// ---------- 開口 ----------

const opSheet = document.getElementById('op-sheet') as HTMLElement;
const opTitle = document.getElementById('op-title') as HTMLElement;
const opWidth = document.getElementById('op-width') as HTMLInputElement;
const opStartRow = document.getElementById('op-start-row') as HTMLElement;
const opStartLabel = document.getElementById('op-start-label') as HTMLElement;
const opStart = document.getElementById('op-start') as HTMLInputElement;
const opMsg = document.getElementById('op-msg') as HTMLElement;
const opOk = document.getElementById('op-ok') as HTMLButtonElement;
const opDelete = document.getElementById('op-delete') as HTMLButtonElement;

let opEditId: string | null = null;
let opDefaultWidth = 900;

function openOpeningSheet(id: string | null) {
  opEditId = id;
  opMsg.textContent = '';
  const o = id ? drawing.openings.find((x) => x.id === id) : undefined;
  const wall = o ? drawing.walls.find((w) => w.id === o.wallId) : undefined;
  if (o && wall && drawing.grid) {
    const g = drawing.grid;
    const startName = wall.axis === 'y' ? `${g.xPrefix}${wall.from + 1}` : `${g.yPrefix}${wall.from + 1}`;
    opTitle.textContent = `開口（${spanName(drawing, wall)}）`;
    opWidth.value = String(o.width);
    opStart.value = String(o.start);
    opStartLabel.textContent = `${startName} から開口の端まで`;
    opStartRow.hidden = false;
    opOk.textContent = '変更を反映';
    opDelete.hidden = false;
  } else {
    opTitle.textContent = '開口';
    opWidth.value = String(opDefaultWidth);
    opStartRow.hidden = true;
    opOk.textContent = '壁をタップして配置';
    opDelete.hidden = true;
  }
  showSheet(opSheet);
}

document.getElementById('op-form')!.addEventListener('submit', (e) => {
  e.preventDefault();
  const width = Number(opWidth.value.normalize('NFKC').trim());
  if (!(width > 0)) {
    opMsg.textContent = '幅は 0 より大きい数字で入力してください';
    return;
  }
  const o = opEditId ? drawing.openings.find((x) => x.id === opEditId) : undefined;
  if (o) {
    const start = Number(opStart.value.normalize('NFKC').trim());
    if (!Number.isFinite(start)) {
      opMsg.textContent = '位置は数字で入力してください';
      return;
    }
    commit(() => {
      o.width = width;
      o.start = start;
    });
    flash(`開口を 幅${formatDim(width)} に変更しました`);
  } else {
    opDefaultWidth = width;
    setMode('opening');
  }
  showSheet(null);
});

opDelete.addEventListener('click', () => {
  if (!opEditId) return;
  const id = opEditId;
  commit(() => {
    drawing.openings = drawing.openings.filter((x) => x.id !== id);
  });
  showSheet(null);
  flash('開口を削除しました（「戻す」で元に戻せます）');
});

document.getElementById('op-close')!.addEventListener('click', () => showSheet(null));

/** タップした点にある開口（壁の厚みの範囲内、長さ方向は開口の範囲内） */
function openingAt(w: Vec2, r: number) {
  return drawing.openings.find((o) => {
    const range = openingRange(drawing, o);
    if (!range) return false;
    const rc = wallRect(drawing, range.wall);
    if (!rc) return false;
    return range.wall.axis === 'y'
      ? w.x >= range.s0 - r && w.x <= range.s1 + r && w.y >= rc.min.y - r && w.y <= rc.max.y + r
      : w.y >= range.s0 - r && w.y <= range.s1 + r && w.x >= rc.min.x - r && w.x <= rc.max.x + r;
  });
}

function openingTap(screen: Vec2, type: string) {
  const w = view.toWorld(screen);
  const r = snapRadiusPx(type) / view.scale;
  const existing = openingAt(w, 0);
  if (existing) {
    openOpeningSheet(existing.id);
    return;
  }
  // 壁の中（少し外側まで）をタップ
  const wall = drawing.walls.find((x) => {
    const rc = wallRect(drawing, x);
    return rc && w.x >= rc.min.x - r && w.x <= rc.max.x + r && w.y >= rc.min.y - r && w.y <= rc.max.y + r;
  });
  if (!wall || !drawing.grid) {
    flash('開口を入れる壁をタップしてください');
    return;
  }
  const { xs, ys } = gridPositions(drawing.grid);
  const along = wall.axis === 'y' ? xs : ys;
  const s0 = along[wall.from];
  const s1 = along[wall.to];
  const width = Math.min(opDefaultWidth, s1 - s0);
  const center = wall.axis === 'y' ? w.x : w.y;
  // タップした所を中心に、区間からはみ出さないように。10mm 単位に丸める
  const start = Math.round(Math.max(0, Math.min(s1 - s0 - width, center - s0 - width / 2)) / 10) * 10;
  commit(() => {
    drawing.openings.push({ id: newId(), wallId: wall.id, start, width });
  });
  flash(`開口 幅${formatDim(width)} を入れました（タップで位置・幅を変更）`);
}

// 開発時だけ、自動テストから状態を見られるようにする（本番ビルドでは消える）
if (import.meta.env.DEV) {
  (window as unknown as { __cad: unknown }).__cad = {
    view,
    redraw: requestRender,
    get underlay() {
      return underlay;
    },
    get drawing() {
      return drawing;
    },
  };
}

new ResizeObserver(resize).observe(canvas);
