export function installInsertPalette(ctx = {}) {
  const {
    state,
    FITTING_NAMES,
    FITTINGS_BY_SHAPE,
    escapeHtml = function(str) { return String(str == null ? '' : str).replace(/[&<>"']/g, function(ch) { return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]; }); },
    getProjectSystemSymbols = function() { return []; },
    drawMeasureOverlay = function() {}
  } = ctx;

  // ---- Insert Palette: Slider-based section system ----
  let _hvacLibraryItems = []; // cached HVAC library items
  
  const HVAC_CATEGORY_ICONS = {
    'equipment': '🏭', 'fan': '🌀', 'air-distribution': '💨', 'terminal': '📦',
    'energy-recovery': '♻️', 'heating': '🔥', 'makeup-air': '🌬️', 'specialty': '⚡'
  };
  const HVAC_CATEGORY_ORDER = ['equipment','fan','air-distribution','terminal','energy-recovery','heating','makeup-air','specialty'];
  
  function setRoundDuctType(type) {
    state.roundDuctType = type;
    document.getElementById('btnSpiral').classList.toggle('active', type === 'spiral');
    document.getElementById('btnSnaplock').classList.toggle('active', type === 'snaplock');
  };
  
  function setFittingShape(shape) {
    state.currentFittingShape = shape;
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
    _hvacLibraryItems = (getProjectSystemSymbols() || []).map(sym => {
      // Pull labor from library entry if linked, otherwise from pricing field
      const bd = sym.equipment?.pricing?.laborBreakdown || sym.pricing?.laborBreakdown || {};
      const totalLaborHrs = Object.values(bd).reduce((s, v) => s + (parseFloat(v) || 0), 0) ||
        sym.equipment?.pricing?.laborHrs || sym.pricing?.laborHrs || 0;
      return {
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
        laborHrs: totalLaborHrs,
        laborBreakdown: bd,
        pricing: sym.equipment?.pricing || sym.pricing || null,
      };
    });
    const slider = document.getElementById('sliderHvac');
    if (slider) slider.max = _hvacLibraryItems.length;
    updateInsertSection('hvac');
  }
  
  function updateInsertSection(section) {
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
        const sel = (state.selectedHvacComponent && state.selectedHvacComponent.tag === item.tag) ? ' selected' : '';
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
        if (item.laborHrs > 0) html += `<span style="font-size:9px;color:#ffd43b;margin-left:auto;white-space:nowrap;font-weight:600" title="Labor hours per unit">${item.laborHrs.toFixed(1)}h</span>`;
        else if (specStr) html += `<span style="font-size:9px;color:#666;margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px" title="${escapeHtml(specParts.join(' · '))}">${escapeHtml(specStr)}</span>`;
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
      `<button data-type="${f.type}" data-shape="${shape}" onclick="event.stopPropagation(); selectInsertFitting('${f.type}','${shape}')" title="${f.title}" ${(state.selectedFittingType === f.type && state.currentFittingShape === shape && !state.selectedHvacComponent) ? 'class="selected"' : ''}>${f.label}</button>`
    ).join('') + '</div>';
  };
  
  function selectInsertFitting(type, shape) {
    // Clear HVAC selection
    state.selectedHvacComponent = null;
    // Set shape context for this fitting
    state.currentFittingShape = shape;
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
  
  function selectHvacComponent(tag) {
    const item = _hvacLibraryItems.find(i => i.tag === tag);
    if (!item) return;
    state.selectedHvacComponent = item;
    state.selectedFittingType = null; // clear fitting selection
    state.selectedFittingId = null;
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
    if (state.selectedHvacComponent) {
      dimsArea.style.display = 'none';
      hvacArea.style.display = 'block';
      const hc = state.selectedHvacComponent;
      const hcSpecs = [];
      if (hc.tonnage) hcSpecs.push(hc.tonnage + ' ton');
      if (hc.cfm) hcSpecs.push(hc.cfm.toLocaleString() + ' CFM');
      if (hc.manufacturer) hcSpecs.push(hc.manufacturer);
      if (hc.model) hcSpecs.push(hc.model);
      if (hc.voltage) hcSpecs.push(hc.voltage);
      let configHtml = `<span style="color:${hc.color || '#00ff88'}">${escapeHtml(hc.tag)}</span> — ${escapeHtml(hc.type || '')}`;
      if (hcSpecs.length > 0) configHtml += `<div style="font-size:10px;color:#a0a0c0;margin-top:2px">${escapeHtml(hcSpecs.join(' · '))}</div>`;
      // Show labor hours summary
      if (hc.laborHrs > 0) {
        configHtml += `<div style="margin-top:4px;font-size:11px;color:#ffd43b;font-weight:600">👷 ${hc.laborHrs.toFixed(2)}h labor`;
        if (hc.laborBreakdown && Object.keys(hc.laborBreakdown).length > 0) {
          const parts = Object.entries(hc.laborBreakdown).filter(([,v]) => v > 0).map(([k,v]) => `${k}: ${v.toFixed(1)}h`);
          if (parts.length > 0) configHtml += `<div style="font-size:9px;color:#a0a0c0;font-weight:400;margin-top:1px">${parts.join(' · ')}</div>`;
        }
        configHtml += `</div>`;
      }
      document.getElementById('hvacConfigTag').innerHTML = configHtml;
    } else {
      dimsArea.style.display = state.selectedFittingType ? 'block' : 'none';
      hvacArea.style.display = 'none';
    }
  }
  
  // Initialize insert palette on load
  
  
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
  
  function selectFittingType(type) {
    state.selectedFittingType = type;
    state.selectedHvacComponent = null;
    state.selectedFittingId = null;
    document.querySelectorAll('.fitting-grid button').forEach(b => {
      b.classList.toggle('selected', b.dataset.type === type && b.dataset.shape === state.currentFittingShape);
    });
    document.getElementById('fpPreview').textContent = FITTING_NAMES[type] || type;
    // Show/hide sizeB based on type
    const needsB = ['tee','saddle45y','lateral','wye','reducer','eccReducer','transition','rectTap','plenum'].includes(type);
    document.getElementById('fpSizeB').style.display = needsB ? '' : 'none';
    document.getElementById('fpSizeBLabel').style.display = needsB ? '' : 'none';
    // Update B label based on fitting type
    const isReducerType = ['reducer','eccReducer'].includes(type);
    const isPlenumType = type === 'plenum';
    document.getElementById('fpSizeBLabel').textContent = isPlenumType ? 'L:' : (isReducerType ? 'Out:' : 'Br:');
    // Clear sizeB when switching to non-B fitting
    if (!needsB) document.getElementById('fpSizeB').value = '';
    updateConfigArea();
  };
  
  
  function rotateFittingInput(deg) {
    const input = document.getElementById('fpRotation');
    let val = (parseFloat(input.value) || 0) + deg;
    val = ((val % 360) + 360) % 360;
    input.value = val;
    drawMeasureOverlay();
  };
  


  window.setRoundDuctType = setRoundDuctType;
  window.setFittingShape = setFittingShape;
  window.updateInsertSection = updateInsertSection;
  window.selectInsertFitting = selectInsertFitting;
  window.selectHvacComponent = selectHvacComponent;
  window.selectFittingType = selectFittingType;
  window.rotateFittingInput = rotateFittingInput;

  setTimeout(function() { renderInsertPalette(); }, 0);

  return {
    setRoundDuctType,
    setFittingShape,
    renderInsertPalette,
    loadHvacInsertItems,
    updateInsertSection,
    selectInsertFitting,
    selectHvacComponent,
    updateConfigArea,
    selectFittingType,
    rotateFittingInput
  };
}
