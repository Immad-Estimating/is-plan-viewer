// =====================================================
// IS Plan Viewer — Insert Palette Module
// =====================================================
// Extracted from index.html to reduce main file size.
// Manages the Insert Palette UI: fitting selection, HVAC
// component placement, ghost preview, and canvas insertion.
// =====================================================

// Reference to host app state — set by init()
let _host = null;

export function init(host) {
  _host = host;
}

// ---- Insert Palette: Slider-based section system ----
let selectedHvacComponent = null; // currently selected HVAC library component
let roundDuctType = 'spiral'; // 'spiral' or 'snaplock'
let _hvacLibraryItems = []; // cached HVAC library items

const HVAC_CATEGORY_ICONS = {
  'equipment': '🏭', 'fan': '🌀', 'air-distribution': '💨', 'terminal': '📦',
  'energy-recovery': '♻️', 'heating': '🔥', 'makeup-air': '🌬️', 'specialty': '⚡'
};
const HVAC_CATEGORY_ORDER = ['equipment','fan','air-distribution','terminal','energy-recovery','heating','makeup-air','specialty'];

window.setRoundDuctType = function(type) {
  roundDuctType = type;
  document.getElementById('btnSpiral').classList.toggle('active', type === 'spiral');
  document.getElementById('btnSnaplock').classList.toggle('active', type === 'snaplock');
};

window.setFittingShape = function(shape) {
  currentFittingShape = shape;
  // Update dimension labels
  const isRect = (shape === 'rect' || shape === 'oval');
  document.getElementById('fpSizeA').placeholder = isRect ? '24x12' : '14';
  if (isRect && !document.getElementById('fpSizeA').value.includes('x')) {
    document.getElementById('fpSizeA').value = '24x12';
  } else if (!isRect && document.getElementById('fpSizeA').value.includes('x')) {
    document.getElementById('fpSizeA').value = '14';
  }
};

function renderInsertPalette() {
  // Set slider max values based on fitting counts
  const sliderRound = document.getElementById('sliderRound');
  const sliderRect = document.getElementById('sliderRect');
  const sliderOval = document.getElementById('sliderOval');
  if (sliderRound) sliderRound.max = FITTINGS_BY_SHAPE.round.length;
  if (sliderRect) sliderRect.max = FITTINGS_BY_SHAPE.rect.length;
  if (sliderOval) sliderOval.max = FITTINGS_BY_SHAPE.oval.length;
  // Render each section at current slider values
  updateInsertSection('round');
  updateInsertSection('rect');
  updateInsertSection('oval');
  // Load HVAC items from project system symbols
  loadHvacInsertItems();
  updateConfigArea();
}

function loadHvacInsertItems() {
  // Use project system symbols (actual extracted tags like RTU-1, EF-1, CD-1)
  // These are the real tags from the project, not generic library templates
  _hvacLibraryItems = (projectSystemSymbols || []).map(sym => ({
    _symId: sym.id,
    tag: sym.tag,
    type: sym.equipment?.type || sym.description?.split(' · ')[0] || '',
    category: sym.equipment?.category || sym.category || 'equipment',
    color: sym.color || '#4dabf7',
    manufacturer: sym.equipment?.manufacturer || '',
    model: sym.equipment?.model || '',
    tonnage: sym.equipment?.tonnage || null,
    cfm: sym.equipment?.cfm || null,
    size: sym.equipment?.size || null,
    voltage: sym.equipment?.voltage || null,
    heating: sym.equipment?.heating || null,
    quantity: sym.equipment?.quantity || null,
  }));
  const slider = document.getElementById('sliderHvac');
  if (slider) slider.max = _hvacLibraryItems.length;
  updateInsertSection('hvac');
}

window.updateInsertSection = function(section) {
  if (section === 'hvac') {
    const slider = document.getElementById('sliderHvac');
    const container = document.getElementById('itemsHvac');
    if (!slider || !container) return;
    const count = parseInt(slider.value) || 0;
    if (count === 0) {
      container.innerHTML = '';
      container.classList.add('collapsed');
      return;
    }
    container.classList.remove('collapsed');
    // Sort by category → type → tag, then render up to count items
    const sorted = [..._hvacLibraryItems].sort((a,b) => {
      const ai = HVAC_CATEGORY_ORDER.indexOf(a.category);
      const bi = HVAC_CATEGORY_ORDER.indexOf(b.category);
      if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      const tc = (a.type || '').localeCompare(b.type || '');
      if (tc !== 0) return tc;
      return (a.tag || '').localeCompare(b.tag || '');
    });
    const visible = sorted.slice(0, count);
    let html = '';
    let lastCat = '';
    let lastType = '';
    visible.forEach((item, idx) => {
      if (item.category !== lastCat) {
        const icon = HVAC_CATEGORY_ICONS[item.category] || '📦';
        const catLabel = item.category.replace(/-/g, ' ');
        html += `<div class="hvac-cat-header">${icon} ${catLabel}</div>`;
        lastCat = item.category;
        lastType = ''; // reset type when category changes
      }
      if (item.type && item.type !== lastType) {
        html += `<div style="font-size:9px;color:#444;padding:2px 0 1px 6px;letter-spacing:0.3px">${escapeHtml(item.type)}</div>`;
        lastType = item.type;
      }
      const sel = (selectedHvacComponent && selectedHvacComponent.tag === item.tag) ? ' selected' : '';
      // Build specs summary
      const specParts = [];
      if (item.tonnage) specParts.push(item.tonnage + 'T');
      if (item.cfm) specParts.push(item.cfm.toLocaleString() + ' CFM');
      if (item.size) specParts.push(item.size);
      if (item.manufacturer) specParts.push(item.manufacturer);
      if (item.voltage) specParts.push(item.voltage);
      if (item.quantity && item.quantity > 1) specParts.push('qty ' + item.quantity);
      const specStr = specParts.length > 0 ? specParts.slice(0, 3).join(' · ') : '';
      html += `<div class="hvac-comp-row${sel}" onclick="event.stopPropagation(); selectHvacComponent('${escapeHtml(item.tag)}')" style="border-left:3px solid ${item.color || '#4dabf7'}">`;
      html += `<span class="comp-tag">${escapeHtml(item.tag)}</span>`;
      html += `<span class="comp-type">${escapeHtml(item.type || '')}</span>`;
      if (specStr) html += `<span style="font-size:9px;color:#666;margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px" title="${escapeHtml(specParts.join(' · '))}">${escapeHtml(specStr)}</span>`;
      html += `</div>`;
    });
    container.innerHTML = html;
    return;
  }
  // Fitting sections (round, rect, oval)
  const shapeMap = { round: 'round', rect: 'rect', oval: 'oval' };
  const shape = shapeMap[section];
  const slider = document.getElementById('slider' + section.charAt(0).toUpperCase() + section.slice(1));
  const container = document.getElementById('items' + section.charAt(0).toUpperCase() + section.slice(1));
  if (!slider || !container) return;
  const count = parseInt(slider.value) || 0;
  if (count === 0) {
    container.innerHTML = '';
    container.classList.add('collapsed');
    return;
  }
  container.classList.remove('collapsed');
  const fittings = FITTINGS_BY_SHAPE[shape] || [];
  const visible = fittings.slice(0, count);
  container.innerHTML = '<div class="fitting-grid">' + visible.map(f =>
    `<button data-type="${f.type}" data-shape="${shape}" onclick="event.stopPropagation(); selectInsertFitting('${f.type}','${shape}')" title="${f.title}" ${(selectedFittingType === f.type && currentFittingShape === shape && !selectedHvacComponent) ? 'class="selected"' : ''}>${f.label}</button>`
  ).join('') + '</div>';
};

window.selectInsertFitting = function(type, shape) {
  // Clear HVAC selection
  selectedHvacComponent = null;
  // Set shape context for this fitting
  currentFittingShape = shape;
  // Update dimension context for shape
  setFittingShape(shape);
  // Select the fitting type
  selectFittingType(type);
  // Re-render all sections to update selection highlights
  updateInsertSection('round');
  updateInsertSection('rect');
  updateInsertSection('oval');
  updateInsertSection('hvac');
  updateConfigArea();
};

window.selectHvacComponent = function(tag) {
  const item = _hvacLibraryItems.find(i => i.tag === tag);
  if (!item) return;
  selectedHvacComponent = item;
  selectedFittingType = null; // clear fitting selection
  selectedFittingId = null;
  // Build preview with specs
  const specParts = [];
  if (item.tonnage) specParts.push(item.tonnage + 'T');
  if (item.cfm) specParts.push(item.cfm.toLocaleString() + ' CFM');
  if (item.manufacturer) specParts.push(item.manufacturer);
  const specSuffix = specParts.length > 0 ? ' (' + specParts.join(', ') + ')' : '';
  document.getElementById('fpPreview').textContent = item.tag + ' — ' + (item.type || 'Component') + specSuffix;
  // Re-render sections
  updateInsertSection('round');
  updateInsertSection('rect');
  updateInsertSection('oval');
  updateInsertSection('hvac');
  updateConfigArea();
};

function updateConfigArea() {
  const dimsArea = document.getElementById('insertDimsArea');
  const hvacArea = document.getElementById('hvacConfigArea');
  if (!dimsArea || !hvacArea) return;
  if (selectedHvacComponent) {
    dimsArea.style.display = 'none';
    hvacArea.style.display = 'block';
    const hc = selectedHvacComponent;
    const hcSpecs = [];
    if (hc.tonnage) hcSpecs.push(hc.tonnage + ' ton');
    if (hc.cfm) hcSpecs.push(hc.cfm.toLocaleString() + ' CFM');
    if (hc.manufacturer) hcSpecs.push(hc.manufacturer);
    if (hc.model) hcSpecs.push(hc.model);
    if (hc.voltage) hcSpecs.push(hc.voltage);
    document.getElementById('hvacConfigTag').innerHTML = `<span style="color:${hc.color || '#00ff88'}">${escapeHtml(hc.tag)}</span> — ${escapeHtml(hc.type || '')}` +
      (hcSpecs.length > 0 ? `<div style="font-size:10px;color:#a0a0c0;margin-top:2px">${escapeHtml(hcSpecs.join(' · '))}</div>` : '');
  } else {
    dimsArea.style.display = selectedFittingType ? 'block' : 'none';
    hvacArea.style.display = 'none';
  }
}

// Initialize insert palette on load
setTimeout(() => renderInsertPalette(), 0);

// Drag support for Insert palette
(function() {
  let _fpDrag = null;
  const handle = document.getElementById('fpDragHandle');
  const palette = document.getElementById('fittingPalette');
  if (!handle || !palette) return;
  handle.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    e.preventDefault();
    _fpDrag = { sx: e.clientX - palette.offsetLeft, sy: e.clientY - palette.offsetTop };
  });
  document.addEventListener('mousemove', (e) => {
    if (!_fpDrag) return;
    let x = e.clientX - _fpDrag.sx;
    let y = e.clientY - _fpDrag.sy;
    // Clamp so at least 40px of the palette stays visible
    x = Math.max(-palette.offsetWidth + 60, Math.min(window.innerWidth - 60, x));
    y = Math.max(0, Math.min(window.innerHeight - 40, y));
    palette.style.left = x + 'px';
    palette.style.top = y + 'px';
  });
  document.addEventListener('mouseup', () => { _fpDrag = null; });
  // Double-click header to reset position
  handle.addEventListener('dblclick', () => { palette.style.left = '16px'; palette.style.top = '50px'; });
})();

window.selectFittingType = function(type) {
  selectedFittingType = type;
  selectedHvacComponent = null;
  selectedFittingId = null;
  document.querySelectorAll('.fitting-grid button').forEach(b => {
    b.classList.toggle('selected', b.dataset.type === type && b.dataset.shape === currentFittingShape);
  });
  document.getElementById('fpPreview').textContent = FITTING_NAMES[type] || type;
  // Show/hide sizeB based on type
  const needsB = ['tee','saddle45y','lateral','wye','reducer','eccReducer','transition','rectTap'].includes(type);
  document.getElementById('fpSizeB').style.display = needsB ? '' : 'none';
  document.getElementById('fpSizeBLabel').style.display = needsB ? '' : 'none';
  // Update B label based on fitting type
  const isReducerType = ['reducer','eccReducer'].includes(type);
  document.getElementById('fpSizeBLabel').textContent = isReducerType ? 'Out:' : 'Br:';
  // Clear sizeB when switching to non-B fitting
  if (!needsB) document.getElementById('fpSizeB').value = '';
  updateConfigArea();
};


window.rotateFittingInput = function(deg) {
  const input = document.getElementById('fpRotation');
  let val = (parseFloat(input.value) || 0) + deg;
  val = ((val % 360) + 360) % 360;
  input.value = val;
  drawMeasureOverlay();
};

function rotateFittingSelected(deg) {
  if (!selectedFittingId) return;
  const fittings = pageFittings[currentPage] || [];
  const f = fittings.find(f => f.id === selectedFittingId);
  if (!f) return;
  f.rotation = ((f.rotation + deg) % 360 + 360) % 360;
  drawMeasureOverlay();
  scheduleSave();
}

function handleFittingClick(e) {
  const pt = screenToPdf(e.clientX, e.clientY);

  // Check if clicking on a rotation handle of selected fitting
  if (selectedFittingId) {
    const f = (pageFittings[currentPage] || []).find(f => f.id === selectedFittingId);
    if (f) {
      const handleDist = getFittingBoundingRadius(f) + 15;
      const hx = f.x + Math.cos((f.rotation - 90) * Math.PI / 180) * handleDist;
      const hy = f.y + Math.sin((f.rotation - 90) * Math.PI / 180) * handleDist;
      const dx = pt.x - hx, dy = pt.y - hy;
      if (Math.sqrt(dx*dx + dy*dy) < 10) {
        // Start drag rotation
        fittingDragRotate = true;
        fittingDragStartAngle = Math.atan2(pt.y - f.y, pt.x - f.x) * 180 / Math.PI - f.rotation;
        return;
      }
    }
  }

  // Check if clicking on an existing fitting
  const fittings = pageFittings[currentPage] || [];
  for (let i = fittings.length - 1; i >= 0; i--) {
    const f = fittings[i];
    const r = getFittingBoundingRadius(f);
    const dx = pt.x - f.x, dy = pt.y - f.y;
    if (Math.sqrt(dx*dx + dy*dy) < r) {
      selectedFittingId = f.id;
      drawMeasureOverlay();
      updatePanel();
      return;
    }
  }

  // Place new fitting if a type is selected
  if (selectedFittingType) {
    if (!pageFittings[currentPage]) pageFittings[currentPage] = [];
    fittingIdCounter++;
    // Snap placement to nearby connection points
    let placeX = pt.x, placeY = pt.y;
    const placeholderConns = [{ x: placeX, y: placeY }];
    const placeTargets = getAllSnapTargets(null, null);
    const placeSnap = findBestSnap(placeholderConns, placeTargets, SNAP_THRESHOLD_PX);
    if (placeSnap.snapped) { placeX += placeSnap.snapDx; placeY += placeSnap.snapDy; }
    const _sA = document.getElementById('fpSizeA').value || '14';
    const _sB = document.getElementById('fpSizeB').value || '';
    const _cd = getCostDefaults(selectedFittingType, _sA, _sB);
    const f = {
      id: fittingIdCounter,
      type: selectedFittingType,
      x: placeX, y: placeY,
      rotation: parseFloat(document.getElementById('fpRotation').value) || 0,
      mirrored: fittingPreMirrored,
      sizeA: _sA,
      sizeB: _sB,
      label: null,
      phase: _cd.phase,
      materialCost: _cd.materialCost,
      laborHrs: _cd.laborHrs,
      laborRate: _cd.laborRate,
      costGroup: null,
      costOverride: false,
      gauge: document.getElementById('fpGauge') ? document.getElementById('fpGauge').value : '26',
      systemSymbol: activeSystemSymbol || null
    };
    pageFittings[currentPage].push(f);
    selectedFittingId = null;
    drawMeasureOverlay();
    updatePanel();
    scheduleSave();
  } else if (selectedHvacComponent) {
    // Place HVAC component as a labeled marker
    if (!pageFittings[currentPage]) pageFittings[currentPage] = [];
    fittingIdCounter++;
    const hvac = selectedHvacComponent;
    const f = {
      id: fittingIdCounter,
      type: 'hvac_component',
      hvacComponentId: hvac._symId || null,
      hvacTag: hvac.tag || 'HVAC',
      hvacType: hvac.type || '',
      hvacCategory: hvac.category || '',
      x: pt.x, y: pt.y,
      rotation: 0,
      mirrored: false,
      sizeA: String(hvac.tonnage ? Math.max(24, hvac.tonnage * 4) : (hvac.size ? parseInt(hvac.size) || 24 : 24)),
      sizeB: String(hvac.tonnage ? Math.max(16, hvac.tonnage * 2.5) : (hvac.size && hvac.size.includes('x') ? parseInt(hvac.size.split('x')[1]) || 16 : 16)),
      label: hvac.tag || 'HVAC',
      phase: 'rough',
      materialCost: (hvac.pricing && hvac.pricing.materialCost) || null,
      laborHrs: null,
      laborRate: null,
      costGroup: null,
      costOverride: false,
      gauge: '',
      systemSymbol: activeSystemSymbol || null
    };
    pageFittings[currentPage].push(f);
    selectedFittingId = null;
    drawMeasureOverlay();
    updatePanel();
    scheduleSave();
  } else {
    selectedFittingId = null;
    drawMeasureOverlay();
    updatePanel();
  }
}

function getFittingBoundingRadius(f) {
  const D = inchesToPx(parseDimension(f.sizeA));
  if (f.type === 'boot') {
    const D2 = f.sizeB ? inchesToPx(parseDimension(f.sizeB)) : D;
    return Math.sqrt(D * D + D2 * D2) / 2 + 5;
  }
  return (D * 1.5 + 10) * 0.75;
}

window.deleteFitting = function(id) {
  const fittings = pageFittings[currentPage] || [];
  const idx = fittings.findIndex(f => f.id === id);
  if (idx !== -1) fittings.splice(idx, 1);
  if (selectedFittingId === id) selectedFittingId = null;
  drawMeasureOverlay();
  updatePanel();
  scheduleSave();
};

window.clearAllFittings = function() {
  pageFittings[currentPage] = [];
  selectedFittingId = null;
  drawMeasureOverlay();
  updatePanel();
  scheduleSave();
};


// ---- Module exports for host app access ----
export function getSelectedHvacComponent() { return selectedHvacComponent; }
export function setSelectedHvacComponent(v) { selectedHvacComponent = v; }
export function getRoundDuctType() { return roundDuctType; }
export function getHvacLibraryItems() { return _hvacLibraryItems; }
export function setHvacLibraryItems(items) { _hvacLibraryItems = items; }
export function render() { renderInsertPalette(); }
