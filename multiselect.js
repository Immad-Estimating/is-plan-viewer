// =====================================================
// IS Plan Viewer — Multi-Select & Bulk Edit
// =====================================================
// Handles multi-item selection on the canvas and bulk
// property changes. Loaded as ES module by index.html.
// =====================================================

// ── State ─────────────────────────────────────────────
let _selectedMeasIds = new Set();
let _selectedFitIds = new Set();
let _enabled = false;
let _boxStart = null;    // {sx, sy} screen coords for selection box
let _boxEnd = null;
let _boxActive = false;
let _panelEl = null;     // bulk edit panel container

// References to main app state (set via init)
let _getPageMeasurements = null;
let _getPageFittings = null;
let _getCurrentPage = null;
let _getScreenToPdf = null;
let _scheduleSave = null;
let _drawOverlay = null;
let _updatePanel = null;
let _getProjectSystemSymbols = null;

// ── CSS ───────────────────────────────────────────────
const CSS = `
/* Selection box overlay */
.ms-box { position: absolute; border: 1px dashed #ffd43b; background: rgba(255,212,59,0.06); pointer-events: none; z-index: 15; }

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
.ms-apply-btn { background: #ffd43b; color: #1a1a2e; border: none; padding: 5px 14px; border-radius: 5px; font-size: 11px; font-weight: 700; cursor: pointer; transition: background 0.12s; }
.ms-apply-btn:hover { background: #ffe066; }
.ms-clear-btn { background: none; border: 1px solid #0f3460; color: #a0a0c0; padding: 5px 12px; border-radius: 5px; font-size: 11px; cursor: pointer; }
.ms-clear-btn:hover { border-color: #e94560; color: #e94560; }

/* Hint bar */
.ms-hint { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 55; background: rgba(255,212,59,0.12); border: 1px solid rgba(255,212,59,0.3); border-radius: 6px; padding: 4px 14px; font-size: 11px; color: #ffd43b; pointer-events: none; white-space: nowrap; display: none; }
.ms-hint.show { display: block; }
`;

let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
  _cssInjected = true;
}

// ── Selection logic ───────────────────────────────────

function getSelectionCount() {
  return _selectedMeasIds.size + _selectedFitIds.size;
}

function clearSelection() {
  _selectedMeasIds.clear();
  _selectedFitIds.clear();
  _boxStart = null;
  _boxEnd = null;
  _boxActive = false;
  hidePanel();
  hideBox();
  if (_drawOverlay) _drawOverlay();
}

function toggleMeasSelection(id) {
  if (_selectedMeasIds.has(id)) _selectedMeasIds.delete(id);
  else _selectedMeasIds.add(id);
  onSelectionChanged();
}

function toggleFitSelection(id) {
  if (_selectedFitIds.has(id)) _selectedFitIds.delete(id);
  else _selectedFitIds.add(id);
  onSelectionChanged();
}

function selectItemsInRect(x1, y1, x2, y2) {
  // x1,y1,x2,y2 in PDF coordinates
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  const page = _getCurrentPage();

  const measurements = _getPageMeasurements(page) || [];
  for (const m of measurements) {
    if (!m.points || m.points.length === 0) continue;
    const inside = m.points.some(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY);
    if (inside) _selectedMeasIds.add(m.id);
  }

  const fittings = _getPageFittings(page) || [];
  for (const f of fittings) {
    if (f.x >= minX && f.x <= maxX && f.y >= minY && f.y <= maxY) {
      _selectedFitIds.add(f.id);
    }
  }

  onSelectionChanged();
}

function onSelectionChanged() {
  if (getSelectionCount() > 0) showPanel();
  else hidePanel();
  if (_drawOverlay) _drawOverlay();
}

// ── Selection box (drag rectangle) ────────────────────

let _boxEl = null;

function showBox(sx, sy, ex, ey) {
  if (!_boxEl) {
    _boxEl = document.createElement('div');
    _boxEl.className = 'ms-box';
    document.getElementById('viewer')?.appendChild(_boxEl);
  }
  const l = Math.min(sx, ex), t = Math.min(sy, ey);
  const w = Math.abs(ex - sx), h = Math.abs(ey - sy);
  _boxEl.style.left = l + 'px';
  _boxEl.style.top = t + 'px';
  _boxEl.style.width = w + 'px';
  _boxEl.style.height = h + 'px';
  _boxEl.style.display = 'block';
}

function hideBox() {
  if (_boxEl) _boxEl.style.display = 'none';
}

// ── Bulk edit panel ───────────────────────────────────

function showPanel() {
  if (!_panelEl) createPanel();
  updatePanelContent();
  _panelEl.classList.add('open');
}

function hidePanel() {
  if (_panelEl) _panelEl.classList.remove('open');
}

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
  const syms = _getProjectSystemSymbols ? _getProjectSystemSymbols() : [];

  // Read current common values (if all selected share a value, show it)
  const page = _getCurrentPage();
  const meas = _getPageMeasurements(page) || [];
  const fits = _getPageFittings(page) || [];
  const selMeas = meas.filter(m => _selectedMeasIds.has(m.id));
  const selFits = fits.filter(f => _selectedFitIds.has(f.id));
  const allItems = [...selMeas, ...selFits];

  const commonSys = getCommonProp(allItems, 'systemSymbol');
  const commonPhase = getCommonProp(allItems, 'phase');
  const commonGroup = getCommonProp(allItems, 'costGroup');
  const commonGauge = getCommonProp(allItems, 'gauge');

  let html = '';
  html += `<div class="ms-panel-head">`;
  html += `<span class="ms-panel-title">Bulk Edit</span>`;
  html += `<span class="ms-panel-count">${count} item${count !== 1 ? 's' : ''} (${mCount} duct${mCount !== 1 ? 's' : ''}, ${fCount} fitting${fCount !== 1 ? 's' : ''})</span>`;
  html += `<button class="ms-panel-close" onclick="window._msClose()">✕</button>`;
  html += `</div>`;

  html += `<div class="ms-panel-grid">`;

  // System Tag
  html += `<label>System Tag</label>`;
  html += `<select id="msBulkSys"><option value="">— no change —</option>`;
  html += `<option value="__clear__"${commonSys === null ? ' selected' : ''}>(clear)</option>`;
  for (const s of syms) {
    const sel = commonSys === s.tag ? ' selected' : '';
    html += `<option value="${escAttr(s.tag)}"${sel}>${escAttr(s.tag)}${s.description ? ' — ' + escAttr(s.description) : ''}</option>`;
  }
  html += `</select>`;

  // Phase
  html += `<label>Phase</label>`;
  html += `<select id="msBulkPhase"><option value="">— no change —</option>`;
  html += `<option value="__clear__">(clear)</option>`;
  const phases = ['rough','trim','air-handler','startup','controls','insulation','venting','stocking','qc'];
  for (const p of phases) {
    const sel = commonPhase === p ? ' selected' : '';
    html += `<option value="${p}"${sel}>${p}</option>`;
  }
  html += `</select>`;

  // Cost Group
  html += `<label>Cost Group</label>`;
  html += `<input type="text" id="msBulkGroup" placeholder="Leave blank = no change" value="${commonGroup || ''}">`;

  // Gauge
  html += `<label>Gauge</label>`;
  html += `<select id="msBulkGauge"><option value="">— no change —</option>`;
  for (const g of ['26','24','22','20','18','16']) {
    const sel = commonGauge === g ? ' selected' : '';
    html += `<option value="${g}"${sel}>${g} ga</option>`;
  }
  html += `</select>`;

  html += `</div>`;

  html += `<div class="ms-panel-actions">`;
  html += `<button class="ms-clear-btn" onclick="window._msClearSel()">Deselect All</button>`;
  html += `<button class="ms-apply-btn" onclick="window._msApply()">Apply to ${count} Items</button>`;
  html += `</div>`;

  _panelEl.innerHTML = html;
}

function getCommonProp(items, prop) {
  if (items.length === 0) return undefined;
  const val = items[0][prop] || null;
  for (let i = 1; i < items.length; i++) {
    if ((items[i][prop] || null) !== val) return undefined; // mixed
  }
  return val;
}

function escAttr(s) { return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

// ── Apply bulk changes ────────────────────────────────

function applyBulkChanges() {
  const page = _getCurrentPage();
  const meas = _getPageMeasurements(page) || [];
  const fits = _getPageFittings(page) || [];

  const sysVal = document.getElementById('msBulkSys')?.value;
  const phaseVal = document.getElementById('msBulkPhase')?.value;
  const groupVal = document.getElementById('msBulkGroup')?.value;
  const gaugeVal = document.getElementById('msBulkGauge')?.value;

  let changed = 0;

  for (const m of meas) {
    if (!_selectedMeasIds.has(m.id)) continue;
    if (sysVal === '__clear__') { m.systemSymbol = null; changed++; }
    else if (sysVal) { m.systemSymbol = sysVal; changed++; }
    if (phaseVal === '__clear__') { m.phase = null; changed++; }
    else if (phaseVal) { m.phase = phaseVal; changed++; }
    if (groupVal !== undefined && groupVal !== '') { m.costGroup = groupVal; changed++; }
    if (gaugeVal) { m.gauge = gaugeVal; changed++; }
  }

  for (const f of fits) {
    if (!_selectedFitIds.has(f.id)) continue;
    if (sysVal === '__clear__') { f.systemSymbol = null; changed++; }
    else if (sysVal) { f.systemSymbol = sysVal; changed++; }
    if (phaseVal === '__clear__') { f.phase = null; changed++; }
    else if (phaseVal) { f.phase = phaseVal; changed++; }
    if (groupVal !== undefined && groupVal !== '') { f.costGroup = groupVal; changed++; }
    if (gaugeVal) { f.gauge = gaugeVal; changed++; }
  }

  if (changed > 0 && _scheduleSave) _scheduleSave();
  if (_updatePanel) _updatePanel();
  clearSelection();
}

// ── Hint bar ──────────────────────────────────────────

let _hintEl = null;

function showHint() {
  if (!_hintEl) {
    _hintEl = document.createElement('div');
    _hintEl.className = 'ms-hint';
    _hintEl.textContent = 'Multi-select: Shift+Click items or Shift+Drag to box select';
    document.getElementById('viewer')?.appendChild(_hintEl);
  }
  _hintEl.classList.add('show');
}

function hideHint() {
  if (_hintEl) _hintEl.classList.remove('show');
}

// ── Public API ────────────────────────────────────────

const MultiSelect = {
  init(opts) {
    injectCSS();
    _getPageMeasurements = opts.getPageMeasurements;
    _getPageFittings = opts.getPageFittings;
    _getCurrentPage = opts.getCurrentPage;
    _getScreenToPdf = opts.screenToPdf;
    _scheduleSave = opts.scheduleSave;
    _drawOverlay = opts.drawOverlay;
    _updatePanel = opts.updatePanel;
    _getProjectSystemSymbols = opts.getProjectSystemSymbols;
    _enabled = true;
  },

  // Called by main app on Shift+mousedown
  onShiftMouseDown(e, screenToPdf) {
    if (!_enabled) return false;
    const pt = screenToPdf(e.clientX, e.clientY);

    // Check if clicking on a specific item
    if (e.type === 'mousedown') {
      _boxStart = { sx: e.clientX, sy: e.clientY, px: pt.x, py: pt.y };
      _boxActive = false;
      return true; // consumed
    }
    return false;
  },

  onShiftMouseMove(e, screenToPdf) {
    if (!_boxStart) return;
    const dx = Math.abs(e.clientX - _boxStart.sx);
    const dy = Math.abs(e.clientY - _boxStart.sy);
    if (dx > 4 || dy > 4) _boxActive = true;

    if (_boxActive) {
      // Get viewer-relative coords
      const vr = document.getElementById('viewer')?.getBoundingClientRect();
      if (vr) {
        showBox(
          _boxStart.sx - vr.left, _boxStart.sy - vr.top,
          e.clientX - vr.left, e.clientY - vr.top
        );
      }
    }
  },

  onShiftMouseUp(e, screenToPdf) {
    if (!_boxStart) return;

    if (_boxActive) {
      // Box select
      const pt = screenToPdf(e.clientX, e.clientY);
      if (!e.ctrlKey && !e.metaKey) {
        // Fresh selection unless Ctrl held
        _selectedMeasIds.clear();
        _selectedFitIds.clear();
      }
      selectItemsInRect(_boxStart.px, _boxStart.py, pt.x, pt.y);
      hideBox();
    } else {
      // Single click — find what's under cursor and toggle
      const pt = screenToPdf(e.clientX, e.clientY);
      const page = _getCurrentPage();
      const displayScale = 1; // hit test at PDF scale

      // Check fittings first
      const fits = _getPageFittings(page) || [];
      let hitFit = null;
      let minDist = 20;
      for (const f of fits) {
        const d = Math.hypot(f.x - pt.x, f.y - pt.y);
        if (d < minDist) { minDist = d; hitFit = f; }
      }
      if (hitFit) { toggleFitSelection(hitFit.id); _boxStart = null; return; }

      // Check measurements
      const meas = _getPageMeasurements(page) || [];
      for (const m of meas) {
        if (!m.points || m.points.length < 2) continue;
        for (let i = 0; i < m.points.length - 1; i++) {
          const a = m.points[i], b = m.points[i + 1];
          const d = pointToSegDist(pt.x, pt.y, a.x, a.y, b.x, b.y);
          if (d < 15) { toggleMeasSelection(m.id); _boxStart = null; return; }
        }
      }
    }

    _boxStart = null;
    _boxActive = false;
  },

  // Check if an item is in the multi-selection (for rendering highlights)
  isMeasSelected(id) { return _selectedMeasIds.has(id); },
  isFitSelected(id) { return _selectedFitIds.has(id); },
  getSelectionCount,
  clearSelection,

  // Show/hide hint
  showHint, hideHint,
};

// ── Geometry helper ───────────────────────────────────

function pointToSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ── Global handlers ───────────────────────────────────

window._msClose = function() { clearSelection(); };
window._msClearSel = function() { clearSelection(); };
window._msApply = function() { applyBulkChanges(); };

export default MultiSelect;
