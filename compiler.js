// =====================================================
// IS Plan Viewer — Takeoff Compiler
// =====================================================
// Aggregates duct runs, fittings, stacks across pages/drawings
// into user-defined grouping hierarchies. Loaded as ES module.
// Zero dependency on index.html internals — reads from IndexedDB.
// =====================================================

import { SPIRAL_DEFAULTS, SNAPLOCK_DEFAULTS, SPIRAL_TAP_DEFAULTS, SNAPLOCK_TAP_DEFAULTS, RECT_FITTING_SA, calcRectFittingSA, RECT_MIN_WIDTH_CLASSES, RECT_PERIM_CLASSES, SHOP_DEFAULTS, DUCT_WEIGHT_PER_LF, LINER_OPTIONS, RECT_DUCT_SHOP_DEFAULTS, RECT_FLEX_CONN_DEFAULTS, RECT_PLENUM_DEFAULT, RECT_REDUCER_SHOP_DEFAULTS, RECT_ENDCAP_SHOP_DEFAULTS, RECT_TRANSITION_SHOP_DEFAULTS, RECT_TAP_SHOP_DEFAULTS, RECT_45EL_SHOP_DEFAULTS, LABOR_DEFAULTS } from './price-defaults.js';

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
async function cPut(store, data) {
  const db = await cOpenDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const r = tx.objectStore(store).put(data);
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

// Grand total adjustments — stored per-project in localStorage, not on items
let _grandAdj = {};

// Compiler radar state
let _radarTarget = null;   // null = scope totals, 'path|...' = specific group
let _radarRows = null;     // cached rows for radar target

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

/* Inline cell editing */
.cmp-cell-edit { background: #0d1117; border: 1px solid #e94560; color: #ffd43b; padding: 2px 4px; border-radius: 3px; font-size: 11px; text-align: right; width: 70px; font-variant-numeric: tabular-nums; outline: none; }
.cmp-cell-edit:focus { box-shadow: 0 0 6px rgba(233,69,96,0.4); }
.cmp-editable { cursor: cell; position: relative; }
.cmp-editable:hover { background: rgba(233,69,96,0.08); }
.cmp-editable:not(.cmp-override):hover::after { content: '✎'; position: absolute; right: 2px; top: 1px; font-size: 8px; color: #e94560; opacity: 0.6; }
.cmp-override { color: #ffd43b; }
.cmp-override .cmp-val-current { display: inline; }
.cmp-override:hover .cmp-val-current { display: none; }
.cmp-override::before { content: attr(data-orig); display: none; color: #555; font-style: italic; text-decoration: line-through; }
.cmp-override:hover::before { display: inline; }
.cmp-override::after { content: ''; position: absolute; top: -1px; right: -1px; width: 5px; height: 5px; background: #ffd43b; border-radius: 50%; }
.cmp-ovr-dot { display: inline-block; width: 5px; height: 5px; background: #ffd43b; border-radius: 50%; margin-left: 3px; vertical-align: middle; cursor: help; }

/* Grand total delta row */
.cmp-delta-row td { font-size: 10px; color: #a0a0c0; border-top: none; padding-top: 0; }
.cmp-delta-pos { color: #ff6b6b; }
.cmp-delta-neg { color: #00ff88; }
.cmp-delta-zero { color: #555; }

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

/* Compiler radar */
.cmp-radar { padding: 12px; border-top: 1px solid #0f3460; background: rgba(15,52,96,0.08); }
.cmp-radar-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.cmp-radar-head span { font-size: 11px; color: #a0a0c0; font-weight: 600; }
.cmp-radar-head button { background: none; border: none; color: #555; cursor: pointer; font-size: 11px; padding: 2px 6px; }
.cmp-radar-head button:hover { color: #e94560; }
.cmp-radar-body { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.cmp-radar-inputs { display: flex; flex-direction: column; gap: 3px; min-width: 160px; }
.cmp-radar-cat { display: flex; align-items: center; gap: 4px; }
.cmp-radar-cat input { width: 52px; background: #1a1a2e; border: 1px solid #0f3460; color: inherit; padding: 3px 4px; border-radius: 3px; font-size: 11px; text-align: right; }
.cmp-radar-cat input:focus { outline: none; border-color: #e94560; }
.cmp-radar-total { margin-top: 6px; padding-top: 6px; border-top: 1px solid #0f3460; display: flex; justify-content: space-between; font-size: 10px; font-weight: 700; color: #e94560; }
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

let _companyDefaultsCache = null;
function _getCompanyDefaults() {
  if (_companyDefaultsCache) return _companyDefaultsCache;
  try { _companyDefaultsCache = JSON.parse(localStorage.getItem('isplan_labor_company') || '{}'); }
  catch (e) { _companyDefaultsCache = {}; }
  return _companyDefaultsCache;
}

function _laborDefaultFallback(baseKey, catKey) {
  // 1. Company-wide defaults (localStorage)
  const cd = _getCompanyDefaults();
  const cdKey = baseKey + '-lc-' + catKey;
  if (cd[cdKey] && cd[cdKey].laborHrs) return cd[cdKey].laborHrs;
  const cdBase = baseKey.replace(/-(mw)?\d+(x\d+)?$/, '') + '-lc-' + catKey;
  if (cdBase !== cdKey && cd[cdBase] && cd[cdBase].laborHrs) return cd[cdBase].laborHrs;
  // 2. JSON defaults
  if (!LABOR_DEFAULTS) return 0;
  if (LABOR_DEFAULTS[baseKey] && LABOR_DEFAULTS[baseKey][catKey]) return LABOR_DEFAULTS[baseKey][catKey];
  const baseOnly = baseKey.replace(/-(mw)?\d+(x\d+)?$/, '');
  if (baseOnly !== baseKey && LABOR_DEFAULTS[baseOnly] && LABOR_DEFAULTS[baseOnly][catKey]) return LABOR_DEFAULTS[baseOnly][catKey];
  return 0;
}

function getPriceBookLaborBreakdown(baseKey) {
  const result = {};
  for (const cat of LABOR_CATEGORIES) {
    const k = baseKey + '-lc-' + cat.key;
    const entry = _priceBookCache ? _priceBookCache[k] : null;
    if (entry && entry.laborHrs) {
      result[cat.key] = entry.laborHrs;
    } else {
      const def = _laborDefaultFallback(baseKey, cat.key);
      if (def > 0) result[cat.key] = def;
    }
  }
  return result;
}

// ── Data normalization ────────────────────────────────────────────────

// ── HVAC component type → labor-defaults key mapping ───────────────────
const _HVAC_TYPE_TO_LABOR_KEY = {
  'rooftop unit': 'rooftop-unit', 'package unit': 'rooftop-unit', 'rtu': 'rooftop-unit',
  'air handler': 'rooftop-unit', 'ahu': 'rooftop-unit',
  'split system': 'split-system', 'condensing unit': 'split-system', 'heat pump': 'split-system',
  'mini split': 'mini-split', 'ptac': 'mini-split', 'wshp': 'mini-split',
  'exhaust fan': 'exhaust-fan', 'return fan': 'exhaust-fan', 'transfer fan': 'exhaust-fan',
  'supply fan': 'exhaust-fan', 'inline fan': 'exhaust-fan', 'ceiling fan': 'exhaust-fan',
  'power ventilator': 'exhaust-fan', 'kitchen hood fan': 'exhaust-fan-lg', 'garage fan': 'exhaust-fan-lg',
  'unit heater': 'unit-heater', 'cabinet heater': 'unit-heater', 'radiant heater': 'unit-heater',
  'baseboard heater': 'unit-heater-elec', 'duct heater': 'unit-heater-elec',
  'erv': 'erv', 'energy recovery wheel': 'erv', 'hrv': 'hrv',
  'vav box': 'vav-box', 'fptu': 'fan-powered-box', 'fan powered box': 'fan-powered-box',
  'fan coil unit': 'fan-powered-box', 'chilled beam': 'fan-powered-box',
  'supply diffuser': 'supply-diffuser', 'linear diffuser': 'linear-diffuser', 'slot diffuser': 'linear-diffuser',
  'return grille': 'return-grille', 'transfer grille': 'return-grille', 'register': 'register',
  'louver': 'louver', 'intake louver': 'louver', 'exhaust louver': 'louver',
  'makeup air unit': 'rooftop-unit', 'doas': 'erv',
  'air curtain': 'louver', 'damper': 'louver', 'fire damper': 'louver',
  'smoke damper': 'louver', 'combination fire/smoke damper': 'louver', 'control damper': 'louver', 'backdraft damper': 'louver',
  'fume hood': 'exhaust-fan', 'kitchen hood': 'exhaust-fan-lg',
};

// Size-based labor key suffix for equipment with tonnage
function _hvacSizeSuffix(tonnage) {
  if (!tonnage) return '';
  if (tonnage <= 3) return '-sm';
  if (tonnage >= 15) return '-lg';
  return ''; // standard
}

// Resolve labor hours for an HVAC component fitting.
// Priority: 1) existing items with same tag, 2) labor-defaults by type, 3) category fallback
function _resolveHvacLabor(f, existingRows, defaultRate) {
  const result = {};
  for (const cat of LABOR_CATEGORIES) result[cat.key] = 0;

  // 1) Check existing compiled rows for same hvacTag — reuse their labor breakdown
  if (f.hvacTag) {
    const match = existingRows.find(r =>
      r._sourceType === 'fitting' && r.systemSymbol === f.hvacTag && r._laborHrs > 0
    );
    if (match && match._laborCatHrs) {
      for (const cat of LABOR_CATEGORIES) {
        result[cat.key] = match._laborCatHrs[cat.key] || 0;
      }
      const total = Object.values(result).reduce((s, v) => s + v, 0);
      if (total > 0) return result;
    }
  }

  // 2) Look up labor-defaults by normalized type
  const typeKey = (f.hvacType || '').toLowerCase().trim();
  let laborKey = _HVAC_TYPE_TO_LABOR_KEY[typeKey] || null;

  // Try fuzzy partial match if exact match fails
  if (!laborKey) {
    for (const [pattern, key] of Object.entries(_HVAC_TYPE_TO_LABOR_KEY)) {
      if (typeKey.includes(pattern) || pattern.includes(typeKey)) {
        laborKey = key;
        break;
      }
    }
  }

  if (laborKey) {
    // Try size-specific variant first (e.g., rooftop-unit-sm, exhaust-fan-lg)
    const tonnage = f.hvacTonnage || (f.sizeA ? parseFloat(f.sizeA) / 4 : null);
    const suffix = _hvacSizeSuffix(tonnage);
    const sizedKey = suffix ? laborKey + suffix : null;
    const defaults = (sizedKey && LABOR_DEFAULTS[sizedKey]) ? LABOR_DEFAULTS[sizedKey] : LABOR_DEFAULTS[laborKey];
    if (defaults) {
      for (const [catKey, hrs] of Object.entries(defaults)) {
        if (typeof hrs === 'number') result[catKey] = hrs;
      }
      const total = Object.values(result).reduce((s, v) => s + v, 0);
      if (total > 0) return result;
    }
  }

  // 3) Category-based fallback
  const cat = (f.hvacCategory || '').toLowerCase();
  const fallbacks = {
    'equipment': { 'rough': 6.0, 'startup': 1.5, 'stocking': 0.5 },
    'fan': { 'rough': 1.5, 'startup': 0.5, 'stocking': 0.3 },
    'air-distribution': { 'trim': 0.2, 'stocking': 0.05 },
    'terminal': { 'rough': 1.5, 'trim': 0.5, 'stocking': 0.3 },
    'energy-recovery': { 'air-handler': 5.0, 'startup': 1.5, 'stocking': 0.5 },
    'heating': { 'rough': 1.5, 'stocking': 0.3, 'startup': 0.5 },
    'makeup-air': { 'rough': 6.0, 'startup': 1.5, 'stocking': 0.5 },
    'specialty': { 'rough': 0.5, 'stocking': 0.1 },
  };
  const fb = fallbacks[cat] || fallbacks['equipment'];
  for (const [ck, hrs] of Object.entries(fb)) {
    result[ck] = hrs;
  }
  return result;
}

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
      let matCost = (matPerFt + linerPerFt) * lengthFt;

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
      // Total labor from breakdown; fall back to stored labHrsPerFt if breakdown is empty
      let laborHrs = Object.values(laborCatHrs).reduce((s, v) => s + v, 0);
      if (laborHrs === 0) {
        const labHrsPerFt = m.laborHrsPerFt || 0;
        laborHrs = labHrsPerFt * lengthFt;
        if (laborHrs > 0) {
          const fb = m.phase || 'rough';
          laborCatHrs[fb] = laborHrs;
          laborCatCost[fb] = laborHrs * rate;
          const co = LABOR_CATEGORIES.find(c => c.key === fb);
          assignedCat = co ? co.label : capitalize(fb);
        }
      }
      const laborCost = laborHrs * rate;

      // Store original calculated values before overrides
      const origLaborHrs = laborHrs, origMatCost = matCost;
      const origLaborCost = laborHrs * rate;
      const origTotal = matCost + origLaborCost;
      const origLaborCatHrs = { ...laborCatHrs };

      // Apply manual overrides if present
      const mOvr = m._overrides || {};
      if (mOvr.laborHrs != null) { laborHrs = mOvr.laborHrs; }
      if (mOvr.materialCost != null) { matCost = mOvr.materialCost; }
      // Apply individual labor category overrides back into the breakdown
      for (const cat of LABOR_CATEGORIES) {
        if (mOvr['laborCat_' + cat.key] != null) {
          laborCatHrs[cat.key] = mOvr['laborCat_' + cat.key];
          laborCatCost[cat.key] = mOvr['laborCat_' + cat.key] * rate;
        }
      }
      const finalLaborCost = laborHrs * rate;
      const finalTotal = (mOvr.totalCost != null) ? mOvr.totalCost : (matCost + finalLaborCost);
      const hasOverride = Object.keys(mOvr).length > 0;

      const flexLabel = isFlex ? ('Flex ' + capitalize(m.duct.flexColor || 'black')) : null;
      rows.push({
        _itemType: isFlex ? 'Flex Duct' : 'Duct Run', _size: m.duct.dims || '?', _shape: flexLabel || capitalize(shape),
        _page: page, _drawingId: drawingId, _drawingName: drawingName,
        _lengthFt: lengthFt, _matCost: matCost, _laborHrs: laborHrs,
        _laborCost: finalLaborCost, _totalCost: finalTotal,
        _laborCatHrs: laborCatHrs, _laborCatCost: laborCatCost, _laborCatLabel: assignedCat,
        _hasOverride: hasOverride, _overrides: mOvr,
        _orig_laborHrs: origLaborHrs, _orig_materialCost: origMatCost,
        _orig_laborCost: origLaborCost, _orig_totalCost: origTotal, _orig_lengthFt: lengthFt,
        _orig_laborCatHrs: origLaborCatHrs,
        phase: m.phase || null, costGroup: m.costGroup || null, gauge: m.gauge || null,
        systemSymbol: m.systemSymbol || null,
        _sourceType: 'measurement', _sourceId: m.id,
        _lined: m.lined || false, _linerPerFt: linerPerFt,
      });
    }

    for (const f of (pd.fittings || [])) {
      const rate = f.laborRate || labRate;

      // ── HVAC component labor assignment ──────────────────────────────
      if (f.type === 'hvac_component') {
        let hvacLabor = _resolveHvacLabor(f, rows, labRate);
        const laborCatHrs = {};
        const laborCatCost = {};
        let assignedCat = 'unassigned';
        let laborHrs = 0;
        for (const cat of LABOR_CATEGORIES) {
          const ch = hvacLabor[cat.key] || 0;
          laborCatHrs[cat.key] = ch;
          laborCatCost[cat.key] = ch * rate;
          laborHrs += ch;
          if (ch > 0 && assignedCat === 'unassigned') assignedCat = cat.label;
        }
        let matCost = f.materialCost || 0;
        const origFLabHrs = laborHrs, origFMatCost = matCost;
        const origFLabCost = laborHrs * rate;
        const origFTotal = matCost + origFLabCost;
        const origFLabCatHrs = { ...laborCatHrs };
        const fOvr = f._overrides || {};
        if (fOvr.laborHrs != null) laborHrs = fOvr.laborHrs;
        if (fOvr.materialCost != null) matCost = fOvr.materialCost;
        for (const cat of LABOR_CATEGORIES) {
          if (fOvr['laborCat_' + cat.key] != null) {
            laborCatHrs[cat.key] = fOvr['laborCat_' + cat.key];
            laborCatCost[cat.key] = fOvr['laborCat_' + cat.key] * rate;
          }
        }
        const laborCost = laborHrs * rate;
        const fTotal = (fOvr.totalCost != null) ? fOvr.totalCost : (matCost + laborCost);
        const fHasOvr = Object.keys(fOvr).length > 0;
        rows.push({
          _itemType: f.hvacType || f.hvacTag || 'HVAC Component',
          _size: f.sizeA + (f.sizeB ? '×' + f.sizeB : ''), _shape: capitalize(f.hvacCategory || 'equipment'),
          _page: page, _drawingId: drawingId, _drawingName: drawingName,
          _lengthFt: 0, _matCost: matCost, _laborHrs: laborHrs,
          _laborCost: laborCost, _totalCost: fTotal,
          _laborCatHrs: laborCatHrs, _laborCatCost: laborCatCost, _laborCatLabel: assignedCat,
          _hasOverride: fHasOvr, _overrides: fOvr,
          _orig_laborHrs: origFLabHrs, _orig_materialCost: origFMatCost,
          _orig_laborCost: origFLabCost, _orig_totalCost: origFTotal, _orig_lengthFt: 0,
          _orig_laborCatHrs: origFLabCatHrs,
          phase: f.phase || null, costGroup: f.costGroup || null, gauge: f.gauge || null,
          systemSymbol: f.systemSymbol || f.hvacTag || null,
          _sourceType: 'fitting', _sourceId: f.id,
        });
        continue;
      }

      const shape = inferFittingShape(f);

      const prefix = shape === 'rect' ? 'rect' : 'spiral';
      // rectTap already has 'rect' prefix baked in — don't double-prefix
      const baseKey = f.type === 'rectTap' ? 'rectTap' : prefix + '-' + f.type;
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
      // Plenum: flat pricing, no size dependency
      if (!matCost && baseKey === 'rect-plenum') {
        const pEntry = _priceBookCache && _priceBookCache['rect-plenum'];
        matCost = (pEntry && pEntry.materialCost != null) ? pEntry.materialCost : RECT_PLENUM_DEFAULT;
      }
      // Rect flex connector fallback: flat pricing from defaults by min-width class
      if (!matCost && shape === 'rect' && baseKey === 'rect-flex-conn') {
        const mainDims = parseRectDims(f.sizeA);
        if (mainDims) {
          const mwMax = findMinWidthClass(mainDims.W, mainDims.H);
          const mwKeyG = baseKey + '-mw' + mwMax + '-g' + (f.gauge || '26');
          const mwKey  = baseKey + '-mw' + mwMax;
          const mwEntry = _priceBookCache && (_priceBookCache[mwKeyG] || _priceBookCache[mwKey]);
          if (mwEntry && mwEntry.materialCost != null) {
            matCost = mwEntry.materialCost;
          } else if (RECT_FLEX_CONN_DEFAULTS[mwMax] != null) {
            matCost = RECT_FLEX_CONN_DEFAULTS[mwMax];
          }
        }
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
            // Add liner: if fitting is explicitly lined OR if a liner option has pricing in PB
            const _linerOpt = (f.lined && f.linerThickness)
              ? (LINER_OPTIONS.find(o => o.thickness === f.linerThickness) || LINER_OPTIONS[0])
              : LINER_OPTIONS[LINER_OPTIONS.length - 1]; // default to largest (1.5")
            const _linerEntry = _priceBookCache ? _priceBookCache[_linerOpt.key] : null;
            const _linerSF = (_linerEntry && _linerEntry.materialCost != null) ? _linerEntry.materialCost : 0;
            if (_linerSF > 0) {
              matCost += sa * _linerSF;
            }
            // Add fitting-specific shop overhead (check PB override first, then defaults)
            const _shopKey = baseKey + '-mw' + mwMax + '-shop';
            const _shopEntry = _priceBookCache && _priceBookCache[_shopKey];
            let _shopOH = (_shopEntry && _shopEntry.materialCost != null) ? _shopEntry.materialCost : null;
            // Fitting-specific defaults
            if (_shopOH == null) {
              if ((baseKey === 'rect-reducer' || baseKey === 'rect-eccReducer') && RECT_REDUCER_SHOP_DEFAULTS[mwMax] != null) _shopOH = RECT_REDUCER_SHOP_DEFAULTS[mwMax];
              else if (baseKey === 'rect-endcap' && RECT_ENDCAP_SHOP_DEFAULTS[mwMax] != null) _shopOH = RECT_ENDCAP_SHOP_DEFAULTS[mwMax];
              else if (baseKey === 'rect-transition' && RECT_TRANSITION_SHOP_DEFAULTS[mwMax] != null) _shopOH = RECT_TRANSITION_SHOP_DEFAULTS[mwMax];
              else if (baseKey === 'rectTap' && RECT_TAP_SHOP_DEFAULTS[mwMax] != null) _shopOH = RECT_TAP_SHOP_DEFAULTS[mwMax];
              else if (baseKey === 'rect-45el' && RECT_45EL_SHOP_DEFAULTS[mwMax] != null) _shopOH = RECT_45EL_SHOP_DEFAULTS[mwMax];
              // Fallback: use duct shop overhead for fittings without specific defaults
              // (elbows, tees, wyes, laterals, sq-wing) — uses the perim-class duct rate
              else {
                const perim = 2 * (mainDims.W + mainDims.H);
                let pcMax = 168;
                for (const pc of RECT_PERIM_CLASSES) { if (perim <= pc.maxPerim) { pcMax = pc.maxPerim; break; } }
                if (RECT_DUCT_SHOP_DEFAULTS[pcMax] != null) _shopOH = RECT_DUCT_SHOP_DEFAULTS[pcMax];
              }
            }
            if (_shopOH != null && _shopOH > 0) matCost += _shopOH;
          }
        }
      }
      // Labor: try size-specific key, then base key, then mw-class key for rect
      let bd = getPriceBookLaborBreakdown(sizeKey);
      if (Object.keys(bd).length === 0) bd = getPriceBookLaborBreakdown(baseKey);
      if (Object.keys(bd).length === 0 && shape === 'rect') {
        const mainDims = parseRectDims(f.sizeA);
        if (mainDims) {
          const mwMax = findMinWidthClass(mainDims.W, mainDims.H);
          bd = getPriceBookLaborBreakdown(baseKey + '-mw' + mwMax);
        }
      }

      const laborCatHrs = {};
      const laborCatCost = {};
      let assignedCat = 'unassigned';
      for (const cat of LABOR_CATEGORIES) {
        const ch = bd[cat.key] || 0;
        laborCatHrs[cat.key] = ch;
        laborCatCost[cat.key] = ch * rate;
        if (ch > 0 && assignedCat === 'unassigned') assignedCat = cat.label;
      }
      // Total labor from breakdown; fall back to stored f.laborHrs if breakdown empty
      let laborHrs = Object.values(laborCatHrs).reduce((s, v) => s + v, 0);
      if (laborHrs === 0) {
        laborHrs = f.laborHrs || 0;
        if (laborHrs > 0) {
          const fb = f.phase || 'rough';
          laborCatHrs[fb] = laborHrs;
          laborCatCost[fb] = laborHrs * rate;
          const co = LABOR_CATEGORIES.find(c => c.key === fb);
          assignedCat = co ? co.label : capitalize(fb);
        }
      }
      // Store originals before overrides
      const origFLabHrs = laborHrs, origFMatCost = matCost;
      const origFLabCost = laborHrs * rate;
      const origFTotal = matCost + origFLabCost;
      const origFLabCatHrs = { ...laborCatHrs };

      // Apply manual overrides
      const fOvr = f._overrides || {};
      if (fOvr.laborHrs != null) laborHrs = fOvr.laborHrs;
      if (fOvr.materialCost != null) matCost = fOvr.materialCost;
      // Apply individual labor category overrides back into the breakdown
      for (const cat of LABOR_CATEGORIES) {
        if (fOvr['laborCat_' + cat.key] != null) {
          laborCatHrs[cat.key] = fOvr['laborCat_' + cat.key];
          laborCatCost[cat.key] = fOvr['laborCat_' + cat.key] * rate;
        }
      }
      const laborCost = laborHrs * rate;
      const fTotal = (fOvr.totalCost != null) ? fOvr.totalCost : (matCost + laborCost);
      const fHasOvr = Object.keys(fOvr).length > 0;

      rows.push({
        _itemType: FITTING_NAMES[f.type] || f.type,
        _size: f.sizeA + (f.sizeB ? '×' + f.sizeB : ''), _shape: capitalize(shape),
        _page: page, _drawingId: drawingId, _drawingName: drawingName,
        _lengthFt: 0, _matCost: matCost, _laborHrs: laborHrs,
        _laborCost: laborCost, _totalCost: fTotal,
        _laborCatHrs: laborCatHrs, _laborCatCost: laborCatCost, _laborCatLabel: assignedCat,
        _hasOverride: fHasOvr, _overrides: fOvr,
        _orig_laborHrs: origFLabHrs, _orig_materialCost: origFMatCost,
        _orig_laborCost: origFLabCost, _orig_totalCost: origFTotal, _orig_lengthFt: 0,
        _orig_laborCatHrs: origFLabCatHrs,
        phase: f.phase || null, costGroup: f.costGroup || null, gauge: f.gauge || null,
        systemSymbol: f.systemSymbol || null,
        _sourceType: 'fitting', _sourceId: f.id,
      });
    }

    for (const s of (pd.stacks || [])) {
      for (const it of (s.items || [])) {
        const shape = it.shape || 'round';
        const ec = {}; for (const c of LABOR_CATEGORIES) ec[c.key] = 0;
        let stMatCost = 0;
        let stLengthFt = 0;
        const stGauge = it.gauge || '26';

        if (it.type === 'ductrun' || it.type === 'flexrun') {
          // Vertical duct run: parse rise/drop as length
          const rd = it.riseDrop ? parseFloat(String(it.riseDrop).replace(/[^\d.]/g, '')) : 0;
          stLengthFt = rd || 0;
          if (stLengthFt > 0) {
            const isRect = shape === 'rect' || shape === 'oval';
            if (isRect && it.sizeA && it.sizeB) {
              const w = parseFloat(it.sizeA) || 24, h = parseFloat(it.sizeB) || 12;
              const perim = 2 * (w + h);
              const wPerLF = (perim / 12) * getGaugeWeightPerSF(stGauge);
              stMatCost = wPerLF * (getCompilerShopSettings().sheetMetalPricePerLb || 0) * stLengthFt;
              // Liner
              const _lo = LINER_OPTIONS[LINER_OPTIONS.length - 1];
              const _le = _priceBookCache ? _priceBookCache[_lo.key] : null;
              const _lsf = (_le && _le.materialCost != null) ? _le.materialCost : 0;
              if (_lsf > 0) stMatCost += (perim / 12) * _lsf * stLengthFt;
              // Shop OH by perim class
              let pcM = 168;
              for (const pc of RECT_PERIM_CLASSES) { if (perim <= pc.maxPerim) { pcM = pc.maxPerim; break; } }
              if (RECT_DUCT_SHOP_DEFAULTS[pcM] != null) stMatCost += RECT_DUCT_SHOP_DEFAULTS[pcM] * stLengthFt;
            } else {
              // Round/flex duct
              const dia = parseFloat(it.sizeA) || 14;
              const sizeKey = (it.type === 'flexrun' ? 'flex-' + (it.flexColor || 'black') : 'duct-spiral') + '-' + Math.round(dia);
              const pbE = _priceBookCache && _priceBookCache[sizeKey];
              if (pbE && pbE.materialCost != null) stMatCost = pbE.materialCost * stLengthFt;
              else if (SPIRAL_DEFAULTS[sizeKey] && SPIRAL_DEFAULTS[sizeKey]['26'] != null) stMatCost = SPIRAL_DEFAULTS[sizeKey]['26'] * stLengthFt;
              else if (SNAPLOCK_DEFAULTS[sizeKey] && SNAPLOCK_DEFAULTS[sizeKey]['26'] != null) stMatCost = SNAPLOCK_DEFAULTS[sizeKey]['26'] * stLengthFt;
            }
          }
        } else {
          // Stack fitting: same pricing logic as canvas fittings
          const prefix = shape === 'rect' ? 'rect' : 'spiral';
          const stBaseKey = it.type === 'rectTap' ? 'rectTap' : prefix + '-' + it.type;
          const mainDims = parseRectDims(it.sizeA);
          const branchDims = parseRectDims(it.sizeB);

          if (shape === 'rect' && stBaseKey === 'rect-plenum') {
            const pE = _priceBookCache && _priceBookCache['rect-plenum'];
            stMatCost = (pE && pE.materialCost != null) ? pE.materialCost : RECT_PLENUM_DEFAULT;
          } else if (shape === 'rect' && stBaseKey === 'rect-flex-conn' && mainDims) {
            const mw = findMinWidthClass(mainDims.W, mainDims.H);
            const mwE = _priceBookCache && (_priceBookCache[stBaseKey + '-mw' + mw + '-g' + stGauge] || _priceBookCache[stBaseKey + '-mw' + mw]);
            stMatCost = (mwE && mwE.materialCost != null) ? mwE.materialCost : (RECT_FLEX_CONN_DEFAULTS[mw] || 0);
            stMatCost = (mwE && mwE.materialCost != null) ? mwE.materialCost : (0[mw] || 0);
          } else if (shape === 'rect' && RECT_FITTING_SA[stBaseKey] && mainDims) {
            const sa = calcRectFittingSA(stBaseKey, mainDims.W, mainDims.H,
              branchDims ? branchDims.W : undefined, branchDims ? branchDims.H : undefined);
            const shop = getCompilerShopSettings();
            stMatCost = sa * getGaugeWeightPerSF(stGauge) * (shop.sheetMetalPricePerLb || 0);
            // Liner
            const _lo2 = LINER_OPTIONS[LINER_OPTIONS.length - 1];
            const _le2 = _priceBookCache ? _priceBookCache[_lo2.key] : null;
            const _lsf2 = (_le2 && _le2.materialCost != null) ? _le2.materialCost : 0;
            if (_lsf2 > 0) stMatCost += sa * _lsf2;
            // Shop OH
            const mw2 = findMinWidthClass(mainDims.W, mainDims.H);
            const _sk = stBaseKey + '-mw' + mw2 + '-shop';
            const _se = _priceBookCache && _priceBookCache[_sk];
            let _soh = (_se && _se.materialCost != null) ? _se.materialCost : null;
            if (_soh == null) {
              if ((stBaseKey === 'rect-reducer' || stBaseKey === 'rect-eccReducer') && RECT_REDUCER_SHOP_DEFAULTS[mw2] != null) _soh = RECT_REDUCER_SHOP_DEFAULTS[mw2];
              else if (stBaseKey === 'rect-endcap' && RECT_ENDCAP_SHOP_DEFAULTS[mw2] != null) _soh = RECT_ENDCAP_SHOP_DEFAULTS[mw2];
              else if (stBaseKey === 'rect-transition' && RECT_TRANSITION_SHOP_DEFAULTS[mw2] != null) _soh = RECT_TRANSITION_SHOP_DEFAULTS[mw2];
              else if (stBaseKey === 'rectTap' && RECT_TAP_SHOP_DEFAULTS[mw2] != null) _soh = RECT_TAP_SHOP_DEFAULTS[mw2];
              else if (stBaseKey === 'rect-45el' && RECT_45EL_SHOP_DEFAULTS[mw2] != null) _soh = RECT_45EL_SHOP_DEFAULTS[mw2];
              else {
                const perim2 = 2 * (mainDims.W + mainDims.H);
                let pcM2 = 168;
                for (const pc of RECT_PERIM_CLASSES) { if (perim2 <= pc.maxPerim) { pcM2 = pc.maxPerim; break; } }
                if (RECT_DUCT_SHOP_DEFAULTS[pcM2] != null) _soh = RECT_DUCT_SHOP_DEFAULTS[pcM2];
              }
            }
            if (_soh != null && _soh > 0) stMatCost += _soh;
          } else if (shape === 'round') {
            // Round fitting: check Price Book → spiral/snaplock defaults
            const sizeKey = stBaseKey + '-' + (it.sizeA || '');
            const pbE = _priceBookCache && _priceBookCache[sizeKey];
            if (pbE && pbE.materialCost != null) stMatCost = pbE.materialCost;
            else if (SPIRAL_DEFAULTS[sizeKey] && SPIRAL_DEFAULTS[sizeKey]['26'] != null) stMatCost = SPIRAL_DEFAULTS[sizeKey]['26'];
            else if (SNAPLOCK_DEFAULTS[sizeKey] && SNAPLOCK_DEFAULTS[sizeKey]['26'] != null) stMatCost = SNAPLOCK_DEFAULTS[sizeKey]['26'];
          }
        }

        // Stack item labor: build key for all item types
        const stLabBaseKey = (it.type === 'ductrun' || it.type === 'flexrun')
          ? (it.type === 'flexrun' ? 'flex-' + (it.flexColor || 'black') : (shape === 'rect' ? 'duct-rect' : 'duct-spiral'))
          : (it.type === 'rectTap' ? 'rectTap' : (shape === 'rect' ? 'rect' : 'spiral') + '-' + it.type);
        const stSizeKey = (it.type === 'boot' && it.sizeA && it.sizeB)
          ? stLabBaseKey + '-' + it.sizeA + 'x' + it.sizeB
          : stLabBaseKey + '-' + (it.sizeA || '');
        let stBd = getPriceBookLaborBreakdown(stSizeKey);
        if (Object.keys(stBd).length === 0) stBd = getPriceBookLaborBreakdown(stLabBaseKey);
        if (Object.keys(stBd).length === 0 && shape === 'rect') {
          const stMainDims = parseRectDims(it.sizeA);
          if (stMainDims) {
            const stMw = findMinWidthClass(stMainDims.W, stMainDims.H);
            stBd = getPriceBookLaborBreakdown(stLabBaseKey + '-mw' + stMw);
          }
        }
        const stLabCatHrs = {};
        const stLabCatCost = {};
        let stLabCat = 'unassigned';
        for (const cat of LABOR_CATEGORIES) {
          const ch = stBd[cat.key] || 0;
          const mult = (it.type === 'ductrun' || it.type === 'flexrun') ? stLengthFt : 1;
          stLabCatHrs[cat.key] = ch * mult;
          stLabCatCost[cat.key] = ch * mult * labRate;
          if (ch > 0 && stLabCat === 'unassigned') stLabCat = cat.label;
        }
        const stLabHrs = Object.values(stLabCatHrs).reduce((s, v) => s + v, 0);
        const stLabCost = stLabHrs * labRate;

        rows.push({
          _itemType: it.type === 'ductrun' ? 'Vert. Duct' : (it.type === 'flexrun' ? 'Vert. Flex' : (FITTING_NAMES[it.type] || it.type)),
          _size: it.sizeA + (it.sizeB ? '×' + it.sizeB : ''), _shape: capitalize(shape),
          _page: page, _drawingId: drawingId, _drawingName: drawingName,
          _lengthFt: stLengthFt, _matCost: stMatCost, _laborHrs: stLabHrs, _laborCost: stLabCost, _totalCost: stMatCost + stLabCost,
          _laborCatHrs: stLabCatHrs, _laborCatCost: stLabCatCost, _laborCatLabel: stLabCat,
          phase: null, costGroup: null, gauge: stGauge,
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

    // Item subtotal (sum of all items)
    html += `<tr class="grand-total"><td>Item Subtotal</td>`;
    for (const c of cols) {
      const val = c.extract(filteredRows);
      const cls = c.isSub ? 'num pinned-cat' : 'num';
      const style = c.isSub ? ` style="--cat-color:${c.color}"` : '';
      html += `<td class="${cls}"${style}>${formatVal(val, c.type)}</td>`;
    }
    html += `</tr>`;

    // Item-level override delta (when individual items have been changed)
    const hasItemOverride = filteredRows.some(r => r._hasOverride);
    if (hasItemOverride) {
      html += `<tr class="cmp-delta-row"><td style="font-style:italic">Base (calculated)</td>`;
      for (const c of cols) {
        const origVal = _calcOriginal(filteredRows, c.key, c.isSub ? c.catKey : null);
        html += `<td class="num">${formatVal(origVal, c.type)}</td>`;
      }
      html += `</tr>`;
      html += `<tr class="cmp-delta-row"><td style="font-style:italic">Δ Item Adjustments</td>`;
      for (const c of cols) {
        const currentVal = c.extract(filteredRows);
        const origVal = _calcOriginal(filteredRows, c.key, c.isSub ? c.catKey : null);
        const delta = currentVal - origVal;
        const deltaCls = Math.abs(delta) < 0.005 ? 'cmp-delta-zero' : (delta > 0 ? 'cmp-delta-pos' : 'cmp-delta-neg');
        const sign = delta > 0 ? '+' : '';
        html += `<td class="num ${deltaCls}">${Math.abs(delta) < 0.005 ? '—' : sign + formatVal(delta, c.type)}</td>`;
      }
      html += `</tr>`;
    }

    // Auto-calculated contingency row (derived from Grand Total - Subtotal)
    const hasGrandAdj = Object.values(_grandAdj).some(v => v != null);
    if (hasGrandAdj) {
      html += `<tr class="cmp-delta-row" style="border-top:1px solid #0f3460"><td style="font-style:italic;color:#ffa94d">± Contingency <span style="font-size:9px;color:#ff6b6b;cursor:pointer" onclick="event.stopPropagation();window._cmpClearGrandAdj()" title="Reset grand total to item subtotal">↩</span></td>`;
      for (const c of cols) {
        const adjKey = c.isSub ? c.parentKey + ':' + c.catKey : c.key;
        const adj = _grandAdj[adjKey] || 0;
        const sign = adj > 0 ? '+' : '';
        const adjCls = Math.abs(adj) < 0.005 ? 'cmp-delta-zero' : (adj > 0 ? 'cmp-delta-pos' : 'cmp-delta-neg');
        html += `<td class="num ${adjCls}">${Math.abs(adj) < 0.005 ? '—' : sign + formatVal(adj, c.type)}</td>`;
      }
      html += `</tr>`;
    }

    // Grand Total — editable. User types desired total, contingency auto-derives.
    html += `<tr class="grand-total"><td>Grand Total ${hasGrandAdj ? '<span style="font-size:9px;color:#ffa94d">●</span>' : ''}</td>`;
    for (const c of cols) {
      const base = c.extract(filteredRows);
      const adjKey = c.isSub ? c.parentKey + ':' + c.catKey : c.key;
      const adj = _grandAdj[adjKey] || 0;
      const total = base + adj;
      const cls2 = c.isSub ? 'num pinned-cat' : 'num';
      const style2 = c.isSub ? ` style="--cat-color:${c.color}"` : '';
      const gtEditable = !c.alwaysOn && (c.type === 'number' || c.type === 'currency') && filteredRows.length > 0;
      if (gtEditable) {
        html += `<td class="${cls2} cmp-editable"${style2} onclick="event.stopPropagation(); window._cmpEditGrandTotal(this,'${adjKey}',${base})" title="Click to set desired total — contingency auto-calculates">${formatVal(total, c.type)}</td>`;
      } else {
        html += `<td class="${cls2}"${style2}>${formatVal(total, c.type)}</td>`;
      }
    }
    html += `</tr>`;

    html += `</tbody></table>`;
  }

  // Radar chart below table
  if (filteredRows && filteredRows.length > 0) {
    var rRows = _radarRows || filteredRows;
    var rLabel = _radarTarget ? _radarTarget.split('|').pop() : (_scope === 'selection' ? 'Selection' : 'Entire Project');
    html += renderCompilerRadar(rRows, rLabel);
  }

  html += `</div>`;

  _container.innerHTML = html;
}

function renderCompilerRadar(rows, label) {
  if (!rows || rows.length === 0) return '';
  const rate = getLaborRate();
  const isGlobalScope = !_radarTarget && _scope !== 'selection';
  const rawTotalHrs = rows.reduce((s, r) => s + (r._laborHrs || 0), 0);
  const n = LABOR_CATEGORIES.length;
  const bd = [];
  let maxVal = 0.5;
  let adjTotalHrs = 0;
  for (const cat of LABOR_CATEGORIES) {
    const rawHrs = rows.reduce((s, r) => s + ((r._laborCatHrs && r._laborCatHrs[cat.key]) || 0), 0);
    // At global scope, include grand total contingency for this category
    const adjHrs = isGlobalScope ? rawHrs + (_grandAdj['laborHrs:' + cat.key] || 0) : rawHrs;
    bd.push({ cat, hrs: adjHrs });
    adjTotalHrs += adjHrs;
    if (adjHrs > maxVal) maxVal = adjHrs;
  }
  const totalHrs = isGlobalScope ? adjTotalHrs : rawTotalHrs;
  if (totalHrs === 0 && rawTotalHrs === 0) return '';
  maxVal = Math.ceil(maxVal * 1.15) || 1;
  const cx = 100, cy = 100, R = 80;
  let html = '<div class="cmp-radar">';
  html += '<div class="cmp-radar-head">';
  html += '<span>' + escHtml(label) + ' \u2014 ' + totalHrs.toFixed(1) + 'h / ' + formatVal(totalHrs * rate, 'currency') + '</span>';
  if (_radarTarget) html += '<button onclick="window._cmpResetRadar()">✕ Reset</button>';
  html += '</div>';
  html += '<div class="cmp-radar-body">';
  // SVG polygon
  html += '<div style="flex-shrink:0"><svg width="220" height="220" viewBox="0 0 220 220">';
  for (let ring = 1; ring <= 4; ring++) {
    const rr = R * ring / 4;
    let pts = '';
    for (let j = 0; j < n; j++) {
      const a = -Math.PI / 2 + (2 * Math.PI * j / n);
      pts += (cx + rr * Math.cos(a)).toFixed(1) + ',' + (cy + rr * Math.sin(a)).toFixed(1) + ' ';
    }
    html += '<polygon points="' + pts + '" fill="none" stroke="#0f3460" stroke-width="0.5"/>';
  }
  for (let j = 0; j < n; j++) {
    const cat = LABOR_CATEGORIES[j];
    const a = -Math.PI / 2 + (2 * Math.PI * j / n);
    const ex = cx + R * Math.cos(a), ey = cy + R * Math.sin(a);
    const has = bd[j].hrs > 0;
    html += '<line x1="' + cx + '" y1="' + cy + '" x2="' + ex.toFixed(1) + '" y2="' + ey.toFixed(1) + '" stroke="' + (has ? '#0f3460' : '#0a1a30') + '" stroke-width="0.5"/>';
    const lx = cx + (R + 18) * Math.cos(a), ly = cy + (R + 18) * Math.sin(a);
    const anchor = Math.abs(Math.cos(a)) < 0.1 ? 'middle' : (Math.cos(a) > 0 ? 'start' : 'end');
    html += '<text x="' + lx.toFixed(1) + '" y="' + (ly + 4).toFixed(1) + '" fill="' + (has ? cat.color : '#333') + '" font-size="11" text-anchor="' + anchor + '" font-weight="700">' + cat.short + '</text>';
  }
  let dataPts = '';
  for (let j = 0; j < n; j++) {
    const a = -Math.PI / 2 + (2 * Math.PI * j / n);
    let v = bd[j].hrs / maxVal; if (v > 1) v = 1;
    dataPts += (cx + R * v * Math.cos(a)).toFixed(1) + ',' + (cy + R * v * Math.sin(a)).toFixed(1) + ' ';
  }
  html += '<polygon points="' + dataPts + '" fill="rgba(233,69,96,0.2)" stroke="#e94560" stroke-width="1.5"/>';
  for (let j = 0; j < n; j++) {
    const a = -Math.PI / 2 + (2 * Math.PI * j / n);
    let v = bd[j].hrs / maxVal; if (v > 1) v = 1;
    const dx = cx + R * v * Math.cos(a), dy = cy + R * v * Math.sin(a);
    html += '<circle cx="' + dx.toFixed(1) + '" cy="' + dy.toFixed(1) + '" r="4.5" fill="' + (bd[j].hrs > 0 ? LABOR_CATEGORIES[j].color : '#333') + '" stroke="' + (bd[j].hrs > 0 ? '#fff' : '#222') + '" stroke-width="1"/>';
  }
  html += '</svg></div>';
  // Editable inputs
  html += '<div class="cmp-radar-inputs">';
  html += '<div style="display:flex;gap:6px;font-size:9px;color:#555;margin-bottom:2px"><span>Category</span><span style="margin-left:auto">Hours</span><span style="width:28px;text-align:right">%</span><span style="width:55px;text-align:right">Cost</span></div>';
  for (let j = 0; j < n; j++) {
    const cat = LABOR_CATEGORIES[j];
    const hrs = bd[j].hrs;
    const cost = hrs * rate;
    const has = hrs > 0;
    const pct = totalHrs > 0 ? (hrs / totalHrs * 100).toFixed(0) : '0';
    html += '<div class="cmp-radar-cat" style="opacity:' + (has ? '1' : '0.3') + '">';
    html += '<span style="color:' + cat.color + ';font-size:11px;font-weight:700;width:24px">' + cat.short + '</span>';
    html += '<input type="text" value="' + (has ? hrs.toFixed(2) : '') + '" placeholder="0" style="color:' + (has ? cat.color : '#333') + '" ';
    html += 'onclick="event.stopPropagation()" onmousedown="event.stopPropagation()" ';
    html += 'onchange="window._cmpRadarEditCat(\'' + cat.key + '\',this.value)">';
    html += '<span style="color:#555;font-size:9px;width:28px;text-align:right">' + pct + '%</span>';
    html += '<span style="color:#a0a0c0;font-size:10px;width:55px;text-align:right">' + (has ? formatVal(cost, 'currency') : '\u2014') + '</span>';
    html += '</div>';
  }
  html += '<div class="cmp-radar-total">';
  html += '<span>Total</span><span>' + totalHrs.toFixed(2) + 'h</span><span>' + formatVal(totalHrs * rate, 'currency') + '</span>';
  html += '</div></div></div></div>';
  return html;
}

function renderTreeRows(node, cols, depth) {
  if (!node._children || node._children.length === 0) return '';
  let html = '';
  for (const child of node._children) {
    const path = child.path;
    const isCollapsed = !!_collapsed[path];
    const hasKids = child._children && child._children._children && child._children._children.length > 0;
    const toggle = hasKids ? `<span class="cmp-toggle">${isCollapsed ? '▶' : '▼'}</span>` : `<span class="cmp-toggle"></span>`;

    const grpHasOverride = child._rows.some(r => r._hasOverride);
    html += `<tr class="group-header depth-${depth}" onclick="window._cmpToggleCollapse('${escapePath(path)}')">`;
    var isRadarFocus = _radarTarget === path;
    html += '<td>' + toggle + ' ' + escHtml(child.label);
    html += ' <span style="font-size:9px;cursor:pointer;color:' + (isRadarFocus ? '#e94560' : '#555') + '" onclick="event.stopPropagation();window._cmpFocusRadar(\'' + escapePath(path) + '\')" title="Show radar for this group">📊</span>';
    if (grpHasOverride) html += '<span class="cmp-ovr-dot" title="Contains overridden values"></span> <span style="font-size:9px;color:#ff6b6b;cursor:pointer;font-weight:400" onclick="event.stopPropagation();window._cmpClearOverrides(\'' + escapePath(path) + '\')" title="Clear all overrides in this group">↩</span>';
    html += '</td>';
    for (const c of cols) {
      const val = c.extract(child._rows);
      const cls = c.isSub ? 'num pinned-cat' : 'num';
      const style = c.isSub ? ` style="--cat-color:${c.color}"` : '';
      const editable = !c.alwaysOn && (c.type === 'number' || c.type === 'currency') && child._rows.length > 0;
      if (editable) {
        const pathEnc = escapePath(path);
        const editKey = c.isSub ? c.parentKey + ':' + c.catKey : c.key;
        // Check for overrides
        let isOvr = false;
        if (c.isSub) {
          isOvr = child._rows.some(r => r._hasOverride && r._overrides && r._overrides['laborCat_' + c.catKey] != null);
        } else {
          const fld = _COL_TO_FIELD[c.key];
          if (fld) isOvr = child._rows.some(r => r._hasOverride && r._overrides && r._overrides[fld] != null);
        }
        let origHtml = '';
        if (isOvr) {
          origHtml = ` data-orig="${formatVal(_calcOriginal(child._rows, c.key, c.isSub ? c.catKey : null), c.type)}"`;
        }
        html += `<td class="${cls} cmp-editable${isOvr ? ' cmp-override' : ''}"${style}${origHtml} onclick="event.stopPropagation(); window._cmpEditCell(this,'${editKey}','${pathEnc}',${child._rows.length})">${isOvr ? '<span class="cmp-val-current">' + formatVal(val, c.type) + '</span>' : formatVal(val, c.type)}</td>`;
      } else {
        html += `<td class="${cls}"${style}>${formatVal(val, c.type)}</td>`;
      }
    }
    html += `</tr>`;
    if (!isCollapsed && child._children) html += renderTreeRows(child._children, cols, depth + 1);
  }
  return html;
}

// Calculate original (pre-override) aggregate for a set of rows
function _calcOriginal(rows, colKey, catKey) {
  // If catKey is provided, calculate original for a specific labor category sub-column
  if (catKey) {
    const isHrs = colKey.indexOf('laborHrs') !== -1 || colKey.indexOf('_') !== -1 && colKey.startsWith('laborHrs');
    let total = 0;
    for (const r of rows) {
      if (r._hasOverride && r._overrides && r._overrides['laborCat_' + catKey] != null) {
        // Original = stored _orig category value
        total += (r._orig_laborCatHrs && r._orig_laborCatHrs[catKey]) || 0;
        if (!isHrs) total = 0; // recalc below
      } else {
        const src = isHrs ? r._laborCatHrs : r._laborCatCost;
        total += (src && src[catKey]) || 0;
      }
    }
    // For cost sub-columns, recalculate from original hours
    if (!isHrs) {
      total = 0;
      const rate = getLaborRate();
      for (const r of rows) {
        if (r._hasOverride && r._overrides && r._overrides['laborCat_' + catKey] != null) {
          total += ((r._orig_laborCatHrs && r._orig_laborCatHrs[catKey]) || 0) * rate;
        } else {
          total += (r._laborCatCost && r._laborCatCost[catKey]) || 0;
        }
      }
    }
    return total;
  }

  // Main column original calculation
  const mapping = _COL_MAP[colKey];
  if (!mapping) return 0;
  const { field, rowProp } = mapping;
  let total = 0;
  for (const r of rows) {
    if (r._hasOverride && r._overrides && r._overrides[field] != null) {
      total += r['_orig_' + field] != null ? r['_orig_' + field] : (r[rowProp] || 0);
    } else {
      total += r[rowProp] || 0;
    }
  }
  return total;
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

function _loadGrandAdj() {
  try { _grandAdj = JSON.parse(localStorage.getItem('isplan_grand_adj_' + _projectId) || '{}'); }
  catch (e) { _grandAdj = {}; }
}
function _saveGrandAdj() {
  if (!_projectId) return;
  const hasVals = Object.values(_grandAdj).some(v => v != null);
  if (hasVals) localStorage.setItem('isplan_grand_adj_' + _projectId, JSON.stringify(_grandAdj));
  else localStorage.removeItem('isplan_grand_adj_' + _projectId);
}

async function loadCompilerData() {
  if (!_projectId) { _rows = []; return; }
  await loadPriceBook();
  await loadProjectRate(_projectId);
  _loadGrandAdj();

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

// ── Inline cell editing ───────────────────────────────────────────────

window._cmpEditCell = function(td, colKey, groupPath, rowCount) {
  const currentText = td.textContent.replace(/[,$]/g, '').replace('—', '').trim();
  const currentVal = parseFloat(currentText) || 0;
  const input = document.createElement('input');
  input.className = 'cmp-cell-edit';
  input.type = 'text';
  input.value = currentVal || '';
  input.setAttribute('data-col', colKey);
  input.setAttribute('data-path', groupPath);
  input.setAttribute('data-rows', rowCount);
  input.setAttribute('data-original', currentVal);
  td.textContent = '';
  td.appendChild(input);
  input.focus();
  input.select();

  let committed = false;
  const commit = async () => {
    if (committed) return;
    committed = true;
    const newVal = parseFloat(input.value);
    if (isNaN(newVal) || newVal === currentVal) { renderCompiler(); return; }
    try {
      await _cmpApplyOverride(colKey, groupPath, newVal, currentVal);
    } catch (e) {
      console.error('Override apply failed:', e);
      renderCompiler();
    }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); committed = true; renderCompiler(); }
  });
};

// Map column key to: override field name, and row property to read current value
const _COL_MAP = {
  totalLF:      { field: 'lengthFt',     rowProp: '_lengthFt' },
  materialCost: { field: 'materialCost', rowProp: '_matCost' },
  laborHrs:     { field: 'laborHrs',     rowProp: '_laborHrs' },
  laborCost:    { field: 'laborCost',    rowProp: '_laborCost' },
  totalCost:    { field: 'totalCost',    rowProp: '_totalCost' },
};
// Keep _COL_TO_FIELD for override indicator check
const _COL_TO_FIELD = { totalLF: 'lengthFt', materialCost: 'materialCost', laborHrs: 'laborHrs', laborCost: 'laborCost', totalCost: 'totalCost' };

async function _cmpApplyOverride(colKey, groupPath, newVal, oldVal) {
  // Find the rows matching this group path
  const filteredRows = applyFilters(_rows);
  const tree = buildGroupTree(filteredRows, _activeGroups);
  const targetRows = _findRowsByPath(tree, groupPath);
  if (!targetRows || targetRows.length === 0) { renderCompiler(); return; }

  // Check if this is a labor category sub-column edit (format: "laborHrs:rough")
  const catSplit = colKey.split(':');
  const isCatEdit = catSplit.length === 2;
  const parentCol = isCatEdit ? catSplit[0] : colKey;
  const catKey = isCatEdit ? catSplit[1] : null;

  const rate = getLaborRate();
  const ratio = oldVal > 0 ? newVal / oldVal : 0;
  const even = newVal / targetRows.length;

  if (isCatEdit) {
    // Category sub-column edit: change specific labor category on each row
    const isHrs = parentCol === 'laborHrs';
    for (const row of targetRows) {
      const catSrc = isHrs ? row._laborCatHrs : row._laborCatCost;
      const oldCatVal = (catSrc && catSrc[catKey]) || 0;
      const newCatVal = oldVal > 0 ? oldCatVal * ratio : even;

      if (!row._overrides) row._overrides = {};
      row._hasOverride = true;

      if (isHrs) {
        // Store the category hours override
        row._overrides['laborCat_' + catKey] = parseFloat(newCatVal.toFixed(4));
        // Recalc total laborHrs = sum of all categories
        const totalHrs = LABOR_CATEGORIES.reduce((s, cat) => {
          if (cat.key === catKey) return s + newCatVal;
          return s + ((row._laborCatHrs && row._laborCatHrs[cat.key]) || 0);
        }, 0);
        row._overrides.laborHrs = parseFloat(totalHrs.toFixed(4));
        row._overrides.laborCost = parseFloat((totalHrs * rate).toFixed(2));
        row._overrides.totalCost = parseFloat(((row._matCost || 0) + totalHrs * rate).toFixed(2));
      } else {
        // laborCost category: back-calc hours from cost
        const newCatHrs = parseFloat((newCatVal / rate).toFixed(4));
        row._overrides['laborCat_' + catKey] = newCatHrs;
        const totalHrs = LABOR_CATEGORIES.reduce((s, cat) => {
          if (cat.key === catKey) return s + newCatHrs;
          return s + ((row._laborCatHrs && row._laborCatHrs[cat.key]) || 0);
        }, 0);
        row._overrides.laborHrs = parseFloat(totalHrs.toFixed(4));
        row._overrides.laborCost = parseFloat((totalHrs * rate).toFixed(2));
        row._overrides.totalCost = parseFloat(((row._matCost || 0) + totalHrs * rate).toFixed(2));
      }
      await _writeOverrideToSource(row);
    }
  } else {
    // Main column edit
    const mapping = _COL_MAP[colKey];
    if (!mapping) { renderCompiler(); return; }
    const { field, rowProp } = mapping;

    for (const row of targetRows) {
      const oldItemVal = row[rowProp] || 0;
      const newItemVal = oldVal > 0 ? oldItemVal * ratio : even;

      if (!row._overrides) row._overrides = {};
      row._overrides[field] = parseFloat(newItemVal.toFixed(4));
      row._hasOverride = true;

      // Cascade: if laborHrs changed, recalc laborCost and totalCost
      if (field === 'laborHrs') {
        row._overrides.laborCost = parseFloat((newItemVal * rate).toFixed(2));
        row._overrides.totalCost = parseFloat(((row._matCost || 0) + newItemVal * rate).toFixed(2));
      }
      // Cascade: if materialCost changed, recalc totalCost
      if (field === 'materialCost') {
        row._overrides.totalCost = parseFloat((newItemVal + (row._laborCost || 0)).toFixed(2));
      }
      await _writeOverrideToSource(row);
    }
  }

  // Reload and re-render
  await loadCompilerData();
  renderCompiler();
}

function _findRowsByPath(node, targetPath) {
  // node can be either: { _rows, _children: [...] } from root/recursive
  // or the tree root itself
  const children = Array.isArray(node) ? node : (node && node._children ? node._children : null);
  if (!children || !Array.isArray(children)) return null;
  for (const child of children) {
    if (child.path === targetPath) return child._rows;
    if (child._children) {
      const found = _findRowsByPath(child._children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

async function _writeOverrideToSource(row) {
  if (!row._sourceType || !row._sourceId) return;
  const drawingId = row._drawingId;
  if (!drawingId) return;

  const ovr = row._overrides || {};
  const isEmpty = Object.keys(ovr).length === 0;

  // Load the pageData for this drawing
  const allPD = await cGetByIndex('pageData', 'drawingId', drawingId);
  for (const pd of allPD) {
    let changed = false;
    if (row._sourceType === 'measurement') {
      for (const m of (pd.measurements || [])) {
        if (m.id === row._sourceId) {
          m._overrides = isEmpty ? undefined : { ...ovr };
          changed = true; break;
        }
      }
    } else if (row._sourceType === 'fitting') {
      for (const f of (pd.fittings || [])) {
        if (f.id === row._sourceId) {
          f._overrides = isEmpty ? undefined : { ...ovr };
          changed = true; break;
        }
      }
    } else if (row._sourceType === 'stack') {
      for (const s of (pd.stacks || [])) {
        for (const it of (s.items || [])) {
          if (it.id === row._sourceId) {
            it._overrides = isEmpty ? undefined : { ...ovr };
            changed = true; break;
          }
        }
        if (changed) break;
      }
    }
    if (changed) {
      await cPut('pageData', pd);
      break;
    }
  }
}

// ── Clear overrides ───────────────────────────────────────────────────
window._cmpClearOverrides = async function(groupPath) {
  const filteredRows = applyFilters(_rows);
  const tree = buildGroupTree(filteredRows, _activeGroups);
  const targetRows = _findRowsByPath(tree, groupPath);
  if (!targetRows) return;

  for (const row of targetRows) {
    row._overrides = {};
    row._hasOverride = false;
    await _writeOverrideToSource(row);
  }
  await loadCompilerData();
  renderCompiler();
};

// ── Compiler radar interactions ──────────────────────────────────────

window._cmpFocusRadar = function(groupPath) {
  var filteredRows = applyFilters(_rows);
  var tree = buildGroupTree(filteredRows, _activeGroups);
  var targetRows = _findRowsByPath(tree, groupPath);
  if (targetRows && targetRows.length > 0) {
    _radarTarget = groupPath;
    _radarRows = targetRows;
  }
  renderCompiler();
};

window._cmpResetRadar = function() {
  _radarTarget = null;
  _radarRows = null;
  renderCompiler();
};

window._cmpRadarEditCat = async function(catKey, value) {
  var newTotal = parseFloat(value);
  if (isNaN(newTotal)) { renderCompiler(); return; }
  var rate = getLaborRate();

  // When radar is at project scope with no group focused,
  // use the grand total contingency system instead of distributing to items.
  // Selection scope always distributes to selected items (like a group).
  if (!_radarTarget && _scope !== 'selection') {
    var scopeRows = applyFilters(_rows);
    var subtotal = scopeRows.reduce(function(s, r) { return s + ((r._laborCatHrs && r._laborCatHrs[catKey]) || 0); }, 0);
    var contingency = newTotal - subtotal;
    var adjKeyHrs = 'laborHrs:' + catKey;
    var adjKeyCost = 'laborCost:' + catKey;
    if (Math.abs(contingency) < 0.005) {
      delete _grandAdj[adjKeyHrs];
      delete _grandAdj[adjKeyCost];
    } else {
      _grandAdj[adjKeyHrs] = parseFloat(contingency.toFixed(4));
      _grandAdj[adjKeyCost] = parseFloat((contingency * rate).toFixed(2));
    }
    // Also update the main laborHrs/laborCost contingencies to reflect the category change
    var totalHrsAdj = 0, totalCostAdj = 0;
    for (var ci = 0; ci < LABOR_CATEGORIES.length; ci++) {
      var ck = LABOR_CATEGORIES[ci].key;
      totalHrsAdj += _grandAdj['laborHrs:' + ck] || 0;
      totalCostAdj += _grandAdj['laborCost:' + ck] || 0;
    }
    if (Math.abs(totalHrsAdj) < 0.005) delete _grandAdj.laborHrs;
    else _grandAdj.laborHrs = parseFloat(totalHrsAdj.toFixed(4));
    if (Math.abs(totalCostAdj) < 0.005) delete _grandAdj.laborCost;
    else _grandAdj.laborCost = parseFloat(totalCostAdj.toFixed(2));
    // Recalc totalCost contingency
    var matAdj = _grandAdj.materialCost || 0;
    var totalAdj = totalHrsAdj + matAdj;
    if (Math.abs(totalAdj) < 0.005) delete _grandAdj.totalCost;
    else _grandAdj.totalCost = parseFloat(totalAdj.toFixed(2));
    _saveGrandAdj();
    renderCompiler();
    return;
  }

  // Group-focused or selection-scope radar: distribute override to individual items
  var rows = _radarRows || applyFilters(_rows);
  if (!rows || rows.length === 0) return;
  var oldTotal = rows.reduce(function(s, r) { return s + ((r._laborCatHrs && r._laborCatHrs[catKey]) || 0); }, 0);
  var ratio = oldTotal > 0 ? newTotal / oldTotal : 0;
  var even = newTotal / rows.length;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var oldCatVal = (row._laborCatHrs && row._laborCatHrs[catKey]) || 0;
    var newCatVal = oldTotal > 0 ? oldCatVal * ratio : even;
    if (!row._overrides) row._overrides = {};
    row._hasOverride = true;
    row._overrides['laborCat_' + catKey] = parseFloat(newCatVal.toFixed(4));
    var totalHrs = 0;
    for (var c = 0; c < LABOR_CATEGORIES.length; c++) {
      if (LABOR_CATEGORIES[c].key === catKey) totalHrs += newCatVal;
      else totalHrs += (row._laborCatHrs && row._laborCatHrs[LABOR_CATEGORIES[c].key]) || 0;
    }
    row._overrides.laborHrs = parseFloat(totalHrs.toFixed(4));
    row._overrides.laborCost = parseFloat((totalHrs * rate).toFixed(2));
    row._overrides.totalCost = parseFloat(((row._matCost || 0) + totalHrs * rate).toFixed(2));
    await _writeOverrideToSource(row);
  }
  await loadCompilerData();
  renderCompiler();
};

// ── Grand total contingency editing ────────────────────────────────────
// Grand total editing: user types desired total, contingency = desired - subtotal
window._cmpEditGrandTotal = function(td, adjKey, subtotal) {
  const currentAdj = _grandAdj[adjKey] || 0;
  const currentTotal = subtotal + currentAdj;
  const input = document.createElement('input');
  input.className = 'cmp-cell-edit';
  input.type = 'text';
  input.value = currentTotal ? currentTotal.toFixed(2) : '';
  input.placeholder = 'Desired total';
  td.textContent = '';
  td.appendChild(input);
  input.focus();
  input.select();

  let done = false;
  const save = () => {
    if (done) return;
    done = true;
    const desiredTotal = parseFloat(input.value);
    if (isNaN(desiredTotal)) { renderCompiler(); return; }

    const contingency = desiredTotal - subtotal;
    if (Math.abs(contingency) < 0.005) { delete _grandAdj[adjKey]; }
    else { _grandAdj[adjKey] = parseFloat(contingency.toFixed(4)); }

    const rate = getLaborRate();
    // Cascade: if editing a labor hrs column (main or category), auto-set labor cost contingency
    if (adjKey === 'laborHrs') {
      if (_grandAdj.laborHrs) _grandAdj.laborCost = parseFloat((_grandAdj.laborHrs * rate).toFixed(2));
      else delete _grandAdj.laborCost;
    }
    if (adjKey === 'laborCost') {
      if (_grandAdj.laborCost) _grandAdj.laborHrs = parseFloat((_grandAdj.laborCost / rate).toFixed(4));
      else delete _grandAdj.laborHrs;
    }
    // Category sub-column cascade
    if (adjKey.indexOf(':') !== -1) {
      const parts = adjKey.split(':');
      const catKey = parts[1];
      if (parts[0] === 'laborHrs') {
        const costKey = 'laborCost:' + catKey;
        if (_grandAdj[adjKey]) _grandAdj[costKey] = parseFloat((_grandAdj[adjKey] * rate).toFixed(2));
        else delete _grandAdj[costKey];
        // Also update main laborHrs contingency = sum of all category contingencies
        _syncGrandLaborTotals();
      } else if (parts[0] === 'laborCost') {
        const hrsKey = 'laborHrs:' + catKey;
        if (_grandAdj[adjKey]) _grandAdj[hrsKey] = parseFloat((_grandAdj[adjKey] / rate).toFixed(4));
        else delete _grandAdj[hrsKey];
        _syncGrandLaborTotals();
      }
    }

    _saveGrandAdj();
    renderCompiler();
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); done = true; renderCompiler(); }
  });
};

// Sync main laborHrs/laborCost contingencies from sum of category contingencies
function _syncGrandLaborTotals() {
  const rate = getLaborRate();
  let totalHrsAdj = 0;
  for (const cat of LABOR_CATEGORIES) {
    totalHrsAdj += _grandAdj['laborHrs:' + cat.key] || 0;
  }
  if (Math.abs(totalHrsAdj) > 0.001) {
    _grandAdj.laborHrs = parseFloat(totalHrsAdj.toFixed(4));
    _grandAdj.laborCost = parseFloat((totalHrsAdj * rate).toFixed(2));
  } else {
    delete _grandAdj.laborHrs;
    delete _grandAdj.laborCost;
  }
}

window._cmpClearGrandAdj = function() {
  _grandAdj = {};
  _saveGrandAdj();
  renderCompiler();
};

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
