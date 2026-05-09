// =====================================================
// IS Plan Viewer — Multi-Select & Bulk Edit
// =====================================================
// Selection modes: Rectangle (Q), Lasso (L), Deselect (Alt+click)
// =====================================================

// ── State ─────────────────────────────────────────────
let _selectedMeasIds = new Set();
let _selectedFitIds = new Set();
let _selectedStackIds = new Set();  // entire stacks
let _enabled = false;
let _panelEl = null;

// Drag state
let _dragStart = null;   // {sx, sy, px, py}
let _dragActive = false;

// Lasso state
let _lassoMode = false;  // true = freehand lasso, false = rectangle
let _lassoPoints = [];   // [{sx,sy,px,py}] screen+pdf coords during drag
let _lassoEl = null;     // SVG overlay element

// Deselect mode
let _deselectMode = false;

// App references
let _getPageMeasurements = null;
let _getPageFittings = null;
let _getPageStacks = null;
let _getCurrentPage = null;
let _scheduleSave = null;
let _drawOverlay = null;
let _updatePanel = null;
let _getProjectSystemSymbols = null;

// ── CSS ───────────────────────────────────────────────
const CSS = `
/* Selection box overlay (rectangle mode) */
.ms-box { position: absolute; border: 1px dashed #ffd43b; background: rgba(255,212,59,0.06); pointer-events: none; z-index: 15; }

/* Lasso SVG overlay */
.ms-lasso-svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 15; overflow: visible; }
.ms-lasso-path { fill: rgba(255,212,59,0.06); stroke: #ffd43b; stroke-width: 1.5; stroke-dasharray: 5 3; }
.ms-lasso-path.deselect { fill: rgba(233,69,96,0.06); stroke: #e94560; }

/* Bulk edit panel */
.ms-panel { display: none; position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); z-index: 60; background: #16213e; border: 1px solid #0f3460; border-radius: 10px; padding: 10px 14px; box-shadow: 0 8px 28px rgba(0,0,0,0.5); min-width: 320px; max-width: 480px; }
.ms-panel.open { display: block; }
.ms-panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.ms-panel-title { font-size: 12px; font-weight: 700; color: #ffd43b; }
.ms-panel-count { font-size: 11px; color: #a0a0c0; }
.ms-panel-close { background: none; border: none; color: #555; cursor: pointer; font-size: 14px; padding: 2px 6px; }
.ms-panel-close:hover { color: #e94560; }
.ms-panel-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: center; }
.ms-panel-grid label { font-size: 11px; color: #a0a0c0; text-align: right; white-space: nowrap; }
.ms-panel-grid select, .ms-panel-grid input { background: #1a1a2e; border: 1px solid #0f3460; color: #e0e0e0; padding: 4px 8px; border-radius: 4px; font-size: 11px; }
.ms-panel-grid select:focus, .ms-panel-grid input:focus { outline: none; border-color: #ffd43b; }
.ms-panel-actions { display: flex; gap: 6px; margin-top: 8px; justify-content: flex-end; }
.ms-apply-btn { background: #ffd43b; color: #1a1a2e; border: none; padding: 5px 14px; border-radius: 5px; font-size: 11px; font-weight: 700; cursor: pointer; }
.ms-apply-btn:hover { background: #ffe066; }
.ms-clear-btn { background: none; border: 1px solid #0f3460; color: #a0a0c0; padding: 5px 12px; border-radius: 5px; font-size: 11px; cursor: pointer; }
.ms-clear-btn:hover { border-color: #e94560; color: #e94560; }

/* Mode indicator */
.ms-mode-badge { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 55; border-radius: 6px; padding: 4px 14px; font-size: 11px; font-weight: 600; pointer-events: none; white-space: nowrap; display: none; }
.ms-mode-badge.show { display: block; }
.ms-mode-badge.select { background: rgba(255,212,59,0.12); border: 1px solid rgba(255,212,59,0.3); color: #ffd43b; }
.ms-mode-badge.lasso { background: rgba(255,212,59,0.12); border: 1px solid rgba(255,212,59,0.3); color: #ffd43b; }
.ms-mode-badge.deselect { background: rgba(233,69,96,0.12); border: 1px solid rgba(233,69,96,0.3); color: #e94560; }
`;

let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
  _cssInjected = true;
}

// ── Core selection ────────────────────────────────────

function getSelectionCount() { return _selectedMeasIds.size + _selectedFitIds.size + _selectedStackIds.size; }

function clearSelection() {
  _selectedMeasIds.clear();
  _selectedFitIds.clear();
  _selectedStackIds.clear();
  _dragStart = null;
  _dragActive = false;
  _lassoPoints = [];
  hidePanel();
  hideBox();
  hideLasso();
  if (_drawOverlay) _drawOverlay();
}

function toggleMeasSelection(id) {
  if (_deselectMode) { _selectedMeasIds.delete(id); }
  else if (_selectedMeasIds.has(id)) { _selectedMeasIds.delete(id); }
  else { _selectedMeasIds.add(id); }
  onSelectionChanged();
}

function toggleFitSelection(id) {
  if (_deselectMode) { _selectedFitIds.delete(id); }
  else if (_selectedFitIds.has(id)) { _selectedFitIds.delete(id); }
  else { _selectedFitIds.add(id); }
  onSelectionChanged();
}

function toggleStackSelection(id) {
  if (_deselectMode) { _selectedStackIds.delete(id); }
  else if (_selectedStackIds.has(id)) { _selectedStackIds.delete(id); }
  else { _selectedStackIds.add(id); }
  onSelectionChanged();
}

function addToSelection(measIds, fitIds, stackIds) {
  for (const id of measIds) _selectedMeasIds.add(id);
  for (const id of fitIds) _selectedFitIds.add(id);
  if (stackIds) for (const id of stackIds) _selectedStackIds.add(id);
  onSelectionChanged();
}

function removeFromSelection(measIds, fitIds, stackIds) {
  for (const id of measIds) _selectedMeasIds.delete(id);
  for (const id of fitIds) _selectedFitIds.delete(id);
  if (stackIds) for (const id of stackIds) _selectedStackIds.delete(id);
  onSelectionChanged();
}

function onSelectionChanged() {
  if (getSelectionCount() > 0) showPanel();
  else hidePanel();
  if (_drawOverlay) _drawOverlay();
}

// ── Rectangle selection ───────────────────────────────

let _boxEl = null;

function showBox(sx, sy, ex, ey) {
  if (!_boxEl) {
    _boxEl = document.createElement('div');
    _boxEl.className = 'ms-box';
    document.getElementById('viewer')?.appendChild(_boxEl);
  }
  _boxEl.style.left = Math.min(sx, ex) + 'px';
  _boxEl.style.top = Math.min(sy, ey) + 'px';
  _boxEl.style.width = Math.abs(ex - sx) + 'px';
  _boxEl.style.height = Math.abs(ey - sy) + 'px';
  _boxEl.style.display = 'block';
  if (_deselectMode) { _boxEl.style.borderColor = '#e94560'; _boxEl.style.background = 'rgba(233,69,96,0.06)'; }
  else { _boxEl.style.borderColor = '#ffd43b'; _boxEl.style.background = 'rgba(255,212,59,0.06)'; }
}

function hideBox() { if (_boxEl) _boxEl.style.display = 'none'; }

function selectItemsInRect(x1, y1, x2, y2) {
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  const page = _getCurrentPage();
  const measHits = [], fitHits = [], stackHits = [];

  for (const m of (_getPageMeasurements(page) || [])) {
    if (!m.points || m.points.length === 0) continue;
    if (m.points.some(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)) measHits.push(m.id);
  }
  for (const f of (_getPageFittings(page) || [])) {
    if (f.x >= minX && f.x <= maxX && f.y >= minY && f.y <= maxY) fitHits.push(f.id);
  }
  // Stacks: check stack center point OR any callout position
  for (const s of (_getPageStacks(page) || [])) {
    const centerIn = s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY;
    const calloutIn = (s.items || []).some(it =>
      it.callout && it.callout.x >= minX && it.callout.x <= maxX && it.callout.y >= minY && it.callout.y <= maxY
    );
    if (centerIn || calloutIn) stackHits.push(s.id);
  }

  if (_deselectMode) removeFromSelection(measHits, fitHits, stackHits);
  else addToSelection(measHits, fitHits, stackHits);
}

// ── Lasso selection ───────────────────────────────────

function ensureLassoSvg() {
  if (!_lassoEl) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('ms-lasso-svg');
    document.getElementById('viewer')?.appendChild(svg);
    _lassoEl = svg;
  }
  return _lassoEl;
}

function drawLassoPath() {
  const svg = ensureLassoSvg();
  const vr = document.getElementById('viewer')?.getBoundingClientRect();
  if (!vr || _lassoPoints.length < 2) { svg.innerHTML = ''; return; }

  let d = `M ${_lassoPoints[0].sx - vr.left} ${_lassoPoints[0].sy - vr.top}`;
  for (let i = 1; i < _lassoPoints.length; i++) {
    d += ` L ${_lassoPoints[i].sx - vr.left} ${_lassoPoints[i].sy - vr.top}`;
  }
  d += ' Z';

  svg.innerHTML = `<path class="ms-lasso-path${_deselectMode ? ' deselect' : ''}" d="${d}"/>`;
}

function hideLasso() {
  if (_lassoEl) _lassoEl.innerHTML = '';
  _lassoPoints = [];
}

function selectItemsInLasso() {
  if (_lassoPoints.length < 3) return;
  const page = _getCurrentPage();
  const poly = _lassoPoints.map(p => ({ x: p.px, y: p.py }));
  const measHits = [], fitHits = [], stackHits = [];

  for (const m of (_getPageMeasurements(page) || [])) {
    if (!m.points || m.points.length === 0) continue;
    if (m.points.some(p => pointInPolygon(p.x, p.y, poly))) measHits.push(m.id);
  }
  for (const f of (_getPageFittings(page) || [])) {
    if (pointInPolygon(f.x, f.y, poly)) fitHits.push(f.id);
  }
  // Stacks: check center point or callout positions
  for (const s of (_getPageStacks(page) || [])) {
    const centerIn = pointInPolygon(s.x, s.y, poly);
    const calloutIn = (s.items || []).some(it =>
      it.callout && pointInPolygon(it.callout.x, it.callout.y, poly)
    );
    if (centerIn || calloutIn) stackHits.push(s.id);
  }

  if (_deselectMode) removeFromSelection(measHits, fitHits, stackHits);
  else addToSelection(measHits, fitHits, stackHits);
}

// Ray casting point-in-polygon
function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ── Mode badge ────────────────────────────────────────

let _badgeEl = null;

function updateModeBadge() {
  if (!_badgeEl) {
    _badgeEl = document.createElement('div');
    _badgeEl.className = 'ms-mode-badge';
    document.getElementById('viewer')?.appendChild(_badgeEl);
  }
  if (_deselectMode) {
    _badgeEl.textContent = '✕ Deselect Mode (Alt)';
    _badgeEl.className = 'ms-mode-badge show deselect';
  } else if (_lassoMode) {
    _badgeEl.textContent = '✦ Lasso Select (L)';
    _badgeEl.className = 'ms-mode-badge show lasso';
  } else {
    _badgeEl.className = 'ms-mode-badge';
  }
}

// ── Bulk edit panel ───────────────────────────────────

function showPanel() { if (!_panelEl) createPanel(); updatePanelContent(); _panelEl.classList.add('open'); }
function hidePanel() { if (_panelEl) _panelEl.classList.remove('open'); }

function createPanel() {
  _panelEl = document.createElement('div');
  _panelEl.className = 'ms-panel';
  _panelEl.id = 'msPanel';
  document.getElementById('viewer')?.appendChild(_panelEl);
}

function updatePanelContent() {
  if (!_panelEl) return;
  const count = getSelectionCount();
  const mCount = _selectedMeasIds.size;
  const fCount = _selectedFitIds.size;
  const sCount = _selectedStackIds.size;
  const syms = _getProjectSystemSymbols ? _getProjectSystemSymbols() : [];
  const page = _getCurrentPage();
  const selMeas = (_getPageMeasurements(page) || []).filter(m => _selectedMeasIds.has(m.id));
  const selFits = (_getPageFittings(page) || []).filter(f => _selectedFitIds.has(f.id));
  const selStacks = (_getPageStacks(page) || []).filter(s => _selectedStackIds.has(s.id));
  // Flatten stack items for property reading
  const stackItems = selStacks.flatMap(s => s.items || []);
  const allItems = [...selMeas, ...selFits, ...stackItems];

  const commonSys = getCommonProp(allItems, 'systemSymbol');
  const commonPhase = getCommonProp(allItems, 'phase');
  const commonGroup = getCommonProp(allItems, 'costGroup');
  const commonGauge = getCommonProp(allItems, 'gauge');

  let html = `<div class="ms-panel-head">`;
  html += `<span class="ms-panel-title">Bulk Edit</span>`;
  const parts = [];
  if (mCount > 0) parts.push(`${mCount} duct${mCount !== 1 ? 's' : ''}`);
  if (fCount > 0) parts.push(`${fCount} fitting${fCount !== 1 ? 's' : ''}`);
  if (sCount > 0) parts.push(`${sCount} stack${sCount !== 1 ? 's' : ''}`);
  html += `<span class="ms-panel-count">${count} item${count !== 1 ? 's' : ''} (${parts.join(', ')})</span>`;
  html += `<button class="ms-panel-close" onclick="window._msClose()">✕</button>`;
  html += `</div><div class="ms-panel-grid">`;

  html += `<label>System Tag</label><select id="msBulkSys"><option value="">— no change —</option><option value="__clear__"${commonSys === null ? ' selected' : ''}>(clear)</option>`;
  for (const s of syms) html += `<option value="${escAttr(s.tag)}"${commonSys === s.tag ? ' selected' : ''}>${escAttr(s.tag)}${s.description ? ' — ' + escAttr(s.description) : ''}</option>`;
  html += `</select>`;

  html += `<label>Phase</label><select id="msBulkPhase"><option value="">— no change —</option><option value="__clear__">(clear)</option>`;
  for (const p of ['rough','trim','air-handler','startup','controls','insulation','venting','stocking','qc']) html += `<option value="${p}"${commonPhase === p ? ' selected' : ''}>${p}</option>`;
  html += `</select>`;

  html += `<label>Cost Group</label><input type="text" id="msBulkGroup" placeholder="Leave blank = no change" value="${commonGroup || ''}">`;

  html += `<label>Gauge</label><select id="msBulkGauge"><option value="">— no change —</option>`;
  for (const g of ['26','24','22','20','18','16']) html += `<option value="${g}"${commonGauge === g ? ' selected' : ''}>${g} ga</option>`;
  html += `</select></div>`;

  html += `<div class="ms-panel-actions">`;
  html += `<button class="ms-clear-btn" onclick="window._msClearSel()">Deselect All</button>`;
  html += `<button class="ms-apply-btn" onclick="window._msApply()">Apply to ${count} Items</button>`;
  html += `</div>`;

  _panelEl.innerHTML = html;
}

function getCommonProp(items, prop) {
  if (items.length === 0) return undefined;
  const val = items[0][prop] || null;
  for (let i = 1; i < items.length; i++) { if ((items[i][prop] || null) !== val) return undefined; }
  return val;
}

function escAttr(s) { return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

function applyBulkChanges() {
  const page = _getCurrentPage();
  const meas = _getPageMeasurements(page) || [];
  const fits = _getPageFittings(page) || [];
  const sysVal = document.getElementById('msBulkSys')?.value;
  const phaseVal = document.getElementById('msBulkPhase')?.value;
  const groupVal = document.getElementById('msBulkGroup')?.value;
  const gaugeVal = document.getElementById('msBulkGauge')?.value;
  let changed = 0;

  const apply = (item) => {
    if (sysVal === '__clear__') { item.systemSymbol = null; changed++; }
    else if (sysVal) { item.systemSymbol = sysVal; changed++; }
    if (phaseVal === '__clear__') { item.phase = null; changed++; }
    else if (phaseVal) { item.phase = phaseVal; changed++; }
    if (groupVal !== undefined && groupVal !== '') { item.costGroup = groupVal; changed++; }
    if (gaugeVal) { item.gauge = gaugeVal; changed++; }
  };

  for (const m of meas) { if (_selectedMeasIds.has(m.id)) apply(m); }
  for (const f of fits) { if (_selectedFitIds.has(f.id)) apply(f); }
  // Apply to all items within selected stacks
  const stacks = _getPageStacks(page) || [];
  for (const s of stacks) {
    if (!_selectedStackIds.has(s.id)) continue;
    for (const it of (s.items || [])) apply(it);
  }

  if (changed > 0 && _scheduleSave) _scheduleSave();
  if (_updatePanel) _updatePanel();
  clearSelection();
}

// ── Geometry helper ───────────────────────────────────

function pointToSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ── Public API ────────────────────────────────────────

const MultiSelect = {
  init(opts) {
    injectCSS();
    _getPageMeasurements = opts.getPageMeasurements;
    _getPageFittings = opts.getPageFittings;
    _getPageStacks = opts.getPageStacks;
    _getCurrentPage = opts.getCurrentPage;
    _scheduleSave = opts.scheduleSave;
    _drawOverlay = opts.drawOverlay;
    _updatePanel = opts.updatePanel;
    _getProjectSystemSymbols = opts.getProjectSystemSymbols;
    _enabled = true;
  },

  // Mode toggles
  get lassoMode() { return _lassoMode; },
  set lassoMode(v) { _lassoMode = v; updateModeBadge(); },

  get deselectMode() { return _deselectMode; },
  set deselectMode(v) { _deselectMode = v; updateModeBadge(); },

  // Mouse handlers — called from index.html
  onShiftMouseDown(e, screenToPdf) {
    if (!_enabled) return false;
    const pt = screenToPdf(e.clientX, e.clientY);
    _dragStart = { sx: e.clientX, sy: e.clientY, px: pt.x, py: pt.y };
    _dragActive = false;
    _lassoPoints = [{ sx: e.clientX, sy: e.clientY, px: pt.x, py: pt.y }];
    return true;
  },

  onShiftMouseMove(e, screenToPdf) {
    if (!_dragStart) return;
    const dx = Math.abs(e.clientX - _dragStart.sx);
    const dy = Math.abs(e.clientY - _dragStart.sy);
    if (dx > 4 || dy > 4) _dragActive = true;

    if (_dragActive) {
      const pt = screenToPdf(e.clientX, e.clientY);
      if (_lassoMode) {
        _lassoPoints.push({ sx: e.clientX, sy: e.clientY, px: pt.x, py: pt.y });
        drawLassoPath();
      } else {
        const vr = document.getElementById('viewer')?.getBoundingClientRect();
        if (vr) showBox(_dragStart.sx - vr.left, _dragStart.sy - vr.top, e.clientX - vr.left, e.clientY - vr.top);
      }
    }
  },

  onShiftMouseUp(e, screenToPdf) {
    if (!_dragStart) return;

    if (_dragActive) {
      if (_lassoMode) {
        selectItemsInLasso();
        hideLasso();
      } else {
        const pt = screenToPdf(e.clientX, e.clientY);
        selectItemsInRect(_dragStart.px, _dragStart.py, pt.x, pt.y);
        hideBox();
      }
    } else {
      // Single click — toggle item (check stacks, fittings, measurements)
      const pt = screenToPdf(e.clientX, e.clientY);
      const page = _getCurrentPage();

      // Priority 1: stacks (center point or callout boxes)
      const stacks = _getPageStacks(page) || [];
      for (let si = stacks.length - 1; si >= 0; si--) {
        const s = stacks[si];
        // Check callout positions
        for (const it of (s.items || [])) {
          if (it.callout && Math.hypot(it.callout.x - pt.x, it.callout.y - pt.y) < 20) {
            toggleStackSelection(s.id); _dragStart = null; return;
          }
        }
        // Check center point
        if (Math.hypot(s.x - pt.x, s.y - pt.y) < (s._hitRadius || 14)) {
          toggleStackSelection(s.id); _dragStart = null; return;
        }
      }

      // Priority 2: fittings
      const fits = _getPageFittings(page) || [];
      let hitFit = null, minDist = 20;
      for (const f of fits) { const d = Math.hypot(f.x - pt.x, f.y - pt.y); if (d < minDist) { minDist = d; hitFit = f; } }
      if (hitFit) { toggleFitSelection(hitFit.id); _dragStart = null; return; }

      // Priority 3: measurements
      const meas = _getPageMeasurements(page) || [];
      for (const m of meas) {
        if (!m.points || m.points.length < 2) continue;
        for (let i = 0; i < m.points.length - 1; i++) {
          const a = m.points[i], b = m.points[i + 1];
          if (pointToSegDist(pt.x, pt.y, a.x, a.y, b.x, b.y) < 15) { toggleMeasSelection(m.id); _dragStart = null; return; }
        }
      }
    }

    _dragStart = null;
    _dragActive = false;
    _lassoPoints = [];
  },

  isMeasSelected(id) { return _selectedMeasIds.has(id); },
  isFitSelected(id) { return _selectedFitIds.has(id); },
  isStackSelected(id) { return _selectedStackIds.has(id); },
  getSelectionCount,
  clearSelection,
};

// ── Global handlers ───────────────────────────────────

window._msClose = function() { clearSelection(); };
window._msClearSel = function() { clearSelection(); };
window._msApply = function() { applyBulkChanges(); };

export default MultiSelect;
