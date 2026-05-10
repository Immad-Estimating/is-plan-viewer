// =====================================================
// IS Plan Viewer — HVAC Component Library
// =====================================================
// Master library of HVAC components across all categories.
// Matches AI-extracted schedule items to known library entries,
// syncs pricing with the Price Book, persists in IndexedDB.
// Pure ES module — zero dependency on index.html internals.
// =====================================================

const DB_NAME = 'ISPlanViewerDB';
const STORE_NAME = 'hvacLibrary';

// ── Category display config ───────────────────────────────────────────
const CATEGORIES = [
  { key: 'equipment',        label: 'Equipment',        icon: '⚙️',  color: '#4dabf7' },
  { key: 'fan',              label: 'Fans',             icon: '🌀', color: '#69db7c' },
  { key: 'air-distribution', label: 'Air Distribution', icon: '💨', color: '#ffd43b' },
  { key: 'terminal',         label: 'Terminal Units',   icon: '📦', color: '#da77f2' },
  { key: 'energy-recovery',  label: 'Energy Recovery',  icon: '♻️',  color: '#74c0fc' },
  { key: 'heating',          label: 'Heating',          icon: '🔥', color: '#ff8787' },
  { key: 'makeup-air',       label: 'Makeup Air',       icon: '🌬️', color: '#ffa94d' },
  { key: 'specialty',        label: 'Specialty',        icon: '⚠️',  color: '#a9e34b' },
];

const CAT_MAP = {};
CATEGORIES.forEach(c => { CAT_MAP[c.key] = c; });

// ── IndexedDB helpers ─────────────────────────────────────────────────
let _db = null;

function _openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    // First, open without version to discover current state
    const probe = indexedDB.open(DB_NAME);
    probe.onsuccess = (e) => {
      const db = e.target.result;
      const ver = db.version;
      if (db.objectStoreNames.contains(STORE_NAME)) {
        // Store already exists — reuse this connection
        _db = db;
        resolve(_db);
      } else {
        // Store missing — close and reopen with version bump to create it
        db.close();
        const upgrade = indexedDB.open(DB_NAME, ver + 1);
        upgrade.onupgradeneeded = (ue) => {
          const udb = ue.target.result;
          if (!udb.objectStoreNames.contains(STORE_NAME)) {
            const store = udb.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            store.createIndex('category', 'category', { unique: false });
          }
        };
        upgrade.onsuccess = (ue) => {
          _db = ue.target.result;
          resolve(_db);
        };
        upgrade.onerror = (ue) => reject(ue.target.error);
      }
    };
    probe.onerror = (e) => reject(e.target.error);
  });
}

async function _txRead(fn) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    fn(store, resolve, reject);
  });
}

async function _txWrite(fn) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    fn(store, resolve, reject);
  });
}

// ── CSS injection ─────────────────────────────────────────────────────
let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement('style');
  style.textContent = `
/* HVAC Library Panel */
.hvac-lib-panel { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #e0e0e0; }

.hvac-lib-tabs { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 0; }
.hvac-lib-tab {
  padding: 5px 12px; border-radius: 14px; border: 1px solid #0f3460;
  background: #16213e; color: #a0a0c0; font-size: 12px; cursor: pointer;
  transition: all .15s; display: flex; align-items: center; gap: 4px; white-space: nowrap;
}
.hvac-lib-tab:hover { border-color: #e94560; color: #e0e0e0; }
.hvac-lib-tab.active { background: var(--tab-color, #e94560); color: #fff; border-color: transparent; font-weight: 600; }
.hvac-lib-tab .tab-count { font-size: 10px; opacity: .7; margin-left: 2px; }

.hvac-lib-search {
  width: 100%; padding: 8px 12px; background: #1a1a2e; border: 1px solid #0f3460;
  border-radius: 6px; color: #e0e0e0; font-size: 13px; margin: 6px 0 10px; box-sizing: border-box;
}
.hvac-lib-search::placeholder { color: #555; }
.hvac-lib-search:focus { outline: none; border-color: #e94560; }

.hvac-lib-grid { display: flex; flex-direction: column; gap: 6px; }

.hvac-lib-card {
  background: #16213e; border: 1px solid #0f3460; border-radius: 8px;
  padding: 10px 14px; cursor: pointer; transition: border-color .15s;
}
.hvac-lib-card:hover { border-color: #e94560; }
.hvac-lib-card.expanded { border-color: #4dabf7; }

.hvac-lib-card-header {
  display: flex; align-items: center; gap: 10px; justify-content: space-between;
}
.hvac-lib-card-title { font-size: 13px; font-weight: 600; color: #e0e0e0; }
.hvac-lib-card-sub { font-size: 11px; color: #a0a0c0; }
.hvac-lib-card-specs { font-size: 11px; color: #a0a0c0; display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
.hvac-lib-card-specs span { background: #1a1a2e; padding: 1px 6px; border-radius: 3px; }
.hvac-lib-badge {
  font-size: 9px; padding: 2px 6px; border-radius: 8px; background: #0f3460;
  color: #a0a0c0; white-space: nowrap;
}
.hvac-lib-pricing { font-size: 11px; color: #00ff88; }

/* Expanded card detail */
.hvac-lib-detail { margin-top: 10px; padding-top: 10px; border-top: 1px solid #0f3460; }
.hvac-lib-detail-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; font-size: 12px;
}
.hvac-lib-detail-grid label { color: #a0a0c0; font-size: 10px; display: block; margin-bottom: 2px; }
.hvac-lib-detail-grid input, .hvac-lib-detail-grid select, .hvac-lib-detail-grid textarea {
  width: 100%; background: #1a1a2e; border: 1px solid #0f3460; color: #e0e0e0;
  padding: 5px 8px; border-radius: 4px; font-size: 12px; box-sizing: border-box;
}
.hvac-lib-detail-grid textarea { grid-column: 1 / -1; min-height: 50px; resize: vertical; }
.hvac-lib-detail-actions { margin-top: 8px; display: flex; gap: 6px; }

/* Section headers in expanded card */
.hvac-lib-section { margin-top: 10px; }
.hvac-lib-section-head {
  display: flex; align-items: center; gap: 6px; margin-bottom: 6px; cursor: pointer; user-select: none;
}
.hvac-lib-section-icon { font-size: 12px; }
.hvac-lib-section-label { font-size: 10px; color: #a0a0c0; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
.hvac-lib-section-line { flex: 1; height: 1px; background: #0f3460; }

/* Pricing row — material + labor side by side */
.hvac-lib-pricing-row {
  display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap;
}
.hvac-lib-price-box {
  flex: 1; min-width: 120px; background: #1a1a2e; border: 1px solid #0f3460;
  border-radius: 6px; padding: 8px 10px;
}
.hvac-lib-price-label { font-size: 10px; color: #a0a0c0; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px; }
.hvac-lib-price-input {
  width: 100%; background: transparent; border: none; color: #00ff88;
  font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums;
  outline: none; padding: 0;
}
.hvac-lib-price-input::placeholder { color: #333; }
.hvac-lib-price-input.labor-val { color: #ffd43b; }
.hvac-lib-price-input.rate-val { color: #a0a0c0; font-size: 13px; font-weight: 400; }
.hvac-lib-price-sub { font-size: 10px; color: #555; margin-top: 2px; }

/* Labor radar chart */
.hvac-lib-radar-wrap {
  margin-top: 8px; background: #1a1a2e; border: 1px solid #0f3460;
  border-radius: 8px; padding: 10px; overflow: hidden;
}
.hvac-lib-radar-toggle {
  display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;
}
.hvac-lib-radar-toggle:hover .hvac-lib-radar-arrow { color: #e94560; }
.hvac-lib-radar-arrow { color: #555; font-size: 10px; transition: transform 0.2s; }
.hvac-lib-radar-arrow.open { transform: rotate(90deg); color: #e94560; }
.hvac-lib-radar-label { font-size: 11px; color: #a0a0c0; font-weight: 600; }
.hvac-lib-radar-total { font-size: 12px; color: #ffd43b; font-weight: 700; }
.hvac-lib-radar-dots { display: flex; gap: 3px; align-items: center; }
.hvac-lib-radar-dot { width: 6px; height: 6px; border-radius: 50%; }
.hvac-lib-radar-body { margin-top: 8px; display: flex; gap: 14px; align-items: flex-start; }
.hvac-lib-radar-cats {
  display: flex; flex-direction: column; gap: 4px; flex: 1;
}
.hvac-lib-cat-row {
  display: flex; align-items: center; gap: 6px; padding: 3px 6px;
  border-radius: 4px; transition: background 0.1s;
}
.hvac-lib-cat-row:hover { background: rgba(15,52,96,0.5); }
.hvac-lib-cat-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.hvac-lib-cat-label { font-size: 11px; color: #a0a0c0; flex: 1; }
.hvac-lib-cat-input {
  width: 52px; background: #16213e; border: 1px solid #0f3460; color: #e0e0e0;
  padding: 3px 6px; border-radius: 3px; font-size: 12px; text-align: right;
  font-variant-numeric: tabular-nums;
}
.hvac-lib-cat-input:focus { outline: none; border-color: #e94560; }
.hvac-lib-cat-unit { font-size: 10px; color: #555; width: 10px; }
.hvac-lib-btn {
  padding: 5px 12px; border-radius: 4px; border: none; font-size: 11px;
  cursor: pointer; font-weight: 600; transition: opacity .15s;
}
.hvac-lib-btn:hover { opacity: .85; }
.hvac-lib-btn-primary { background: #00ff88; color: #1a1a2e; }
.hvac-lib-btn-danger { background: #e94560; color: #fff; }
.hvac-lib-btn-secondary { background: #0f3460; color: #e0e0e0; }
.hvac-lib-btn-add {
  width: 100%; padding: 8px; background: transparent; border: 1px dashed #0f3460;
  color: #a0a0c0; border-radius: 6px; cursor: pointer; font-size: 12px; margin-top: 6px;
  transition: all .15s;
}
.hvac-lib-btn-add:hover { border-color: #00ff88; color: #00ff88; }

.hvac-lib-empty { text-align: center; padding: 30px; color: #555; font-size: 13px; }

/* Match Step UI */
.hvac-match-panel { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #e0e0e0; }

.hvac-match-row {
  background: #16213e; border: 1px solid #0f3460; border-radius: 8px;
  margin-bottom: 6px; overflow: hidden; transition: border-color .15s;
}
.hvac-match-row:hover { border-color: #4dabf7; }

.hvac-match-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; cursor: pointer; gap: 10px;
}
.hvac-match-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.hvac-match-tag {
  font-weight: 700; font-size: 13px; color: #e0e0e0; white-space: nowrap;
}
.hvac-match-type { font-size: 12px; color: #a0a0c0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hvac-match-spec { font-size: 11px; color: #a0a0c0; background: #1a1a2e; padding: 1px 6px; border-radius: 3px; white-space: nowrap; }

.hvac-match-indicator { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.hvac-match-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.hvac-match-label { font-size: 11px; font-weight: 600; white-space: nowrap; }
.hvac-match-name { font-size: 11px; color: #a0a0c0; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.hvac-match-expand {
  padding: 0 14px 12px; border-top: 1px solid #0f3460; display: none;
}
.hvac-match-row.open .hvac-match-expand { display: block; padding-top: 10px; }

.hvac-match-options { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.hvac-match-option {
  display: flex; align-items: center; justify-content: space-between;
  background: #1a1a2e; padding: 6px 10px; border-radius: 4px; font-size: 12px;
}
.hvac-match-option-info { display: flex; align-items: center; gap: 6px; }
.hvac-match-score { font-size: 10px; padding: 1px 5px; border-radius: 3px; font-weight: 600; }

.hvac-match-bulk {
  display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; padding-top: 10px;
  border-top: 1px solid #0f3460;
}
`;
  document.head.appendChild(style);
}

// ── Labor categories (mirrors Price Book) ─────────────────────────────
const LABOR_CATS = [
  { key: 'rough',       label: 'Rough',        short: 'R',  color: '#4dabf7' },
  { key: 'air-handler', label: 'Air Handler',   short: 'AH', color: '#69db7c' },
  { key: 'condenser',   label: 'Condenser',     short: 'CU', color: '#69db7c' },
  { key: 'lineset',     label: 'Line Set',      short: 'LS', color: '#ffd43b' },
  { key: 'trim',        label: 'Trim',          short: 'T',  color: '#da77f2' },
  { key: 'venting',     label: 'Venting',       short: 'V',  color: '#ff8787' },
  { key: 'stocking',    label: 'Stocking',      short: 'SK', color: '#a9e34b' },
  { key: 'startup',     label: 'Startup',       short: 'SU', color: '#ffa94d' },
  { key: 'qc',          label: 'Quality Ctrl',  short: 'QC', color: '#74c0fc' },
];

// Applicable labor cats per library category
function _applicableCats(category) {
  switch (category) {
    case 'equipment':       return ['air-handler','condenser','lineset','stocking','startup','qc'];
    case 'fan':             return ['rough','stocking','startup','qc'];
    case 'air-distribution':return ['rough','trim','stocking','qc'];
    case 'terminal':        return ['rough','trim','stocking','startup','qc'];
    case 'heating':         return ['rough','stocking','startup','qc'];
    case 'energy-recovery': return ['air-handler','stocking','startup','qc'];
    case 'makeup-air':      return ['rough','stocking','startup','qc'];
    case 'specialty':       return ['rough','trim','stocking','qc'];
    default:                return LABOR_CATS.map(c => c.key);
  }
}

function _getTotalBreakdownHrs(breakdown) {
  if (!breakdown || typeof breakdown !== 'object') return 0;
  return Object.values(breakdown).reduce((s, v) => s + (parseFloat(v) || 0), 0);
}

// Build radar chart SVG
function _renderRadarSVG(breakdown, applicableKeys) {
  const cats = LABOR_CATS;
  const n = cats.length;
  const cx = 80, cy = 80, r = 62;
  let maxVal = 1;
  for (const c of cats) { const v = breakdown[c.key] || 0; if (v > maxVal) maxVal = Math.ceil(v); }

  let svg = `<svg width="170" height="170" viewBox="0 0 170 170" style="flex-shrink:0">`;
  // Background rings
  for (let ring = 1; ring <= 4; ring++) {
    const rr = r * ring / 4;
    const pts = [];
    for (let j = 0; j < n; j++) {
      const a = -Math.PI/2 + (2*Math.PI*j/n);
      pts.push(`${(cx + rr*Math.cos(a)).toFixed(1)},${(cy + rr*Math.sin(a)).toFixed(1)}`);
    }
    svg += `<polygon points="${pts.join(' ')}" fill="none" stroke="#0f3460" stroke-width="0.5"/>`;
  }
  // Axes + labels
  for (let j = 0; j < n; j++) {
    const c = cats[j];
    const enabled = applicableKeys.includes(c.key);
    const a = -Math.PI/2 + (2*Math.PI*j/n);
    const ex = cx + r*Math.cos(a), ey = cy + r*Math.sin(a);
    svg += `<line x1="${cx}" y1="${cy}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${enabled ? '#0f3460' : '#0a1a30'}" stroke-width="0.5"/>`;
    const lx = cx + (r+15)*Math.cos(a), ly = cy + (r+15)*Math.sin(a);
    const anchor = Math.abs(Math.cos(a)) < 0.1 ? 'middle' : (Math.cos(a) > 0 ? 'start' : 'end');
    svg += `<text x="${lx.toFixed(1)}" y="${(ly+3).toFixed(1)}" fill="${enabled ? c.color : '#333'}" font-size="9" text-anchor="${anchor}" font-weight="700">${c.short}</text>`;
  }
  // Data polygon
  const dataPts = [];
  for (let j = 0; j < n; j++) {
    const a = -Math.PI/2 + (2*Math.PI*j/n);
    const val = Math.min((breakdown[cats[j].key] || 0) / maxVal, 1);
    dataPts.push(`${(cx + r*val*Math.cos(a)).toFixed(1)},${(cy + r*val*Math.sin(a)).toFixed(1)}`);
  }
  svg += `<polygon points="${dataPts.join(' ')}" fill="rgba(233,69,96,0.2)" stroke="#e94560" stroke-width="1.5"/>`;
  // Dots
  for (let j = 0; j < n; j++) {
    const c = cats[j];
    const enabled = applicableKeys.includes(c.key);
    const a = -Math.PI/2 + (2*Math.PI*j/n);
    const val = Math.min((breakdown[c.key] || 0) / maxVal, 1);
    const dx = cx + r*val*Math.cos(a), dy = cy + r*val*Math.sin(a);
    svg += `<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="3.5" fill="${enabled ? c.color : '#333'}" stroke="${enabled ? '#fff' : '#222'}" stroke-width="0.8"/>`;
  }
  svg += `</svg>`;
  return svg;
}

// ── Utility helpers ───────────────────────────────────────────────────
function _norm(s) { return (s || '').toLowerCase().trim(); }
function _specSummary(entry) {
  const parts = [];
  if (entry.specs?.tonnage) parts.push(entry.specs.tonnage + ' ton');
  if (entry.specs?.cfm) parts.push(entry.specs.cfm.toLocaleString() + ' CFM');
  if (entry.specs?.size) parts.push(entry.specs.size);
  if (entry.specs?.heating) parts.push(entry.specs.heating);
  return parts.join(' · ') || '—';
}
function _priceSummary(entry) {
  if (!entry.pricing) return '';
  const parts = [];
  if (entry.pricing.materialCost) parts.push('$' + entry.pricing.materialCost.toLocaleString());
  if (entry.pricing.laborHrs) parts.push(entry.pricing.laborHrs + 'h');
  return parts.join(' + ');
}
function _el(tag, attrs, children) {
  const el = document.createElement(tag);
  if (attrs) Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'className') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v);
  });
  if (typeof children === 'string') el.textContent = children;
  else if (Array.isArray(children)) children.forEach(c => { if (c) el.appendChild(c); });
  else if (children instanceof Node) el.appendChild(children);
  return el;
}

// ── Matching engine ───────────────────────────────────────────────────
function _scoreMatch(libraryEntry, extracted) {
  const e = libraryEntry;
  const x = extracted;

  // 1. Exact: manufacturer + model
  if (e.manufacturer && e.model && x.manufacturer && x.model &&
      _norm(e.manufacturer) === _norm(x.manufacturer) &&
      _norm(e.model) === _norm(x.model)) {
    return { score: 1.0, matchReason: 'Exact match (manufacturer + model)' };
  }

  // 2. Strong: type + manufacturer
  if (e.type && x.type && e.manufacturer && x.manufacturer &&
      _norm(e.type) === _norm(x.type) &&
      _norm(e.manufacturer) === _norm(x.manufacturer)) {
    return { score: 0.8, matchReason: 'Strong match (type + manufacturer)' };
  }

  // 3. Fuzzy: type + similar specs
  if (e.type && x.type && _norm(e.type) === _norm(x.type)) {
    let specScore = 0;
    let specChecks = 0;

    const eTon = e.specs?.tonnage;
    const xTon = x.tonnage ?? x.specs?.tonnage;
    if (eTon && xTon) {
      specChecks++;
      if (Math.abs(eTon - xTon) / Math.max(eTon, xTon) <= 0.20) specScore++;
    }

    const eCfm = e.specs?.cfm;
    const xCfm = x.cfm ?? x.specs?.cfm;
    if (eCfm && xCfm) {
      specChecks++;
      if (Math.abs(eCfm - xCfm) / Math.max(eCfm, xCfm) <= 0.25) specScore++;
    }

    const eSize = _norm(e.specs?.size);
    const xSize = _norm(x.size ?? x.specs?.size);
    if (eSize && xSize) {
      specChecks++;
      if (eSize === xSize) specScore++;
    }

    if (specChecks > 0 && specScore >= 1) {
      return { score: 0.6, matchReason: `Fuzzy match (type + ${specScore}/${specChecks} specs)` };
    }
  }

  // 4. Category: same category, type contains overlap
  const eCat = e.category;
  const xCat = x.category;
  if (eCat && xCat && eCat === xCat) {
    // Bonus: partial type match
    if (e.type && x.type) {
      const eWords = _norm(e.type).split(/\s+/);
      const xWords = _norm(x.type).split(/\s+/);
      const overlap = eWords.filter(w => xWords.includes(w) && w.length > 2).length;
      if (overlap > 0) {
        return { score: 0.3, matchReason: 'Category match (same category, similar type)' };
      }
    }
    return { score: 0.2, matchReason: 'Category match (same category)' };
  }

  return null;
}

// ── Main API ──────────────────────────────────────────────────────────
const HVACLibrary = {

  CATEGORIES,

  // ── DB init ───────────────────────────────────────────
  async init() {
    await _openDB();
  },

  // ── CRUD ──────────────────────────────────────────────
  async getAll() {
    return _txRead((store, resolve, reject) => {
      const r = store.getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  },

  async getByCategory(cat) {
    return _txRead((store, resolve, reject) => {
      const r = store.index('category').getAll(cat);
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  },

  async get(id) {
    return _txRead((store, resolve, reject) => {
      const r = store.get(id);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  },

  async save(entry) {
    const now = Date.now();
    if (!entry.id) {
      // New entry
      entry.createdAt = now;
      entry.modifiedAt = now;
      entry.usageCount = entry.usageCount || 0;
    } else {
      entry.modifiedAt = now;
    }
    // Ensure shape
    entry.specs = entry.specs || {};
    entry.pricing = entry.pricing || { materialCost: 0, laborHrs: 0, laborRate: null, laborBreakdown: {} };
    entry.notes = entry.notes || '';

    return _txWrite((store, resolve, reject) => {
      const r = store.put(entry);
      r.onsuccess = () => resolve(r.result); // returns id
      r.onerror = () => reject(r.error);
    });
  },

  async remove(id) {
    return _txWrite((store, resolve, reject) => {
      const r = store.delete(id);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  },

  // ── Matching ──────────────────────────────────────────
  async findMatches(extractedItem) {
    const all = await this.getAll();
    const results = [];
    for (const entry of all) {
      const m = _scoreMatch(entry, extractedItem);
      if (m && m.score >= 0.2) {
        results.push({ entry, score: m.score, matchReason: m.matchReason });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 5);
  },

  async matchExtractedBatch(equipmentArray) {
    const all = await this.getAll();
    return equipmentArray.map(extracted => {
      const matches = [];
      for (const entry of all) {
        const m = _scoreMatch(entry, extracted);
        if (m && m.score >= 0.2) {
          matches.push({ entry, score: m.score, matchReason: m.matchReason });
        }
      }
      matches.sort((a, b) => b.score - a.score);
      const top = matches.slice(0, 5);
      const bestMatch = top.length > 0 && top[0].score >= 0.3 ? top[0].entry : null;
      return { extracted, matches: top, bestMatch };
    });
  },

  // ── Price Book sync ───────────────────────────────────
  async syncFromPriceBook(priceBookCache) {
    if (!priceBookCache || typeof priceBookCache !== 'object') return 0;
    const all = await this.getAll();
    let synced = 0;

    for (const entry of all) {
      // Try matching by type+manufacturer or model
      const key = _norm(entry.type) + '|' + _norm(entry.manufacturer || '');
      const modelKey = _norm(entry.model || '');

      for (const [pbKey, pbEntry] of Object.entries(priceBookCache)) {
        const pbNorm = _norm(pbKey);
        if ((key && pbNorm.includes(_norm(entry.type))) ||
            (modelKey && pbNorm.includes(modelKey))) {
          const pricing = entry.pricing || {};
          if (pbEntry.materialCost !== undefined) pricing.materialCost = pbEntry.materialCost;
          if (pbEntry.laborHrs !== undefined) pricing.laborHrs = pbEntry.laborHrs;
          if (pbEntry.laborRate !== undefined) pricing.laborRate = pbEntry.laborRate;
          if (pbEntry.laborBreakdown) pricing.laborBreakdown = { ...pricing.laborBreakdown, ...pbEntry.laborBreakdown };
          entry.pricing = pricing;
          await this.save(entry);
          synced++;
          break;
        }
      }
    }
    return synced;
  },

  async pushToPriceBook(libraryId) {
    const entry = await this.get(libraryId);
    if (!entry) return null;
    // Return a price-book-compatible object for the caller to integrate
    return {
      type: entry.type,
      tag: entry.tag,
      category: entry.category,
      manufacturer: entry.manufacturer,
      model: entry.model,
      materialCost: entry.pricing?.materialCost || 0,
      laborHrs: entry.pricing?.laborHrs || 0,
      laborRate: entry.pricing?.laborRate || null,
      laborBreakdown: entry.pricing?.laborBreakdown || {},
    };
  },

  // ── Import from AI extraction ─────────────────────────
  createEntryFromExtracted(item) {
    return {
      tag: (item.tag || '').replace(/[-\s]?\d+$/, '').toUpperCase(), // strip trailing number → canonical
      type: item.type || '',
      category: item.category || 'equipment',
      manufacturer: item.manufacturer || null,
      model: item.model || null,
      specs: {
        tonnage: item.tonnage ?? item.specs?.tonnage ?? null,
        cfm: item.cfm ?? item.specs?.cfm ?? null,
        heating: item.heating ?? item.specs?.heating ?? null,
        voltage: item.voltage ?? item.specs?.voltage ?? null,
        refrigerant: item.refrigerant ?? item.specs?.refrigerant ?? null,
        mca: item.mca ?? item.specs?.mca ?? null,
        mocp: item.mocp ?? item.specs?.mocp ?? null,
        size: item.size ?? item.specs?.size ?? null,
      },
      pricing: { materialCost: 0, laborHrs: 0, laborRate: null, laborBreakdown: {} },
      notes: '',
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      usageCount: 0,
    };
  },

  // ── Stats ─────────────────────────────────────────────
  async incrementUsage(id) {
    const entry = await this.get(id);
    if (!entry) return;
    entry.usageCount = (entry.usageCount || 0) + 1;
    await this.save(entry);
  },

  // ── UI: Library Browser Panel ─────────────────────────
  renderLibraryPanel(container) {
    injectCSS();
    container.innerHTML = '';
    const panel = _el('div', { className: 'hvac-lib-panel' });
    container.appendChild(panel);

    let activeCat = 'equipment';
    let searchTerm = '';
    let expandedId = null;
    let allEntries = [];

    const render = async () => {
      try { allEntries = await this.getAll(); } catch { allEntries = []; }
      panel.innerHTML = '';

      // Category counts
      const catCounts = {};
      CATEGORIES.forEach(c => { catCounts[c.key] = 0; });
      allEntries.forEach(e => { if (catCounts[e.category] !== undefined) catCounts[e.category]++; });

      // Tabs
      const tabs = _el('div', { className: 'hvac-lib-tabs' });
      CATEGORIES.forEach(cat => {
        const tab = _el('button', {
          className: 'hvac-lib-tab' + (activeCat === cat.key ? ' active' : ''),
          onClick: () => { activeCat = cat.key; expandedId = null; render(); },
        });
        tab.style.setProperty('--tab-color', cat.color);
        tab.innerHTML = `${cat.icon} ${cat.label} <span class="tab-count">(${catCounts[cat.key]})</span>`;
        tabs.appendChild(tab);
      });
      panel.appendChild(tabs);

      // Search
      const search = _el('input', {
        className: 'hvac-lib-search',
        type: 'text',
        placeholder: '🔍 Search by type, manufacturer, model...',
        value: searchTerm,
        onInput: (ev) => { searchTerm = ev.target.value; renderGrid(); },
      });
      panel.appendChild(search);

      // Grid container
      const grid = _el('div', { className: 'hvac-lib-grid', id: 'hvac-lib-grid' });
      panel.appendChild(grid);

      const renderGrid = () => {
        grid.innerHTML = '';
        let filtered = allEntries.filter(e => e.category === activeCat);

        if (searchTerm) {
          const q = _norm(searchTerm);
          filtered = filtered.filter(e =>
            _norm(e.type).includes(q) ||
            _norm(e.manufacturer).includes(q) ||
            _norm(e.model).includes(q) ||
            _norm(e.tag).includes(q) ||
            _norm(e.notes).includes(q)
          );
        }

        // Sort: most used first, then alphabetical by type
        filtered.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0) || (a.type || '').localeCompare(b.type || ''));

        if (filtered.length === 0) {
          grid.appendChild(_el('div', { className: 'hvac-lib-empty' },
            searchTerm ? 'No entries match your search.' : 'No entries in this category yet.'));
        }

        filtered.forEach(entry => {
          const isExpanded = expandedId === entry.id;
          const card = _el('div', { className: 'hvac-lib-card' + (isExpanded ? ' expanded' : '') });

          // Header
          const header = _el('div', { className: 'hvac-lib-card-header' });
          const left = _el('div', { style: { flex: '1', minWidth: '0' } });
          const titleRow = _el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } });
          titleRow.appendChild(_el('span', { className: 'hvac-lib-card-title' }, entry.type || entry.tag));
          if (entry.manufacturer) titleRow.appendChild(_el('span', { className: 'hvac-lib-card-sub' }, entry.manufacturer));
          if (entry.model) titleRow.appendChild(_el('span', { className: 'hvac-lib-card-sub', style: { color: '#4dabf7' } }, entry.model));
          left.appendChild(titleRow);

          const specs = _el('div', { className: 'hvac-lib-card-specs' });
          const specText = _specSummary(entry);
          if (specText !== '—') specs.appendChild(_el('span', {}, specText));
          const price = _priceSummary(entry);
          if (price) specs.appendChild(_el('span', { className: 'hvac-lib-pricing' }, price));
          left.appendChild(specs);
          header.appendChild(left);

          // Right: usage badge
          if (entry.usageCount > 0) {
            header.appendChild(_el('span', { className: 'hvac-lib-badge' }, `Used ${entry.usageCount}×`));
          }

          card.appendChild(header);
          header.addEventListener('click', () => {
            expandedId = isExpanded ? null : entry.id;
            renderGrid();
          });

          // Expanded detail
          if (isExpanded) {
            const detail = _el('div', { className: 'hvac-lib-detail' });
            const inputs = {};

            // ── SECTION 1: Identity ──
            const idGrid = _el('div', { className: 'hvac-lib-detail-grid' });
            [['Tag Template', 'tag', entry.tag], ['Type', 'type', entry.type],
             ['Manufacturer', 'manufacturer', entry.manufacturer || ''], ['Model', 'model', entry.model || '']]
            .forEach(([label, path, value]) => {
              const w = _el('div');
              w.appendChild(_el('label', {}, label));
              const inp = _el('input', { type: 'text', value: value ?? '' });
              inputs[path] = inp;
              w.appendChild(inp);
              idGrid.appendChild(w);
            });
            detail.appendChild(idGrid);

            // ── SECTION 2: Specs (category-aware) ──
            const specSec = _el('div', { className: 'hvac-lib-section' });
            const specHead = _el('div', { className: 'hvac-lib-section-head' });
            specHead.innerHTML = '<span class="hvac-lib-section-icon">📋</span><span class="hvac-lib-section-label">Specs</span><span class="hvac-lib-section-line"></span>';
            specSec.appendChild(specHead);

            const specGrid = _el('div', { className: 'hvac-lib-detail-grid' });
            // Show relevant specs based on category
            const specFields = [];
            const cat = entry.category || 'equipment';
            if (['equipment','energy-recovery','makeup-air'].includes(cat)) {
              specFields.push(['Tonnage', 'specs.tonnage', entry.specs?.tonnage ?? '']);
              specFields.push(['Heating', 'specs.heating', entry.specs?.heating || '']);
              specFields.push(['Refrigerant', 'specs.refrigerant', entry.specs?.refrigerant || '']);
            }
            if (['equipment','fan','air-distribution','terminal','energy-recovery','makeup-air','heating'].includes(cat)) {
              specFields.push(['CFM', 'specs.cfm', entry.specs?.cfm ?? '']);
            }
            if (['air-distribution','specialty','terminal'].includes(cat)) {
              specFields.push(['Size', 'specs.size', entry.specs?.size || '']);
            }
            specFields.push(['Voltage', 'specs.voltage', entry.specs?.voltage || '']);
            if (['equipment','energy-recovery','makeup-air'].includes(cat)) {
              specFields.push(['MCA', 'specs.mca', entry.specs?.mca ?? '']);
              specFields.push(['MOCP', 'specs.mocp', entry.specs?.mocp ?? '']);
            }
            specFields.forEach(([label, path, value]) => {
              const w = _el('div');
              w.appendChild(_el('label', {}, label));
              const inp = _el('input', { type: 'text', value: value ?? '' });
              inputs[path] = inp;
              w.appendChild(inp);
              specGrid.appendChild(w);
            });
            specSec.appendChild(specGrid);
            detail.appendChild(specSec);

            // ── SECTION 3: Pricing & Labor ──
            const priceSec = _el('div', { className: 'hvac-lib-section' });
            const priceHead = _el('div', { className: 'hvac-lib-section-head' });
            priceHead.innerHTML = '<span class="hvac-lib-section-icon">💲</span><span class="hvac-lib-section-label">Pricing & Labor</span><span class="hvac-lib-section-line"></span>';
            priceSec.appendChild(priceHead);

            // Material + Total Labor + Rate row
            const priceRow = _el('div', { className: 'hvac-lib-pricing-row' });

            // Material cost box
            const matBox = _el('div', { className: 'hvac-lib-price-box' });
            matBox.innerHTML = '<div class="hvac-lib-price-label">Material Cost</div>';
            const matInp = _el('input', {
              className: 'hvac-lib-price-input', type: 'text',
              value: entry.pricing?.materialCost ? '$' + entry.pricing.materialCost.toLocaleString() : '',
              placeholder: '$0.00',
            });
            inputs['pricing.materialCost'] = matInp;
            matBox.appendChild(matInp);
            matBox.appendChild(_el('div', { className: 'hvac-lib-price-sub' }, 'per unit'));
            priceRow.appendChild(matBox);

            // Labor hours box (total from breakdown)
            const bd = entry.pricing?.laborBreakdown || {};
            const totalBdHrs = _getTotalBreakdownHrs(bd);
            const displayHrs = totalBdHrs > 0 ? totalBdHrs : (entry.pricing?.laborHrs || 0);
            const laborBox = _el('div', { className: 'hvac-lib-price-box' });
            laborBox.innerHTML = '<div class="hvac-lib-price-label">Labor Hours</div>';
            const laborDisp = _el('div', {
              style: { fontSize: '18px', fontWeight: '700', color: '#ffd43b', fontVariantNumeric: 'tabular-nums' },
            }, displayHrs > 0 ? displayHrs.toFixed(2) + 'h' : '—');
            laborBox.appendChild(laborDisp);
            const laborDollar = (displayHrs * (entry.pricing?.laborRate || 45));
            laborBox.appendChild(_el('div', { className: 'hvac-lib-price-sub' },
              displayHrs > 0 ? '$' + laborDollar.toFixed(2) + ' at $' + (entry.pricing?.laborRate || 45) + '/hr' : 'set hours below'));
            priceRow.appendChild(laborBox);

            // Rate box
            const rateBox = _el('div', { className: 'hvac-lib-price-box', style: { maxWidth: '110px' } });
            rateBox.innerHTML = '<div class="hvac-lib-price-label">Labor Rate</div>';
            const rateInp = _el('input', {
              className: 'hvac-lib-price-input rate-val', type: 'text',
              value: entry.pricing?.laborRate ? '$' + entry.pricing.laborRate : '',
              placeholder: '$45 default',
            });
            inputs['pricing.laborRate'] = rateInp;
            rateBox.appendChild(rateInp);
            rateBox.appendChild(_el('div', { className: 'hvac-lib-price-sub' }, 'per hour'));
            priceRow.appendChild(rateBox);

            priceSec.appendChild(priceRow);

            // ── Labor breakdown radar chart ──
            const radarWrap = _el('div', { className: 'hvac-lib-radar-wrap' });
            let radarOpen = true; // default open
            const applicableKeys = _applicableCats(entry.category);

            const renderRadar = () => {
              const currentBd = {};
              LABOR_CATS.forEach(c => {
                const inp = inputs['bd.' + c.key];
                currentBd[c.key] = inp ? (parseFloat(inp.value) || 0) : (bd[c.key] || 0);
              });

              radarWrap.innerHTML = '';

              // Toggle header
              const toggle = _el('div', { className: 'hvac-lib-radar-toggle' });
              toggle.innerHTML = `<span class="hvac-lib-radar-arrow ${radarOpen ? 'open' : ''}">▶</span>
                <span class="hvac-lib-radar-label">Labor Breakdown</span>`;

              // Dot summary
              const dots = _el('span', { className: 'hvac-lib-radar-dots' });
              LABOR_CATS.forEach(c => {
                if ((currentBd[c.key] || 0) > 0) {
                  const d = _el('span', { className: 'hvac-lib-radar-dot' });
                  d.style.background = c.color;
                  dots.appendChild(d);
                }
              });
              toggle.appendChild(dots);

              const total = _getTotalBreakdownHrs(currentBd);
              toggle.appendChild(_el('span', { className: 'hvac-lib-radar-total', style: { marginLeft: 'auto' } },
                total > 0 ? total.toFixed(2) + 'h' : '—'));

              toggle.addEventListener('click', () => { radarOpen = !radarOpen; renderRadar(); });
              radarWrap.appendChild(toggle);

              if (radarOpen) {
                const body = _el('div', { className: 'hvac-lib-radar-body' });

                // SVG radar chart
                const svgWrap = _el('div');
                svgWrap.innerHTML = _renderRadarSVG(currentBd, applicableKeys);
                body.appendChild(svgWrap);

                // Category input rows
                const catList = _el('div', { className: 'hvac-lib-radar-cats' });
                LABOR_CATS.forEach(c => {
                  const enabled = applicableKeys.includes(c.key);
                  const row = _el('div', { className: 'hvac-lib-cat-row', style: { opacity: enabled ? '1' : '0.3' } });
                  row.appendChild(_el('span', { className: 'hvac-lib-cat-dot', style: { background: c.color } }));
                  row.appendChild(_el('span', { className: 'hvac-lib-cat-label' }, c.label));
                  const catInp = _el('input', {
                    className: 'hvac-lib-cat-input', type: 'text',
                    value: currentBd[c.key] || '', placeholder: '0',
                    disabled: enabled ? undefined : 'disabled',
                  });
                  catInp.style.color = enabled ? c.color : '#333';
                  catInp.style.borderColor = enabled ? '#0f3460' : '#0a1a30';
                  // Live update radar on change
                  catInp.addEventListener('change', () => {
                    // Update the labor total display
                    const newBd = {};
                    LABOR_CATS.forEach(cc => {
                      const i = inputs['bd.' + cc.key];
                      newBd[cc.key] = i ? (parseFloat(i.value) || 0) : 0;
                    });
                    const newTotal = _getTotalBreakdownHrs(newBd);
                    laborDisp.textContent = newTotal > 0 ? newTotal.toFixed(2) + 'h' : '—';
                    const newRate = parseFloat((rateInp.value || '').replace('$','')) || 45;
                    laborBox.querySelector('.hvac-lib-price-sub').textContent =
                      newTotal > 0 ? '$' + (newTotal * newRate).toFixed(2) + ' at $' + newRate + '/hr' : 'set hours below';
                    renderRadar();
                  });
                  inputs['bd.' + c.key] = catInp;
                  row.appendChild(catInp);
                  row.appendChild(_el('span', { className: 'hvac-lib-cat-unit' }, 'h'));
                  catList.appendChild(row);
                });
                body.appendChild(catList);
                radarWrap.appendChild(body);
              }
            };

            renderRadar();
            priceSec.appendChild(radarWrap);
            detail.appendChild(priceSec);

            // ── SECTION 4: Notes ──
            const notesSec = _el('div', { className: 'hvac-lib-section' });
            const notesHead = _el('div', { className: 'hvac-lib-section-head' });
            notesHead.innerHTML = '<span class="hvac-lib-section-icon">📝</span><span class="hvac-lib-section-label">Notes</span><span class="hvac-lib-section-line"></span>';
            notesSec.appendChild(notesHead);
            const notesInp = _el('textarea', {
              style: { width: '100%', background: '#1a1a2e', border: '1px solid #0f3460', color: '#e0e0e0', padding: '6px 8px', borderRadius: '4px', fontSize: '12px', minHeight: '40px', resize: 'vertical', boxSizing: 'border-box' },
            }, entry.notes || '');
            notesInp.placeholder = 'Add notes...';
            inputs['notes'] = notesInp;
            notesSec.appendChild(notesInp);
            detail.appendChild(notesSec);

            // ── Action buttons ──
            const actions = _el('div', { className: 'hvac-lib-detail-actions', style: { marginTop: '12px' } });

            const saveBtn = _el('button', {
              className: 'hvac-lib-btn hvac-lib-btn-primary',
              onClick: async () => {
                const updated = { ...entry };
                updated.tag = inputs['tag'].value;
                updated.type = inputs['type'].value;
                updated.manufacturer = inputs['manufacturer'].value || null;
                updated.model = inputs['model'].value || null;
                updated.specs = {
                  tonnage: parseFloat(inputs['specs.tonnage']?.value) || null,
                  cfm: parseFloat(inputs['specs.cfm']?.value) || null,
                  voltage: inputs['specs.voltage']?.value || null,
                  heating: inputs['specs.heating']?.value || null,
                  refrigerant: inputs['specs.refrigerant']?.value || null,
                  mca: parseFloat(inputs['specs.mca']?.value) || null,
                  mocp: parseFloat(inputs['specs.mocp']?.value) || null,
                  size: inputs['specs.size']?.value || null,
                };
                const newBreakdown = {};
                LABOR_CATS.forEach(c => { newBreakdown[c.key] = parseFloat(inputs['bd.' + c.key]?.value) || 0; });
                const totalHrs = _getTotalBreakdownHrs(newBreakdown);
                updated.pricing = {
                  materialCost: parseFloat((inputs['pricing.materialCost'].value || '').replace(/[\$,]/g, '')) || 0,
                  laborHrs: totalHrs,
                  laborRate: parseFloat((inputs['pricing.laborRate'].value || '').replace('$','')) || null,
                  laborBreakdown: newBreakdown,
                };
                updated.notes = inputs['notes'].value || '';
                await HVACLibrary.save(updated);
                render();
              },
            }, 'Save');
            actions.appendChild(saveBtn);

            const delBtn = _el('button', {
              className: 'hvac-lib-btn hvac-lib-btn-danger',
              onClick: async () => {
                if (confirm(`Delete "${entry.type}" from library?`)) {
                  await HVACLibrary.remove(entry.id);
                  expandedId = null;
                  render();
                }
              },
            }, 'Delete');
            actions.appendChild(delBtn);

            detail.appendChild(actions);
            card.appendChild(detail);
          }

          grid.appendChild(card);
        });

        // Add Entry button
        const addBtn = _el('button', {
          className: 'hvac-lib-btn-add',
          onClick: async () => {
            const newEntry = {
              tag: '',
              type: '',
              category: activeCat,
              manufacturer: null,
              model: null,
              specs: { tonnage: null, cfm: null, heating: null, voltage: null, refrigerant: null, mca: null, mocp: null, size: null },
              pricing: { materialCost: 0, laborHrs: 0, laborRate: null, laborBreakdown: {} },
              notes: '',
              createdAt: Date.now(),
              modifiedAt: Date.now(),
              usageCount: 0,
            };
            const id = await HVACLibrary.save(newEntry);
            expandedId = id;
            render();
          },
        }, `+ Add ${CAT_MAP[activeCat]?.label || 'Entry'}`);
        grid.appendChild(addBtn);
      };

      renderGrid();
    };

    render();
  },

  // ── UI: Match Step (post-AI-extraction) ───────────────
  renderMatchStep(container, matchResults, callbacks = {}) {
    injectCSS();
    container.innerHTML = '';
    const panel = _el('div', { className: 'hvac-match-panel' });
    container.appendChild(panel);

    const { onLink, onCreateNew, onSkip } = callbacks;
    const resolved = new Set(); // track resolved indices

    // Header summary
    const counts = { match: 0, possible: 0, newItem: 0 };
    matchResults.forEach(r => {
      const best = r.matches?.[0];
      if (best && best.score >= 0.8) counts.match++;
      else if (best && best.score >= 0.3) counts.possible++;
      else counts.newItem++;
    });
    const summary = _el('div', { style: { fontSize: '12px', color: '#a0a0c0', marginBottom: '10px', display: 'flex', gap: '14px' } });
    summary.innerHTML = `
      <span>🟢 ${counts.match} matched</span>
      <span>🟡 ${counts.possible} possible</span>
      <span>🔵 ${counts.newItem} new</span>
      <span style="color:#555">·</span>
      <span>${matchResults.length} total</span>
    `;
    panel.appendChild(summary);

    // Rows
    const rowsContainer = _el('div');
    panel.appendChild(rowsContainer);

    const renderRows = () => {
      rowsContainer.innerHTML = '';

      matchResults.forEach((result, idx) => {
        if (resolved.has(idx)) return;
        const { extracted, matches } = result;
        const best = matches?.[0];
        const cat = CAT_MAP[extracted.category] || CAT_MAP['equipment'];

        // Determine match tier
        let tier, tierColor, tierLabel, tierDot;
        if (best && best.score >= 0.8) {
          tier = 'match'; tierColor = '#00ff88'; tierLabel = 'Match Found'; tierDot = '#00ff88';
        } else if (best && best.score >= 0.3) {
          tier = 'possible'; tierColor = '#ffd43b'; tierLabel = 'Possible Match'; tierDot = '#ffd43b';
        } else {
          tier = 'new'; tierColor = '#4dabf7'; tierLabel = 'New'; tierDot = '#4dabf7';
        }

        const row = _el('div', { className: 'hvac-match-row' });

        // Header
        const header = _el('div', { className: 'hvac-match-header' });

        // Left: tag, icon, type, spec
        const left = _el('div', { className: 'hvac-match-left' });
        left.appendChild(_el('span', {}, cat.icon));
        left.appendChild(_el('span', { className: 'hvac-match-tag' }, extracted.tag || '?'));
        left.appendChild(_el('span', { className: 'hvac-match-type' }, extracted.type || ''));
        const specVal = extracted.tonnage ? (extracted.tonnage + ' ton') :
                        extracted.cfm ? (extracted.cfm + ' CFM') :
                        extracted.size || '';
        if (specVal) left.appendChild(_el('span', { className: 'hvac-match-spec' }, specVal));
        header.appendChild(left);

        // Right: match indicator + action
        const right = _el('div', { className: 'hvac-match-indicator' });
        const dot = _el('span', { className: 'hvac-match-dot', style: { background: tierDot } });
        right.appendChild(dot);
        right.appendChild(_el('span', { className: 'hvac-match-label', style: { color: tierColor } }, tierLabel));

        if (tier === 'match' && best) {
          right.appendChild(_el('span', { className: 'hvac-match-name' }, best.entry.type + (best.entry.manufacturer ? ' · ' + best.entry.manufacturer : '')));
          const linkBtn = _el('button', {
            className: 'hvac-lib-btn hvac-lib-btn-primary',
            style: { padding: '3px 10px', fontSize: '11px' },
            onClick: (ev) => {
              ev.stopPropagation();
              resolved.add(idx);
              onLink?.(extracted, best.entry);
              renderRows();
            },
          }, 'Link');
          right.appendChild(linkBtn);
        } else if (tier === 'new') {
          const saveBtn = _el('button', {
            className: 'hvac-lib-btn hvac-lib-btn-secondary',
            style: { padding: '3px 10px', fontSize: '11px', color: '#4dabf7', borderColor: '#4dabf7' },
            onClick: (ev) => {
              ev.stopPropagation();
              resolved.add(idx);
              onCreateNew?.(extracted);
              renderRows();
            },
          }, 'Save to Library');
          right.appendChild(saveBtn);
        }

        header.appendChild(right);
        row.appendChild(header);

        // Expandable detail
        const expand = _el('div', { className: 'hvac-match-expand' });

        // Extracted item details
        const detailParts = [];
        if (extracted.manufacturer) detailParts.push(`Mfr: ${extracted.manufacturer}`);
        if (extracted.model) detailParts.push(`Model: ${extracted.model}`);
        if (extracted.tonnage) detailParts.push(`${extracted.tonnage} ton`);
        if (extracted.cfm) detailParts.push(`${extracted.cfm} CFM`);
        if (extracted.voltage) detailParts.push(extracted.voltage);
        if (extracted.heating) detailParts.push(extracted.heating);
        if (extracted.size) detailParts.push(extracted.size);
        if (detailParts.length > 0) {
          expand.appendChild(_el('div', {
            style: { fontSize: '11px', color: '#a0a0c0', marginBottom: '8px' },
          }, detailParts.join(' · ')));
        }

        // Match options
        if (matches.length > 0) {
          expand.appendChild(_el('div', {
            style: { fontSize: '10px', color: '#555', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' },
          }, 'Library Matches'));
          const options = _el('div', { className: 'hvac-match-options' });
          matches.forEach(m => {
            const opt = _el('div', { className: 'hvac-match-option' });
            const info = _el('div', { className: 'hvac-match-option-info' });
            const scoreColor = m.score >= 0.8 ? '#00ff88' : m.score >= 0.6 ? '#ffd43b' : '#a0a0c0';
            info.appendChild(_el('span', {
              className: 'hvac-match-score',
              style: { background: scoreColor, color: '#1a1a2e' },
            }, Math.round(m.score * 100) + '%'));
            info.appendChild(_el('span', { style: { fontSize: '12px' } },
              m.entry.type + (m.entry.manufacturer ? ' · ' + m.entry.manufacturer : '') +
              (m.entry.model ? ' · ' + m.entry.model : '')));
            info.appendChild(_el('span', { style: { fontSize: '10px', color: '#555' } }, m.matchReason));
            opt.appendChild(info);

            const acceptBtn = _el('button', {
              className: 'hvac-lib-btn hvac-lib-btn-primary',
              style: { padding: '2px 8px', fontSize: '10px' },
              onClick: () => {
                resolved.add(idx);
                onLink?.(extracted, m.entry);
                renderRows();
              },
            }, 'Link');
            opt.appendChild(acceptBtn);
            options.appendChild(opt);
          });
          expand.appendChild(options);
        }

        // Skip button
        const skipRow = _el('div', { style: { marginTop: '6px', textAlign: 'right' } });
        skipRow.appendChild(_el('button', {
          className: 'hvac-lib-btn hvac-lib-btn-secondary',
          style: { padding: '3px 10px', fontSize: '10px' },
          onClick: () => {
            resolved.add(idx);
            onSkip?.(extracted);
            renderRows();
          },
        }, 'Skip'));
        if (tier !== 'new') {
          skipRow.appendChild(_el('button', {
            className: 'hvac-lib-btn hvac-lib-btn-secondary',
            style: { padding: '3px 10px', fontSize: '10px', marginLeft: '4px', color: '#4dabf7' },
            onClick: () => {
              resolved.add(idx);
              onCreateNew?.(extracted);
              renderRows();
            },
          }, 'Save as New'));
        }
        expand.appendChild(skipRow);

        row.appendChild(expand);

        // Toggle expand on header click
        header.addEventListener('click', () => {
          row.classList.toggle('open');
        });

        rowsContainer.appendChild(row);
      });

      // "All resolved" message
      if (resolved.size === matchResults.length) {
        rowsContainer.appendChild(_el('div', {
          style: { textAlign: 'center', padding: '20px', color: '#00ff88', fontSize: '13px' },
        }, '✓ All items resolved'));
      }
    };

    renderRows();

    // Bulk action bar
    const bulk = _el('div', { className: 'hvac-match-bulk' });

    bulk.appendChild(_el('button', {
      className: 'hvac-lib-btn hvac-lib-btn-primary',
      onClick: () => {
        matchResults.forEach((r, idx) => {
          if (resolved.has(idx)) return;
          const best = r.matches?.[0];
          if (best && best.score >= 0.8) {
            resolved.add(idx);
            onLink?.(r.extracted, best.entry);
          }
        });
        renderRows();
      },
    }, 'Link All Matches'));

    bulk.appendChild(_el('button', {
      className: 'hvac-lib-btn hvac-lib-btn-secondary',
      style: { color: '#4dabf7' },
      onClick: () => {
        matchResults.forEach((r, idx) => {
          if (resolved.has(idx)) return;
          const best = r.matches?.[0];
          if (!best || best.score < 0.3) {
            resolved.add(idx);
            onCreateNew?.(r.extracted);
          }
        });
        renderRows();
      },
    }, 'Save All New'));

    panel.appendChild(bulk);
  },
};

export default HVACLibrary;
