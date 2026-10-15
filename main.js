// packages is loaded from packages.js (set before this script runs)
let packages = typeof PACKAGES !== 'undefined' ? PACKAGES : [];

const canvas = document.getElementById('grid');
const ctx = canvas.getContext('2d');

const SQRT3 = Math.sqrt(3);

// Hex size (center to corner). Adjustable from the settings menu (press M).
const BASE_R = 80;
const GAP = 4;
let R = BASE_R;

// Pointy-top hex spacing
let colW = R * Math.sqrt(3);
let rowH = R * 1.5;

// Settings are mirrored into the URL's query string, which is read back here on
// load. That makes the address bar itself the share link:
//   ?size=150&unique=1&off=air,ark   (or on=a,b,c when that's shorter)
let sizeScale = 1;
let disabled = new Set(); // package names hidden from the grid
let uniqueMode = false; // each sticker once, black everywhere else
{
  const q = new URLSearchParams(location.search);
  const size = Number(q.get('size')) / 100;
  if (size >= 0.4 && size <= 2.5) sizeScale = size;
  uniqueMode = q.get('unique') === '1';
  const list = key => (q.get(key) || '').split(',').filter(Boolean);
  if (q.has('on')) {
    const on = new Set(list('on'));
    disabled = new Set(packages.map(p => p.name).filter(n => !on.has(n)));
  } else {
    disabled = new Set(list('off'));
  }
}

function shareURL() {
  const q = new URLSearchParams();
  if (sizeScale !== 1) q.set('size', Math.round(sizeScale * 100));
  if (uniqueMode) q.set('unique', '1');
  const off = packages.map(p => p.name).filter(n => disabled.has(n));
  const on = packages.map(p => p.name).filter(n => !disabled.has(n));
  if (off.length) {
    // Whichever list is shorter keeps the link manageable.
    if (off.length <= on.length) q.set('off', off.join(','));
    else q.set('on', on.join(','));
  }
  const qs = q.toString();
  // location.origin is "null" on file://, so cut the current URL instead.
  const base = location.href.split(/[?#]/)[0];
  return base + (qs ? `?${qs}` : '');
}

R = BASE_R * sizeScale;
colW = R * Math.sqrt(3);
rowH = R * 1.5;

let sources = []; // decoded <img> elements, kept so bitmaps can be rebuilt at a new size
let images = [];
let enabledIdx = []; // indices into packages that are currently shown
let panX = 0;
let panY = 0;
let dragging = false;
let lastX = 0;
let lastY = 0;

// Momentum
let velX = 0;
let velY = 0;
let rafId = null;

// Hover — hoverCol/Row is the cell under the cursor (or null).
// activeCol/Row is the cell currently being scaled (may linger while animating out).
let hoverCol = null;
let hoverRow = null;
let activeCol = null;
let activeRow = null;
let hoverScale = 1.0;
let hoverAnimRaf = null;

// --- Image loading ---

// Stickers are pre-rasterized to draw size by generate.js, so loading is just
// a decode. Downsampling to the exact bitmap size here still helps: it keeps
// drawImage on a 1:1 blit and shrinks what we hold in memory.
function toBitmap(img) {
  if (!img) return Promise.resolve(null);
  const dpr = window.devicePixelRatio || 1;
  const r = R - GAP;
  return createImageBitmap(img, {
    resizeWidth: Math.round(r * Math.sqrt(3) * dpr),
    resizeHeight: Math.round(r * 2 * dpr),
    resizeQuality: 'high',
  })
    // On file:// the image counts as cross-origin, so it can't be turned
    // into a bitmap. Hand back the element and let drawImage scale it.
    .catch(() => img);
}

async function loadImages() {
  // Load via <img> rather than fetch so the page still works when opened
  // straight off disk — fetch refuses file:// URLs.
  sources = await Promise.all(
    packages.map(pkg => new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = pkg.path;
    }))
  );
  images = await Promise.all(sources.map(toBitmap));
}

// Re-rasterize for the current size. Until it finishes, the old bitmaps are
// drawn scaled, which is fine for a moment.
let rebuildToken = 0;
async function rebuildBitmaps() {
  const token = ++rebuildToken;
  const next = await Promise.all(sources.map(toBitmap));
  if (token !== rebuildToken) return;
  images = next;
  render();
}

// --- Deterministic image assignment ---

// Unique mode: pack the enabled stickers into a round cluster around cell
// (0, 0), in a fixed shuffled order. Cells outside it stay empty.
let uniqueLayout = new Map(); // "col,row" -> index into packages

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildUniqueLayout() {
  uniqueLayout = new Map();
  const n = enabledIdx.length;
  if (n === 0) return;
  const radius = Math.ceil(Math.sqrt(n)) + 2;
  const cells = [];
  for (let row = -radius; row <= radius; row++) {
    for (let col = -radius; col <= radius; col++) {
      const x = (col + (row % 2 !== 0 ? 0.5 : 0)) * SQRT3;
      const y = row * 1.5;
      cells.push({ col, row, d: Math.hypot(x, y) });
    }
  }
  cells.sort((a, b) => a.d - b.d || a.row - b.row || a.col - b.col);

  const order = [...enabledIdx];
  const rand = mulberry32(12345);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  order.forEach((pkgIdx, i) => uniqueLayout.set(`${cells[i].col},${cells[i].row}`, pkgIdx));
}

// Put the middle of the unique cluster in the middle of the screen.
function centerView() {
  panX = window.innerWidth / 2;
  panY = window.innerHeight / 2;
}

function updateEnabled() {
  enabledIdx = packages.map((_, i) => i).filter(i => !disabled.has(packages[i].name));
  buildUniqueLayout();
}
updateEnabled();
if (uniqueMode) centerView();

// Returns an index into packages, or -1 for an empty cell.
function imageIndexForCell(col, row) {
  if (uniqueMode) return uniqueLayout.get(`${col},${row}`) ?? -1;
  if (enabledIdx.length === 0) return -1;
  return enabledIdx[Math.abs((col * 73856093) ^ (row * 19349663)) % enabledIdx.length];
}

function imageForCell(col, row) {
  return images[imageIndexForCell(col, row)];
}

// --- Hex geometry ---

function hexCenter(col, row) {
  const x = panX + col * colW + (row % 2 !== 0 ? colW / 2 : 0);
  const y = panY + row * rowH;
  return { x, y };
}

function hexPath(cx, cy) {
  const r = R - GAP;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i - 30); // pointy-top
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// --- Hover hit test ---

function cellAtPoint(mx, my) {
  const row = Math.round((my - panY) / rowH);
  let best = null, bestDist = Infinity;
  for (let r = row - 1; r <= row + 1; r++) {
    const offset = r % 2 !== 0 ? colW / 2 : 0;
    const col = Math.round((mx - panX - offset) / colW);
    for (let c = col - 1; c <= col + 1; c++) {
      const { x, y } = hexCenter(c, r);
      const dist = Math.hypot(mx - x, my - y);
      if (dist < bestDist) { bestDist = dist; best = { col: c, row: r }; }
    }
  }
  return bestDist < R ? best : null;
}

// --- Drawing ---

function drawHex(cx, cy, img, scale) {
  if (!img) return; // sticker failed to load; leave the cell empty
  const r = R - GAP;
  ctx.save();
  if (scale !== 1.0) {
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
  }
  hexPath(cx, cy);
  ctx.clip();
  // Match the pointy-top hex aspect ratio (width = r√3, height = 2r)
  const hw = r * SQRT3 / 2;
  ctx.drawImage(img, cx - hw, cy - r, hw * 2, r * 2);
  ctx.restore();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (images.length === 0 || enabledIdx.length === 0) return;

  // Visible range with 2-cell buffer
  const minCol = Math.floor(-panX / colW) - 2;
  const maxCol = Math.ceil((-panX + canvas.width) / colW) + 2;
  const minRow = Math.floor(-panY / rowH) - 2;
  const maxRow = Math.ceil((-panY + canvas.height) / rowH) + 2;

  // Draw all non-active hexes first, then active on top
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      if (col === activeCol && row === activeRow) continue;
      const { x, y } = hexCenter(col, row);
      drawHex(x, y, imageForCell(col, row), 1.0);
    }
  }
  if (activeCol !== null) {
    const { x, y } = hexCenter(activeCol, activeRow);
    drawHex(x, y, imageForCell(activeCol, activeRow), hoverScale);
  }
}

// --- Hover animation ---

function tickHoverAnim() {
  const target = (hoverCol !== null) ? 1.1 : 1.0;
  hoverScale += (target - hoverScale) * 0.1;
  render();
  if (Math.abs(hoverScale - target) > 0.001) {
    hoverAnimRaf = requestAnimationFrame(tickHoverAnim);
  } else {
    hoverScale = target;
    if (target === 1.0) activeCol = activeRow = null;
    render();
  }
}

function startHoverAnim() {
  cancelAnimationFrame(hoverAnimRaf);
  hoverAnimRaf = requestAnimationFrame(tickHoverAnim);
}

// --- Momentum animation ---

function animateMomentum() {
  velX *= 0.95;
  velY *= 0.95;
  panX += velX;
  panY += velY;
  render();
  if (Math.abs(velX) > 0.2 || Math.abs(velY) > 0.2) {
    rafId = requestAnimationFrame(animateMomentum);
  }
}

// --- Scroll ---

let wheelRafPending = false;

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  cancelAnimationFrame(rafId);
  panX -= e.deltaX * 0.5;
  panY -= e.deltaY * 0.5;
  if (!wheelRafPending) {
    wheelRafPending = true;
    requestAnimationFrame(() => {
      wheelRafPending = false;
      render();
    });
  }
}, { passive: false });

// --- Interaction ---

let dragDist = 0;

canvas.addEventListener('pointerdown', e => {
  dragging = true;
  dragDist = 0;
  lastX = e.clientX;
  lastY = e.clientY;
  velX = 0;
  velY = 0;
  cancelAnimationFrame(rafId);
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('mousemove', e => {
  const cell = cellAtPoint(e.clientX, e.clientY);
  const filled = cell && imageIndexForCell(cell.col, cell.row) >= 0;
  const col = filled ? cell.col : null;
  const row = filled ? cell.row : null;
  if (col !== hoverCol || row !== hoverRow) {
    hoverCol = col;
    hoverRow = row;
    if (col !== null) { activeCol = col; activeRow = row; }
    canvas.style.cursor = col !== null ? 'pointer' : 'grab';
    startHoverAnim();
  }
});

canvas.addEventListener('mouseleave', () => {
  hoverCol = null;
  hoverRow = null;
  startHoverAnim();
});

canvas.addEventListener('pointermove', e => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  velX = dx;
  velY = dy;
  dragDist += Math.hypot(dx, dy);
  panX += dx;
  panY += dy;
  lastX = e.clientX;
  lastY = e.clientY;
  render();
});

canvas.addEventListener('pointerup', e => {
  dragging = false;
  rafId = requestAnimationFrame(animateMomentum);
  // Treat as click only if pointer barely moved
  if (dragDist < 6) {
    const cell = cellAtPoint(e.clientX, e.clientY);
    const idx = cell ? imageIndexForCell(cell.col, cell.row) : -1;
    if (idx >= 0) openPanel(packages[idx].url);
  }
});

canvas.addEventListener('pointercancel', () => {
  dragging = false;
});

// --- Resize ---

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // reset and scale atomically
  render();
}

window.addEventListener('resize', resize);

// --- Init ---

const loadingEl = document.getElementById('loading');

loadImages().then(() => {
  resize();
  loadingEl.classList.add('hidden');
  loadingEl.addEventListener('transitionend', () => loadingEl.remove(), { once: true });
});

// --- Panel ---

const panel = document.getElementById('panel');
const panelFrame = document.getElementById('panel-frame');
const panelClose = document.getElementById('panel-close');
const panelExternal = document.getElementById('panel-external');

function openPanel(url) {
  panelFrame.src = url;
  panelExternal.href = url;
  panel.classList.add('open');
}

function closePanel() {
  panel.classList.remove('open');
  panelFrame.src = '';
}

panelClose.addEventListener('click', closePanel);

// Debounced: Safari rate-limits history updates and the slider fires constantly.
let syncTimer = null;
function syncURL() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    try { history.replaceState(null, '', shareURL()); } catch {}
  }, 200);
}

// --- Settings menu (toggled with M; deliberately not advertised in the UI) ---

const menu = document.getElementById('menu');
const sizeSlider = document.getElementById('menu-size');
const sizeValue = document.getElementById('menu-size-value');
const menuSearch = document.getElementById('menu-search');
const menuList = document.getElementById('menu-list');
const menuCount = document.getElementById('menu-count');

function toggleMenu(open = !menu.classList.contains('open')) {
  menu.classList.toggle('open', open);
  if (!open && document.activeElement && menu.contains(document.activeElement)) {
    document.activeElement.blur();
  }
}

function applyFilter() {
  const q = menuSearch.value.trim().toLowerCase();
  for (const li of menuList.children) {
    li.hidden = q !== '' && !li.dataset.name.toLowerCase().includes(q);
  }
}

function updateCount() {
  menuCount.textContent = `${enabledIdx.length} of ${packages.length} shown`;
}

function setSize(scale) {
  const ratio = (BASE_R * scale) / R;
  sizeScale = scale;
  R = BASE_R * scale;
  colW = R * SQRT3;
  rowH = R * 1.5;
  // Zoom about the center of the screen so the view doesn't jump.
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  panX = cx - (cx - panX) * ratio;
  panY = cy - (cy - panY) * ratio;
  cancelAnimationFrame(rafId);
  velX = velY = 0;
  hoverCol = hoverRow = activeCol = activeRow = null;
  hoverScale = 1.0;
  render();
  syncURL();
  clearTimeout(setSize.timer);
  setSize.timer = setTimeout(rebuildBitmaps, 150);
}

function setUniqueMode(on) {
  uniqueMode = on;
  activeCol = activeRow = hoverCol = hoverRow = null;
  cancelAnimationFrame(rafId);
  velX = velY = 0;
  if (on) centerView();
  syncURL();
  render();
}

function setEnabled(names, on) {
  for (const n of names) on ? disabled.delete(n) : disabled.add(n);
  updateEnabled();
  activeCol = activeRow = hoverCol = hoverRow = null;
  updateCount();
  syncURL();
  render();
}

function buildMenuList() {
  const sorted = [...packages].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  for (const pkg of sorted) {
    const li = document.createElement('li');
    li.dataset.name = pkg.name;
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !disabled.has(pkg.name);
    box.addEventListener('change', () => setEnabled([pkg.name], box.checked));
    const img = document.createElement('img');
    img.src = pkg.path;
    img.loading = 'lazy';
    img.alt = '';
    const name = document.createElement('span');
    name.textContent = pkg.name;
    label.append(box, img, name);
    li.append(label);
    menuList.append(li);
  }
  updateCount();
}

function setAllVisible(on) {
  const names = [...menuList.children].filter(li => !li.hidden).map(li => li.dataset.name);
  for (const li of menuList.children) {
    if (!li.hidden) li.querySelector('input').checked = on;
  }
  setEnabled(names, on);
}

const uniqueBox = document.getElementById('menu-unique');
uniqueBox.checked = uniqueMode;
uniqueBox.addEventListener('change', () => setUniqueMode(uniqueBox.checked));

sizeSlider.value = Math.round(sizeScale * 100);
sizeValue.textContent = `${sizeSlider.value}%`;
sizeSlider.addEventListener('input', () => {
  sizeValue.textContent = `${sizeSlider.value}%`;
  setSize(sizeSlider.value / 100);
});
menuSearch.addEventListener('input', applyFilter);
const shareBtn = document.getElementById('menu-share');
shareBtn.addEventListener('click', async () => {
  const url = shareURL();
  let ok = true;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    ok = false;
    window.prompt('Copy this link:', url);
  }
  if (ok) {
    shareBtn.textContent = 'Link copied';
    setTimeout(() => { shareBtn.textContent = 'Copy share link'; }, 1500);
  }
});
document.getElementById('menu-all').addEventListener('click', () => setAllVisible(true));
document.getElementById('menu-none').addEventListener('click', () => setAllVisible(false));
document.getElementById('menu-close').addEventListener('click', () => toggleMenu(false));
buildMenuList();

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closePanel();
    toggleMenu(false);
    return;
  }
  const typing = e.target.matches?.('input[type="search"], input[type="text"], textarea');
  if ((e.key === 'm' || e.key === 'M') && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
    toggleMenu();
  }
});
