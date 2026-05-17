import { SPIRAL_DEFAULTS, SNAPLOCK_DEFAULTS, SPIRAL_TAP_DEFAULTS, SNAPLOCK_TAP_DEFAULTS, RECT_FITTING_REF, RECT_FITTING_SA, calcRectFittingSA, RECT_PERIM_CLASSES, RECT_MIN_WIDTH_CLASSES, DUCT_WEIGHT_PER_LF, SHOP_DEFAULTS, LINER_OPTIONS, RECT_DUCT_SHOP_DEFAULTS, RECT_FLEX_CONN_DEFAULTS, RECT_PLENUM_DEFAULT, RECT_REDUCER_SHOP_DEFAULTS, RECT_ENDCAP_SHOP_DEFAULTS, RECT_TRANSITION_SHOP_DEFAULTS, RECT_TAP_SHOP_DEFAULTS, RECT_45EL_SHOP_DEFAULTS, LABOR_CATEGORIES, LABOR_DEFAULTS, HANGER_DEFAULTS } from './price-defaults.js';

export function installPriceBook(ctx = {}) {
  const {
    idbGetAll,
    idbPut,
    showToast = function() {},
    refreshCompiler = function() {},
    getCompilerState = function() { return {}; },
    escapeHtml = function(str) { return String(str == null ? '' : str).replace(/[&<>"']/g, function(ch) { return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]; }); },
    calculateSpiralWireLengthEach = function() { return 0; },
    getHangerLabel = function(key) { return key; }
  } = ctx;

  function shouldRefreshCompiler() {
    const state = getCompilerState() || {};
    return state.activePanelTab === 'comp' && state.compilerInited;
  }

  // ---- Global Price Book ----
  let priceBookCache = null; // loaded once on init, { '90el': { materialCost, laborHrs, sizeRules:{} }, ... }
  
  async function loadPriceBook() {
    try {
      const all = await idbGetAll('priceBook');
      priceBookCache = {};
      for (const entry of all) priceBookCache[entry.key] = entry;
    } catch(e) {
      console.warn('[PriceBook] Could not load:', e);
      priceBookCache = {};
    }
  }
  
  function getPriceBookEntry(type, sizeA) {
    if (!priceBookCache) return null;
    const entry = priceBookCache[type];
    if (!entry) return null;
    // Check size-specific override first
    if (entry.sizeRules && sizeA && entry.sizeRules[sizeA]) {
      return { ...entry, ...entry.sizeRules[sizeA] };
    }
    return entry;
  }
  
  async function savePriceBookEntry(key, data) {
    // Audit log: record what changed before overwriting
    var prev = priceBookCache ? priceBookCache[key] : null;
    if (prev) {
      var changes = [];
      for (var p in data) {
        if (p === 'key') continue;
        var oldVal = prev[p] != null ? prev[p] : null;
        var newVal = data[p] != null ? data[p] : null;
        if (oldVal !== newVal) changes.push({ prop: p, old: oldVal, new: newVal });
      }
      if (changes.length > 0) _logPBOverride(key, changes);
    } else if (data.laborHrs != null || data.materialCost != null) {
      // New entry — log as first set
      var props = [];
      if (data.laborHrs != null) props.push({ prop: 'laborHrs', old: null, new: data.laborHrs });
      if (data.materialCost != null) props.push({ prop: 'materialCost', old: null, new: data.materialCost });
      if (props.length > 0) _logPBOverride(key, props);
    }
    const entry = { key, ...data };
    await idbPut('priceBook', entry);
    if (!priceBookCache) priceBookCache = {};
    priceBookCache[key] = entry;
  }
  
  function _logPBOverride(key, changes) {
    try {
      var log = JSON.parse(localStorage.getItem('isplan_pb_audit_log') || '[]');
      log.push({ ts: Date.now(), key: key, changes: changes });
      // Keep last 500 entries to avoid unbounded growth
      if (log.length > 500) log = log.slice(-500);
      localStorage.setItem('isplan_pb_audit_log', JSON.stringify(log));
    } catch (e) { /* silent — audit log is non-critical */ }
  }
  
  // Price Book UI
  const PRICE_BOOK_TABS = {
    rect: {
      label: 'Rectangular',
      sections: [
        { id: 'rect-shop', hasGauge: false, title: 'Shop Settings', isShopSettings: true, items: [] },
        { id: 'rect-fit', hasGauge: true, title: 'Fittings', hasShopAdder: true, items: [
          { key: 'rect-90el', label: '90\u00b0 Elbow' },
          { key: 'rect-45el', label: '45\u00b0 Elbow' },
          { key: 'rect-22el', label: '22.5\u00b0 Elbow' },
          { key: 'rect-tee', label: 'Tee-Wye' },
          { key: 'rectTap', label: 'Straight Tap' },
          { key: 'rect-tapIncreasedArea', label: 'Tap Increased Area' },
          { key: 'rect-wye', label: 'Wye' },
          { key: 'rect-lateral', label: '45\u00b0 Lateral' },
          { key: 'rect-reducer', label: 'Reducer' },
          { key: 'rect-eccReducer', label: 'Offset/Ecc Reducer' },
          { key: 'rect-sqwing', label: 'Square Wing EL' },
          { key: 'rect-endcap', label: 'End Cap' },
          { key: 'rect-transition', label: 'Rect to Round Trans.' },
          { key: 'rect-flex-conn', label: 'Flex Connector' },
          { key: 'rect-plenum', label: 'Plenum' },
        ]},
        { id: 'rect-duct', hasGauge: true, title: 'Ductwork (Auto-Calc)', isRectDuctCalc: true, items: [
          { key: 'duct-rect', label: 'Rect Duct (per ft)' },
        ]},
        { id: 'rect-acc', hasGauge: false, title: 'Accessories & Add-Ons', hasShopAdder: true, items: [
          { key: 'liner-1', label: '1\u2033 Liner ($/SF)', isLiner: true },
          { key: 'liner-1.5', label: '1.5\u2033 Liner ($/SF)', isLiner: true },
          { key: 'rect-wrap', label: 'Wrap Insulation ($/SF)' },
          { key: 'rect-nosing', label: 'Nosing / Edging ($/LF)' },
          { key: 'rect-turning-vanes', label: 'Turning Vanes ($/Ea)' },
          { key: 'rect-access-door', label: 'Access Door ($/Ea)' },
          { key: 'rect-volume-damper', label: 'Volume Damper ($/Ea)' },
          { key: 'rect-fire-damper', label: 'Fire Damper ($/Ea)' },
  
          { key: 'rect-boot-12x12', label: 'Boot 12×12 ($/Ea)' },
          { key: 'rect-boot-14x14', label: 'Boot 14×14 ($/Ea)' },
          { key: 'rect-boot-15x15', label: 'Boot 15×15 ($/Ea)' },
          { key: 'rect-boot-18x18', label: 'Boot 18×18 ($/Ea)' },
          { key: 'rect-boot-20x20', label: 'Boot 20×20 ($/Ea)' },
          { key: 'rect-boot-30x20', label: 'Boot 30×20 RAC ($/Ea)' },
        ]},
      ]
    },
    round: {
      label: 'Round',
      sections: [
        { id: 'round-fit', hasGauge: true, title: 'Fittings', toggleType: true, items: [
          { key: 'spiral-90el', snapKey: 'snaplock-90el', label: '90° Elbow', sizes: [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24] },
          { key: 'spiral-45el', snapKey: 'snaplock-45el', label: '45° Elbow', sizes: [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24] },
          { key: 'spiral-22el', snapKey: 'snaplock-22el', label: '22.5° Elbow', sizes: [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24] },
          { key: 'spiral-tee', snapKey: 'snaplock-tee', label: 'Tee-Wye', sizePairs: true, sizes: [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24] },
          { key: 'spiral-saddle45y', snapKey: 'snaplock-saddle45y', label: 'Saddle 45° Wye', sizePairs: true, sizes: [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24] },
          { key: 'spiral-lateral', snapKey: 'snaplock-lateral', label: '45° Lateral', sizePairs: true, sizes: [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24] },
          { key: 'spiral-wye', snapKey: 'snaplock-wye', label: 'Wye', sizePairs: true, sizes: [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24] },
          { key: 'spiral-reducer', snapKey: 'snaplock-reducer', label: 'Concentric Reducer', sizePairs: true, sizes: [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24] },
          { key: 'spiral-eccReducer', snapKey: 'snaplock-eccReducer', label: 'Eccentric Reducer', sizePairs: true, sizes: [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24] },
          { key: 'spiral-endcap', snapKey: 'snaplock-endcap', label: 'End Cap', sizes: [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24] },
          { key: 'spiral-coupling', snapKey: 'snaplock-coupling', label: 'Coupling', sizes: [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24] },
          { key: 'spiral-transition', snapKey: 'snaplock-transition', label: 'Round to Rect Trans.', sizes: [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24] },
          { key: 'spiral-volume-damper', snapKey: 'snaplock-volume-damper', label: 'Volume Damper', sizes: [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24] },
          { key: 'spiral-spin-in', snapKey: 'snaplock-spin-in', label: 'Spin-In / Tap', sizes: [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24] },
          { key: 'spiral-starting-collar', snapKey: 'snaplock-starting-collar', label: 'Starting Collar', sizes: [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24] },
  
          { key: 'spiral-flex-conn', snapKey: 'snaplock-flex-conn', label: 'Flex Connector', sizes: [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24] },
          { key: 'spiral-tap', snapKey: 'snaplock-tap', label: 'Saddle Tap', sizePairs: true, sizes: [8, 10, 12, 14, 16, 18, 20] },
  
        ]},
        { id: 'round-duct', hasGauge: true, title: 'Ductwork', toggleType: true, items: [
          { key: 'duct-spiral-3', snapKey: 'duct-snaplock-3', label: '3\u2033' },
          { key: 'duct-spiral-4', snapKey: 'duct-snaplock-4', label: '4\u2033' },
          { key: 'duct-spiral-5', snapKey: 'duct-snaplock-5', label: '5\u2033' },
          { key: 'duct-spiral-6', snapKey: 'duct-snaplock-6', label: '6\u2033' },
          { key: 'duct-spiral-7', snapKey: 'duct-snaplock-7', label: '7\u2033' },
          { key: 'duct-spiral-8', snapKey: 'duct-snaplock-8', label: '8\u2033' },
          { key: 'duct-spiral-9', snapKey: 'duct-snaplock-9', label: '9\u2033' },
          { key: 'duct-spiral-10', snapKey: 'duct-snaplock-10', label: '10\u2033' },
          { key: 'duct-spiral-11', snapKey: null, label: '11\u2033' },
          { key: 'duct-spiral-12', snapKey: 'duct-snaplock-12', label: '12\u2033' },
          { key: 'duct-spiral-13', snapKey: null, label: '13\u2033' },
          { key: 'duct-spiral-14', snapKey: 'duct-snaplock-14', label: '14\u2033' },
          { key: 'duct-spiral-15', snapKey: null, label: '15\u2033' },
          { key: 'duct-spiral-16', snapKey: 'duct-snaplock-16', label: '16\u2033' },
          { key: 'duct-spiral-17', snapKey: null, label: '17\u2033' },
          { key: 'duct-spiral-18', snapKey: 'duct-snaplock-18', label: '18\u2033' },
          { key: 'duct-spiral-20', snapKey: 'duct-snaplock-20', label: '20\u2033' },
          { key: 'duct-spiral-22', snapKey: 'duct-snaplock-22', label: '22\u2033' },
          { key: 'duct-spiral-24', snapKey: 'duct-snaplock-24', label: '24\u2033' },
          { key: 'duct-spiral-26', snapKey: null, label: '26\u2033' },
          { key: 'duct-spiral-28', snapKey: null, label: '28\u2033' },
          { key: 'duct-spiral-30', snapKey: null, label: '30\u2033' },
          { key: 'duct-spiral-32', snapKey: null, label: '32\u2033' },
          { key: 'duct-spiral-34', snapKey: null, label: '34\u2033' },
          { key: 'duct-spiral-36', snapKey: null, label: '36\u2033' },
        ]},
        { id: 'round-flex', hasGauge: false, title: 'Flex Duct (per 25ft roll)', toggleType: false, flexToggle: true, items: [
          { key: 'flex-black-4',  altKey: 'flex-silver-4',  label: '4\u2033' },
          { key: 'flex-black-5',  altKey: 'flex-silver-5',  label: '5\u2033' },
          { key: 'flex-black-6',  altKey: 'flex-silver-6',  label: '6\u2033' },
          { key: 'flex-black-7',  altKey: 'flex-silver-7',  label: '7\u2033' },
          { key: 'flex-black-8',  altKey: 'flex-silver-8',  label: '8\u2033' },
          { key: 'flex-black-9',  altKey: 'flex-silver-9',  label: '9\u2033' },
          { key: 'flex-black-10', altKey: 'flex-silver-10', label: '10\u2033' },
          { key: 'flex-black-12', altKey: 'flex-silver-12', label: '12\u2033' },
          { key: 'flex-black-14', altKey: 'flex-silver-14', label: '14\u2033' },
          { key: 'flex-black-16', altKey: 'flex-silver-16', label: '16\u2033' },
          { key: 'flex-black-18', altKey: 'flex-silver-18', label: '18\u2033' },
          { key: 'flex-black-20', altKey: 'flex-silver-20', label: '20\u2033' },
        ]},
      ]
    },
    oval: {
      label: 'Oval',
      sections: [
        { id: 'oval-fit', hasGauge: true, title: 'Fittings', items: [
          { key: 'oval-90el', label: '90\u00b0 Elbow' },
          { key: 'oval-45el', label: '45\u00b0 Elbow' },
          { key: 'oval-tee', label: 'Tee' },
          { key: 'oval-saddle45y', label: 'Saddle 45\u00b0 Wye' },
          { key: 'oval-reducer', label: 'Reducer' },
          { key: 'oval-endcap', label: 'End Cap' },
          { key: 'oval-transition', label: 'Oval to Round Trans.' },
        ]},
        { id: 'oval-duct', hasGauge: true, title: 'Ductwork', items: [
          { key: 'duct-oval', label: 'Oval Duct (per ft)' },
        ]},
      ]
    },
    hangers: {
      label: 'Hangers',
      sections: [
        { id: 'hanger-main', hasGauge: false, title: 'Hanger Supports', isHangerCatalog: true, items: [] },
        { id: 'hanger-hardware', hasGauge: false, title: 'Hanger Hardware', isHangerCatalog: true, family: 'hardware', items: [] },
      ]
    }
  };
  
  var pbCollapsed = {};
  var pbGauge = { 'round-fit': '26', 'round-duct': '26', 'rect-fit': '26', 'rect-duct': '26', 'oval-fit': '26', 'oval-duct': '26' }; // active gauge per section
  var activePBTab = 'rect';
  var pbRoundType = { 'round-fit': 'spiral', 'round-duct': 'spiral' }; // toggle: 'spiral' or 'snaplock'
  var pbFlexColor = { 'round-flex': 'black' }; // toggle: 'black' or 'silver'
  var pbExpandedItems = {}; // tracks which fitting rows are expanded to show per-size pricing
  var pbExpandedAssemblies = {}; // tracks expanded hanger assembly pricing details
  var pbPerimClass = { 'rect-fit': 0 }; // active perimeter class index per section (rect duct)
  var pbMinWidthClass = { 'rect-fit': 0 }; // active min-width class index per section (rect fittings)
  var pbLinerActive = false; // when true, rect duct/fit prices include liner adder
  var pbActiveLiner = null;  // active liner key (e.g. 'liner-1') — null = no liner selected
  
  // SMACNA galvanized sheet metal weights (lbs per SF) by gauge
  var SHEET_METAL_WEIGHT = {
    '26': 1.031,
    '24': 1.406,
    '22': 1.781,
    '20': 2.156,
    '18': 2.781
  };
  
  // Duct weight per linear foot by perimeter (inches) and gauge — from vendor table
  // Key: perimeterInches, Value: { '26': lbs/LF, '24': lbs/LF, '22': lbs/LF }
  // DUCT_WEIGHT_PER_LF — imported from price-defaults.js
  
  // Lookup duct weight/LF for a perimeter class using closest data point
  function getDuctWeightPerLF(perimIn, gauge) {
    var keys = Object.keys(DUCT_WEIGHT_PER_LF).map(Number).sort(function(a,b){return a-b;});
    // Find closest key <= perimIn, or first key if smaller
    var best = keys[0];
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] <= perimIn) best = keys[i];
      else break;
    }
    var entry = DUCT_WEIGHT_PER_LF[best];
    return entry ? (entry[gauge] || entry['26'] || 0) : 0;
  }
  
  // Shop settings defaults (stored in priceBookCache under 'shop-settings' key)
  // SHOP_DEFAULTS — imported from price-defaults.js
  
  // Labor categories — only certain categories apply to certain item types
  // LABOR_CATEGORIES — imported from price-defaults.js
  
  var activeLaborCat = 'rough'; // default active labor category
  
  function getLaborCatForSection(sectionId) {
    // Map section types to applicable categories
    var type = 'duct';
    if (sectionId && sectionId.indexOf('-fit') !== -1) type = 'fitting';
    else if (sectionId && sectionId.indexOf('-acc') !== -1) type = 'accessory';
    else if (sectionId && sectionId.indexOf('-equip') !== -1) type = 'equipment';
    return LABOR_CATEGORIES.filter(function(c) { return c.applies.indexOf(type) !== -1; });
  }
  
  // Reference data per rectangular fitting type (read-only)
  // cuts: fabrication complexity reference
  // RECT_FITTING_REF, RECT_FITTING_SA, calcRectFittingSA — imported from price-defaults.js
  
  // Gauge → lbs per SF (galvanized sheet metal)
  function getGaugeWeightPerSF(gauge) {
    if (gauge === '22') return 1.406;
    if (gauge === '24') return 1.156;
    return 0.906; // 26ga default
  }
  
  // Auto-calc raw material cost for a rect fitting from W×H, gauge
  function calcRectFittingRawCost(fittingKey, widthIn, heightIn, gauge, branchW, branchH) {
    if (!RECT_FITTING_SA[fittingKey]) return null;
    var sa = calcRectFittingSA(fittingKey, widthIn, heightIn, branchW, branchH);
    var shop = getShopSettings();
    var weightPerSF = getGaugeWeightPerSF(gauge);
    return sa * weightPerSF * (shop.sheetMetalPricePerLb || 0);
  }
  
  // Get active liner $/SF from Price Book (0 if no liner selected or liner toggle off)
  function getActiveLinerPricePerSF() {
    if (!pbLinerActive || !pbActiveLiner) return 0;
    var entry = priceBookCache ? priceBookCache[pbActiveLiner] : null;
    return (entry && entry.materialCost != null) ? entry.materialCost : 0;
  }
  
  function getShopSettings() {
    var saved = priceBookCache ? priceBookCache['shop-settings'] : null;
    if (saved) {
      var s = {};
      for (var k in SHOP_DEFAULTS) s[k] = saved[k] != null ? saved[k] : SHOP_DEFAULTS[k];
      return s;
    }
    return Object.assign({}, SHOP_DEFAULTS);
  }
  
  // Calculate rect duct raw material cost per LF from perimeter and gauge using vendor weight table
  function calcRectDuctRawPerLF(perimeterIn, gauge) {
    var shop = getShopSettings();
    var weightPerLF = getDuctWeightPerLF(perimeterIn, gauge);
    var rawMaterialPerLF = weightPerLF * (shop.sheetMetalPricePerLb || 0);
    return {
      perimeterIn: perimeterIn,
      weightPerLF: weightPerLF,
      rawMaterialPerLF: rawMaterialPerLF
    };
  }
  
  // SPIRAL_DEFAULTS, SNAPLOCK_DEFAULTS — imported from price-defaults.js
  
  function getGaugesForSection(sectionId) {
    if (sectionId && sectionId.indexOf('hanger-') === 0) return null;
    if (sectionId === 'round-flex') return null;
    return ['26', '24', '22'];
  }
  
  function getMaterialForGauge(key, gauge) {
    // Check user-saved price first
    var gKey = key + '-g' + gauge;
    var saved = priceBookCache ? priceBookCache[gKey] : null;
    if (saved && saved.materialCost != null) return saved.materialCost;
    // Fall back to defaults - check both spiral and snap lock tables
    var def = SPIRAL_DEFAULTS[key];
    if (def && def[gauge] != null) return def[gauge];
    var slDef = SNAPLOCK_DEFAULTS[key];
    if (slDef && slDef[gauge] != null) return slDef[gauge];
    // Saddle tap defaults
    var stDef = SPIRAL_TAP_DEFAULTS[key];
    if (stDef && stDef[gauge] != null) return stDef[gauge];
    var sltDef = SNAPLOCK_TAP_DEFAULTS[key];
    if (sltDef && sltDef[gauge] != null) return sltDef[gauge];
    return null;
  }
  
  // Price Book panel - drag, resize, persist position/size
  var _pbDrag = null;
  var _pbResize = null;
  
  function pbRestoreLayout() {
    var saved = localStorage.getItem('pbLayout');
    if (saved) {
      try { return JSON.parse(saved); } catch(e) {}
    }
    return null;
  }
  
  function pbSaveLayout() {
    var panel = document.getElementById('priceBookPanel');
    if (!panel) return;
    var layout = {
      left: panel.style.left,
      top: panel.style.top,
      width: panel.style.width,
      height: panel.style.height,
      collapsed: pbCollapsed,
      gauge: pbGauge,
      roundType: pbRoundType,
      perimClass: pbPerimClass,
      minWidthClass: pbMinWidthClass,
      expandedAssemblies: pbExpandedAssemblies,
      laborCat: activeLaborCat,
      tab: activePBTab,
      linerActive: pbLinerActive,
      activeLiner: pbActiveLiner
    };
    localStorage.setItem('pbLayout', JSON.stringify(layout));
  }
  
  function pbApplyLayout(panel) {
    var layout = pbRestoreLayout();
    if (layout) {
      // Clamp saved position so panel stays on-screen
      var x = parseInt(layout.left) || 0;
      var y = parseInt(layout.top) || 0;
      var pw = parseInt(layout.width) || 500;
      x = Math.max(-pw + 80, Math.min(window.innerWidth - 80, x));
      y = Math.max(0, Math.min(window.innerHeight - 40, y));
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
      if (layout.width) panel.style.width = layout.width;
      if (layout.height) panel.style.height = layout.height;
      if (layout.collapsed) pbCollapsed = layout.collapsed;
      if (layout.gauge) {
        // Merge saved gauges with defaults (handles renamed section IDs)
        for (var gk in layout.gauge) {
          pbGauge[gk] = layout.gauge[gk];
        }
      }
      if (layout.roundType) {
        for (var rk in layout.roundType) {
          pbRoundType[rk] = layout.roundType[rk];
        }
      }
      if (layout.perimClass) {
        for (var pk in layout.perimClass) pbPerimClass[pk] = layout.perimClass[pk];
      }
      if (layout.minWidthClass) {
        for (var mwk in layout.minWidthClass) pbMinWidthClass[mwk] = layout.minWidthClass[mwk];
      }
      if (layout.expandedAssemblies) pbExpandedAssemblies = layout.expandedAssemblies;
      if (layout.linerActive != null) pbLinerActive = layout.linerActive;
      if (layout.activeLiner) pbActiveLiner = layout.activeLiner;
      if (layout.laborCat) activeLaborCat = layout.laborCat;
      if (layout.tab) activePBTab = layout.tab;
    } else {
      panel.style.width = '480px';
      panel.style.height = '520px';
      panel.style.left = (window.innerWidth - 480) / 2 + 'px';
      panel.style.top = (window.innerHeight - 520) / 2 + 'px';
    }
  }
  
  function pbInitDrag() {
    var titleBar = document.getElementById('pbTitleBar');
    var panel = document.getElementById('priceBookPanel');
    titleBar.addEventListener('mousedown', function(e) {
      if (e.target.tagName === 'BUTTON') return;
      _pbDrag = { startX: e.clientX, startY: e.clientY, origLeft: parseInt(panel.style.left) || 0, origTop: parseInt(panel.style.top) || 0 };
      e.preventDefault();
    });
    titleBar.addEventListener('dblclick', function() {
      var w = parseInt(panel.style.width) || 500;
      var h = parseInt(panel.style.height) || 520;
      panel.style.left = Math.max(40, (window.innerWidth - w) / 2) + 'px';
      panel.style.top = Math.max(40, (window.innerHeight - h) / 2) + 'px';
      pbSaveLayout();
    });
    var resizeHandle = document.getElementById('pbResizeHandle');
    resizeHandle.addEventListener('mousedown', function(e) {
      _pbResize = { startX: e.clientX, startY: e.clientY, origW: panel.offsetWidth, origH: panel.offsetHeight };
      e.preventDefault();
      e.stopPropagation();
    });
    document.addEventListener('mousemove', function(e) {
      if (_pbDrag) {
        var x = _pbDrag.origLeft + e.clientX - _pbDrag.startX;
        var y = _pbDrag.origTop + e.clientY - _pbDrag.startY;
        x = Math.max(-panel.offsetWidth + 80, Math.min(window.innerWidth - 80, x));
        y = Math.max(0, Math.min(window.innerHeight - 40, y));
        panel.style.left = x + 'px';
        panel.style.top = y + 'px';
      }
      if (_pbResize) {
        var newW = Math.max(340, _pbResize.origW + e.clientX - _pbResize.startX);
        var newH = Math.max(250, _pbResize.origH + e.clientY - _pbResize.startY);
        panel.style.width = newW + 'px';
        panel.style.height = newH + 'px';
      }
    });
    document.addEventListener('mouseup', function() {
      if (_pbDrag || _pbResize) { _pbDrag = null; _pbResize = null; pbSaveLayout(); }
    });
  }
  
  window.openPriceBook = function() {
    var panel = document.getElementById('priceBookPanel');
    if (panel.style.display === 'flex') { closePriceBook(); return; } // toggle
    pbApplyLayout(panel);
    panel.style.display = 'flex';
    try { renderPriceBook(); } catch(e) {
      console.error('[PriceBook]', e);
      document.getElementById('priceBookContent').innerHTML = '<div style="color:#e94560;padding:12px">Error: ' + e.message + '</div>';
    }
  };
  
  window.closePriceBook = function() {
    pbSaveLayout();
    document.getElementById('priceBookPanel').style.display = 'none';
  };
  
  window.setPBTab = function(tab) {
    activePBTab = tab;
    renderPriceBook();
    pbSaveLayout();
  };
  
  window.togglePBSection = function(sectionId) {
    pbCollapsed[sectionId] = !pbCollapsed[sectionId];
    renderPriceBook();
    pbSaveLayout();
  };
  
  window.togglePBAssembly = function(key) {
    pbExpandedAssemblies[key] = !pbExpandedAssemblies[key];
    renderPriceBook();
    pbSaveLayout();
  };
  
  window.setPBGauge = function(sectionId, gauge) {
    pbGauge[sectionId] = gauge;
    renderPriceBook();
  };
  
  window.togglePBRoundType = function(sectionId) {
    var current = pbRoundType[sectionId] || 'spiral';
    pbRoundType[sectionId] = current === 'spiral' ? 'snaplock' : 'spiral';
    renderPriceBook();
    pbSaveLayout();
  };
  
  window.togglePBFlexColor = function(sectionId) {
    var current = pbFlexColor[sectionId] || 'black';
    pbFlexColor[sectionId] = current === 'black' ? 'silver' : 'black';
    renderPriceBook();
  };
  
  window.togglePBItemExpand = function(itemKey) {
    // Don't collapse if a radar chart is open for a child of this item
    if (pbExpandedItems[itemKey] && radarChartTarget && radarChartTarget.indexOf(itemKey) === 0) return;
    pbExpandedItems[itemKey] = !pbExpandedItems[itemKey];
    renderPriceBook();
  };
  
  
  
  window.togglePBSizePairExpand = function(pairKey) {
    pbExpandedItems[pairKey] = !pbExpandedItems[pairKey];
    renderPriceBook();
  };
  
  
  
  // Build labor-category-aware key: appends '-lc-{category}' to base key for laborHrs
  function lhCatKey(baseKey, cat) {
    return baseKey + '-lc-' + (cat || activeLaborCat);
  }
  
  // Resolve labor default: check size-specific key first, then base key
  function _laborDefault(baseKey, catKey) {
    // 1. Company-wide defaults (localStorage) — user's saved overrides for all projects
    var cd = _loadCompanyDefaults();
    var cdKey = baseKey + '-lc-' + catKey;
    if (cd[cdKey] && cd[cdKey].laborHrs) return cd[cdKey].laborHrs;
    // Try base key fallback in company defaults
    var cdBase = baseKey.replace(/-(mw)?\d+(x\d+)?$/, '') + '-lc-' + catKey;
    if (cdBase !== cdKey && cd[cdBase] && cd[cdBase].laborHrs) return cd[cdBase].laborHrs;
    // 2. JSON defaults (labor-defaults.json) — seeded starting values
    if (!LABOR_DEFAULTS) return 0;
    if (LABOR_DEFAULTS[baseKey] && LABOR_DEFAULTS[baseKey][catKey]) return LABOR_DEFAULTS[baseKey][catKey];
    var baseOnly = baseKey.replace(/-(mw)?\d+(x\d+)?$/, '');
    if (baseOnly !== baseKey && LABOR_DEFAULTS[baseOnly] && LABOR_DEFAULTS[baseOnly][catKey]) return LABOR_DEFAULTS[baseOnly][catKey];
    return 0;
  }
  
  // Get total labor hours across all categories for an item
  function getTotalLaborHrs(baseKey, applicableCats) {
    var total = 0;
    var cats = applicableCats || LABOR_CATEGORIES;
    for (var i = 0; i < cats.length; i++) {
      var k = lhCatKey(baseKey, cats[i].key);
      var entry = priceBookCache ? priceBookCache[k] : null;
      if (entry && entry.laborHrs) { total += entry.laborHrs; }
      else { total += _laborDefault(baseKey, cats[i].key); }
    }
    return total;
  }
  
  // Get labor hours per category for an item (for radar chart)
  function getLaborBreakdown(baseKey, applicableCats) {
    var cats = applicableCats || LABOR_CATEGORIES;
    var result = [];
    for (var i = 0; i < cats.length; i++) {
      var k = lhCatKey(baseKey, cats[i].key);
      var entry = priceBookCache ? priceBookCache[k] : null;
      var hrs = (entry && entry.laborHrs) ? entry.laborHrs : _laborDefault(baseKey, cats[i].key);
      result.push({ cat: cats[i], hrs: hrs });
    }
    return result;
  }
  
  // Active radar chart state
  var radarChartTarget = null; // base key of item being edited
  var radarChartItemType = null; // 'duct','fitting','accessory','equipment'
  var radarChartSubType = null; // 'spiral','snaplock', or null
  
  // Render a radar chart as SVG for a given item
  function renderRadarChart(baseKey, itemType, subType) {
    // subType: 'spiral', 'snaplock', or null
    var allCats = LABOR_CATEGORIES;
    var breakdown = getLaborBreakdown(baseKey, allCats);
    var n = allCats.length;
    var isSheetMetal = (itemType === 'duct' || itemType === 'fitting');
    var isSnapLock = subType === 'snaplock';
    // Determine which categories are enabled per item
    function isCatEnabled(cat) {
      if (!isSheetMetal) return cat.applies.indexOf(itemType) !== -1;
      // Sheet metal: rough always on, stocking always on, trim only for snap lock
      if (cat.key === 'rough') return true;
      if (cat.key === 'stocking') return true;
      if (cat.key === 'trim' && isSnapLock) return true;
      return false;
    }
    var cx = 100, cy = 100, r = 80;
    var maxVal = 2;
    for (var i = 0; i < breakdown.length; i++) {
      if (breakdown[i].hrs > maxVal) maxVal = Math.ceil(breakdown[i].hrs);
    }
  
    // --- Layout: flex row with radar on left, sliders on right ---
    var html = '<div style="display:flex;gap:16px;align-items:flex-start">';
  
    // --- LEFT: Radar chart SVG ---
    html += '<div style="flex-shrink:0">';
    html += '<svg width="220" height="220" viewBox="0 0 220 220">';
    // Background rings
    for (var ring = 1; ring <= 4; ring++) {
      var rr = r * ring / 4;
      var pts = [];
      for (var j = 0; j < n; j++) {
        var angle = -Math.PI / 2 + (2 * Math.PI * j / n);
        pts.push((cx + rr * Math.cos(angle)).toFixed(1) + ',' + (cy + rr * Math.sin(angle)).toFixed(1));
      }
      html += '<polygon points="' + pts.join(' ') + '" fill="none" stroke="#0f3460" stroke-width="0.5"/>';
    }
    // Axis lines + labels
    for (var j = 0; j < n; j++) {
      var cat = allCats[j];
      var enabled = isCatEnabled(cat);
      var angle = -Math.PI / 2 + (2 * Math.PI * j / n);
      var ex = cx + r * Math.cos(angle);
      var ey = cy + r * Math.sin(angle);
      html += '<line x1="' + cx + '" y1="' + cy + '" x2="' + ex.toFixed(1) + '" y2="' + ey.toFixed(1) + '" stroke="' + (enabled ? '#0f3460' : '#0a1a30') + '" stroke-width="0.5"/>';
      var lx = cx + (r + 18) * Math.cos(angle);
      var ly = cy + (r + 18) * Math.sin(angle);
      var anchor = Math.abs(Math.cos(angle)) < 0.1 ? 'middle' : (Math.cos(angle) > 0 ? 'start' : 'end');
      html += '<text x="' + lx.toFixed(1) + '" y="' + (ly + 4).toFixed(1) + '" fill="' + (enabled ? cat.color : '#333') + '" font-size="11" text-anchor="' + anchor + '" font-weight="700">' + cat.short + '</text>';
    }
    // Data polygon
    var dataPts = [];
    for (var j = 0; j < n; j++) {
      var angle = -Math.PI / 2 + (2 * Math.PI * j / n);
      var val = breakdown[j].hrs / maxVal;
      if (val > 1) val = 1;
      dataPts.push((cx + r * val * Math.cos(angle)).toFixed(1) + ',' + (cy + r * val * Math.sin(angle)).toFixed(1));
    }
    html += '<polygon points="' + dataPts.join(' ') + '" fill="rgba(233,69,96,0.2)" stroke="#e94560" stroke-width="1.5"/>';
    // Vertex dots
    for (var j = 0; j < n; j++) {
      var cat = allCats[j];
      var enabled = isCatEnabled(cat);
      var angle = -Math.PI / 2 + (2 * Math.PI * j / n);
      var val = breakdown[j].hrs / maxVal;
      if (val > 1) val = 1;
      var dx = cx + r * val * Math.cos(angle);
      var dy = cy + r * val * Math.sin(angle);
      html += '<circle cx="' + dx.toFixed(1) + '" cy="' + dy.toFixed(1) + '" r="4.5" fill="' + (enabled ? cat.color : '#333') + '" stroke="' + (enabled ? '#fff' : '#222') + '" stroke-width="1"/>';
    }
    html += '</svg>';
    // Category inputs below chart
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:6px">';
    // Source legend
    html += '<div style="display:flex;gap:8px;margin-bottom:4px;font-size:9px">';
    html += '<span style="color:#e94560">● Project</span>';
    html += '<span style="color:#00ff88">● Company</span>';
    html += '<span style="color:#555">● Default</span>';
    html += '</div>';
    for (var j = 0; j < n; j++) {
      var cat = allCats[j];
      var enabled = isCatEnabled(cat);
      var catKey = lhCatKey(baseKey, cat.key);
      // Determine source of this value
      var pbEntry = priceBookCache ? priceBookCache[catKey] : null;
      var hasProjVal = pbEntry && pbEntry.laborHrs != null;
      var cd = _loadCompanyDefaults();
      var hasCo = cd[catKey] && cd[catKey].laborHrs;
      var hasJson = _laborDefault(baseKey, cat.key) > 0;
      var srcDot = '', srcTitle = '';
      if (hasProjVal) { srcDot = '#e94560'; srcTitle = 'Project override'; }
      else if (hasCo) { srcDot = '#00ff88'; srcTitle = 'Company default'; }
      else if (hasJson && breakdown[j].hrs > 0) { srcDot = '#555'; srcTitle = 'JSON seed default'; }
      html += '<div style="display:flex;align-items:center;gap:4px;opacity:' + (enabled ? '1' : '0.3') + '">';
      html += '<span style="color:' + cat.color + ';font-size:11px;font-weight:700;width:24px">' + cat.short + '</span>';
      html += '<input type="text" value="' + (breakdown[j].hrs || '') + '" placeholder="0" ';
      html += (enabled ? '' : 'disabled ') + 'style="width:44px;background:#1a1a2e;border:1px solid ' + (enabled ? '#0f3460' : '#0a1a30') + ';color:' + (enabled ? cat.color : '#333') + ';padding:3px 4px;border-radius:3px;font-size:12px;text-align:right" ';
      html += 'onclick="event.stopPropagation()" onmousedown="event.stopPropagation()" onchange="updateRadarHrs(\'' + catKey + '\',this.value)">';
      if (srcDot) html += '<span style="color:' + srcDot + ';font-size:8px" title="' + srcTitle + '">●</span>';
      else html += '<span style="width:8px"></span>';
      html += '</div>';
    }
    html += '</div>';
    html += '</div>'; // end left
  
    // --- RIGHT: Size slider ---
    html += '<div style="display:flex;flex-direction:column;gap:8px;min-width:50px;align-items:center">';
    var isRoundItem = baseKey.indexOf('spiral') !== -1 || baseKey.indexOf('snaplock') !== -1;
    var RD_SIZES = [4,5,6,7,8,9,10,12,14,16,18,20,22,24];
    if (isRoundItem) {
      // Parse current size(s) from key: 'spiral-tee-12x8' or 'spiral-90el-12' or 'duct-spiral-12'
      var pairMatch = baseKey.match(/-(\d+)x(\d+)$/);
      var singleMatch = !pairMatch && baseKey.match(/-(\d+)$/);
      var mainSz = pairMatch ? parseInt(pairMatch[1]) : (singleMatch ? parseInt(singleMatch[1]) : 12);
      // Detect if this fitting TYPE is a two-dim type (even if current key has no x)
      var fittingType = baseKey.replace(/-(\d+)(x\d+)?$/, '');
      var isTwoDim = pairMatch || (RECT_FITTING_REF[fittingType] && false) || /-(tee|saddle45y|lateral|wye|reducer|eccReducer|transition)/.test(baseKey);
      var secSz = pairMatch ? parseInt(pairMatch[2]) : mainSz;
      var mainIdx = RD_SIZES.indexOf(mainSz); if (mainIdx < 0) mainIdx = 0;
      var uid = 'rd-' + Date.now();
      // Primary slider
      html += '<span style="color:#a0a0c0;font-size:12px;font-weight:700">\u2300</span>';
      html += '<input type="range" id="' + uid + 'a" min="0" max="' + (RD_SIZES.length-1) + '" value="' + mainIdx + '" ';
      html += 'orient="vertical" style="writing-mode:bt-lr;-webkit-appearance:slider-vertical;width:24px;height:' + (isTwoDim ? '90' : '140') + 'px;accent-color:#00c8ff" ';
      html += 'onclick="event.stopPropagation()" onmousedown="event.stopPropagation()" ';
      html += 'oninput="document.getElementById(\'' + uid + 'al\').textContent=[4,5,6,7,8,9,10,12,14,16,18,20,22,24][this.value]+\'\u2033\'" ';
      html += 'onchange="radarSlideRd(0,this.value,\'' + baseKey + '\')">';
      html += '<span id="' + uid + 'al" style="color:#00c8ff;font-size:14px;font-weight:700">' + mainSz + '\u2033</span>';
      // Secondary slider (branch/outlet) for two-dim fitting types
      if (isTwoDim) {
        var secIdx = RD_SIZES.indexOf(secSz); if (secIdx < 0) secIdx = 0;
        html += '<span style="color:#da77f2;font-size:11px;font-weight:700;margin-top:8px">BRANCH</span>';
        html += '<input type="range" id="' + uid + 'b" min="0" max="' + mainIdx + '" value="' + secIdx + '" ';
        html += 'orient="vertical" style="writing-mode:bt-lr;-webkit-appearance:slider-vertical;width:24px;height:90px;accent-color:#da77f2" ';
        html += 'onclick="event.stopPropagation()" onmousedown="event.stopPropagation()" ';
        html += 'oninput="document.getElementById(\'' + uid + 'bl\').textContent=[4,5,6,7,8,9,10,12,14,16,18,20,22,24][this.value]+\'\u2033\'" ';
        html += 'onchange="radarSlideRd(1,this.value,\'' + baseKey + '\')">';
        html += '<span id="' + uid + 'bl" style="color:#da77f2;font-size:14px;font-weight:700">' + secSz + '\u2033</span>';
      }
    } else {
      var currentMWIdx = pbMinWidthClass['rect-fit'] || 0;
      html += '<span style="color:#a0a0c0;font-size:12px;font-weight:700">MIN</span>';
      html += '<input type="range" min="0" max="' + (RECT_MIN_WIDTH_CLASSES.length-1) + '" value="' + currentMWIdx + '" ';
      html += 'orient="vertical" style="writing-mode:bt-lr;-webkit-appearance:slider-vertical;width:24px;height:140px;accent-color:#e94560" ';
      html += 'onclick="event.stopPropagation()" onmousedown="event.stopPropagation()" ';
      html += 'onchange="radarSliderMinWidth(this.value)">';
      var mwLabel = RECT_MIN_WIDTH_CLASSES[currentMWIdx] ? RECT_MIN_WIDTH_CLASSES[currentMWIdx].label : '';
      html += '<span style="color:#e94560;font-size:12px;font-weight:600;text-align:center;max-width:60px">' + mwLabel + '</span>';
    }
    html += '</div>';
  
    // Save as Company Default + Revert to Platform Default buttons
    html += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #0f3460;display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
    html += '<button onclick="event.stopPropagation();saveAsCompanyDefault(\'' + baseKey + '\')" style="background:#0f3460;color:#a0a0c0;border:1px solid #1a4080;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:10px;white-space:nowrap" title="Save current labor hours as company-wide default for all future projects">🏢 Save as Company Default</button>';
    html += '<button onclick="event.stopPropagation();revertToPlatformDefault(\'' + baseKey + '\')" style="background:#1a1a2e;color:#ff6b6b;border:1px solid #3d0a0a;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:10px;white-space:nowrap" title="Remove all project and company overrides — revert to platform seed defaults">↩ Revert to Default</button>';
    var hasGlobal = _hasCompanyDefault(baseKey);
    if (hasGlobal) html += '<span style="color:#00ff88;font-size:9px">✓ Company default set</span>';
    html += '</div>';
  
    html += '</div>'; // end flex row
    return html;
  }
  
  window.radarSlideRd = function(dim, idx, key) {
    var S = [4,5,6,7,8,9,10,12,14,16,18,20,22,24];
    var v = S[parseInt(idx)];
    var pairM = key.match(/-(\d+)x(\d+)$/);
    var singleM = !pairM && key.match(/-(\d+)$/);
    var newKey;
    if (pairM) {
      var m = parseInt(pairM[1]), b = parseInt(pairM[2]);
      if (dim === 0) { m = v; if (b > m) b = m; }
      else { b = v; if (b > m) b = m; }
      newKey = key.replace(/-(\d+)x(\d+)$/, '-' + m + 'x' + b);
    } else if (singleM) {
      if (dim === 1) {
        // Branch slider on a single-dim key: create pair key
        var curMain = parseInt(singleM[1]);
        if (v > curMain) v = curMain;
        if (v === curMain) { newKey = key; } // same size = stay single
        else { newKey = key.replace(/-(\d+)$/, '-' + curMain + 'x' + v); }
      } else {
        newKey = key.replace(/-(\d+)$/, '-' + v);
      }
    } else { return; }
    var parent = key.replace(/-(\d+)(x\d+)?$/, '');
    pbExpandedItems[parent] = true;
    // Keep main size group expanded for pair-type fittings
    var newPairM = newKey.match(/-(\d+)x(\d+)$/);
    var newSingleM = !newPairM && newKey.match(/-(\d+)$/);
    var mainForExpand = newPairM ? parseInt(newPairM[1]) : (newSingleM ? parseInt(newSingleM[1]) : v);
    pbExpandedItems[parent + '-' + mainForExpand] = true;
    radarChartTarget = newKey;
    renderPriceBook();
  };
  
  window.radarSliderMinWidth = function(idx) {
    var i = parseInt(idx);
    var oldIdx = pbMinWidthClass['rect-fit'] || 0;
    pbMinWidthClass['rect-fit'] = i;
    // Update radarChartTarget key to match new min-width class so chart stays open
    if (radarChartTarget) {
      var oldMax = RECT_MIN_WIDTH_CLASSES[oldIdx] ? RECT_MIN_WIDTH_CLASSES[oldIdx].maxMin : 6;
      var newMax = RECT_MIN_WIDTH_CLASSES[i] ? RECT_MIN_WIDTH_CLASSES[i].maxMin : 6;
      radarChartTarget = radarChartTarget.replace('-mw' + oldMax, '-mw' + newMax);
    }
    renderPriceBook();
    pbSaveLayout();
  };
  
  window.updateRadarHrs = async function(catKey, value) {
    var existing = (priceBookCache && priceBookCache[catKey]) || { key: catKey };
    existing.laborHrs = value === '' ? null : parseFloat(value) || null;
    await savePriceBookEntry(catKey, existing);
    renderPriceBook();
  };
  
  // ── Company-wide labor defaults (localStorage) ──────────────────────
  var _companyDefaults = null;
  function _loadCompanyDefaults() {
    if (_companyDefaults) return _companyDefaults;
    try { _companyDefaults = JSON.parse(localStorage.getItem('isplan_labor_company') || '{}'); }
    catch (e) { _companyDefaults = {}; }
    return _companyDefaults;
  }
  
  function _hasCompanyDefault(baseKey) {
    var cd = _loadCompanyDefaults();
    for (var i = 0; i < LABOR_CATEGORIES.length; i++) {
      if (cd[baseKey + '-lc-' + LABOR_CATEGORIES[i].key]) return true;
    }
    return false;
  }
  
  window.saveAsCompanyDefault = function(baseKey) {
    var cd = _loadCompanyDefaults();
    var saved = 0;
    for (var i = 0; i < LABOR_CATEGORIES.length; i++) {
      var catKey = baseKey + '-lc-' + LABOR_CATEGORIES[i].key;
      var entry = priceBookCache ? priceBookCache[catKey] : null;
      var hrs = (entry && entry.laborHrs) ? entry.laborHrs : _laborDefault(baseKey, LABOR_CATEGORIES[i].key);
      if (hrs > 0) { cd[catKey] = { laborHrs: hrs }; saved++; }
    }
    localStorage.setItem('isplan_labor_company', JSON.stringify(cd));
    _companyDefaults = cd;
    showToast('Saved ' + saved + ' labor values as company default for ' + baseKey, 2500);
    renderPriceBook();
  };
  
  window.revertToPlatformDefault = async function(baseKey) {
    var removed = 0;
    // 1. Remove project overrides from IndexedDB
    for (var i = 0; i < LABOR_CATEGORIES.length; i++) {
      var catKey = baseKey + '-lc-' + LABOR_CATEGORIES[i].key;
      if (priceBookCache && priceBookCache[catKey] && priceBookCache[catKey].laborHrs != null) {
        delete priceBookCache[catKey].laborHrs;
        await savePriceBookEntry(catKey, priceBookCache[catKey]);
        removed++;
      }
    }
    // 2. Remove company defaults from localStorage
    var cd = _loadCompanyDefaults();
    var cdRemoved = 0;
    for (var i = 0; i < LABOR_CATEGORIES.length; i++) {
      var catKey = baseKey + '-lc-' + LABOR_CATEGORIES[i].key;
      if (cd[catKey]) { delete cd[catKey]; cdRemoved++; }
    }
    if (cdRemoved > 0) {
      localStorage.setItem('isplan_labor_company', JSON.stringify(cd));
      _companyDefaults = cd;
    }
    showToast('Reverted ' + baseKey + ' to platform defaults (' + removed + ' project + ' + cdRemoved + ' company overrides cleared)', 3000);
    renderPriceBook();
  };
  
  window.toggleRadarChart = function(baseKey, itemType, subType) {
    if (radarChartTarget === baseKey) {
      radarChartTarget = null;
      radarChartItemType = null;
      radarChartSubType = null;
    } else {
      radarChartTarget = baseKey;
      radarChartItemType = itemType;
      radarChartSubType = subType || null;
    }
    renderPriceBook();
  };
  
  function pbInput(key, prop, value) {
    var clr = prop === 'materialCost' ? '#00ff88' : prop === 'laborHrs' ? '#ffaa00' : '#e0e0e0';
    return '<input type="text" value="' + (value != null ? value : '') + '" placeholder="\u2014" style="width:60px;background:#1a1a2e;border:1px solid #0f3460;color:' + clr + ';padding:3px 5px;border-radius:3px;font-size:11px;text-align:right" onchange="updatePBEntry(\'' + key + '\',\'' + prop + '\',this.value)">';
  }
  
  function pbRow(item, sectionId) {
    var gauge = pbGauge[sectionId] || null;
    // Determine active key based on spiral/snaplock toggle
    var activeKey = item.key;
    // Flex color toggle: black/silver
    if (item.altKey && pbFlexColor[sectionId] === 'silver') {
      activeKey = item.altKey;
    }
    var roundType = pbRoundType[sectionId];
    if (roundType === 'snaplock' && item.snapKey) {
      activeKey = item.snapKey;
    } else if (roundType === 'snaplock' && item.snapKey === null) {
      var html = '<tr style="border-bottom:1px solid rgba(15,52,96,0.3);opacity:0.3">';
      html += '<td style="padding:4px;color:#666;font-size:11px">' + item.label + '</td>';
      html += '<td style="padding:4px 2px;color:#666;font-size:11px;text-align:center" colspan="2">—</td>';
      html += '</tr>';
      return html;
    }
    var entry = priceBookCache ? priceBookCache[activeKey] : null;
    var lhEntry = priceBookCache ? priceBookCache[lhCatKey(activeKey)] : null;
    var lh = lhEntry ? lhEntry.laborHrs : (entry ? entry.laborHrs : null);
    var mc;
    if (gauge && (SPIRAL_DEFAULTS[activeKey] || SNAPLOCK_DEFAULTS[activeKey])) {
      mc = getMaterialForGauge(activeKey, gauge);
    } else if (!gauge && SNAPLOCK_DEFAULTS[activeKey] && SNAPLOCK_DEFAULTS[activeKey]['26'] != null) {
      mc = SNAPLOCK_DEFAULTS[activeKey]['26'];
    } else {
      mc = entry ? entry.materialCost : null;
    }
    var gaugeKey = gauge ? activeKey + '-g' + gauge : activeKey;
    var isRectFit = sectionId === 'rect-fit';
    var isPlenum = activeKey === 'rect-plenum';
    var hasSizes = ((item.sizes && item.sizes.length > 0) || isRectFit) && !isPlenum;
    var hasPairs = item.sizePairs && item.sizes && item.sizes.length > 0;
    var isExpanded = hasSizes && !!pbExpandedItems[activeKey];
    var arrow = hasSizes ? (isExpanded ? '\u25BC ' : '\u25B6 ') : '';
    var clickAttr = hasSizes ? ' onclick="togglePBItemExpand(\'' + activeKey + '\')" style="padding:4px;color:#e0e0e0;font-size:11px;cursor:pointer"' : ' style="padding:4px;color:#e0e0e0;font-size:11px"';
    var hasShopAdder = isRectFit || (sectionId === 'rect-acc');
    // For rect fittings, key prices by perimeter class + auto-calc raw material
    var mcKey = gaugeKey;
    var lhKey = activeKey;
    var autoCalcMc = null;
    // Representative W,H for the active min-width class (~2:1 aspect)
    var mwSampleW = 12, mwSampleH = 6, mwSampleSA = 0;
    if (isRectFit) {
      var mwIdx = pbMinWidthClass[sectionId] || 0;
      var mwCls = RECT_MIN_WIDTH_CLASSES[mwIdx];
      var mwMax = mwCls ? mwCls.maxMin : 6;
      mwSampleW = mwCls ? mwCls.repW : 12;
      mwSampleH = mwCls ? mwCls.repH : 6;
      mcKey = activeKey + '-mw' + mwMax + (gauge ? '-g' + gauge : '');
      lhKey = activeKey + '-mw' + mwMax;
      // Auto-calc raw material from SA × gauge weight × $/lb
      // Plenum: flat pricing, no size scaling
      if (isPlenum) {
        autoCalcMc = RECT_PLENUM_DEFAULT;
      }
      // Flex connector: flat pricing from defaults
      else if (activeKey === 'rect-flex-conn' && RECT_FLEX_CONN_DEFAULTS[mwMax] != null) {
        autoCalcMc = RECT_FLEX_CONN_DEFAULTS[mwMax];
      } else {
        autoCalcMc = calcRectFittingRawCost(activeKey, mwSampleW, mwSampleH, gauge || '26');
        // Add liner adder to fitting auto-calc when toggle active
        if (pbLinerActive && autoCalcMc != null) {
          var fitLinerSA = RECT_FITTING_SA[activeKey] ? calcRectFittingSA(activeKey, mwSampleW, mwSampleH) : 0;
          autoCalcMc += fitLinerSA * getActiveLinerPricePerSF();
        }
      }
      mwSampleSA = RECT_FITTING_SA[activeKey] ? calcRectFittingSA(activeKey, mwSampleW, mwSampleH) : 0;
      // Check for user override
      var mwEntry = priceBookCache ? priceBookCache[mcKey] : null;
      mc = (mwEntry && mwEntry.materialCost != null) ? mwEntry.materialCost : null;
      var mwLhEntry = priceBookCache ? priceBookCache[lhCatKey(lhKey)] : null;
      lh = mwLhEntry ? mwLhEntry.laborHrs : null;
    }
    var ref = RECT_FITTING_REF[activeKey];
    var html = '<tr style="border-bottom:1px solid rgba(15,52,96,0.3)">';
    html += '<td' + clickAttr + '>' + arrow + item.label;
    // Show surface area for rect fittings (read-only, derived from min-width class)
    if (isRectFit && ref && mwSampleSA > 0) {
      html += ' <span style="color:#666;font-size:9px">(SA: ' + mwSampleSA.toFixed(1) + ' SF)</span>';
    }
    html += '</td>';
    // Material: show auto-calc in dim green or user override in bright green
    html += '<td style="padding:4px 2px">';
    if (isRectFit && mc == null && autoCalcMc != null && autoCalcMc > 0) {
      html += '<input type="text" value="' + autoCalcMc.toFixed(2) + '" placeholder="\u2014" '
        + 'style="width:50px;background:#1a1a2e;border:1px solid #0f3460;color:#009966;padding:3px 4px;border-radius:3px;font-size:11px;text-align:right;font-style:italic" '
        + 'onchange="updatePBEntry(\'' + mcKey + '\',\'materialCost\',this.value)" title="Auto-calc from sheet weight \u2014 edit to override">';
    } else {
      html += pbInput(mcKey, 'materialCost', mc);
    }
    html += '</td>';
    // Per-item shop adder
    if (hasShopAdder) {
      var shopKey = (isRectFit ? lhKey : activeKey) + '-shop';
      var shopSaved = priceBookCache ? priceBookCache[shopKey] : null;
      var shopAdder = shopSaved ? shopSaved.materialCost : null;
      html += '<td style="padding:4px 2px"><input type="text" value="' + (shopAdder != null ? shopAdder : '') + '" placeholder="\u2014" style="width:50px;background:#1a1a2e;border:1px solid #0f3460;color:#ffaa00;padding:3px 4px;border-radius:3px;font-size:11px;text-align:right" onchange="updatePBEntry(\'' + shopKey + '\',\'materialCost\',this.value)"></td>';
    }
    // Labor: total hours across all categories + radar chart trigger
    var lhItemType = isRectFit ? 'fitting' : (sectionId === 'rect-acc' ? 'accessory' : (sectionId && sectionId.indexOf('-duct') !== -1 ? 'duct' : 'fitting'));
    var lhBaseKey = isRectFit ? lhKey : activeKey;
    // Determine sub-type for spiral/snaplock context
    var lhSubType = '';
    var rt = pbRoundType[sectionId];
    if (rt === 'snaplock') lhSubType = 'snaplock';
    else if (sectionId && sectionId.indexOf('round') !== -1) lhSubType = 'spiral';
    var totalLh = getTotalLaborHrs(lhBaseKey);
    html += '<td style="padding:4px 2px;text-align:center;cursor:pointer" onclick="toggleRadarChart(\'' + lhBaseKey + '\',\'' + lhItemType + '\',\'' + lhSubType + '\')" title="Click to edit labor breakdown">';
    html += '<span style="color:#ffaa00;font-size:11px">' + (totalLh > 0 ? totalLh.toFixed(2) + 'h' : '\u2014') + '</span>';
    html += ' <span style="color:#555;font-size:9px">\u25BC</span>';
    html += '</td>';
    html += '</tr>';
    // Radar chart row (if this item is active)
    // Skip when rect fit is expanded — the matching per-class sub-row will render it instead
    if (radarChartTarget === lhBaseKey && !(isRectFit && isExpanded)) {
      var colSpan = hasShopAdder ? 4 : 3;
      html += '<tr onclick="event.stopPropagation()"><td colspan="' + colSpan + '" style="padding:8px;background:rgba(15,52,96,0.2);border-bottom:1px solid #0f3460">';
      html += renderRadarChart(lhBaseKey, lhItemType, radarChartSubType);
      html += '</td></tr>';
    }
  
    // ---- Rect fitting: expand by min-width class ----
    if (isExpanded && isRectFit) {
      for (var mi = 0; mi < RECT_MIN_WIDTH_CLASSES.length; mi++) {
        var mwSub = RECT_MIN_WIDTH_CLASSES[mi];
        var mwMaxSub = mwSub.maxMin;
        var subW = mwSub.repW;
        var subH = mwSub.repH;
        var subSA = RECT_FITTING_SA[activeKey] ? calcRectFittingSA(activeKey, subW, subH) : 0;
        var subAutoMc;
        // Flex connector: flat pricing from defaults
        if (activeKey === 'rect-flex-conn' && RECT_FLEX_CONN_DEFAULTS[mwMaxSub] != null) {
          subAutoMc = RECT_FLEX_CONN_DEFAULTS[mwMaxSub];
        } else {
          subAutoMc = calcRectFittingRawCost(activeKey, subW, subH, gauge || '26');
          // Add liner adder to sub-row auto-calc when toggle active
          if (pbLinerActive && subAutoMc != null) {
            var subLinerSA = RECT_FITTING_SA[activeKey] ? calcRectFittingSA(activeKey, subW, subH) : 0;
            subAutoMc += subLinerSA * getActiveLinerPricePerSF();
          }
        }
        var subMcKey = activeKey + '-mw' + mwMaxSub + (gauge ? '-g' + gauge : '');
        var subLhKey = activeKey + '-mw' + mwMaxSub;
        var subEntry = priceBookCache ? priceBookCache[subMcKey] : null;
        var subMc = (subEntry && subEntry.materialCost != null) ? subEntry.materialCost : null;
        var subShopKey = subLhKey + '-shop';
        var subShopSaved = priceBookCache ? priceBookCache[subShopKey] : null;
        var subShopAdder = (subShopSaved && subShopSaved.materialCost != null) ? subShopSaved.materialCost : null;
        // Fitting-specific shop adder defaults
        var subShopIsDefault = false;
        if (subShopAdder == null) {
          var _fsd = null;
          if ((activeKey === 'rect-reducer' || activeKey === 'rect-eccReducer') && RECT_REDUCER_SHOP_DEFAULTS[mwMaxSub] != null) _fsd = RECT_REDUCER_SHOP_DEFAULTS[mwMaxSub];
          else if (activeKey === 'rect-endcap' && RECT_ENDCAP_SHOP_DEFAULTS[mwMaxSub] != null) _fsd = RECT_ENDCAP_SHOP_DEFAULTS[mwMaxSub];
          else if (activeKey === 'rect-transition' && RECT_TRANSITION_SHOP_DEFAULTS[mwMaxSub] != null) _fsd = RECT_TRANSITION_SHOP_DEFAULTS[mwMaxSub];
          else if (activeKey === 'rectTap' && RECT_TAP_SHOP_DEFAULTS[mwMaxSub] != null) _fsd = RECT_TAP_SHOP_DEFAULTS[mwMaxSub];
          else if (activeKey === 'rect-45el' && RECT_45EL_SHOP_DEFAULTS[mwMaxSub] != null) _fsd = RECT_45EL_SHOP_DEFAULTS[mwMaxSub];
          if (_fsd != null) { subShopAdder = _fsd; subShopIsDefault = true; }
        }
        var subTotalLh = getTotalLaborHrs(subLhKey);
        var isActiveMW = (mi === (pbMinWidthClass[sectionId] || 0));
        var rowBg = isActiveMW ? 'background:rgba(233,69,96,0.12)' : 'background:rgba(15,52,96,0.15)';
        html += '<tr style="border-bottom:1px solid rgba(15,52,96,0.15);' + rowBg + '">';
        html += '<td style="padding:3px 4px 3px 20px;color:#e94560;font-size:12px;font-weight:' + (isActiveMW ? '700' : '500') + '">' + mwSub.label;
        if (subSA > 0) html += ' <span style="color:#666;font-size:9px">(SA: ' + subSA.toFixed(1) + ' SF)</span>';
        html += '</td>';
        html += '<td style="padding:3px 2px">';
        if (subMc == null && subAutoMc != null && subAutoMc > 0) {
          html += '<input type="text" value="' + subAutoMc.toFixed(2) + '" placeholder="—" '
            + 'style="width:50px;background:#1a1a2e;border:1px solid #0f3460;color:#009966;padding:3px 4px;border-radius:3px;font-size:11px;text-align:right;font-style:italic" '
            + 'onchange="updatePBEntry(\'' + subMcKey + '\',\'materialCost\',this.value)" title="Auto-calc from sheet weight — edit to override">';
        } else {
          html += pbInput(subMcKey, 'materialCost', subMc);
        }
        html += '</td>';
        var subShopColor = subShopIsDefault ? '#cc8800' : '#ffaa00';
        var subShopStyle = subShopIsDefault ? 'font-style:italic' : '';
        html += '<td style="padding:3px 2px"><input type="text" value="' + (subShopAdder != null ? subShopAdder.toFixed(2) : '') + '" placeholder="—" style="width:50px;background:#1a1a2e;border:1px solid #0f3460;color:' + subShopColor + ';padding:3px 4px;border-radius:3px;font-size:11px;text-align:right;' + subShopStyle + '" onchange="updatePBEntry(\'' + subShopKey + '\',\'materialCost\',this.value)" title="' + (subShopIsDefault ? 'Default from pricing log' : '') + '"></td>';
        html += '<td style="padding:3px 2px;text-align:center;cursor:pointer" onclick="event.stopPropagation();toggleRadarChart(\'' + subLhKey + '\',\'fitting\',\'\')">';
        html += '<span style="color:#ffaa00;font-size:11px">' + (subTotalLh > 0 ? subTotalLh.toFixed(2) + 'h' : '—') + '</span>';
        html += ' <span style="color:#555;font-size:9px">▼</span></td>';
        html += '</tr>';
        if (radarChartTarget === subLhKey) {
          html += '<tr onclick="event.stopPropagation()"><td colspan="4" style="padding:8px;background:rgba(15,52,96,0.2);border-bottom:1px solid #0f3460">';
          html += renderRadarChart(subLhKey, 'fitting', '');
          html += '</td></tr>';
        }
      }
    }
    // ---- Two-dimension pricing: expandable tree with sub-rows ----
    else if (isExpanded && hasPairs) {
      var isReducer = activeKey.indexOf('reducer') !== -1 || activeKey.indexOf('eccReducer') !== -1;
      var mainLabel = isReducer ? 'Inlet' : 'Main';
      var subLabel = isReducer ? 'Outlet' : 'Branch';
      for (var si = 0; si < item.sizes.length; si++) {
        var mainSz = item.sizes[si];
        html += '<tr style="border-bottom:1px solid rgba(15,52,96,0.2);background:rgba(15,52,96,0.15)">';
        html += '<td onclick="togglePBSizePairExpand(\'' + activeKey + '-' + mainSz + '\')" style="padding:3px 4px 3px 16px;color:#00c8ff;font-size:12px;cursor:pointer;font-weight:600" onmouseover="this.style.color=\'#4dd9ff\'" onmouseout="this.style.color=\'#00c8ff\'">';
        var pairExpanded = !!pbExpandedItems[activeKey + '-' + mainSz];
        html += (pairExpanded ? '\u25BC ' : '\u25B6 ') + mainSz + '\u2033 ' + mainLabel;
        html += '</td>';
        var szKey = activeKey + '-' + mainSz;
        var szMc = getMaterialForGauge(szKey, gauge || '26');
        var szGaugeKey = gauge ? szKey + '-g' + gauge : szKey;
        var szEntry = priceBookCache ? priceBookCache[szKey] : null;
        var szLhEntry = priceBookCache ? priceBookCache[lhCatKey(szKey)] : null;
        var szLh = szLhEntry ? szLhEntry.laborHrs : (szEntry ? szEntry.laborHrs : null);
        html += '<td style="padding:3px 2px">' + pbInput(szGaugeKey, 'materialCost', szMc) + '</td>';
        var szTotalLh = getTotalLaborHrs(szKey);
        var szSubType = (pbRoundType[sectionId] === 'snaplock') ? 'snaplock' : 'spiral';
        html += '<td style="padding:3px 2px;text-align:center;cursor:pointer" onclick="event.stopPropagation();toggleRadarChart(\'' + szKey + '\',\'fitting\',\'' + szSubType + '\')">';
        html += '<span style="color:#ffaa00;font-size:11px">' + (szTotalLh > 0 ? szTotalLh.toFixed(2) + 'h' : '\u2014') + '</span>';
        html += ' <span style="color:#555;font-size:9px">\u25BC</span></td>';
        html += '</tr>';
        if (radarChartTarget === szKey) {
          html += '<tr onclick="event.stopPropagation()"><td colspan="3" style="padding:8px;background:rgba(15,52,96,0.2);border-bottom:1px solid #0f3460">';
          html += renderRadarChart(szKey, 'fitting', radarChartSubType);
          html += '</td></tr>';
        }
        if (pairExpanded) {
          for (var bi = 0; bi < item.sizes.length; bi++) {
            var subSz = item.sizes[bi];
            if (subSz > mainSz) continue;
            var pairKey = activeKey + '-' + mainSz + 'x' + subSz;
            var pairMc = getMaterialForGauge(pairKey, gauge || '26');
            var pairGaugeKey = gauge ? pairKey + '-g' + gauge : pairKey;
            var pairEntry = priceBookCache ? priceBookCache[pairKey] : null;
            var pairLhEntry = priceBookCache ? priceBookCache[lhCatKey(pairKey)] : null;
            var pairLh = pairLhEntry ? pairLhEntry.laborHrs : (pairEntry ? pairEntry.laborHrs : null);
            html += '<tr style="border-bottom:1px solid rgba(15,52,96,0.1);background:rgba(15,52,96,0.25)">';
            html += '<td style="padding:2px 4px 2px 36px;color:#a0c8ff;font-size:11px">';
            html += mainSz + '\u2033\u00d7' + subSz + '\u2033';
            html += '</td>';
            html += '<td style="padding:2px 2px">' + pbInput(pairGaugeKey, 'materialCost', pairMc) + '</td>';
            var pairTotalLh = getTotalLaborHrs(pairKey);
            html += '<td style="padding:2px 2px;text-align:center;cursor:pointer" onclick="event.stopPropagation();toggleRadarChart(\'' + pairKey + '\',\'fitting\',\'' + szSubType + '\')">';
            html += '<span style="color:#ffaa00;font-size:10px">' + (pairTotalLh > 0 ? pairTotalLh.toFixed(2) + 'h' : '\u2014') + '</span></td>';
            html += '</tr>';
            if (radarChartTarget === pairKey) {
              html += '<tr onclick="event.stopPropagation()"><td colspan="3" style="padding:8px;background:rgba(15,52,96,0.2);border-bottom:1px solid #0f3460">';
              html += renderRadarChart(pairKey, 'fitting', radarChartSubType);
              html += '</td></tr>';
            }
          }
        }
      }
    }
    // ---- Single-dimension per-size rows (elbows, endcaps, couplings, etc.) ----
    else if (isExpanded) {
      for (var si = 0; si < item.sizes.length; si++) {
        var sz = item.sizes[si];
        var sizeKey = activeKey + '-' + sz;
        var szMc = getMaterialForGauge(sizeKey, gauge || '26');
        var szGaugeKey = gauge ? sizeKey + '-g' + gauge : sizeKey;
        var szEntry = priceBookCache ? priceBookCache[sizeKey] : null;
        var szLhEntry2 = priceBookCache ? priceBookCache[lhCatKey(sizeKey)] : null;
        var szLh = szLhEntry2 ? szLhEntry2.laborHrs : (szEntry ? szEntry.laborHrs : null);
        html += '<tr style="border-bottom:1px solid rgba(15,52,96,0.15);background:rgba(15,52,96,0.15)">';
        html += '<td onclick="togglePBItemExpand(\'' + activeKey + '\')" style="padding:3px 4px 3px 20px;color:#00c8ff;font-size:12px;cursor:pointer" onmouseover="this.style.color=\'#4dd9ff\'" onmouseout="this.style.color=\'#00c8ff\'">' + sz + '\u2033</td>';
        // Radar chart row for this size
        if (radarChartTarget === sizeKey) {
          html += '<tr onclick="event.stopPropagation()"><td colspan="3" style="padding:8px;background:rgba(15,52,96,0.2);border-bottom:1px solid #0f3460">';
          html += renderRadarChart(sizeKey, 'fitting', radarChartSubType);
          html += '</td></tr>';
        }
        html += '<td style="padding:3px 2px">' + pbInput(szGaugeKey, 'materialCost', szMc) + '</td>';
        var szTotLh = getTotalLaborHrs(sizeKey);
        var szSub = (pbRoundType[sectionId] === 'snaplock') ? 'snaplock' : 'spiral';
        html += '<td style="padding:3px 2px;text-align:center;cursor:pointer" onclick="event.stopPropagation();toggleRadarChart(\'' + sizeKey + '\',\'fitting\',\'' + szSub + '\')">';
        html += '<span style="color:#ffaa00;font-size:11px">' + (szTotLh > 0 ? szTotLh.toFixed(2) + 'h' : '\u2014') + '</span>';
        html += ' <span style="color:#555;font-size:9px">\u25BC</span></td>';
        html += '</tr>';
      }
    }
    return html;
  }
  
  function pbRowEditable(item, sectionId) {
    // Resolve active key (flex Black/Silver toggle)
    var activeKey = item.key;
    if (item.altKey && pbFlexColor[sectionId] === 'silver') activeKey = item.altKey;
    var entry = priceBookCache ? priceBookCache[activeKey] : null;
    var mc = entry ? entry.materialCost : null;
    // Fallback to SNAPLOCK_DEFAULTS for flex items
    if (mc == null && typeof SNAPLOCK_DEFAULTS !== 'undefined' && SNAPLOCK_DEFAULTS[activeKey] && SNAPLOCK_DEFAULTS[activeKey]['26'] != null) {
      mc = SNAPLOCK_DEFAULTS[activeKey]['26'];
    }
    var lhEntry = priceBookCache ? priceBookCache[lhCatKey(activeKey)] : null;
    var lh = lhEntry ? lhEntry.laborHrs : (entry ? entry.laborHrs : null);
    var hasShopAdder = sectionId === 'rect-acc';
    var html = '<tr style="border-bottom:1px solid rgba(15,52,96,0.3)">';
    var isFlex = sectionId === 'round-flex';
    // Liner items get a radio button for selection
    if (item.isLiner) {
      var isActive = pbActiveLiner === activeKey;
      var radioBg = isActive ? 'background:#ff6b6b;border-color:#ff6b6b' : 'background:#1a1a2e;border-color:#0f3460';
      html += '<td style="padding:4px;color:#e0e0e0;font-size:11px">';
      html += '<span onclick="event.stopPropagation();setActiveLiner(\'' + activeKey + '\')" style="display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid;cursor:pointer;vertical-align:middle;margin-right:6px;' + radioBg + '" title="Set as active liner"></span>';
      html += item.label + '</td>';
    } else {
      html += '<td style="padding:4px;color:#e0e0e0;font-size:11px">' + item.label + '</td>';
    }
    if (isFlex) {
      // Display as $/Roll (×25), save as $/ft (÷25)
      var rollPrice = mc != null ? (mc * 25).toFixed(2) : '';
      html += '<td style="padding:4px 2px"><input type="text" value="' + rollPrice + '" placeholder="\u2014" style="width:60px;background:#1a1a2e;border:1px solid #0f3460;color:#00ff88;padding:3px 5px;border-radius:3px;font-size:11px;text-align:right" onchange="updatePBEntry(\'' + activeKey + '\',\'materialCost\',parseFloat(this.value)/25)"></td>';
    } else {
      html += '<td style="padding:4px 2px">' + pbInput(activeKey, 'materialCost', mc) + '</td>';
    }
    if (hasShopAdder) {
      var shopKey = activeKey + '-shop';
      var shopSaved = priceBookCache ? priceBookCache[shopKey] : null;
      var shopAdder = shopSaved ? shopSaved.materialCost : null;
      html += '<td style="padding:4px 2px"><input type="text" value="' + (shopAdder != null ? shopAdder : '') + '" placeholder="\u2014" style="width:50px;background:#1a1a2e;border:1px solid #0f3460;color:#ffaa00;padding:3px 4px;border-radius:3px;font-size:11px;text-align:right" onchange="updatePBEntry(\'' + shopKey + '\',\'materialCost\',this.value)"></td>';
    }
    // Labor: total hours + radar trigger
    var totalLh = getTotalLaborHrs(activeKey);
    html += '<td style="padding:4px 2px;text-align:center;cursor:pointer" onclick="toggleRadarChart(\'' + activeKey + '\',\'' + (hasShopAdder ? 'accessory' : 'duct') + '\')" title="Click to edit labor breakdown">';
    html += '<span style="color:#ffaa00;font-size:11px">' + (totalLh > 0 ? totalLh.toFixed(2) + 'h' : '\u2014') + '</span>';
    html += ' <span style="color:#555;font-size:9px">\u25BC</span>';
    html += '</td>';
    html += '</tr>';
    // Radar chart row
    if (radarChartTarget === activeKey) {
      var colSpan = hasShopAdder ? 4 : 3;
      html += '<tr onclick="event.stopPropagation()"><td colspan="' + colSpan + '" style="padding:8px;background:rgba(15,52,96,0.2);border-bottom:1px solid #0f3460">';
      html += renderRadarChart(activeKey, hasShopAdder ? 'accessory' : 'duct');
      html += '</td></tr>';
    }
    return html;
  }
  
  function pbColumnHeader(hasMaterialInput, sectionId) {
    var matLabel;
    if (sectionId && sectionId.indexOf('-acc') !== -1) {
      matLabel = 'Rate';
    } else if (sectionId && (sectionId.indexOf('-fit') !== -1)) {
      matLabel = '$/Ea';
    } else if (sectionId && sectionId === 'round-flex') {
      matLabel = '$/Roll';
    } else if (sectionId && (sectionId.indexOf('-duct') !== -1)) {
      matLabel = '$/Ft';
    } else {
      matLabel = hasMaterialInput ? 'Material $' : '$/Ft';
    }
    // Sections with shop adder get 4 columns
    if (sectionId === 'rect-fit' || sectionId === 'rect-acc') {
      return '<tr style="color:#a0a0c0;font-size:10px;text-transform:uppercase;letter-spacing:0.3px"><th style="padding:4px;text-align:left">Item</th><th style="padding:4px;text-align:center;width:55px">' + matLabel + '</th><th style="padding:4px;text-align:center;width:55px">Shop +$</th><th style="padding:4px;text-align:center;width:55px">Labor Hrs</th></tr>';
    }
    return '<tr style="color:#a0a0c0;font-size:10px;text-transform:uppercase;letter-spacing:0.3px"><th style="padding:4px;text-align:left">Item</th><th style="padding:4px;text-align:center;width:70px">' + matLabel + '</th><th style="padding:4px;text-align:center;width:70px">Labor Hrs</th></tr>';
  }
  
  function getHangerPriceBookItems(family) {
    const types = (HANGER_DEFAULTS && HANGER_DEFAULTS.types) || {};
    return Object.keys(types)
      .filter(function(key) {
        const fam = types[key].family || '';
        return family ? fam === family : fam !== 'hardware';
      })
      .map(function(key) {
        return { key: key, label: types[key].label || key };
      });
  }
  
  function getHangerPriceBookMaterialRate(key) {
    var entry = priceBookCache ? priceBookCache[key] : null;
    if (entry && entry.materialCost != null) return parseFloat(entry.materialCost) || 0;
    var def = HANGER_DEFAULTS.pricing && HANGER_DEFAULTS.pricing[key];
    if (!def) return 0;
    if (def.materialUnit === 'LF' && def.materialCostPerLf != null) return parseFloat(def.materialCostPerLf) || 0;
    return def.materialCost != null ? (parseFloat(def.materialCost) || 0) : 0;
  }
  
  function getHangerPriceBookMaterialUnit(key) {
    var def = HANGER_DEFAULTS.pricing && HANGER_DEFAULTS.pricing[key];
    return def && def.materialUnit ? def.materialUnit : 'EA';
  }
  
  function getSpiralWireAssemblyPreview() {
    var defaults = (HANGER_DEFAULTS.takeoffDefaults && HANGER_DEFAULTS.takeoffDefaults.spiralWire) || {};
    var dropFt = defaults.defaultDropFt != null ? parseFloat(defaults.defaultDropFt) : 2;
    var wireEach = calculateSpiralWireLengthEach('hanger-spiral-wire', dropFt);
    var assembly = HANGER_DEFAULTS.assemblies && HANGER_DEFAULTS.assemblies['hanger-spiral-wire'];
    var parts = [];
    var total = 0;
    if (!Array.isArray(assembly)) return { dropFt, wireEach, total, parts };
    for (var i = 0; i < assembly.length; i++) {
      var component = assembly[i];
      var componentKey = component.componentKey;
      if (!componentKey) continue;
      var qtyEach = component.quantity === 'wireLengthEach' ? wireEach : (parseFloat(component.quantity) || 0);
      var unit = getHangerPriceBookMaterialUnit(componentKey);
      var rate = getHangerPriceBookMaterialRate(componentKey);
      var amount = qtyEach * rate;
      total += amount;
      parts.push({
        key: componentKey,
        label: getHangerLabel(componentKey),
        qtyEach,
        unit,
        rate,
        amount
      });
    }
    return { dropFt, wireEach, total, parts };
  }
  
  function renderSpiralWireAssemblyBreakdown() {
    var preview = getSpiralWireAssemblyPreview();
    var html = '<tr style="background:rgba(15,52,96,0.18);border-bottom:1px solid rgba(15,52,96,0.35)">';
    html += '<td colspan="3" style="padding:7px 8px;color:#a0a0c0;font-size:10px;line-height:1.5">';
    html += '<div><span style="color:#e0e0e0;font-weight:600">Assembly pricing:</span> derived from components at default ' + preview.dropFt + ' ft wire drop.</div>';
    html += '<div><span style="color:#ffaa00">Wire length:</span> ' + preview.wireEach.toFixed(2) + ' LF each';
    html += ' <span style="color:#666">including upper/lower allowances and waste</span></div>';
    for (var i = 0; i < preview.parts.length; i++) {
      var p = preview.parts[i];
      html += '<div style="display:flex;justify-content:space-between;gap:10px">';
      html += '<span>' + escapeHtml(p.label) + '</span>';
      html += '<span style="color:#00ff88">' + p.qtyEach.toFixed(p.unit === 'LF' ? 2 : 0) + ' ' + p.unit + ' × $' + p.rate.toFixed(2) + ' = $' + p.amount.toFixed(2) + '</span>';
      html += '</div>';
    }
    html += '<div style="margin-top:3px;border-top:1px solid #0f3460;padding-top:3px;display:flex;justify-content:space-between">';
    html += '<span style="color:#e0e0e0">Derived material per hanger</span><span style="color:#00ff88;font-weight:700">$' + preview.total.toFixed(2) + ' / EA</span>';
    html += '</div>';
    html += '<div style="color:#666;margin-top:3px">Edit the wire rope and upper/lower/gripper component rows in Hanger Hardware to change this assembly price.</div>';
    html += '</td></tr>';
    return html;
  }
  
  function renderHangerPriceBookSection(sec) {
    var html = pbColumnHeader(true, sec.id);
    var items = getHangerPriceBookItems(sec.family);
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var key = item.key;
      var entry = priceBookCache ? priceBookCache[key] : null;
      var def = HANGER_DEFAULTS.pricing && HANGER_DEFAULTS.pricing[key];
      var unit = def && def.materialUnit ? def.materialUnit : 'EA';
      var mc = entry && entry.materialCost != null ? entry.materialCost : (def ? (unit === 'LF' ? def.materialCostPerLf : def.materialCost) : null);
      var totalLh = getTotalLaborHrs(key);
      var isSpiralWireAssembly = key === 'hanger-spiral-wire';
      var assemblyPreview = isSpiralWireAssembly ? getSpiralWireAssemblyPreview() : null;
      var isAssemblyExpanded = isSpiralWireAssembly && !!pbExpandedAssemblies[key];
      html += '<tr style="border-bottom:1px solid rgba(15,52,96,0.3)">';
      html += '<td style="padding:4px;color:#e0e0e0;font-size:11px">';
      if (isSpiralWireAssembly) {
        html += '<button onclick="event.stopPropagation();togglePBAssembly(\'' + key + '\')" title="Show/hide assembly pricing" style="background:transparent;border:none;color:#a0a0c0;cursor:pointer;font-size:10px;padding:0 4px 0 0">' + (isAssemblyExpanded ? '\u25BC' : '\u25B6') + '</button>';
      }
      html += item.label + ' <span style="color:#666;font-size:9px">$/'+ unit + '</span></td>';
      if (isSpiralWireAssembly) {
        html += '<td style="padding:4px 2px;text-align:center"><span style="color:#00ff88;font-size:11px" title="Derived from wire and attachment components">$' + assemblyPreview.total.toFixed(2) + '/EA</span></td>';
      } else {
        html += '<td style="padding:4px 2px">' + pbInput(key, 'materialCost', mc) + '</td>';
      }
      html += '<td style="padding:4px 2px;text-align:center;cursor:pointer" onclick="toggleRadarChart(\'' + key + '\',\'accessory\',\'\')" title="Click to edit labor breakdown">';
      html += '<span style="color:#ffaa00;font-size:11px">' + (totalLh > 0 ? totalLh.toFixed(2) + 'h' : '\u2014') + '</span>';
      html += ' <span style="color:#555;font-size:9px">\u25BC</span></td>';
      html += '</tr>';
      if (isSpiralWireAssembly && isAssemblyExpanded) {
        html += renderSpiralWireAssemblyBreakdown();
      }
      if (radarChartTarget === key) {
        html += '<tr onclick="event.stopPropagation()"><td colspan="3" style="padding:8px;background:rgba(15,52,96,0.2);border-bottom:1px solid #0f3460">';
        html += renderRadarChart(key, 'accessory', '');
        html += '</td></tr>';
      }
    }
    if (items.length === 0) {
      html += '<tr><td colspan="3" style="padding:10px;color:#666;font-size:11px">No hanger defaults loaded.</td></tr>';
    }
    return html;
  }
  
  function shopSettingInput(settingKey, value, label, unit, color) {
    color = color || '#e0e0e0';
    return '<tr style="border-bottom:1px solid rgba(15,52,96,0.3)">'
      + '<td style="padding:5px 4px;color:#e0e0e0;font-size:11px">' + label + '</td>'
      + '<td colspan="2" style="padding:5px 2px;text-align:right">'
      + '<input type="text" value="' + (value != null ? value : '') + '" placeholder="0.00" '
      + 'style="width:70px;background:#1a1a2e;border:1px solid #0f3460;color:' + color + ';padding:3px 5px;border-radius:3px;font-size:11px;text-align:right" '
      + 'onchange="updateShopSetting(\'' + settingKey + '\',this.value)"> '
      + '<span style="color:#666;font-size:10px">' + unit + '</span>'
      + '</td></tr>';
  }
  
  function renderShopSettingsSection() {
    var s = getShopSettings();
    var html = '';
    html += '<tr style="color:#a0a0c0;font-size:10px;text-transform:uppercase;letter-spacing:0.3px"><th style="padding:4px;text-align:left">Setting</th><th colspan="2" style="padding:4px;text-align:right">Value</th></tr>';
    html += shopSettingInput('sheetMetalPricePerLb', s.sheetMetalPricePerLb || '', 'Sheet Metal Price', '$/lb', '#00ff88');
    html += shopSettingInput('wrapInsulationPerSF', s.wrapInsulationPerSF || '', 'Wrap Insulation', '$/SF', '#ffa94d');
    // Live preview
    html += '<tr style="border-bottom:1px solid rgba(15,52,96,0.3);background:rgba(15,52,96,0.1)"><td colspan="3" style="padding:6px 4px;font-size:10px;color:#a0a0c0">';
    var preview = calcRectDuctRawPerLF(72, '26');
    html += '<span style="color:#666">72\u2033 perim @ 26ga =</span> ';
    html += preview.weightPerLF.toFixed(3) + ' lbs/LF';
    if (preview.rawMaterialPerLF > 0) {
      html += ' \u2192 <span style="color:#00ff88">$' + preview.rawMaterialPerLF.toFixed(2) + ' raw/LF</span>';
    }
    html += '</td></tr>';
    // SMACNA gauge weight reference
    html += '<tr style="background:rgba(15,52,96,0.1)"><td colspan="3" style="padding:4px;font-size:9px;color:#666">';
    html += 'SMACNA lbs/SF: 26ga=1.031 | 24ga=1.406 | 22ga=1.781 | 20ga=2.156 | 18ga=2.781';
    html += '</td></tr>';
    return html;
  }
  
  // Perimeter classes aligned to vendor weight table data points
  // RECT_PERIM_CLASSES — imported from price-defaults.js
  
  function renderRectDuctCalcSection(sec, gauge) {
    var html = '';
    html += '<tr style="color:#a0a0c0;font-size:10px;text-transform:uppercase;letter-spacing:0.3px"><th style="padding:4px;text-align:left">Perimeter Class</th><th style="padding:4px;text-align:center;width:55px">Raw $/LF</th><th style="padding:4px;text-align:center;width:55px">Shop +$/LF</th><th style="padding:4px;text-align:center;width:55px">Labor Hrs/LF</th></tr>';
    for (var i = 0; i < RECT_PERIM_CLASSES.length; i++) {
      var pc = RECT_PERIM_CLASSES[i];
      var calc = calcRectDuctRawPerLF(pc.refPerim, gauge);
      // Liner adder per LF when toggle is active
      var linerAdder = 0;
      if (pbLinerActive) {
        var linerSF = getActiveLinerPricePerSF();
        linerAdder = (pc.refPerim / 12) * linerSF;
      }
      var classKey = 'duct-rect-p' + pc.maxPerim;
      var gKey = classKey + '-g' + gauge;
      // Raw material: auto-calc (read-only display) or user-override
      var saved = priceBookCache ? priceBookCache[gKey] : null;
      var baseRaw = (saved && saved.materialCost != null) ? saved.materialCost : (calc.rawMaterialPerLF > 0 ? calc.rawMaterialPerLF : null);
      var rawMc = baseRaw != null ? baseRaw + linerAdder : (linerAdder > 0 ? linerAdder : null);
      var isAutoCalc = !(saved && saved.materialCost != null) && calc.rawMaterialPerLF > 0;
      // Shop adder: per perimeter class, editable
      var shopKey = classKey + '-shop';
      var shopSaved = priceBookCache ? priceBookCache[shopKey] : null;
      var shopAdder = (shopSaved && shopSaved.materialCost != null) ? shopSaved.materialCost : null;
      // Fallback to RECT_DUCT_SHOP_DEFAULTS if no user override
      var shopIsDefault = false;
      if (shopAdder == null && RECT_DUCT_SHOP_DEFAULTS[pc.maxPerim] != null) {
        shopAdder = RECT_DUCT_SHOP_DEFAULTS[pc.maxPerim];
        shopIsDefault = true;
      }
      // Labor hrs: total across all categories
      var totalDuctLh = getTotalLaborHrs(classKey);
      html += '<tr style="border-bottom:1px solid rgba(15,52,96,0.3)">';
      html += '<td style="padding:4px;color:#e0e0e0;font-size:11px">' + pc.label + ' <span style="color:#555;font-size:9px">' + calc.weightPerLF.toFixed(1) + ' lbs/LF</span></td>';
      // Raw material column
      html += '<td style="padding:4px 2px">';
      if (isAutoCalc) {
        html += '<input type="text" value="' + rawMc.toFixed(2) + '" placeholder="\u2014" '
          + 'style="width:50px;background:#1a1a2e;border:1px solid #0f3460;color:#009966;padding:3px 4px;border-radius:3px;font-size:11px;text-align:right;font-style:italic" '
          + 'onchange="updatePBEntry(\'' + gKey + '\',\'materialCost\',this.value)" title="Auto-calc from $/lb \u2014 edit to override">';
      } else {
        html += '<input type="text" value="' + (rawMc != null ? rawMc.toFixed(2) : '') + '" placeholder="\u2014" '
          + 'style="width:50px;background:#1a1a2e;border:1px solid #0f3460;color:#00ff88;padding:3px 4px;border-radius:3px;font-size:11px;text-align:right" '
          + 'onchange="updatePBEntry(\'' + gKey + '\',\'materialCost\',this.value)">';
      }
      html += '</td>';
      // Shop adder column (italic if default, solid if user-overridden)
      html += '<td style="padding:4px 2px">';
      var shopColor = shopIsDefault ? '#cc8800' : '#ffaa00';
      var shopItalic = shopIsDefault ? 'font-style:italic' : '';
      html += '<input type="text" value="' + (shopAdder != null ? shopAdder.toFixed(2) : '') + '" placeholder="\u2014" '
        + 'style="width:50px;background:#1a1a2e;border:1px solid #0f3460;color:' + shopColor + ';padding:3px 4px;border-radius:3px;font-size:11px;text-align:right;' + shopItalic + '" '
        + 'onchange="updatePBEntry(\'' + shopKey + '\',\'materialCost\',this.value)" title="' + (shopIsDefault ? 'Default from pricing log \u2014 edit to override' : 'User override') + '">';
      html += '</td>';
      // Labor hrs
      html += '<td style="padding:4px 2px;text-align:center;cursor:pointer" onclick="toggleRadarChart(\'' + classKey + '\',\'duct\',\'\')" title="Click to edit labor breakdown">';
      html += '<span style="color:#ffaa00;font-size:11px">' + (totalDuctLh > 0 ? totalDuctLh.toFixed(2) + 'h' : '\u2014') + '</span>';
      html += ' <span style="color:#555;font-size:9px">\u25BC</span>';
      html += '</td>';
      html += '</tr>';
      // Radar chart row
      if (radarChartTarget === classKey) {
        html += '<tr onclick="event.stopPropagation()"><td colspan="4" style="padding:8px;background:rgba(15,52,96,0.2);border-bottom:1px solid #0f3460">';
        html += renderRadarChart(classKey, 'duct', radarChartSubType);
        html += '</td></tr>';
      }
    }
    return html;
  }
  
  window.setLaborCat = function(catKey) {
    activeLaborCat = catKey;
    renderPriceBook();
    pbSaveLayout();
  };
  
  window.setActiveLiner = function(key) {
    // Radio behavior: clicking active liner deselects it
    pbActiveLiner = (pbActiveLiner === key) ? null : key;
    // Auto-enable liner toggle when a liner is selected
    if (pbActiveLiner) pbLinerActive = true;
    renderPriceBook();
    pbSaveLayout();
  };
  
  window.togglePBLiner = function() {
    pbLinerActive = !pbLinerActive;
    if (pbLinerActive && !pbActiveLiner) {
      // Default to 1" liner if none selected
      pbActiveLiner = LINER_OPTIONS[0].key;
    }
    renderPriceBook();
    pbSaveLayout();
  };
  
  window.updateShopSetting = async function(key, value) {
    var existing = (priceBookCache && priceBookCache['shop-settings']) || { key: 'shop-settings' };
    existing[key] = value === '' ? null : parseFloat(value) || null;
    await savePriceBookEntry('shop-settings', existing);
    renderPriceBook(); // re-render to update auto-calc previews
  };
  
  
  
  function renderPriceBook() {
    var el = document.getElementById('priceBookContent');
    var tabs = Object.keys(PRICE_BOOK_TABS);
    var html = '<div style="display:flex;gap:4px;margin-bottom:12px">';
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      var active = t === activePBTab;
      var style = active
        ? 'background:rgba(233,69,96,0.15);border-color:#e94560;color:#e94560'
        : 'background:#1a1a2e;border-color:#0f3460;color:#a0a0c0';
      html += '<button onclick="setPBTab(\'' + t + '\')" style="flex:1;padding:6px 4px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;border:1px solid;' + style + '">' + PRICE_BOOK_TABS[t].label + '</button>';
    }
    html += '</div>';
  
    var tab = PRICE_BOOK_TABS[activePBTab];
    html += '<table style="width:100%;border-collapse:collapse">';
    for (var si = 0; si < tab.sections.length; si++) {
      var sec = tab.sections[si];
      var collapsed = !!pbCollapsed[sec.id];
      var arrow = collapsed ? '\u25b6' : '\u25bc';
      var count = sec.isHangerCatalog ? getHangerPriceBookItems(sec.family).length : sec.items.length;
      var gauges = getGaugesForSection(sec.id);
  
      // Section header row
      html += '<tr>';
      html += '<td colspan="3" style="padding:10px 4px 4px;font-size:11px;font-weight:700;color:#e94560;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e94560;cursor:pointer" onclick="togglePBSection(\'' + sec.id + '\')">';
      html += arrow + '  ' + sec.title + ' <span style="font-weight:400;color:#a0a0c0;font-size:10px;text-transform:none">(' + count + ')</span>';
      // Right-side controls: toggle type + gauge selector
      html += '<span style="float:right;font-weight:400;text-transform:none;display:flex;align-items:center;gap:6px">';
      // Flex Black/Silver toggle
      if (sec.flexToggle && !collapsed) {
        var flexColor = pbFlexColor[sec.id] || 'black';
        var isBlack = flexColor === 'black';
        html += '<button onclick="event.stopPropagation();togglePBFlexColor(\'' + sec.id + '\')" style="padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;font-weight:600;border:1px solid;white-space:nowrap;' + (isBlack ? 'background:rgba(60,60,60,0.4);color:#ccc;border-color:#888' : 'background:rgba(200,200,200,0.2);color:#e0e0e0;border-color:#bbb') + '">' + (isBlack ? '\u25cf Black' : '\u25cb Silver') + '</button>';
      }
      // Spiral/Snap Lock toggle (only for toggleType sections)
      if (sec.toggleType && !collapsed) {
        var roundType = pbRoundType[sec.id] || 'spiral';
        var spiralActive = roundType === 'spiral';
        var spiralStyle = spiralActive
          ? 'background:rgba(0,200,255,0.15);color:#00c8ff;border-color:#00c8ff'
          : 'background:#1a1a2e;color:#555;border-color:#0f3460';
        var snapStyle = !spiralActive
          ? 'background:rgba(0,255,136,0.15);color:#00ff88;border-color:#00ff88'
          : 'background:#1a1a2e;color:#555;border-color:#0f3460';
        html += '<button onclick="event.stopPropagation();togglePBRoundType(\'' + sec.id + '\')" style="padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;font-weight:600;border:1px solid;white-space:nowrap;' + (spiralActive ? spiralStyle : snapStyle) + '">';
        if (spiralActive) {
          html += '\u25CE Spiral';
        } else {
          html += '\u25CB Snap Lock';
        }
        html += '</button>';
      }
      // Gauge selector inline with header
      if (gauges && !collapsed) {
        var activeG = pbGauge[sec.id] || '26';
        for (var gi = 0; gi < gauges.length; gi++) {
          var g = gauges[gi];
          var gStyle = g === activeG
            ? 'background:#e94560;color:#fff;border-color:#e94560'
            : 'background:#1a1a2e;color:#a0a0c0;border-color:#0f3460';
          html += '<button onclick="event.stopPropagation();setPBGauge(\'' + sec.id + '\',\'' + g + '\')" style="padding:2px 6px;border-radius:3px;cursor:pointer;font-size:10px;font-weight:600;border:1px solid;margin-left:3px;' + gStyle + '">' + g + 'ga</button>';
        }
      }
      // LINER toggle button for rect-fit and rect-duct sections
      if (sec.id === 'rect-fit' || sec.id === 'rect-duct') {
        var lnStyle = pbLinerActive
          ? 'background:#ff6b6b;color:#fff;border-color:#ff6b6b'
          : 'background:#1a1a2e;color:#666;border-color:#0f3460';
        var lnLabel = pbLinerActive && pbActiveLiner
          ? (LINER_OPTIONS.find(function(o){return o.key===pbActiveLiner})||{}).label || 'LINER'
          : 'LINER';
        html += ' <button onclick="event.stopPropagation();togglePBLiner()" style="padding:2px 6px;border-radius:3px;cursor:pointer;font-size:9px;font-weight:600;border:1px solid;margin-left:6px;' + lnStyle + '" title="Toggle liner adder in prices">' + lnLabel + '</button>';
      }
      html += '</span>';
      html += '</td></tr>';
  
  
      if (!collapsed) {
        // Special rendering for Shop Settings section
        if (sec.isShopSettings) {
          html += renderShopSettingsSection();
        }
        // Special rendering for Rect Duct Auto-Calc section
        else if (sec.isRectDuctCalc) {
          html += renderRectDuctCalcSection(sec, pbGauge[sec.id] || '26');
        }
        else if (sec.isHangerCatalog) {
          html += renderHangerPriceBookSection(sec);
        }
        else {
          var hasGauge = !!sec.hasGauge;
          html += pbColumnHeader(!hasGauge, sec.id);
          for (var j = 0; j < sec.items.length; j++) {
            if (hasGauge) {
              html += pbRow(sec.items[j], sec.id);
            } else {
              html += pbRowEditable(sec.items[j], sec.id);
            }
          }
        }
      }
    }
    html += '</table>';
  
    el.innerHTML = html;
  }
  
  window.updatePBEntry = async function(key, prop, value) {
    var existing = (priceBookCache && priceBookCache[key]) || { key: key };
    existing[prop] = value === '' ? null : parseFloat(value) || null;
    await savePriceBookEntry(key, existing);
    renderPriceBook();
    if (shouldRefreshCompiler()) refreshCompiler();
  };
  


  return {
    loadPriceBook,
    getPriceBookEntry,
    savePriceBookEntry,
    getMaterialForGauge,
    getTotalLaborHrs,
    getShopSettings,
    getActiveLinerPricePerSF,
    calcRectDuctRawPerLF,
    calcRectFittingRawCost,
    lhCatKey,
    pbInitDrag,
    renderPriceBook,
    getCache: function() { return priceBookCache; }
  };
}
