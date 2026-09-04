// packages is loaded from packages.js (set before this script runs)
let packages = typeof PACKAGES !== 'undefined' ? PACKAGES : [];

const canvas = document.getElementById('grid');
const ctx = canvas.getContext('2d');

// Hex size (center to corner). Adjust for feel.
const R = 80;
const GAP = 4;

// Pointy-top hex spacing
const colW = R * Math.sqrt(3);
const rowH = R * 1.5;

let images = [];
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
async function loadImages() {
  const dpr = window.devicePixelRatio || 1;
  const r = R - GAP;
  const bmpW = Math.round(r * Math.sqrt(3) * dpr);
  const bmpH = Math.round(r * 2 * dpr);
  // Load via <img> rather than fetch so the page still works when opened
  // straight off disk — fetch refuses file:// URLs.
  images = await Promise.all(
    packages.map(pkg => new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        createImageBitmap(img, {
          resizeWidth: bmpW,
          resizeHeight: bmpH,
          resizeQuality: 'high',
        })
          // On file:// the image counts as cross-origin, so it can't be turned
          // into a bitmap. Hand back the element and let drawImage scale it.
          .then(resolve, () => resolve(img));
      };
      img.onerror = () => resolve(null);
      img.src = pkg.path;
    }))
  );
}

// --- Deterministic image assignment ---

function imageIndexForCell(col, row) {
  return Math.abs((col * 73856093) ^ (row * 19349663)) % packages.length;
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

const SQRT3 = Math.sqrt(3);

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

  if (images.length === 0) return;

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
  const col = cell ? cell.col : null;
  const row = cell ? cell.row : null;
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
    if (cell) {
      const pkg = packages[imageIndexForCell(cell.col, cell.row)];
      openPanel(pkg.url);
    }
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

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closePanel();
});
