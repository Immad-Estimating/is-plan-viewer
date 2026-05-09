// =====================================================
// IS Plan Viewer — Takeoff Compiler
// =====================================================
// Aggregates duct runs, fittings, stacks across pages/drawings
// into user-defined grouping hierarchies. Loaded as ES module.
// Zero dependency on index.html internals — reads from IndexedDB.
//
// Usage: index.html imports and calls Compiler.init(containerEl)
// =====================================================

const DB_NAME = 'ISPlanViewerDB';
const DB_VERSION = 2;

// ── IndexedDB helpers (standalone — no coupling to main app) ──────────
let _cdb = null;
function cOpenDB() {
  if (_cdb) return Promise.resolve(_cdb);
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onsuccess = e => { _cdb = e.target.result; res(_cdb); };
    r.onerror = e => rej(e.target.error);
  });
}
async function cGetAll(store) {
  const db = await cOpenDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function cGetByIndex(store, idx, val) {
  const db = await cOpenDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).index(idx).getAll(val);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

// ── Fitting names (mirrored from main app) ────────────────────────────
const FITTING_NAMES = {
  '90el': '90° Elbow', '45el': '45° Elbow', '22el': '22.5° Elbow',
  'tee': 'Tee', 'saddle45y': 'Saddle 45Y', 'lateral': '45° Lateral',
  'wye': 'Wye', 'reducer': 'Reducer', 'eccReducer': 'Ecc Reducer',
  'endcap': 'End Cap', 'transition': 'Transition', 'sqwing': 'Sq Wing EL',
  'rectTap': 'Rect Tap'
};

// ── Available grouping dimensions ─────────────────────────────────────
// Each has a key (used in data), a label (shown to user), and extractor
const GROUP_DIMENSIONS = [
  { key: 'itemType',  label: 'Type',       icon: '🔧', extract: r => r._itemType },
  { key: 'size',      label: 'Size',       icon: '📐', extract: r => r._size },
  { key: 'shape',     label: 'Shape',      icon: '⬡',  extract: r => r._shape },
  { key: 'phase',     label: 'Phase',      icon: '🏷️', extract: r => r.phase || 'unassigned' },
  { key: 'costGroup', label: 'Cost Group', icon: '💰', extract: r => r.costGroup || 'ungrouped' },
  { key: 'gauge',     label: 'Gauge',      icon: '🔩', extract: r => r.gauge || 'default' },
  { key: 'page',      label: 'Page',       icon: '📄', extract: r => 'Pg ' + r._page },
  { key: 'drawing',   label: 'Drawing',    icon: '📋', extract: r => r._drawingName },
];

// ── Column definitions (toggleable) ───────────────────────────────────
const DATA_COLUMNS = [
  { key: 'qty',          label: 'Qty',          type: 'number', extract: rows => rows.length, alwaysOn: true },
  { key: 'totalLF',      label: 'Total LF',     type: 'number', extract: rows => rows.reduce((s, r) => s + (r._lengthFt || 0), 0) },
  { key: 'materialCost', label: 'Material $',    type: 'currency', extract: rows => rows.reduce((s, r) => s + (r._matCost || 0), 0) },
  { key: 'laborHrs',     label: 'Labor Hrs',     type: 'number', extract: rows => rows.reduce((s, r) => s + (r._laborHrs || 0), 0) },
  { key: 'laborCost',    label: 'Labor $',       type: 'currency', extract: rows => rows.reduce((s, r) => s + (r._laborCost || 0), 0) },
  { key: 'totalCost',    label: 'Total $',       type: 'currency', extract: rows => rows.reduce((s, r) => s + (r._totalCost || 0), 0) },
];

// ── State ─────────────────────────────────────────────────────────────
let _container = null;
let _scope = 'project';           // 'project' | 'drawing'
let _projectId = null;
let _drawingId = null;
let _activeGroups = ['itemType'];  // ordered list of grouping keys
let _activeColumns = ['qty', 'totalLF', 'materialCost', 'laborHrs', 'totalCost'];
let _collapsed = {};               // groupPath -> true
let _rows = [];                    // flat normalized rows (rebuilt on data change)
let _drawingNames = {};            // drawingId -> fileName

// ── CSS (injected once) ───────────────────────────────────────────────
const CSS = `
.compiler { font-size: 12px; color: #e0e0e0; display: flex; flex-direction: column; height: 100%; }

/* Scope toggle */
.cmp-scope { display: flex; gap: 4px; padding: 8px 10px 4px; }
.cmp-scope button { flex: 1; background: #1a1a2e; border: 1px solid #0f3460; color: #a0a0c0; padding: 5px 8px; border-radius: 5px; cursor: pointer; font-size: 11px; font-weight: 600; transition: all 0.15s; }
.cmp-scope button.active { background: #e94560; border-color: #e94560; color: #fff; }
.cmp-scope button:hover:not(.active) { border-color: #1a4080; color: #e0e0e0; }

/* Group chip bar */
.cmp-groups { padding: 6px 10px; border-bottom: 1px solid #0f3460; }
.cmp-groups-label { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
.cmp-chip-bar { display: flex; flex-wrap: wrap; gap: 4px; min-height: 28px; padding: 2px; border: 1px dashed #0f3460; border-radius: 5px; position: relative; }
.cmp-chip-bar.drag-over { border-color: #e94560; background: rgba(233,69,96,0.05); }
.cmp-chip { display: inline-flex; align-items: center; gap: 3px; padding: 3px 8px; border-radius: 12px; font-size: 10px; font-weight: 600; cursor: grab; user-select: none; transition: all 0.15s; }
.cmp-chip:active { cursor: grabbing; }
.cmp-chip.in-bar { background: #e94560; color: #fff; }
.cmp-chip.in-bar .cmp-chip-x { cursor: pointer; opacity: 0.7; margin-left: 2px; }
.cmp-chip.in-bar .cmp-chip-x:hover { opacity: 1; }
.cmp-chip-order { font-size: 9px; opacity: 0.6; min-width: 10px; }

/* Available chips tray */
.cmp-avail { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 10px 6px; }
.cmp-avail .cmp-chip { background: #0f3460; color: #a0a0c0; border: 1px solid #1a4080; }
.cmp-avail .cmp-chip:hover { border-color: #e94560; color: #e0e0e0; }

/* Column toggles */
.cmp-cols { display: flex; gap: 3px; padding: 2px 10px 6px; flex-wrap: wrap; }
.cmp-col-tog { font-size: 10px; padding: 2px 6px; border-radius: 3px; border: 1px solid #0f3460; background: #1a1a2e; color: #555; cursor: pointer; transition: all 0.15s; }
.cmp-col-tog.on { border-color: #00ff88; color: #00ff88; background: rgba(0,255,136,0.08); }
.cmp-col-tog:hover { border-color: #1a4080; }

/* Results table */
.cmp-results { flex: 1; overflow: auto; padding: 0 6px 8px; }
.cmp-table { width: 100%; border-collapse: collapse; }
.cmp-table th { position: sticky; top: 0; background: #16213e; text-align: left; padding: 5px 6px; font-size: 10px; color: #a0a0c0; text-transform: uppercase; letter-spacing: 0.3px; border-bottom: 1px solid #0f3460; white-space: nowrap; }
.cmp-table th.num { text-align: right; }
.cmp-table td { padding: 4px 6px; border-bottom: 1px solid rgba(15,52,96,0.4); white-space: nowrap; }
.cmp-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.cmp-table tr.group-header td { font-weight: 600; cursor: pointer; user-select: none; }
.cmp-table tr.group-header:hover td { background: rgba(233,69,96,0.06); }
.cmp-table tr.depth-0 td { color: #e0e0e0; font-size: 12px; border-bottom: 1px solid #0f3460; }
.cmp-table tr.depth-1 td { color: #c0c0d0; font-size: 11px; padding-left: 18px; }
.cmp-table tr.depth-2 td { color: #a0a0b8; font-size: 11px; padding-left: 32px; }
.cmp-table tr.depth-3 td { color: #8888a0; font-size: 10px; padding-left: 46px; }
.cmp-table tr.leaf td { font-size: 11px; color: #888; }
.cmp-table tr.grand-total td { font-weight: 700; color: #e94560; border-top: 2px solid #e94560; font-size: 12px; }
.cmp-toggle { display: inline-block; width: 14px; font-size: 10px; color: #555; }
.cmp-empty { text-align: center; color: #555; padding: 40px 20px; }
.cmp-empty-icon { font-size: 32px; margin-bottom: 8px; }
`;

let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
  _cssInjected = true;
}

// ── Data normalization ────────────────────────────────────────────────
// Converts raw pageData into flat rows with consistent fields for grouping

function normalizeRows(allPageData, drawingNames) {
  const rows = [];
  for (const pd of allPageData) {
    const page = pd.pageNum || 0;
    const drawingId = pd.drawingId;
    const drawingName = drawingNames[drawingId] || `Drawing ${drawingId}`;

    // -- Duct runs (measurements with duct tag) --
    for (const m of (pd.measurements || [])) {
      if (!m.duct) continue; // skip plain measurements
      const lengthFt = m.distance ? m.distance.value || 0 : 0;
      const shape = m.duct.type || 'round';
      const matPerFt = m.materialCostPerFt || 0;
      const labHrsPerFt = m.laborHrsPerFt || 0;
      const labRate = m.laborRate || 45;
      const matCost = matPerFt * lengthFt;
      const laborHrs = labHrsPerFt * lengthFt;
      const laborCost = laborHrs * labRate;
      rows.push({
        _itemType: 'Duct Run',
        _size: m.duct.dims || '?',
        _shape: capitalize(shape),
        _page: page,
        _drawingId: drawingId,
        _drawingName: drawingName,
        _lengthFt: lengthFt,
        _matCost: m.costOverride ? (m.materialCostPerFt || 0) * lengthFt : matCost,
        _laborHrs: laborHrs,
        _laborCost: laborCost,
        _totalCost: matCost + laborCost,
        phase: m.phase || null,
        costGroup: m.costGroup || null,
        gauge: m.gauge || null,
        liner: m.duct.liner || 0,
      });
    }

    // -- Fittings --
    for (const f of (pd.fittings || [])) {
      const matCost = f.materialCost || 0;
      const laborHrs = f.laborHrs || 0;
      const labRate = f.laborRate || 45;
      const laborCost = laborHrs * labRate;
      const shape = inferFittingShape(f);
      rows.push({
        _itemType: FITTING_NAMES[f.type] || f.type,
        _size: f.sizeA + (f.sizeB ? '×' + f.sizeB : ''),
        _shape: capitalize(shape),
        _page: page,
        _drawingId: drawingId,
        _drawingName: drawingName,
        _lengthFt: 0,
        _matCost: matCost,
        _laborHrs: laborHrs,
        _laborCost: laborCost,
        _totalCost: matCost + laborCost,
        phase: f.phase || null,
        costGroup: f.costGroup || null,
        gauge: f.gauge || null,
      });
    }

    // -- Vertical stack items --
    for (const s of (pd.stacks || [])) {
      for (const it of (s.items || [])) {
        const shape = it.shape || 'round';
        rows.push({
          _itemType: it.type === 'ductrun' ? 'Vert. Duct' : (FITTING_NAMES[it.type] || it.type),
          _size: it.sizeA + (it.sizeB ? '×' + it.sizeB : ''),
          _shape: capitalize(shape),
          _page: page,
          _drawingId: drawingId,
          _drawingName: drawingName,
          _lengthFt: 0,
          _matCost: 0,
          _laborHrs: 0,
          _laborCost: 0,
          _totalCost: 0,
          phase: null,
          costGroup: null,
          gauge: null,
        });
      }
    }
  }
  return rows;
}

function inferFittingShape(f) {
  // If sizeA contains 'x' it's rect
  const s = String(f.sizeA || '');
  if (s.includes('x')) return 'rect';
  return 'round'; // default
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ── Grouping engine ───────────────────────────────────────────────────

function buildGroupTree(rows, groupKeys) {
  if (groupKeys.length === 0) return { _rows: rows, _children: null };

  const dims = groupKeys.map(k => GROUP_DIMENSIONS.find(d => d.key === k)).filter(Boolean);
  return _groupRecursive(rows, dims, 0, '');
}

function _groupRecursive(rows, dims, depth, pathPrefix) {
  if (depth >= dims.length) return { _rows: rows, _children: null };

  const dim = dims[depth];
  const buckets = {};
  for (const r of rows) {
    const val = dim.extract(r);
    if (!buckets[val]) buckets[val] = [];
    buckets[val].push(r);
  }

  // Sort bucket keys
  const keys = Object.keys(buckets).sort((a, b) => {
    // numeric-aware sort
    const na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });

  const children = [];
  for (const k of keys) {
    const path = pathPrefix ? pathPrefix + '|' + k : k;
    children.push({
      label: k,
      path,
      _rows: buckets[k],
      _children: _groupRecursive(buckets[k], dims, depth + 1, path),
    });
  }

  return { _rows: rows, _children: children };
}

// ── Rendering ─────────────────────────────────────────────────────────

function renderCompiler() {
  if (!_container) return;
  const cols = DATA_COLUMNS.filter(c => _activeColumns.includes(c.key) || c.alwaysOn);

  let html = '';

  // Scope toggle
  html += `<div class="cmp-scope">
    <button class="${_scope === 'drawing' ? 'active' : ''}" onclick="window._cmpSetScope('drawing')">This Drawing</button>
    <button class="${_scope === 'project' ? 'active' : ''}" onclick="window._cmpSetScope('project')">Entire Project</button>
  </div>`;

  // Active grouping bar (drop zone)
  html += `<div class="cmp-groups">`;
  html += `<div class="cmp-groups-label">Group by (drag to reorder)</div>`;
  html += `<div class="cmp-chip-bar" id="cmpChipBar" ondragover="event.preventDefault(); this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="window._cmpDropChip(event)">`;
  _activeGroups.forEach((k, i) => {
    const dim = GROUP_DIMENSIONS.find(d => d.key === k);
    if (!dim) return;
    html += `<span class="cmp-chip in-bar" draggable="true" data-key="${k}" ondragstart="window._cmpDragStart(event, '${k}')">
      <span class="cmp-chip-order">${i + 1}</span> ${dim.icon} ${dim.label}
      <span class="cmp-chip-x" onclick="window._cmpRemoveGroup('${k}')">✕</span>
    </span>`;
  });
  if (_activeGroups.length === 0) {
    html += `<span style="color:#555;font-size:10px;padding:4px">Drag dimensions here to group…</span>`;
  }
  html += `</div></div>`;

  // Available chips tray
  const available = GROUP_DIMENSIONS.filter(d => !_activeGroups.includes(d.key));
  if (available.length > 0) {
    html += `<div class="cmp-avail">`;
    for (const d of available) {
      html += `<span class="cmp-chip" draggable="true" data-key="${d.key}" ondragstart="window._cmpDragStart(event, '${d.key}')" onclick="window._cmpAddGroup('${d.key}')">${d.icon} ${d.label}</span>`;
    }
    html += `</div>`;
  }

  // Column toggles
  html += `<div class="cmp-cols">`;
  for (const c of DATA_COLUMNS) {
    if (c.alwaysOn) continue;
    const on = _activeColumns.includes(c.key);
    html += `<span class="cmp-col-tog ${on ? 'on' : ''}" onclick="window._cmpToggleCol('${c.key}')">${c.label}</span>`;
  }
  html += `</div>`;

  // Results
  html += `<div class="cmp-results">`;
  if (_rows.length === 0) {
    html += `<div class="cmp-empty"><div class="cmp-empty-icon">📊</div>No takeoff data yet.<br>Draw duct runs & place fittings to compile.</div>`;
  } else {
    const tree = buildGroupTree(_rows, _activeGroups);
    html += `<table class="cmp-table"><thead><tr>`;
    html += `<th>Item</th>`;
    for (const c of cols) html += `<th class="${c.type === 'number' || c.type === 'currency' ? 'num' : ''}">${c.label}</th>`;
    html += `</tr></thead><tbody>`;
    html += renderTreeRows(tree, cols, 0);

    // Grand total
    html += `<tr class="grand-total"><td>Grand Total</td>`;
    for (const c of cols) {
      const val = c.extract(_rows);
      html += `<td class="num">${formatVal(val, c.type)}</td>`;
    }
    html += `</tr>`;

    html += `</tbody></table>`;
  }
  html += `</div>`;

  _container.innerHTML = html;
}

function renderTreeRows(node, cols, depth) {
  if (!node._children || node._children.length === 0) return '';
  let html = '';
  for (const child of node._children) {
    const path = child.path;
    const isCollapsed = !!_collapsed[path];
    const toggle = child._children && child._children._children && child._children._children.length > 0
      ? `<span class="cmp-toggle">${isCollapsed ? '▶' : '▼'}</span>`
      : `<span class="cmp-toggle"></span>`;

    html += `<tr class="group-header depth-${depth}" onclick="window._cmpToggleCollapse('${escapePath(path)}')">`;
    html += `<td>${toggle} ${escHtml(child.label)}</td>`;
    for (const c of cols) {
      const val = c.extract(child._rows);
      html += `<td class="num">${formatVal(val, c.type)}</td>`;
    }
    html += `</tr>`;

    if (!isCollapsed && child._children) {
      html += renderTreeRows(child._children, cols, depth + 1);
    }
  }
  return html;
}

function formatVal(val, type) {
  if (val == null || val === 0) return '—';
  if (type === 'currency') return '$' + val.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (type === 'number') return typeof val === 'number' ? (val % 1 === 0 ? val.toLocaleString() : val.toFixed(1)) : val;
  return val;
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function escapePath(s) { return s.replace(/'/g, "\\'").replace(/\\/g, "\\\\"); }

// ── Data loading ──────────────────────────────────────────────────────

async function loadCompilerData() {
  if (!_projectId) { _rows = []; return; }

  // Get drawing names
  const drawings = await cGetByIndex('drawings', 'projectId', _projectId);
  _drawingNames = {};
  for (const d of drawings) _drawingNames[d.id] = d.fileName || `Drawing ${d.id}`;

  let allPageData;
  if (_scope === 'drawing' && _drawingId) {
    allPageData = await cGetByIndex('pageData', 'drawingId', _drawingId);
  } else {
    // All drawings in project
    allPageData = [];
    for (const d of drawings) {
      const pd = await cGetByIndex('pageData', 'drawingId', d.id);
      allPageData.push(...pd);
    }
  }

  _rows = normalizeRows(allPageData, _drawingNames);
}

// ── Public API (called from index.html) ───────────────────────────────

const Compiler = {
  async init(container, projectId, drawingId) {
    injectCSS();
    _container = container;
    _projectId = projectId;
    _drawingId = drawingId;
    _scope = drawingId ? 'drawing' : 'project';
    await this.refresh();
  },

  async refresh() {
    await loadCompilerData();
    renderCompiler();
  },

  setDrawing(drawingId) {
    _drawingId = drawingId;
    if (_scope === 'drawing') this.refresh();
  },

  setProject(projectId) {
    _projectId = projectId;
    this.refresh();
  },
};

// ── Global handlers (onclick from rendered HTML) ──────────────────────

window._cmpSetScope = function(scope) {
  _scope = scope;
  Compiler.refresh();
};

window._cmpAddGroup = function(key) {
  if (!_activeGroups.includes(key)) {
    _activeGroups.push(key);
    _collapsed = {};
    renderCompiler();
  }
};

window._cmpRemoveGroup = function(key) {
  _activeGroups = _activeGroups.filter(k => k !== key);
  _collapsed = {};
  renderCompiler();
};

window._cmpToggleCol = function(key) {
  if (_activeColumns.includes(key)) {
    _activeColumns = _activeColumns.filter(k => k !== key);
  } else {
    _activeColumns.push(key);
  }
  renderCompiler();
};

window._cmpToggleCollapse = function(path) {
  _collapsed[path] = !_collapsed[path];
  renderCompiler();
};

// Drag & drop reordering
let _dragKey = null;
window._cmpDragStart = function(e, key) {
  _dragKey = key;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', key);
};

window._cmpDropChip = function(e) {
  e.preventDefault();
  const bar = document.getElementById('cmpChipBar');
  if (bar) bar.classList.remove('drag-over');
  if (!_dragKey) return;

  // If not already in active groups, add it
  if (!_activeGroups.includes(_dragKey)) {
    _activeGroups.push(_dragKey);
  } else {
    // Reorder: figure out drop position from mouse
    const chips = bar.querySelectorAll('.cmp-chip.in-bar');
    let insertIdx = _activeGroups.length;
    for (let i = 0; i < chips.length; i++) {
      const rect = chips[i].getBoundingClientRect();
      if (e.clientX < rect.left + rect.width / 2) {
        insertIdx = i;
        break;
      }
    }
    _activeGroups = _activeGroups.filter(k => k !== _dragKey);
    _activeGroups.splice(insertIdx, 0, _dragKey);
  }

  _collapsed = {};
  _dragKey = null;
  renderCompiler();
};

export default Compiler;
