// =====================================================
// IS Plan Viewer — Takeoff Compiler
// =====================================================
// Aggregates duct runs, fittings, stacks across pages/drawings
// into user-defined grouping hierarchies. Loaded as ES module.
// Zero dependency on index.html internals — reads from IndexedDB.
// =====================================================

import { SNAPLOCK_DEFAULTS, SPIRAL_TAP_DEFAULTS, SNAPLOCK_TAP_DEFAULTS, RECT_FITTING_SA, calcRectFittingSA, RECT_MIN_WIDTH_CLASSES, SHOP_DEFAULTS, DUCT_WEIGHT_PER_LF, LINER_OPTIONS } from './price-defaults.js';

function getGaugeWeightPerSF(gauge) {
  if (gauge === '22') return 1.406;
  if (gauge === '24') return 1.156;
  return 0.906; // 26ga default
}

function getCompilerShopSettings() {
  const saved = _priceBookCache ? _priceBookCache['shop-settings'] : null;
  const s = {};
  for (const k in SHOP_DEFAULTS) s[k] = (saved && saved[k] != null) ? saved[k] : SHOP_DEFAULTS[k];
  return s;
}

// Parse a size string like "24x12" → { W: 24, H: 12 }; non-rect returns null.
function parseRectDims(sizeStr) {
  if (!sizeStr) return null;
  const m = String(sizeStr).match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return { W: parseFloat(m[1]), H: parseFloat(m[2]) };
}

// Find the min-width class maxMin for a rect fitting's W × H (narrow dim drives the bucket).
function findMinWidthClass(widthIn, heightIn) {
  const minDim = Math.min(widthIn, heightIn);
  for (const c of RECT_MIN_WIDTH_CLASSES) {
    if (minDim <= c.maxMin) return c.maxMin;
  }
  return RECT_MIN_WIDTH_CLASSES[RECT_MIN_WIDTH_CLASSES.length - 1].maxMin;
}

const DB_NAME = 'ISPlanViewerDB';
const DB_VERSION = 3;

// ── IndexedDB helpers ─────────────────────────────────────────────────
let _cdb = null;
function cOpenDB() {
  if (_cdb) return Promise.resolve(_cdb);
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      // Guard: create any stores that might be missing at this version
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('drawings')) { const ds = db.createObjectStore('drawings', { keyPath: 'id', autoIncrement: true }); ds.createIndex('projectId', 'projectId', { unique: false }); }
      if (!db.objectStoreNames.contains('pageData')) { const ps = db.createObjectStore('pageData', { keyPath: 'id' }); ps.createIndex('drawingId', 'drawingId', { unique: false }); }
      if (!db.objectStoreNames.contains('priceBook')) db.createObjectStore('priceBook', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('hvacLibrary')) { const hl = db.createObjectStore('hvacLibrary', { keyPath: 'id', autoIncrement: true }); hl.createIndex('category', 'category', { unique: false }); }
    };
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
async function cGet(store, key) {
  const db = await cOpenDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

// ── Constants ─────────────────────────────────────────────────────────
const FITTING_NAMES = {
  '90el': '90° Elbow', '45el': '45° Elbow', '22el': '22.5° Elbow',
  'tee': 'Tee-Wye', 'saddle45y': 'Saddle 45Y', 'lateral': '45° Lateral', 'boot': 'Boot',
  'wye': 'Wye', 'reducer': 'Reducer', 'eccReducer': 'Ecc Reducer',
  'endcap': 'End Cap', 'transition': 'Transition', 'sqwing': 'Sq Wing EL',
  'rectTap': 'Rect Tap'
};

const LABOR_CATEGORIES = [
  { key: 'rough',       label: 'Rough',        short: 'R',  color: '#4dabf7' },
  { key: 'air-handler', label: 'Air Handler',  short: 'AH', color: '#69db7c' },
  { key: 'condenser',   label: 'Condenser',    short: 'CU', color: '#69db7c' },
  { key: 'lineset',     label: 'Line Set',     short: 'LS', color: '#ffd43b' },
  { key: 'trim',        label: 'Trim',         short: 'T',  color: '#da77f2' },
  { key: 'venting',     label: 'Venting',      short: 'V',  color: '#ff8787' },
  { key: 'stocking',    label: 'Stocking',     short: 'SK', color: '#a9e34b' },
  { key: 'startup',     label: 'Startup',      short: 'SU', color: '#ffa94d' },
  { key: 'qc',          label: 'Quality Ctrl', short: 'QC', color: '#74c0fc' },
];

const GROUP_DIMENSIONS = [
  { key: 'itemType',  label: 'Type',           icon: '🔧', extract: r => r._itemType },
  { key: 'size',      label: 'Size',           icon: '📐', extract: r => r._size },
  { key: 'shape',     label: 'Shape',          icon: '⬡',  extract: r => r._shape },
  { key: 'phase',     label: 'Phase',          icon: '🏷️', extract: r => r.phase || 'unassigned' },
  { key: 'costGroup', label: 'Cost Group',     icon: '💰', extract: r => r.costGroup || 'ungrouped' },
  { key: 'gauge',     label: 'Gauge',          icon: '🔩', extract: r => r.gauge || 'default' },
  { key: 'lined',     label: 'Lined',          icon: '🧱', extract: r => r._lined ? 'Lined' : 'Unlined' },
  { key: 'laborCat',  label: 'Labor Category', icon: '👷', extract: r => r._laborCatLabel || 'unassigned' },
  { key: 'system',    label: 'System Tag',       icon: '⚙️', extract: r => r.systemSymbol || 'unassigned' },
  { key: 'page',      label: 'Page',           icon: '📄', extract: r => 'Pg ' + r._page },
  { key: 'drawing',   label: 'Drawing',        icon: '📋', extract: r => r._drawingName },
];

const DATA_COLUMNS = [
  { key: 'qty',          label: 'Qty',        type: 'number',   extract: rows => rows.length, alwaysOn: true },
  { key: 'totalLF',      label: 'Total LF',   type: 'number',   extract: rows => rows.reduce((s, r) => s + (r._lengthFt || 0), 0) },
  { key: 'materialCost', label: 'Material $',  type: 'currency', extract: rows => rows.reduce((s, r) => s + (r._matCost || 0), 0) },
  { key: 'laborHrs',     label: 'Labor Hrs',   type: 'number',   extract: rows => rows.reduce((s, r) => s + (r._laborHrs || 0), 0), hasBreakdown: true },
  { key: 'laborCost',    label: 'Labor $',     type: 'currency', extract: rows => rows.reduce((s, r) => s + (r._laborCost || 0), 0), hasBreakdown: true },
  { key: 'totalCost',    label: 'Total $',     type: 'currency', extract: rows => rows.reduce((s, r) => s + (r._totalCost || 0), 0) },
];

// ── State ─────────────────────────────────────────────────────────────
let _container = null;
let _scope = 'project';  // 'selection' | 'project'
let _projectId = null;
let _drawingId = null;
let _activeGroups = ['itemType'];
let _activeColumns = ['qty', 'totalLF', 'materialCost', 'laborHrs', 'totalCost'];
let _collapsed = {};
let _rows = [];
let _drawingNames = {};
let _priceBookCache = null;
let _projectRateTable = null;

// Pinned labor category columns
let _pinnedCats = { laborHrs: new Set(), laborCost: new Set() };
let _lbrCollapsed = { laborHrs: false, laborCost: false };

// Filters: { dimensionKey: Set of allowed values } — null means no filter (all pass)
let _filters = {};

// Selection scope: IDs from multi-select on canvas
let _selMeasIds = null;   // Set or null
let _selFitIds = null;
let _selStackIds = null;

// ── CSS ───────────────────────────────────────────────────────────────
const CSS = `
.compiler { font-size: 12px; color: #e0e0e0; display: flex; flex-direction: column; height: 100%; }
.cmp-scope { display: flex; gap: 4px; padding: 8px 10px 4px; }
.cmp-scope button { flex: 1; background: #1a1a2e; border: 1px solid #0f3460; color: #a0a0c0; padding: 5px 8px; border-radius: 5px; cursor: pointer; font-size: 11px; font-weight: 600; transition: all 0.15s; }
.cmp-scope button.active { background: #e94560; border-color: #e94560; color: #fff; }
.cmp-scope button:hover:not(.active) { border-color: #1a4080; color: #e0e0e0; }
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
.cmp-avail { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 10px 6px; }
.cmp-avail .cmp-chip { background: #0f3460; color: #a0a0c0; border: 1px solid #1a4080; }
.cmp-avail .cmp-chip:hover { border-color: #e94560; color: #e0e0e0; }
.cmp-cols { display: flex; gap: 3px; padding: 2px 10px 6px; flex-wrap: wrap; }
.cmp-col-tog { font-size: 10px; padding: 2px 6px; border-radius: 3px; border: 1px solid #0f3460; background: #1a1a2e; color: #555; cursor: pointer; transition: all 0.15s; }
.cmp-col-tog.on { border-color: #00ff88; color: #00ff88; background: rgba(0,255,136,0.08); }
.cmp-col-tog:hover { border-color: #1a4080; }

/* Filters */
.cmp-filters { padding: 2px 10px 6px; display: flex; flex-wrap: wrap; gap: 3px; }
.cmp-filter-chip { position: relative; display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px; border-radius: 10px; font-size: 10px; font-weight: 600; cursor: pointer; border: 1px solid #0f3460; background: #1a1a2e; color: #a0a0c0; transition: all 0.12s; user-select: none; }
.cmp-filter-chip:hover { border-color: #1a4080; color: #e0e0e0; }
.cmp-filter-chip.active { border-color: #ffd43b; color: #ffd43b; background: rgba(255,212,59,0.08); }
.cmp-filter-chip .cmp-fc-count { font-size: 9px; opacity: 0.7; }
.cmp-filter-pop { display: none; position: absolute; top: 100%; left: 0; z-index: 25; background: #1a1a2e; border: 1px solid #0f3460; border-radius: 6px; padding: 6px 0; min-width: 160px; max-height: 220px; overflow-y: auto; box-shadow: 0 6px 20px rgba(0,0,0,0.5); }
.cmp-filter-chip.open .cmp-filter-pop { display: block; }
.cmp-fp-row { display: flex; align-items: center; gap: 6px; padding: 4px 10px; cursor: pointer; font-size: 11px; color: #a0a0c0; transition: background 0.1s; }
.cmp-fp-row:hover { background: rgba(255,212,59,0.06); }
.cmp-fp-cb { width: 14px; height: 14px; accent-color: #ffd43b; cursor: pointer; flex-shrink: 0; }
.cmp-fp-actions { display: flex; gap: 6px; padding: 4px 10px; border-top: 1px solid #0f3460; margin-top: 4px; }
.cmp-fp-actions button { background: none; border: none; color: #555; cursor: pointer; font-size: 10px; padding: 2px 4px; }
.cmp-fp-actions button:hover { color: #ffd43b; }

/* Results table */
.cmp-results { flex: 1; overflow: auto; padding: 0 6px 8px; }
.cmp-table { width: 100%; border-collapse: collapse; }
.cmp-table th { position: sticky; top: 0; background: #16213e; text-align: left; padding: 5px 6px; font-size: 10px; color: #a0a0c0; text-transform: uppercase; letter-spacing: 0.3px; border-bottom: 1px solid #0f3460; white-space: nowrap; z-index: 2; }
.cmp-table th.num { text-align: right; }
.cmp-table td { padding: 4px 6px; border-bottom: 1px solid rgba(15,52,96,0.4); white-space: nowrap; }
.cmp-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.cmp-table tr.group-header td { font-weight: 600; cursor: pointer; user-select: none; }
.cmp-table tr.group-header:hover td { background: rgba(233,69,96,0.06); }
.cmp-table tr.depth-0 td { color: #e0e0e0; font-size: 12px; border-bottom: 1px solid #0f3460; }
.cmp-table tr.depth-1 td { color: #c0c0d0; font-size: 11px; padding-left: 18px; }
.cmp-table tr.depth-2 td { color: #a0a0b8; font-size: 11px; padding-left: 32px; }
.cmp-table tr.depth-3 td { color: #8888a0; font-size: 10px; padding-left: 46px; }
.cmp-table tr.grand-total td { font-weight: 700; color: #e94560; border-top: 2px solid #e94560; font-size: 12px; }
.cmp-toggle { display: inline-block; width: 14px; font-size: 10px; color: #555; }
.cmp-empty { text-align: center; color: #555; padding: 40px 20px; }
.cmp-empty-icon { font-size: 32px; margin-bottom: 8px; }

/* Labor breakdown header — hover target */
.cmp-lbr-th { position: relative; }
.cmp-lbr-th:hover { color: #e94560; }

/* Header content: label + dot cluster */
.cmp-lbr-inner { display: flex; align-items: center; justify-content: flex-end; gap: 4px; cursor: pointer; }
.cmp-lbr-label { white-space: nowrap; }
.cmp-dot-cluster { display: inline-flex; gap: 2px; align-items: center; padding: 1px 3px; border-radius: 6px; background: rgba(15,52,96,0.6); transition: all 0.2s; }
.cmp-dot-cluster:empty { display: none; }
.cmp-dot-cluster .cd { width: 6px; height: 6px; border-radius: 50%; transition: all 0.25s; }
.cmp-dot-cluster.expanded .cd { width: 4px; height: 4px; opacity: 0.4; }

/* Labor popover — appears on hover */
.cmp-lbr-pop { display: none; position: absolute; top: 100%; right: 0; z-index: 20; background: #1a1a2e; border: 1px solid #0f3460; border-radius: 6px; padding: 6px 0; min-width: 150px; box-shadow: 0 6px 20px rgba(0,0,0,0.5); }
.cmp-lbr-th:hover .cmp-lbr-pop { display: block; }
.cmp-lbr-row { display: flex; align-items: center; padding: 4px 10px; gap: 6px; cursor: pointer; font-size: 11px; transition: background 0.1s; }
.cmp-lbr-row:hover { background: rgba(233,69,96,0.08); }
.cmp-lbr-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; transition: box-shadow 0.15s; }
.cmp-lbr-row.pinned .cmp-lbr-dot { box-shadow: 0 0 4px currentColor; }
.cmp-lbr-name { flex: 1; color: #a0a0c0; }
.cmp-lbr-row.pinned .cmp-lbr-name { color: #e0e0e0; font-weight: 600; }
.cmp-lbr-pin { font-size: 9px; color: #555; }
.cmp-lbr-row.pinned .cmp-lbr-pin { color: #00ff88; }

/* Pinned category sub-columns */
.cmp-table th.pinned-cat { font-size: 9px; text-transform: none; letter-spacing: 0; padding: 4px 5px; border-left: 2px solid var(--cat-color); }
.cmp-table td.pinned-cat { font-size: 10px; padding: 3px 5px; border-left: 2px solid var(--cat-color); color: #a0a0c0; }
`;

let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
  _cssInjected = true;
}

// ── Price book ────────────────────────────────────────────────────────
async function loadPriceBook() {
  try {
    const all = await cGetAll('priceBook');
    _priceBookCache = {};
    for (const entry of all) _priceBookCache[entry.key] = entry;
  } catch (e) { _priceBookCache = {}; }
}

async function loadProjectRate(projectId) {
  try {
    const proj = await cGet('projects', projectId);
    _projectRateTable = (proj && proj.rateTable) ? proj.rateTable : null;
  } catch (e) { _projectRateTable = null; }
}

function getLaborRate() {
  return (_projectRateTable && _projectRateTable.laborRatePerHr) || 45;
}

function getPriceBookLaborBreakdown(baseKey) {
  const result = {};
  for (const cat of LABOR_CATEGORIES) {
    const k = baseKey + '-lc-' + cat.key;
    const entry = _priceBookCache ? _priceBookCache[k] : null;
    if (entry && entry.laborHrs) result[cat.key] = entry.laborHrs;
  }
  return result;
}

// ── Data normalization ────────────────────────────────────────────────

function normalizeRows(allPageData, drawingNames) {
  const rows = [];
  const labRate = getLaborRate();

  for (const pd of allPageData) {
    const page = pd.pageNum || 0;
    const drawingId = pd.drawingId;
    const drawingName = drawingNames[drawingId] || `Drawing ${drawingId}`;

    for (const m of (pd.measurements || [])) {
      if (!m.duct) continue;
      const isFlex = m.duct.type === 'flex';
      const dropFt = isFlex ? ((m.duct.dropInches || 0) / 12) : 0;
      const lengthFt = (m.distance ? m.distance.value || 0 : 0) + dropFt;
      const shape = m.duct.type || 'round';
      const matPerFt = m.materialCostPerFt || 0;
      // Liner adder: if duct is lined, lookup $/SF from Price Book by liner thickness
      let linerPerFt = 0;
      if (m.lined && m.duct.liner > 0) {
        const dims = (m.duct.dims || '').split('x');
        let perimFt = 0;
        if (dims.length === 2) { perimFt = (2 * (parseFloat(dims[0]) + parseFloat(dims[1]))) / 12; }
        else if (dims.length === 1) { perimFt = (Math.PI * parseFloat(dims[0])) / 12; }
        // Find matching liner option by thickness
        const linerThick = m.duct.liner;
        const linerOpt = LINER_OPTIONS.find(o => o.thickness === linerThick) || LINER_OPTIONS[0];
        const linerEntry = _priceBookCache ? _priceBookCache[linerOpt.key] : null;
        const linerSF = (linerEntry && linerEntry.materialCost != null) ? linerEntry.materialCost : 0;
        linerPerFt = perimFt * linerSF;
      }
      const rate = m.laborRate || labRate;
      const labHrsPerFt = m.laborHrsPerFt || 0;
      const matCost = (matPerFt + linerPerFt) * lengthFt;
      const laborHrs = labHrsPerFt * lengthFt;
      const laborCost = laborHrs * rate;

      const ductKey = isFlex
        ? 'flex-' + (m.duct.flexColor || 'black')
        : (shape === 'rect' ? 'duct-rect' : shape === 'oval' ? 'duct-oval' : 'duct-round');
      const sizeKey = ductKey + '-' + (m.duct.dims || '');
      const laborBreakdown = getPriceBookLaborBreakdown(sizeKey);

      const laborCatHrs = {};
      const laborCatCost = {};
      let assignedCat = 'unassigned';
      for (const cat of LABOR_CATEGORIES) {
        const catHrs = (laborBreakdown[cat.key] || 0) * lengthFt;
        laborCatHrs[cat.key] = catHrs;
        laborCatCost[cat.key] = catHrs * rate;
        if (catHrs > 0 && assignedCat === 'unassigned') assignedCat = cat.label;
      }
      const totalBdHrs = Object.values(laborCatHrs).reduce((s, v) => s + v, 0);
      if (totalBdHrs === 0 && laborHrs > 0) {
        const fb = m.phase || 'rough';
        laborCatHrs[fb] = laborHrs;
        laborCatCost[fb] = laborCost;
        const co = LABOR_CATEGORIES.find(c => c.key === fb);
        assignedCat = co ? co.label : capitalize(fb);
      }

      const flexLabel = isFlex ? ('Flex ' + capitalize(m.duct.flexColor || 'black')) : null;
      rows.push({
        _itemType: isFlex ? 'Flex Duct' : 'Duct Run', _size: m.duct.dims || '?', _shape: flexLabel || capitalize(shape),
        _page: page, _drawingId: drawingId, _drawingName: drawingName,
        _lengthFt: lengthFt, _matCost: matCost, _laborHrs: laborHrs,
        _laborCost: laborCost, _totalCost: matCost + laborCost,
        _laborCatHrs: laborCatHrs, _laborCatCost: laborCatCost, _laborCatLabel: assignedCat,
        phase: m.phase || null, costGroup: m.costGroup || null, gauge: m.gauge || null,
        systemSymbol: m.systemSymbol || null,
        _sourceType: 'measurement', _sourceId: m.id,
        _lined: m.lined || false, _linerPerFt: linerPerFt,
      });
    }

    for (const f of (pd.fittings || [])) {
      const laborHrs = f.laborHrs || 0;
      const rate = f.laborRate || labRate;
      const laborCost = laborHrs * rate;
      const shape = inferFittingShape(f);

      const prefix = shape === 'rect' ? 'rect' : 'spiral';
      const baseKey = prefix + '-' + f.type;
      // Boot uses WxH key; other fittings use single size
      const sizeKey = (f.type === 'boot' && f.sizeA && f.sizeB)
        ? baseKey + '-' + f.sizeA + 'x' + f.sizeB
        : baseKey + '-' + (f.sizeA || '');

      // Material cost: use stored value, or look up from price book/defaults
      let matCost = f.materialCost || 0;
      if (!matCost && _priceBookCache) {
        const pbEntry = _priceBookCache[sizeKey];
        if (pbEntry && pbEntry.materialCost != null) {
          matCost = pbEntry.materialCost;
        }
      }
      if (!matCost && SNAPLOCK_DEFAULTS[sizeKey] && SNAPLOCK_DEFAULTS[sizeKey]['26'] != null) {
        matCost = SNAPLOCK_DEFAULTS[sizeKey]['26'];
      }
      // Saddle tap fallback: check spiral and snaplock tap defaults
      if (!matCost && SPIRAL_TAP_DEFAULTS[sizeKey] && SPIRAL_TAP_DEFAULTS[sizeKey]['26'] != null) {
        matCost = SPIRAL_TAP_DEFAULTS[sizeKey]['26'];
      }
      if (!matCost && SNAPLOCK_TAP_DEFAULTS[sizeKey] && SNAPLOCK_TAP_DEFAULTS[sizeKey]['26'] != null) {
        matCost = SNAPLOCK_TAP_DEFAULTS[sizeKey]['26'];
      }
      // Rect fitting fallback: min-width-class price book override → SA-based auto-calc
      if (!matCost && shape === 'rect' && RECT_FITTING_SA[baseKey]) {
        const mainDims = parseRectDims(f.sizeA);
        const branchDims = parseRectDims(f.sizeB);
        if (mainDims) {
          const gauge = f.gauge || '26';
          const mwMax = findMinWidthClass(mainDims.W, mainDims.H);
          // Check Price Book min-width-class override (with or without gauge suffix)
          const mwKeyG = baseKey + '-mw' + mwMax + '-g' + gauge;
          const mwKey  = baseKey + '-mw' + mwMax;
          const mwEntry = _priceBookCache && (_priceBookCache[mwKeyG] || _priceBookCache[mwKey]);
          if (mwEntry && mwEntry.materialCost != null) {
            matCost = mwEntry.materialCost;
          } else {
            const sa = calcRectFittingSA(baseKey, mainDims.W, mainDims.H,
                                         branchDims ? branchDims.W : undefined,
                                         branchDims ? branchDims.H : undefined);
            const shop = getCompilerShopSettings();
            matCost = sa * getGaugeWeightPerSF(gauge) * (shop.sheetMetalPricePerLb || 0);
          }
        }
      }
      let bd = getPriceBookLaborBreakdown(sizeKey);
      if (Object.keys(bd).length === 0) bd = getPriceBookLaborBreakdown(baseKey);

      const laborCatHrs = {};
      const laborCatCost = {};
      let assignedCat = 'unassigned';
      for (const cat of LABOR_CATEGORIES) {
        const ch = bd[cat.key] || 0;
        laborCatHrs[cat.key] = ch;
        laborCatCost[cat.key] = ch * rate;
        if (ch > 0 && assignedCat === 'unassigned') assignedCat = cat.label;
      }
      const totalBdHrs = Object.values(laborCatHrs).reduce((s, v) => s + v, 0);
      if (totalBdHrs === 0 && laborHrs > 0) {
        const fb = f.phase || 'rough';
        laborCatHrs[fb] = laborHrs;
        laborCatCost[fb] = laborCost;
        const co = LABOR_CATEGORIES.find(c => c.key === fb);
        assignedCat = co ? co.label : capitalize(fb);
      }

      rows.push({
        _itemType: FITTING_NAMES[f.type] || f.type,
        _size: f.sizeA + (f.sizeB ? '×' + f.sizeB : ''), _shape: capitalize(shape),
        _page: page, _drawingId: drawingId, _drawingName: drawingName,
        _lengthFt: 0, _matCost: matCost, _laborHrs: laborHrs,
        _laborCost: laborCost, _totalCost: matCost + laborCost,
        _laborCatHrs: laborCatHrs, _laborCatCost: laborCatCost, _laborCatLabel: assignedCat,
        phase: f.phase || null, costGroup: f.costGroup || null, gauge: f.gauge || null,
        systemSymbol: f.systemSymbol || null,
        _sourceType: 'fitting', _sourceId: f.id,
      });
    }

    for (const s of (pd.stacks || [])) {
      for (const it of (s.items || [])) {
        const shape = it.shape || 'round';
        const ec = {}; for (const c of LABOR_CATEGORIES) ec[c.key] = 0;
        rows.push({
          _itemType: it.type === 'ductrun' ? 'Vert. Duct' : (FITTING_NAMES[it.type] || it.type),
          _size: it.sizeA + (it.sizeB ? '×' + it.sizeB : ''), _shape: capitalize(shape),
          _page: page, _drawingId: drawingId, _drawingName: drawingName,
          _lengthFt: 0, _matCost: 0, _laborHrs: 0, _laborCost: 0, _totalCost: 0,
          _laborCatHrs: { ...ec }, _laborCatCost: { ...ec }, _laborCatLabel: 'unassigned',
          phase: null, costGroup: null, gauge: null,
          systemSymbol: null,
          _sourceType: 'stack', _sourceId: it.id, _sourceStackId: s.id,
        });
      }
    }
  }
  return rows;
}

function inferFittingShape(f) { return String(f.sizeA || '').includes('x') ? 'rect' : 'round'; }
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

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
  for (const r of rows) { const v = dim.extract(r); if (!buckets[v]) buckets[v] = []; buckets[v].push(r); }
  const keys = Object.keys(buckets).sort((a, b) => {
    const na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
  const children = [];
  for (const k of keys) {
    const path = pathPrefix ? pathPrefix + '|' + k : k;
    children.push({ label: k, path, _rows: buckets[k], _children: _groupRecursive(buckets[k], dims, depth + 1, path) });
  }
  return { _rows: rows, _children: children };
}

// ── Filtering ──────────────────────────────────────────────────────

function getUniqueValues(rows, dimKey) {
  const dim = GROUP_DIMENSIONS.find(d => d.key === dimKey);
  if (!dim) return [];
  const vals = new Set();
  for (const r of rows) vals.add(dim.extract(r));
  return [...vals].sort((a, b) => {
    const na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  });
}

function applyFilters(rows) {
  const activeFilterKeys = Object.keys(_filters);
  if (activeFilterKeys.length === 0) return rows;
  return rows.filter(r => {
    for (const key of activeFilterKeys) {
      const allowed = _filters[key];
      if (!allowed || allowed.size === 0) continue;
      const dim = GROUP_DIMENSIONS.find(d => d.key === key);
      if (!dim) continue;
      const val = dim.extract(r);
      if (!allowed.has(val)) return false;
    }
    return true;
  });
}

function isFilterActive(dimKey) {
  return _filters[dimKey] && _filters[dimKey].size > 0;
}

function getFilteredRowCount(dimKey) {
  if (!_filters[dimKey]) return 0;
  return _filters[dimKey].size;
}

// ── Build column list with pinned category sub-columns ────────────────

function getEffectiveColumns() {
  const result = [];
  for (const c of DATA_COLUMNS) {
    if (!_activeColumns.includes(c.key) && !c.alwaysOn) continue;
    result.push(c);
    // Insert pinned category columns right after the parent (only if not collapsed)
    if (c.hasBreakdown && !_lbrCollapsed[c.key]) {
      const pinned = _pinnedCats[c.key];
      if (pinned && pinned.size > 0) {
        for (const cat of LABOR_CATEGORIES) {
          if (!pinned.has(cat.key)) continue;
          result.push({
            key: c.key + '_' + cat.key,
            label: cat.short,
            fullLabel: cat.label,
            type: c.type,
            color: cat.color,
            isSub: true,
            parentKey: c.key,
            catKey: cat.key,
            extract: c.key === 'laborHrs'
              ? (rows => rows.reduce((s, r) => s + ((r._laborCatHrs && r._laborCatHrs[cat.key]) || 0), 0))
              : (rows => rows.reduce((s, r) => s + ((r._laborCatCost && r._laborCatCost[cat.key]) || 0), 0)),
          });
        }
      }
    }
  }
  return result;
}

// ── Rendering ─────────────────────────────────────────────────────────

function renderCompiler() {
  if (!_container) return;
  const cols = getEffectiveColumns();
  let html = '';

  // Scope toggle
  html += `<div class="cmp-scope">
    <button class="${_scope === 'selection' ? 'active' : ''}" onclick="window._cmpSetScope('selection')">${_selMeasIds || _selFitIds || _selStackIds ? 'Selection (' + ((_selMeasIds ? _selMeasIds.size : 0) + (_selFitIds ? _selFitIds.size : 0) + (_selStackIds ? _selStackIds.size : 0)) + ')' : 'Selection'}</button>
    <button class="${_scope === 'project' ? 'active' : ''}" onclick="window._cmpSetScope('project')">Entire Project</button>
  </div>`;

  // Grouping bar
  html += `<div class="cmp-groups"><div class="cmp-groups-label">Group by (drag to reorder)</div>`;
  html += `<div class="cmp-chip-bar" id="cmpChipBar" ondragover="event.preventDefault(); this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="window._cmpDropChip(event)">`;
  _activeGroups.forEach((k, i) => {
    const dim = GROUP_DIMENSIONS.find(d => d.key === k);
    if (!dim) return;
    html += `<span class="cmp-chip in-bar" draggable="true" data-key="${k}" ondragstart="window._cmpDragStart(event, '${k}')">
      <span class="cmp-chip-order">${i + 1}</span> ${dim.icon} ${dim.label}
      <span class="cmp-chip-x" onclick="window._cmpRemoveGroup('${k}')">✕</span>
    </span>`;
  });
  if (_activeGroups.length === 0) html += `<span style="color:#555;font-size:10px;padding:4px">Drag dimensions here to group…</span>`;
  html += `</div></div>`;

  // Available chips
  const avail = GROUP_DIMENSIONS.filter(d => !_activeGroups.includes(d.key));
  if (avail.length > 0) {
    html += `<div class="cmp-avail">`;
    for (const d of avail) html += `<span class="cmp-chip" draggable="true" data-key="${d.key}" ondragstart="window._cmpDragStart(event, '${d.key}')" onclick="window._cmpAddGroup('${d.key}')">${d.icon} ${d.label}</span>`;
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

  // Filter chips
  html += `<div class="cmp-filters">`;
  for (const d of GROUP_DIMENSIONS) {
    const vals = getUniqueValues(_rows, d.key);
    if (vals.length <= 1) continue; // no point filtering single-value dims
    const active = isFilterActive(d.key);
    const count = active ? getFilteredRowCount(d.key) : 0;
    const openCls = _openFilterPop === d.key ? ' open' : '';
    html += `<span class="cmp-filter-chip${active ? ' active' : ''}${openCls}" onclick="window._cmpToggleFilterPop('${d.key}')"`;
    html += ` id="cmpFc_${d.key}">`;
    html += `🔍 ${d.label}`;
    if (active) html += ` <span class="cmp-fc-count">(${count}/${vals.length})</span>`;
    // Popover
    html += `<div class="cmp-filter-pop" onclick="event.stopPropagation()">`;
    const allowed = _filters[d.key];
    for (const v of vals) {
      const checked = !allowed || allowed.has(v) ? 'checked' : '';
      html += `<label class="cmp-fp-row"><input type="checkbox" class="cmp-fp-cb" ${checked} onchange="window._cmpSetFilter('${d.key}',${JSON.stringify(v).replace(/'/g,"\\'")},this.checked)"> ${escHtml(String(v))}</label>`;
    }
    html += `<div class="cmp-fp-actions">`;
    html += `<button onclick="window._cmpFilterAll('${d.key}', true)">All</button>`;
    html += `<button onclick="window._cmpFilterAll('${d.key}', false)">None</button>`;
    html += `<button onclick="window._cmpClearFilter('${d.key}')">Clear</button>`;
    html += `</div></div></span>`;
  }
  html += `</div>`;

  // Apply filters to get visible rows
  const filteredRows = applyFilters(_rows);

  // Results table
  html += `<div class="cmp-results">`;
  if (_rows.length === 0) {
    html += `<div class="cmp-empty"><div class="cmp-empty-icon">📊</div>No takeoff data yet.<br>Draw duct runs & place fittings to compile.</div>`;
  } else if (filteredRows.length === 0) {
    html += `<div class="cmp-empty"><div class="cmp-empty-icon">🔍</div>No items match current filters.<br>Adjust filters above to see data.</div>`;
  } else {
    const tree = buildGroupTree(filteredRows, _activeGroups);
    html += `<table class="cmp-table"><thead><tr><th>Item</th>`;

    for (const c of cols) {
      if (c.isSub) {
        // Pinned sub-column
        html += `<th class="num pinned-cat" style="--cat-color:${c.color}" title="${c.fullLabel} — click to unpin" onclick="window._cmpUnpinCat('${c.parentKey}','${c.catKey}')">${c.label}</th>`;
      } else if (c.hasBreakdown && _activeColumns.includes(c.key)) {
        const pinned = _pinnedCats[c.key] || new Set();
        const isCollapsed = _lbrCollapsed[c.key];
        const hasPins = pinned.size > 0;

        html += `<th class="num cmp-lbr-th" id="lbrTh_${c.key}">`;

        // Inner: label + dot cluster, click toggles collapse
        html += `<div class="cmp-lbr-inner" onclick="event.stopPropagation(); window._cmpToggleLbrCollapse('${c.key}')">`;
        html += `<span class="cmp-lbr-label">${c.label}</span>`;
        if (hasPins) {
          html += `<span class="cmp-dot-cluster ${isCollapsed ? '' : 'expanded'}">`;
          for (const cat of LABOR_CATEGORIES) {
            if (!pinned.has(cat.key)) continue;
            html += `<span class="cd" style="background:${cat.color}" title="${cat.label}"></span>`;
          }
          html += `</span>`;
        }
        html += `</div>`;

        // Popover (hover)
        html += `<div class="cmp-lbr-pop" id="lbrPop_${c.key}">`;
        for (const cat of LABOR_CATEGORIES) {
          const isPinned = pinned.has(cat.key);
          html += `<div class="cmp-lbr-row ${isPinned ? 'pinned' : ''}" onclick="event.stopPropagation(); window._cmpTogglePin('${c.key}','${cat.key}')">`;
          html += `<span class="cmp-lbr-dot" style="background:${cat.color}"></span>`;
          html += `<span class="cmp-lbr-name">${cat.label}</span>`;
          html += `<span class="cmp-lbr-pin">${isPinned ? '📌' : ''}</span>`;
          html += `</div>`;
        }
        html += `</div></th>`;
      } else {
        html += `<th class="${c.type === 'number' || c.type === 'currency' ? 'num' : ''}">${c.label}</th>`;
      }
    }

    html += `</tr></thead><tbody>`;
    html += renderTreeRows(tree, cols, 0);

    // Grand total
    html += `<tr class="grand-total"><td>Grand Total</td>`;
    for (const c of cols) {
      const val = c.extract(filteredRows);
      const cls = c.isSub ? 'num pinned-cat' : 'num';
      const style = c.isSub ? ` style="--cat-color:${c.color}"` : '';
      html += `<td class="${cls}"${style}>${formatVal(val, c.type)}</td>`;
    }
    html += `</tr></tbody></table>`;
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
    const hasKids = child._children && child._children._children && child._children._children.length > 0;
    const toggle = hasKids ? `<span class="cmp-toggle">${isCollapsed ? '▶' : '▼'}</span>` : `<span class="cmp-toggle"></span>`;

    html += `<tr class="group-header depth-${depth}" onclick="window._cmpToggleCollapse('${escapePath(path)}')">`;
    html += `<td>${toggle} ${escHtml(child.label)}</td>`;
    for (const c of cols) {
      const val = c.extract(child._rows);
      const cls = c.isSub ? 'num pinned-cat' : 'num';
      const style = c.isSub ? ` style="--cat-color:${c.color}"` : '';
      html += `<td class="${cls}"${style}>${formatVal(val, c.type)}</td>`;
    }
    html += `</tr>`;
    if (!isCollapsed && child._children) html += renderTreeRows(child._children, cols, depth + 1);
  }
  return html;
}

function formatVal(val, type) {
  if (val == null || val === 0) return '—';
  if (type === 'currency') return '$' + val.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (type === 'number') return typeof val === 'number' ? (val % 1 === 0 ? val.toLocaleString() : val.toFixed(1)) : val;
  return val;
}

function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function escapePath(s) { return s.replace(/'/g, "\\'").replace(/\\/g, "\\\\"); }

// ── Data loading ──────────────────────────────────────────────────────

async function loadCompilerData() {
  if (!_projectId) { _rows = []; return; }
  await loadPriceBook();
  await loadProjectRate(_projectId);

  const drawings = await cGetByIndex('drawings', 'projectId', _projectId);
  _drawingNames = {};
  for (const d of drawings) _drawingNames[d.id] = d.fileName || `Drawing ${d.id}`;

  // Always load current drawing's data (for selection scope) + optionally all
  let allPageData = [];
  if (_scope === 'selection' && _drawingId) {
    // Only current drawing for selection mode
    allPageData = await cGetByIndex('pageData', 'drawingId', _drawingId);
  } else {
    for (const d of drawings) {
      const pd = await cGetByIndex('pageData', 'drawingId', d.id);
      allPageData.push(...pd);
    }
  }

  let rows = normalizeRows(allPageData, _drawingNames);

  // In selection scope, filter to only selected item IDs
  if (_scope === 'selection' && (_selMeasIds || _selFitIds || _selStackIds)) {
    rows = rows.filter(r => {
      if (r._sourceType === 'measurement' && _selMeasIds && _selMeasIds.has(r._sourceId)) return true;
      if (r._sourceType === 'fitting' && _selFitIds && _selFitIds.has(r._sourceId)) return true;
      if (r._sourceType === 'stack' && _selStackIds && _selStackIds.has(r._sourceStackId)) return true;
      return false;
    });
  }

  _rows = rows;
}

// ── Public API ────────────────────────────────────────────────────────

const Compiler = {
  async init(container, projectId, drawingId) {
    injectCSS();
    _container = container;
    _projectId = projectId;
    _drawingId = drawingId;
    _scope = 'selection'; // default to selection view
    await this.refresh();
  },
  async refresh() {
    await loadCompilerData();
    renderCompiler();
  },
  setDrawing(drawingId) { _drawingId = drawingId; if (_scope === 'selection') this.refresh(); },
  setProject(projectId) { _projectId = projectId; this.refresh(); },

  // Push canvas selection into compiler
  setSelection(measIds, fitIds, stackIds) {
    _selMeasIds = measIds && measIds.size > 0 ? new Set(measIds) : null;
    _selFitIds = fitIds && fitIds.size > 0 ? new Set(fitIds) : null;
    _selStackIds = stackIds && stackIds.size > 0 ? new Set(stackIds) : null;
    if (_scope === 'selection') this.refresh();
  },

  clearSelectionScope() {
    _selMeasIds = null;
    _selFitIds = null;
    _selStackIds = null;
    if (_scope === 'selection') this.refresh();
  },
};

// ── Global handlers ───────────────────────────────────────────────────

window._cmpSetScope = function(scope) { _scope = scope; Compiler.refresh(); };

window._cmpAddGroup = function(key) {
  if (!_activeGroups.includes(key)) { _activeGroups.push(key); _collapsed = {}; renderCompiler(); }
};

window._cmpRemoveGroup = function(key) {
  _activeGroups = _activeGroups.filter(k => k !== key); _collapsed = {}; renderCompiler();
};

window._cmpToggleCol = function(key) {
  if (_activeColumns.includes(key)) {
    _activeColumns = _activeColumns.filter(k => k !== key);
    if (_pinnedCats[key]) _pinnedCats[key].clear();
  } else {
    _activeColumns.push(key);
  }
  renderCompiler();
};

window._cmpToggleCollapse = function(path) { _collapsed[path] = !_collapsed[path]; renderCompiler(); };

// Filter popover state
let _openFilterPop = null;

window._cmpToggleFilterPop = function(dimKey) {
  _openFilterPop = _openFilterPop === dimKey ? null : dimKey;
  renderCompiler();
  // Close on outside click
  if (_openFilterPop) {
    setTimeout(() => {
      const handler = (e) => {
        const chip = document.getElementById('cmpFc_' + dimKey);
        if (chip && !chip.contains(e.target)) {
          _openFilterPop = null;
          renderCompiler();
          document.removeEventListener('click', handler);
        }
      };
      document.addEventListener('click', handler);
    }, 10);
  }
};

window._cmpSetFilter = function(dimKey, value, included) {
  const vals = getUniqueValues(_rows, dimKey);
  if (!_filters[dimKey]) {
    // First exclusion: start with all values, then remove the unchecked one
    _filters[dimKey] = new Set(vals);
  }
  if (included) {
    _filters[dimKey].add(value);
    // If all values are now selected, clear the filter
    if (_filters[dimKey].size >= vals.length) delete _filters[dimKey];
  } else {
    _filters[dimKey].delete(value);
  }
  // Keep popover open
  const pop = _openFilterPop;
  renderCompiler();
  _openFilterPop = pop;
  // Re-render to keep popover state
  const chip = document.getElementById('cmpFc_' + dimKey);
  if (chip) chip.classList.add('open');
};

window._cmpFilterAll = function(dimKey, selectAll) {
  if (selectAll) {
    delete _filters[dimKey];
  } else {
    _filters[dimKey] = new Set();
  }
  const pop = _openFilterPop;
  renderCompiler();
  _openFilterPop = pop;
  const chip = document.getElementById('cmpFc_' + dimKey);
  if (chip) chip.classList.add('open');
};

window._cmpClearFilter = function(dimKey) {
  delete _filters[dimKey];
  _openFilterPop = null;
  renderCompiler();
};

// Collapse/expand pinned labor sub-columns (pins remembered)
window._cmpToggleLbrCollapse = function(key) {
  _lbrCollapsed[key] = !_lbrCollapsed[key];
  renderCompiler();
};

// Pin/unpin a labor category as a sub-column
window._cmpTogglePin = function(parentKey, catKey) {
  if (!_pinnedCats[parentKey]) _pinnedCats[parentKey] = new Set();
  if (_pinnedCats[parentKey].has(catKey)) {
    _pinnedCats[parentKey].delete(catKey);
  } else {
    _pinnedCats[parentKey].add(catKey);
    // Auto-expand when pinning a new category
    _lbrCollapsed[parentKey] = false;
  }
  renderCompiler();
};

window._cmpUnpinCat = function(parentKey, catKey) {
  if (_pinnedCats[parentKey]) _pinnedCats[parentKey].delete(catKey);
  renderCompiler();
};

// Drag & drop
let _dragKey = null;
window._cmpDragStart = function(e, key) {
  _dragKey = key; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', key);
};

window._cmpDropChip = function(e) {
  e.preventDefault();
  const bar = document.getElementById('cmpChipBar');
  if (bar) bar.classList.remove('drag-over');
  if (!_dragKey) return;
  if (!_activeGroups.includes(_dragKey)) {
    _activeGroups.push(_dragKey);
  } else {
    const chips = bar.querySelectorAll('.cmp-chip.in-bar');
    let insertIdx = _activeGroups.length;
    for (let i = 0; i < chips.length; i++) {
      const rect = chips[i].getBoundingClientRect();
      if (e.clientX < rect.left + rect.width / 2) { insertIdx = i; break; }
    }
    _activeGroups = _activeGroups.filter(k => k !== _dragKey);
    _activeGroups.splice(insertIdx, 0, _dragKey);
  }
  _collapsed = {}; _dragKey = null; renderCompiler();
};

export default Compiler;
