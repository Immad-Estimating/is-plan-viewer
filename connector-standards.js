import {
  CONNECTOR_DEFAULTS,
  getConnectorSeedDefaultsSnapshot,
  getConnectorDefaultsSnapshot,
  replaceConnectorDefaultsSection,
  saveConnectorDefaultsOverride,
} from './price-defaults.js';
import { calculateConnectorApplicationBreakdown } from './connector-rules.js';

export function installConnectorStandards(ctx = {}) {
  const {
    refreshCompiler = function() {},
    getCompilerState = function() { return {}; },
    showToast = function() {},
    escapeHtml = function(str) {
      return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]);
    },
  } = ctx;

  let _csDrag = null;
  let _csResize = null;
  let activeStandardKey = null;
  let activePreviewType = 'rect';
  const applicationPreviewLengthFt = {
    rect: 8,
    spiral: 3.14,
    round: 3.14,
    oval: 5,
    flex: 3.14,
  };
  const collapsedPanes = {
    model: false,
    rules: false,
    products: false,
    joints: true,
  };

  const PRODUCT_COLORS = {
    'water-based-duct-mastic': '#f8f9fa',
    'foil-scrim-kraft-tape': '#b197fc',
    'butyl-gasket-tape': '#4dabf7',
    'rect-s-cleat-slip': '#c74343',
    'rect-drive-cleat': '#1f6b4a',
    'sheet-metal-screws': '#b08d35',
  };

  const PREVIEW_TYPES = [
    { id: 'rect', label: 'Rectangular', subtitle: 'Insulated rectangular duct' },
    { id: 'spiral', label: 'Spiral', subtitle: 'Round spiral joint' },
    { id: 'round', label: 'Snaplock', subtitle: 'Round duct joint' },
    { id: 'oval', label: 'Oval', subtitle: 'Flat oval duct' },
    { id: 'flex', label: 'Flex', subtitle: 'Flexible duct' },
  ];
  const RECT_S_DRIVE_REFERENCE_IMAGE = './assets/connector-standards-s-drive.png';
  const SPIRAL_REFERENCE_IMAGE = './assets/connector-standards-spiral.png';
  const SNAPLOCK_REFERENCE_IMAGE = './assets/connector-standards-snaplock.png';
  const FLEX_REFERENCE_IMAGE = './assets/connector-standards-flex.png';

  const SHAPE_LABELS = {
    rect: 'Rectangular',
    spiral: 'Spiral',
    round: 'Snaplock/Round',
    oval: 'Flat Oval',
    flex: 'Flex',
  };

  function jsString(value) {
    return String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  function slugify(value) {
    return String(value || 'standard').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'standard';
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function getPreviewShape() {
    return activePreviewType === 'spiral' ? 'spiral' : activePreviewType === 'round' ? 'round' : activePreviewType;
  }

  function shouldRefreshCompiler() {
    const state = getCompilerState() || {};
    return state.activePanelTab === 'comp' && state.compilerInited;
  }

  function panel() { return document.getElementById('connectorStandardsPanel'); }
  function content() { return document.getElementById('connectorStandardsContent'); }

  function applyLayout(el) {
    try {
      const saved = JSON.parse(localStorage.getItem('isplan_connector_standards_layout') || 'null');
      if (saved) {
        el.style.left = saved.left;
        el.style.top = saved.top;
        el.style.width = saved.width;
        el.style.height = saved.height;
        return;
      }
    } catch (e) { /* ignore bad layout */ }
    el.style.left = Math.max(20, window.innerWidth - 760) + 'px';
    el.style.top = '88px';
    el.style.width = '720px';
    el.style.height = '620px';
  }

  function saveLayout() {
    const el = panel();
    if (!el) return;
    localStorage.setItem('isplan_connector_standards_layout', JSON.stringify({
      left: el.style.left,
      top: el.style.top,
      width: el.style.width,
      height: el.style.height,
    }));
  }

  function initDrag() {
    const el = panel();
    const title = document.getElementById('csTitleBar');
    const resize = document.getElementById('csResizeHandle');
    if (!el || !title || title._csInit) return;
    title._csInit = true;
    title.addEventListener('mousedown', e => {
      _csDrag = {
        startX: e.clientX,
        startY: e.clientY,
        origLeft: parseInt(el.style.left || '0', 10),
        origTop: parseInt(el.style.top || '0', 10),
      };
      e.preventDefault();
    });
    resize.addEventListener('mousedown', e => {
      _csResize = { startX: e.clientX, startY: e.clientY, origW: el.offsetWidth, origH: el.offsetHeight };
      e.preventDefault();
      e.stopPropagation();
    });
    document.addEventListener('mousemove', e => {
      if (_csDrag) {
        const x = Math.max(-el.offsetWidth + 120, Math.min(window.innerWidth - 80, _csDrag.origLeft + e.clientX - _csDrag.startX));
        const y = Math.max(0, Math.min(window.innerHeight - 60, _csDrag.origTop + e.clientY - _csDrag.startY));
        el.style.left = x + 'px';
        el.style.top = y + 'px';
      }
      if (_csResize) {
        el.style.width = Math.max(560, _csResize.origW + e.clientX - _csResize.startX) + 'px';
        el.style.height = Math.max(430, _csResize.origH + e.clientY - _csResize.startY) + 'px';
      }
    });
    document.addEventListener('mouseup', () => {
      if (_csDrag || _csResize) {
        _csDrag = null;
        _csResize = null;
        saveLayout();
      }
    });
  }

  function getActiveStandard(snapshot) {
    const standards = snapshot.standards || {};
    if (!activeStandardKey || !standards[activeStandardKey]) activeStandardKey = snapshot.takeoffDefaults?.activeStandard || Object.keys(standards)[0];
    return standards[activeStandardKey] || { rules: [] };
  }

  function getProductColor(key, products = {}) {
    return (products[key] && products[key].displayColor) || PRODUCT_COLORS[key] || '#ffd43b';
  }

  function getActiveProductKeys(snapshot) {
    return Array.from(new Set((getActiveStandard(snapshot).rules || [])
      .filter(rule => rule.enabled !== false && rule.product)
      .map(rule => rule.product)));
  }

  function ruleAppliesToCurrentDuct(rule) {
    const shape = getPreviewShape();
    return !Array.isArray(rule.appliesToShapes) || rule.appliesToShapes.includes(shape);
  }

  function getRuleRangeLabel(rule) {
    const min = rule.minJointLengthFt;
    const max = rule.maxJointLengthFt;
    const measure = getPreviewShape() === 'rect' ? 'perimeter' : 'joint length';
    if (min == null && max == null) return `All ${measure}s`;
    if (min != null && max != null) return `${measure}: ${min}-${max} ft`;
    if (min != null) return `${measure}: ${min}+ ft`;
    return `${measure}: up to ${max} ft`;
  }

  function getApplicationPreviewLength() {
    const shape = getPreviewShape();
    return applicationPreviewLengthFt[shape] || 1;
  }

  function formatMoney(value, digits = 3) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? `$${n.toFixed(digits)}` : '$0.000';
  }

  function getEnabledRulesForShape(standard) {
    return (standard.rules || []).filter(rule => rule.enabled !== false && ruleAppliesToCurrentDuct(rule));
  }

  function getFilteredRules(standard) {
    return (standard.rules || []).filter(rule => ruleAppliesToCurrentDuct(rule));
  }

  function saveStandardsAndActive(standards, activeKey) {
    const keys = Object.keys(standards || {});
    const safeKey = activeKey && standards[activeKey] ? activeKey : keys[0];
    if (safeKey) activeStandardKey = safeKey;
    replaceConnectorDefaultsSection('standards', standards);
    saveConnectorDefaultsOverride({ takeoffDefaults: { activeStandard: safeKey } });
    render();
    if (shouldRefreshCompiler()) refreshCompiler();
  }

  function renderLayerLegend(activeLayers, products) {
    return activeLayers.map(key => {
      const p = products[key] || {};
      const color = getProductColor(key, products);
      return `<span class="cs-layer-chip"><span class="cs-layer-dot" style="background:${color};color:${color}"></span>${escapeHtml(p.label || key)}</span>`;
    }).join('');
  }

  function renderRectPreview(activeLayers, products) {
    return `
      <div class="cs-reference-image-view" role="img" aria-label="Imported rectangular S and drive joint reference image">
        <img src="${RECT_S_DRIVE_REFERENCE_IMAGE}" alt="Rectangular S and drive joint reference with mastic, S-cleats, drive cleats, and fasteners" loading="eager">
      </div>
    `;
    return `
      <svg class="cs-joint-svg" viewBox="0 0 1120 620" role="img" aria-label="Revit style rectangular S and drive duct joint with colored editable connector components">
        <defs>
          <linearGradient id="csRectMetal" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#eef2f5"/><stop offset="38%" stop-color="#b9c1ca"/><stop offset="100%" stop-color="#6f7a86"/>
          </linearGradient>
          <linearGradient id="csRectDark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#4c5663"/><stop offset="100%" stop-color="#17202b"/>
          </linearGradient>
          <linearGradient id="csInsul" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#fff56d"/><stop offset="100%" stop-color="#d2c92f"/>
          </linearGradient>
          <filter id="csRectShadow" x="-30%" y="-30%" width="170%" height="180%">
            <feDropShadow dx="0" dy="24" stdDeviation="18" flood-color="#000" flood-opacity="0.35"/>
          </filter>
        </defs>
        <rect x="0" y="0" width="1120" height="620" fill="#eceeef"/>
        <path d="M80 470 L910 550 L1040 462 L214 382 Z" fill="#9aa0a8" opacity="0.26"/>

        <g filter="url(#csRectShadow)" transform="translate(32 24)">
          <path d="M76 232 L360 168 L518 238 L232 310 Z" fill="url(#csRectMetal)"/>
          <path d="M232 310 L518 238 L518 398 L232 484 Z" fill="#8d98a3"/>
          <path d="M76 232 L232 310 L232 484 L76 388 Z" fill="#d6dce2"/>
          <path d="M106 258 L204 302 L204 420 L106 365 Z" fill="url(#csRectDark)"/>
          <path d="M232 310 L518 238 L518 398 L232 484 Z" fill="#a7b1bd" opacity="0.35"/>
          <path d="M501 239 L536 230 L536 398 L501 409 Z" fill="${mastic}" opacity="0.95"/>
          <path d="M486 225 L536 214 L536 232 L486 245 Z" fill="${sCleat}" opacity="0.96"/>
          <path d="M486 412 L536 397 L536 416 L486 432 Z" fill="${sCleat}" opacity="0.96"/>
          <path d="M520 247 L545 239 L545 405 L520 414 Z" fill="${drive}" opacity="0.98"/>
          ${Array.from({ length: 4 }, (_, i) => `<circle cx="527" cy="${272 + i * 32}" r="5" fill="${fastener}" stroke="#5b4718" stroke-width="1.2"/>`).join('')}
          <text x="110" y="150" fill="#1f2937" font-size="16" font-weight="800">Finished joined assembly</text>
          <line x1="280" y1="158" x2="496" y2="226" stroke="#1f2937" stroke-width="1.5"/>
        </g>

        <g filter="url(#csRectShadow)" transform="translate(475 36)">
          <path d="M96 270 L360 210 L500 275 L234 342 Z" fill="url(#csRectMetal)"/>
          <path d="M234 342 L500 275 L500 420 L234 496 Z" fill="#8d98a3"/>
          <path d="M96 270 L234 342 L234 496 L96 410 Z" fill="#d6dce2"/>
          <path d="M124 292 L204 334 L204 430 L124 383 Z" fill="url(#csRectDark)"/>
          <path d="M610 160 L814 116 L930 168 L724 220 Z" fill="#d9d0a6" opacity="0.9"/>
          <path d="M724 220 L930 168 L930 326 L724 390 Z" fill="#b8ad82" opacity="0.84"/>
          <path d="M610 160 L724 220 L724 390 L610 318 Z" fill="#e4dcc0" opacity="0.86"/>
          <path d="M603 153 L724 213 L724 224 L603 164 Z" fill="${mastic}" opacity="0.96"/>
          <path d="M724 213 L936 160 L936 174 L724 227 Z" fill="${mastic}" opacity="0.96"/>
          <path d="M724 380 L936 316 L936 330 L724 394 Z" fill="${mastic}" opacity="0.92"/>
          <rect x="510" y="210" width="86" height="18" rx="2" fill="${sCleat}" transform="rotate(-13 510 210)"/>
          <rect x="520" y="458" width="96" height="18" rx="2" fill="${sCleat}" transform="rotate(-16 520 458)"/>
          <rect x="588" y="252" width="26" height="112" rx="3" fill="${drive}" transform="rotate(-10 588 252)"/>
          <rect x="696" y="260" width="26" height="112" rx="3" fill="${drive}" transform="rotate(-10 696 260)"/>
          ${Array.from({ length: 7 }, (_, i) => `<path d="M${626 + i * 24} ${330 + (i % 2) * 18} l34 13" stroke="${fastener}" stroke-width="5" stroke-linecap="round"/><circle cx="${626 + i * 24}" cy="${330 + (i % 2) * 18}" r="4" fill="${fastener}"/>`).join('')}
        </g>

        <g font-size="15" fill="#111827" font-weight="800">
          <text x="865" y="82">MASTIC SEALANT</text>
          <text x="865" y="100">(${mastic === '#f8f9fa' ? 'WHITE' : 'COLOR MASTER'})</text>
          <text x="735" y="143">S-CLEATS (SLIP)</text>
          <text x="735" y="161">RED</text>
          <text x="704" y="234">DRIVE CLEATS</text>
          <text x="704" y="252">DARK GREEN</text>
          <text x="900" y="412">FASTENERS</text>
          <text x="900" y="430">SCREWS/RIVETS</text>
        </g>
        <g stroke="#111827" stroke-width="1.5" fill="none">
          <path d="M850 104 L843 160"/>
          <path d="M724 154 L655 206"/>
          <path d="M690 240 L604 298"/>
          <path d="M892 410 L758 364"/>
        </g>
        <text x="64" y="575" fill="#475569" font-size="16" font-weight="700">Simple rectangular S-and-drive joint: every visible connector color is mastered from editable product defaults.</text>
        <text x="64" y="598" fill="${fallback}" font-size="13" font-weight="700">Active standard layers are still reflected in the legend below the model.</text>
      </svg>
    `;
  }

  function renderRoundPreview(activeLayers, type, products) {
    if (type === 'spiral') {
      return `
        <div class="cs-reference-image-view" role="img" aria-label="Imported spiral duct joint reference image">
          <img src="${SPIRAL_REFERENCE_IMAGE}" alt="Spiral duct joint reference with internal connector, mastic, sealing tape, and fasteners" loading="eager">
        </div>
      `;
    }
    if (type === 'round') {
      return `
        <div class="cs-reference-image-view" role="img" aria-label="Imported snaplock duct joint reference image">
          <img src="${SNAPLOCK_REFERENCE_IMAGE}" alt="Snaplock duct joint reference with mastic sealant applicator and sealing tape" loading="eager">
        </div>
      `;
    }
    if (type === 'flex') {
      return `
        <div class="cs-reference-image-view" role="img" aria-label="Imported flex duct joint assembly reference image">
          <img src="${FLEX_REFERENCE_IMAGE}" alt="Flex duct joint assembly reference with spiral duct, starting collars, screws, mastic, foil jacket, duct ties, and HVAC tape" loading="eager">
        </div>
      `;
    }
    const first = getProductColor(activeLayers[0], products);
    const second = getProductColor(activeLayers[1] || activeLayers[0], products);
    const ribLines = type === 'flex' ? Array.from({ length: 18 }, (_, i) => `<ellipse cx="${180 + i * 32}" cy="270" rx="35" ry="96" fill="none" stroke="#cbd5e1" stroke-width="3" opacity="0.68"/>`).join('') : '';
    const spiralLines = type === 'spiral' ? Array.from({ length: 10 }, (_, i) => `<path d="M${176 + i * 54} 168 C${226 + i * 54} 222 ${226 + i * 54} 322 ${176 + i * 54} 374" fill="none" stroke="#f8fafc" stroke-width="2" opacity="0.36"/>`).join('') : '';
    const ovalScale = type === 'oval' ? 'scale(1 0.66) translate(0 140)' : '';
    return `
      <svg class="cs-joint-svg" viewBox="0 0 980 560" role="img" aria-label="3D ${type} duct model with colored connector applications">
        <defs>
          <linearGradient id="csRoundBody${type}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#f1f5f9"/><stop offset="45%" stop-color="#94a3b8"/><stop offset="100%" stop-color="#27364b"/>
          </linearGradient>
          <filter id="csRoundShadow${type}" x="-30%" y="-30%" width="170%" height="180%">
            <feDropShadow dx="0" dy="24" stdDeviation="18" flood-color="#000" flood-opacity="0.36"/>
          </filter>
        </defs>
        <rect width="980" height="560" fill="#e6e7e9"/>
        <path d="M124 390 C294 472 648 452 842 360 L884 402 C675 516 286 514 80 416 Z" fill="#a5abb4" opacity="0.34"/>
        <g transform="${ovalScale}" filter="url(#csRoundShadow${type})">
          <path d="M150 170 L736 98 C830 158 833 312 748 382 L158 448 C244 372 240 234 150 170Z" fill="url(#csRoundBody${type})"/>
          <ellipse cx="158" cy="309" rx="94" ry="139" fill="#334155" stroke="#dbeafe" stroke-width="4" transform="rotate(-7 158 309)"/>
          <ellipse cx="158" cy="309" rx="54" ry="82" fill="#111827" opacity="0.74" transform="rotate(-7 158 309)"/>
          <ellipse cx="748" cy="240" rx="94" ry="139" fill="#1e293b" stroke="#94a3b8" stroke-width="4" transform="rotate(-7 748 240)"/>
          <path d="M334 136 L554 110 C642 168 645 316 565 388 L342 414 C418 342 415 204 334 136Z" fill="#cbd5e1" stroke="#f8fafc" stroke-width="3"/>
          ${ribLines}${spiralLines}
          <ellipse cx="334" cy="275" rx="44" ry="126" fill="none" stroke="${first}" stroke-width="13" opacity="0.88"/>
          <ellipse cx="558" cy="249" rx="44" ry="126" fill="none" stroke="${second}" stroke-width="13" opacity="0.88"/>
        </g>
        <text x="335" y="62" fill="#343a40" font-size="18" font-weight="800">${type === 'oval' ? 'Flat oval' : type === 'flex' ? 'Flexible' : type === 'spiral' ? 'Spiral' : 'Snaplock'} duct model view</text>
        <text x="332" y="430" fill="#475569" font-size="16" font-weight="700">Joint applications stay color coded by product</text>
      </svg>
    `;
  }

  function renderPreviewScene(activeLayers, products) {
    if (activePreviewType === 'rect') return renderRectPreview(activeLayers, products);
    return renderRoundPreview(activeLayers, activePreviewType, products);
  }

  function renderPane(id, title, subtitle, bodyHtml) {
    const closed = !!collapsedPanes[id];
    return `
      <div class="cs-pane">
        <button type="button" class="cs-pane-head" onclick="toggleConnectorPane('${jsString(id)}')">
          <span><span class="cs-title">${escapeHtml(title)}</span><span class="cs-subtitle">${escapeHtml(subtitle)}</span></span>
          <span class="cs-caret">${closed ? '+' : '-'}</span>
        </button>
        ${closed ? '' : `<div class="cs-pane-body">${bodyHtml}</div>`}
      </div>
    `;
  }

  function renderJointPreview(snapshot) {
    const products = snapshot.products || {};
    const activeKeys = getActiveProductKeys(snapshot);
    const activeLayers = activeKeys.length ? activeKeys : ['water-based-duct-mastic', 'butyl-gasket-tape'];
    const legend = renderLayerLegend(activeLayers, products);
    const switcher = PREVIEW_TYPES.map(type => `
      <button type="button" class="${type.id === activePreviewType ? 'active' : ''}" onclick="setConnectorPreviewType('${jsString(type.id)}')">
        <b>${escapeHtml(type.label)}</b><span>${escapeHtml(type.subtitle)}</span>
      </button>
    `).join('');
    return `
      <div class="cs-hero">
        <button type="button" class="cs-hero-head" onclick="toggleConnectorPane('model')">
          <span><span class="cs-title">Model Preview</span><span class="cs-subtitle">Active connector products shown as colored joint layers</span></span>
          <span class="cs-caret">${collapsedPanes.model ? '+' : '-'}</span>
        </button>
        ${collapsedPanes.model ? '' : `
          <div class="cs-hero-body">
            <div class="cs-preview-switcher">${switcher}</div>
            <div class="cs-model-stage">
              ${renderPreviewScene(activeLayers, products)}
              ${['rect', 'spiral', 'round', 'flex'].includes(activePreviewType) ? '' : `<div class="cs-layer-strip">${legend}</div>`}
            </div>
            <div class="cs-preview-note">Each duct type has a separate model-style preview. Use the buttons above to swap between rectangular, spiral, snaplock, oval, and flex views while the active connector products remain color-coded.</div>
          </div>`}
      </div>
    `;
  }

  function renderStandardsManager(snapshot) {
    const standards = snapshot.standards || {};
    const standard = getActiveStandard(snapshot);
    const keys = Object.keys(standards);
    const enabled = getEnabledRulesForShape(standard);
    const standardCards = keys.map(key => {
      const std = standards[key] || {};
      const isActive = key === activeStandardKey;
      return `
        <button type="button" class="cs-standard-card ${isActive ? 'active' : ''}" onclick="setConnectorStandard('${jsString(key)}')">
          <span class="cs-radio-dot">${isActive ? '●' : '○'}</span>
          <span><b>${escapeHtml(std.label || key)}</b><small>${escapeHtml(std.description || 'No description yet')}</small></span>
        </button>
      `;
    }).join('');
    const enabledList = enabled.length ? enabled.map(rule => `<li>${escapeHtml(rule.label || rule.id)} <span>${escapeHtml(getRuleRangeLabel(rule))}</span></li>`).join('') : '<li>No active components for this duct type yet.</li>';
    return `
      <div class="cs-standard-manager">
        <div class="cs-section-kicker">Project Default Standard</div>
        <div class="cs-standards-list">${standardCards}</div>
        <div class="cs-standard-detail">
          <label>Standard Name<input value="${escapeHtml(standard.label || activeStandardKey || '')}" onchange="updateConnectorStandardMeta('label',this.value)"></label>
          <label>Description<textarea rows="3" onchange="updateConnectorStandardMeta('description',this.value)">${escapeHtml(standard.description || '')}</textarea></label>
          <div class="cs-standard-actions">
            <button onclick="saveConnectorStandardAs()">Save As Standard</button>
            <button onclick="saveConnectorStandardDefault()">Save Current As Default</button>
            <button onclick="resetConnectorStandardToDefault()">Revert This Standard</button>
            <button class="danger" onclick="deleteConnectorStandard()">Delete</button>
          </div>
        </div>
        <div class="cs-active-components">
          <b>${escapeHtml(SHAPE_LABELS[getPreviewShape()] || getPreviewShape())} components in this standard</b>
          <ul>${enabledList}</ul>
        </div>
      </div>
    `;
  }

  function renderJointDefaults(snapshot) {
    const fittings = (snapshot.jointCountDefaults && snapshot.jointCountDefaults.fittings) || {};
    const duct = (snapshot.jointCountDefaults && snapshot.jointCountDefaults.duct) || {};
    const visible = ['90el', '45el', 'tee', 'wye', 'reducer', 'endcap', 'coupling', 'spin-in', 'volume-damper', 'rectTap', 'tapIncreasedArea'];
    let html = '<div class="cs-joint-grid">';
    for (const key of visible) {
      html += `<label>${escapeHtml(key)}<input type="number" step="1" value="${fittings[key] ?? 0}" onchange="updateConnectorJointCount('${jsString(key)}',this.value)"></label>`;
    }
    html += '</div>';
    const ductRows = [
      { key: 'spiral', title: 'Spiral duct', hint: 'Standard 10 ft sections with inserted coupling interfaces', countProp: 'jointsPerCoupling', countLabel: 'Joints / coupling', fallbackLength: 10, fallbackCount: 2 },
      { key: 'round', title: 'Snaplock / round duct', hint: 'Standard 5 ft snaplock sections, no auto coupler insertion', countProp: 'jointsPerJoint', countLabel: 'Joints / section joint', fallbackLength: 5, fallbackCount: 1 },
      { key: 'rect', title: 'Rectangular duct', hint: 'Standard 4 ft shop sections with slip/drive joint accounting', countProp: 'jointsPerJoint', countLabel: 'Joints / section joint', fallbackLength: 4, fallbackCount: 1 },
      { key: 'oval', title: 'Flat oval duct', hint: 'Standard 10 ft flat-oval sections with oval perimeter joint accounting', countProp: 'jointsPerJoint', countLabel: 'Joints / section joint', fallbackLength: 10, fallbackCount: 1 },
    ];
    for (const row of ductRows) {
      const cfg = duct[row.key] || {};
      html += `<div class="cs-duct-policy"><div><b>${escapeHtml(row.title)}</b><span>${escapeHtml(row.hint)}</span></div>`;
      html += `<label>Length FT<input type="number" step="0.5" value="${cfg.standardLengthFt ?? row.fallbackLength}" onchange="updateConnectorDuctPolicy('${row.key}','standardLengthFt',this.value)"></label>`;
      html += `<label>${escapeHtml(row.countLabel)}<input type="number" step="1" value="${cfg[row.countProp] ?? row.fallbackCount}" onchange="updateConnectorDuctPolicy('${row.key}','${row.countProp}',this.value)"></label></div>`;
    }
    return renderPane('joints', 'Joint Defaults', 'Standard duct lengths and connection counts by duct type', html + '</div>');
  }

  function renderComponentLibrary(snapshot) {
    const standard = getActiveStandard(snapshot);
    const products = snapshot.products || {};
    const rules = getFilteredRules(standard);
    const sampleJointLengthFt = getApplicationPreviewLength();
    const lengthLabel = getPreviewShape() === 'rect' ? 'Sample perimeter LF' : 'Sample joint LF';
    const cards = rules.length ? rules.map(rule => {
      const product = products[rule.product] || {};
      const color = getProductColor(rule.product, products);
      const checked = rule.enabled !== false;
      const math = calculateConnectorApplicationBreakdown(rule, product, sampleJointLengthFt, 1);
      const qtyPerLf = `${math.qtyPerJointFt.toFixed(4)} ${math.materialUnit || ''}/LF`.trim();
      const qtyPerJoint = `${math.qtyPerJoint.toFixed(4)} ${math.materialUnit || ''}`.trim();
      const sourceUnit = product.applicationUnit === 'EA'
        ? `1 ${math.materialUnit || 'EA'} every ${rule.spacingFt || 1} LF`
        : `${product.coveragePerUnit || 0} LF per ${product.materialUnit || 'unit'}`;
      return `
        <div class="cs-rule-card ${checked ? 'active-product' : ''}" style="--cs-accent:${color};border-color:${checked ? color : 'rgba(116,192,252,0.12)'}">
          <div class="cs-rule-top">
            <label class="cs-rule-check">
              <input type="checkbox" ${checked ? 'checked' : ''} onchange="updateConnectorRule('${jsString(activeStandardKey)}','${jsString(rule.id)}','enabled',this.checked)">
              <span class="cs-radio-dot">${checked ? '●' : '○'}</span>
              ${escapeHtml(rule.label || rule.id)}
            </label>
            <span class="cs-color-swatch" style="--cs-accent:${color}"></span>
          </div>
          <div class="cs-muted">${escapeHtml(product.label || rule.product || 'No product selected')} · ${escapeHtml(product.family || '')}</div>
          <div class="cs-rule-meta">
            <span class="cs-pill">${escapeHtml((rule.appliesToJointTypes || []).join(', ') || 'all joints')}</span>
            <span class="cs-pill">${escapeHtml(rule.jointLengthFormula || 'perimeterFt')}</span>
            <span class="cs-pill">${escapeHtml(getRuleRangeLabel(rule))}</span>
          </div>
          <div class="cs-application-math">
            <div><b>Standardized unit</b><span>${escapeHtml(sourceUnit)} · waste ${math.wasteFactor}</span></div>
            <div><b>Per LF applied</b><span>${escapeHtml(qtyPerLf)} · ${formatMoney(math.costPerJointFt)}/LF</span></div>
            <div><b>Sample joint</b><span>${sampleJointLengthFt.toFixed(2)} LF uses ${escapeHtml(qtyPerJoint)} · ${formatMoney(math.costPerJoint)}</span></div>
          </div>
          <div class="cs-product-fields">
            <label>Cost / ${escapeHtml(product.materialUnit || 'unit')}<input type="number" step="0.01" value="${product.materialCost ?? ''}" onchange="updateConnectorProduct('${jsString(rule.product)}','materialCost',this.value)"></label>
            <label>Master Color<input type="color" value="${color}" onchange="updateConnectorProduct('${jsString(rule.product)}','displayColor',this.value)"></label>
            <label>Min ${getPreviewShape() === 'rect' ? 'Perimeter' : 'Joint'} FT<input type="number" step="0.1" value="${rule.minJointLengthFt ?? ''}" onchange="updateConnectorRule('${jsString(activeStandardKey)}','${jsString(rule.id)}','minJointLengthFt',this.value)"></label>
            <label>Max ${getPreviewShape() === 'rect' ? 'Perimeter' : 'Joint'} FT<input type="number" step="0.1" value="${rule.maxJointLengthFt ?? ''}" onchange="updateConnectorRule('${jsString(activeStandardKey)}','${jsString(rule.id)}','maxJointLengthFt',this.value)"></label>
            <label>Coverage<input type="number" step="0.01" value="${product.coveragePerUnit ?? ''}" onchange="updateConnectorProduct('${jsString(rule.product)}','coveragePerUnit',this.value)"></label>
            <label>Waste<input type="number" step="0.01" value="${product.wasteFactor ?? ''}" onchange="updateConnectorProduct('${jsString(rule.product)}','wasteFactor',this.value)"></label>
          </div>
        </div>
      `;
    }).join('') : '<div class="cs-empty">No connector components are defined for this duct type in the selected standard.</div>';
    const sampleEditor = `
      <div class="cs-application-sample">
        <label>${lengthLabel}<input type="number" step="0.1" value="${sampleJointLengthFt}" onchange="setConnectorApplicationPreviewLength(this.value)"></label>
        <span>Use this to check how purchase units convert into applied cost per joint before a fitting is placed.</span>
      </div>`;
    return renderPane('rules', `${SHAPE_LABELS[getPreviewShape()] || getPreviewShape()} Component Library`, 'Enable items to add them to the selected project standard', `${sampleEditor}<div class="cs-card-grid">${cards}</div>`);
  }

  function render() {
    const snap = getConnectorDefaultsSnapshot();
    if (!content()) return;
    content().innerHTML = `
      <div class="cs-shell">
        <div class="cs-left">
          ${renderStandardsManager(snap)}
          ${renderJointPreview(snap)}
        </div>
        <div class="cs-right">
          ${renderComponentLibrary(snap)}
          ${renderJointDefaults(snap)}
        </div>
      </div>
    `;
  }

  function saveAndRefresh(patch) {
    saveConnectorDefaultsOverride(patch);
    render();
    if (shouldRefreshCompiler()) refreshCompiler();
    showToast('Connector standard updated');
  }

  window.openConnectorStandards = function() {
    const el = panel();
    if (!el) return;
    if (el.style.display === 'flex') { window.closeConnectorStandards(); return; }
    applyLayout(el);
    el.style.display = 'flex';
    initDrag();
    render();
  };

  window.closeConnectorStandards = function() {
    saveLayout();
    const el = panel();
    if (el) el.style.display = 'none';
  };

  window.updateConnectorProduct = function(key, prop, value) {
    saveAndRefresh({ products: { [key]: { [prop]: prop === 'displayColor' ? value : (value === '' ? null : parseFloat(value)) } } });
  };

  window.updateConnectorJointCount = function(key, value) {
    saveAndRefresh({ jointCountDefaults: { fittings: { [key]: parseInt(value, 10) || 0 } } });
  };

  window.updateConnectorDuctPolicy = function(ductKey, prop, value) {
    saveAndRefresh({ jointCountDefaults: { duct: { [ductKey]: { [prop]: parseFloat(value) || 0 } } } });
  };

  window.updateConnectorRule = function(standardKey, ruleId, prop, value) {
    const standards = CONNECTOR_DEFAULTS.standards || {};
    const nextValue = prop === 'enabled' ? !!value : (value === '' && (prop === 'minJointLengthFt' || prop === 'maxJointLengthFt') ? null : (prop === 'minJointLengthFt' || prop === 'maxJointLengthFt' ? parseFloat(value) : value));
    const rules = ((standards[standardKey] || {}).rules || []).map(rule => rule.id === ruleId ? { ...rule, [prop]: nextValue } : rule);
    const updated = { ...standards, [standardKey]: { ...(standards[standardKey] || {}), rules } };
    saveStandardsAndActive(updated, standardKey);
  };

  window.setConnectorStandard = function(key) {
    activeStandardKey = key;
    saveAndRefresh({ takeoffDefaults: { activeStandard: key } });
  };

  window.toggleConnectorPane = function(id) {
    collapsedPanes[id] = !collapsedPanes[id];
    render();
  };

  window.setConnectorPreviewType = function(type) {
    activePreviewType = PREVIEW_TYPES.some(item => item.id === type) ? type : 'rect';
    render();
  };

  window.setConnectorApplicationPreviewLength = function(value) {
    const n = parseFloat(value);
    if (Number.isFinite(n) && n > 0) applicationPreviewLengthFt[getPreviewShape()] = n;
    render();
  };

  window.updateConnectorStandardMeta = function(prop, value) {
    const standards = CONNECTOR_DEFAULTS.standards || {};
    const key = activeStandardKey || Object.keys(standards)[0];
    if (!key) return;
    const updated = { ...standards, [key]: { ...(standards[key] || {}), [prop]: value } };
    saveStandardsAndActive(updated, key);
  };

  window.saveConnectorStandardAs = function() {
    const standards = CONNECTOR_DEFAULTS.standards || {};
    const currentKey = activeStandardKey || Object.keys(standards)[0];
    const current = standards[currentKey];
    if (!current) return;
    const label = window.prompt('Name this construction standard:', `${current.label || 'Custom Standard'} Copy`);
    if (!label) return;
    let key = slugify(label);
    let n = 2;
    while (standards[key]) key = `${slugify(label)}-${n++}`;
    const newStandard = clone(current);
    newStandard.label = label;
    newStandard.description = newStandard.description || 'Custom connector standard.';
    newStandard.source = 'User defined';
    newStandard._defaultRules = clone(newStandard.rules || []);
    const updated = { ...standards, [key]: newStandard };
    saveStandardsAndActive(updated, key);
    showToast('Standard saved');
  };

  window.saveConnectorStandardDefault = function() {
    const standards = CONNECTOR_DEFAULTS.standards || {};
    const key = activeStandardKey || Object.keys(standards)[0];
    if (!key || !standards[key]) return;
    const updated = { ...standards, [key]: { ...standards[key], _defaultRules: clone(standards[key].rules || []) } };
    saveStandardsAndActive(updated, key);
    showToast('Standard default updated');
  };

  window.resetConnectorStandardToDefault = function() {
    const standards = CONNECTOR_DEFAULTS.standards || {};
    const seeds = getConnectorSeedDefaultsSnapshot().standards || {};
    const key = activeStandardKey || Object.keys(standards)[0];
    if (!key || !standards[key]) return;
    const defaultRules = standards[key]._defaultRules || (seeds[key] && seeds[key].rules);
    if (!defaultRules) {
      showToast('No saved default exists for this standard');
      return;
    }
    const updated = { ...standards, [key]: { ...standards[key], rules: clone(defaultRules) } };
    saveStandardsAndActive(updated, key);
    showToast('Standard reverted');
  };

  window.deleteConnectorStandard = function() {
    const standards = CONNECTOR_DEFAULTS.standards || {};
    const keys = Object.keys(standards);
    const key = activeStandardKey || keys[0];
    if (keys.length <= 1) {
      showToast('At least one standard is required');
      return;
    }
    if (!window.confirm('Delete this construction standard?')) return;
    const updated = { ...standards };
    delete updated[key];
    saveStandardsAndActive(updated, Object.keys(updated)[0]);
    showToast('Standard deleted');
  };

  return { render };
}
