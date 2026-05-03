#!/usr/bin/env python3
"""Add dedicated Spiral Duct tool: set diameter once, click-click for each run"""

with open('index.html', 'r') as f:
    content = f.read()

changes = 0

# 1. Add tool button in toolbar after Measure
old_toolbar = """    <button id="measureBtn" onclick="toggleMeasureMode()" title="Measure (M)">📐 Measure</button>
    <button id="panelBtn" onclick="togglePanel()" title="Measurements Panel">📋</button>"""
new_toolbar = """    <button id="measureBtn" onclick="toggleMeasureMode()" title="Measure (M)">📐 Measure</button>
    <button id="spiralBtn" onclick="toggleSpiralMode()" title="Spiral Duct (S)">◎ Spiral</button>
    <button id="panelBtn" onclick="togglePanel()" title="Measurements Panel">📋</button>"""
assert old_toolbar in content
content = content.replace(old_toolbar, new_toolbar)
changes += 1

# 2. Add CSS for the spiral diameter config bar
old_css_anchor = '  .anno-controls { position: absolute; top: 8px; right: 16px;'
new_css_anchor = """  /* Spiral tool config bar */
  .spiral-config { display: none; position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 55; background: #16213e; border: 1px solid #0f3460; border-radius: 6px; padding: 6px 14px; gap: 10px; align-items: center; box-shadow: 0 4px 16px rgba(0,0,0,0.4); font-size: 13px; white-space: nowrap; }
  .spiral-config.active { display: flex; }
  .spiral-config label { color: #a0a0c0; font-size: 12px; }
  .spiral-config select, .spiral-config input { background: #1a1a2e; border: 1px solid #0f3460; color: #e0e0e0; padding: 4px 8px; border-radius: 4px; font-size: 13px; }
  .spiral-config select:focus, .spiral-config input:focus { outline: none; border-color: #e94560; }
  .spiral-config .spiral-diam-input { width: 60px; text-align: center; font-weight: 600; }
  .spiral-config .spiral-hint { color: #a0a0c0; font-size: 11px; }
  .spiral-config .duct-type-select { width: auto; }
  .anno-controls { position: absolute; top: 8px; right: 16px;"""
assert old_css_anchor in content
content = content.replace(old_css_anchor, new_css_anchor)
changes += 1

# 3. Add spiral config bar HTML in the viewer container (near anno controls)
old_anno_html = '    <!-- Annotation controls -->'
new_anno_html = """    <!-- Spiral duct tool config -->
    <div class="spiral-config" id="spiralConfig">
      <label>Type:</label>
      <select id="spiralToolType" class="duct-type-select" onchange="onSpiralTypeChange()">
        <option value="spiral">◎ Spiral</option>
        <option value="round">● Round</option>
        <option value="rect">▬ Rect</option>
        <option value="oval">⬭ Oval</option>
      </select>
      <label id="spiralDiamLabel">⌀</label>
      <input type="text" id="spiralDiamInput" class="spiral-diam-input" value="14" placeholder="14">
      <span id="spiralDimsExtra" style="display:none">
        <label>×</label>
        <input type="text" id="spiralHeightInput" class="spiral-diam-input" value="12" placeholder="12" style="width:50px">
      </span>
      <span class="spiral-hint">Click-click to draw · Enter/Dbl-click to finish</span>
    </div>
    <!-- Annotation controls -->"""
assert old_anno_html in content
content = content.replace(old_anno_html, new_anno_html)
changes += 1

# 4. Add spiral mode state variables near measureMode
old_mode_vars = "let measureMode = false;"
new_mode_vars = """let measureMode = false;
let spiralMode = false;  // dedicated duct drawing tool"""
assert old_mode_vars in content
content = content.replace(old_mode_vars, new_mode_vars)
changes += 1

# 5. Add spiralMode toggle function after toggleMeasureMode
old_toggle_measure = """window.toggleMeasureMode = function() {
  measureMode = !measureMode;
  const btn = document.getElementById('measureBtn');
  btn.classList.toggle('active', measureMode);
  viewer.classList.toggle('measuring', measureMode);
  if (!measureMode) {
    measPoints = [];
    drawMeasureOverlay();
  }
};"""
new_toggle_measure = """window.toggleMeasureMode = function() {
  // Turn off spiral mode if active
  if (spiralMode) toggleSpiralMode();
  measureMode = !measureMode;
  const btn = document.getElementById('measureBtn');
  btn.classList.toggle('active', measureMode);
  viewer.classList.toggle('measuring', measureMode);
  if (!measureMode) {
    measPoints = [];
    drawMeasureOverlay();
  }
};

window.toggleSpiralMode = function() {
  // Turn off measure mode if active
  if (measureMode) { measureMode = false; document.getElementById('measureBtn').classList.remove('active'); }
  spiralMode = !spiralMode;
  const btn = document.getElementById('spiralBtn');
  btn.classList.toggle('active', spiralMode);
  viewer.classList.toggle('measuring', spiralMode);
  document.getElementById('spiralConfig').classList.toggle('active', spiralMode);
  if (!spiralMode) {
    // If there are pending points, finish the current run
    if (measPoints.length >= 2) finishSpiralRun();
    measPoints = [];
    drawMeasureOverlay();
  }
};

window.onSpiralTypeChange = function() {
  const type = document.getElementById('spiralToolType').value;
  const isRect = (type === 'rect' || type === 'oval');
  document.getElementById('spiralDiamLabel').textContent = isRect ? 'W' : '⌀';
  document.getElementById('spiralDimsExtra').style.display = isRect ? 'inline' : 'none';
  document.getElementById('spiralDiamInput').placeholder = isRect ? '24' : '14';
};

function getSpiralToolDuct() {
  const type = document.getElementById('spiralToolType').value;
  const symbols = { rect: '▬', oval: '⬭', round: '●', spiral: '◎' };
  const w = document.getElementById('spiralDiamInput').value.trim() || '14';
  if (type === 'rect' || type === 'oval') {
    const h = document.getElementById('spiralHeightInput').value.trim() || '12';
    return { type, dims: w + 'x' + h, symbol: symbols[type] };
  }
  return { type, dims: w, symbol: symbols[type] };
}

function finishSpiralRun() {
  if (measPoints.length < 2) return;
  const scale = getScaleForPage(currentPage);
  const pxLen = computePolylineLength(measPoints);
  const dist = computeRealDistance(pxLen, scale);
  
  window._measIdCounter = ++measureIdCounter;
  const meas = {
    id: measureIdCounter,
    page: currentPage,
    points: [...measPoints],
    scale: scale ? { ...scale } : null,
    pxLength: pxLen,
    distance: dist,
    duct: getSpiralToolDuct(),
    labelText: null,
    labelSize: null,
    labelTextOpacity: null,
    labelFillOpacity: null
  };
  
  if (!pageMeasurements[currentPage]) pageMeasurements[currentPage] = [];
  pageMeasurements[currentPage].push(meas);
  measPoints = [];
  drawMeasureOverlay();
  updatePanel();
  scheduleSave();
}"""
assert old_toggle_measure in content
content = content.replace(old_toggle_measure, new_toggle_measure)
changes += 1

# 6. Update click handler to handle spiralMode — finish previous run on new click after Enter/dblclick
# The existing click handler adds points in measureMode. We need it to also work in spiralMode.
old_click_measure = "  if (!measureMode) return;\n  \n  const pt = screenToPdf(e.clientX, e.clientY);\n  measPoints.push(pt);\n  drawMeasureOverlay();"
new_click_measure = "  if (!measureMode && !spiralMode) return;\n  \n  const pt = screenToPdf(e.clientX, e.clientY);\n  measPoints.push(pt);\n  drawMeasureOverlay();"
assert old_click_measure in content
content = content.replace(old_click_measure, new_click_measure)
changes += 1

# 7. Update dblclick to finish spiral run (not finishMeasurement) when in spiral mode
old_dblclick = "  if (!measureMode || measPoints.length < 2) return;\n  e.preventDefault();\n  finishMeasurement();"
new_dblclick = """  if (spiralMode && measPoints.length >= 2) {
    e.preventDefault();
    finishSpiralRun();
    return;
  }
  if (!measureMode || measPoints.length < 2) return;
  e.preventDefault();
  finishMeasurement();"""
assert old_dblclick in content
content = content.replace(old_dblclick, new_dblclick)
changes += 1

# 8. Update Enter key to finish spiral run in spiral mode
old_enter_finish = "  else if (e.key === 'Enter' && measPoints.length >= 2) {\n    e.preventDefault();\n    finishMeasurement();\n  }"
new_enter_finish = """  else if (e.key === 'Enter' && measPoints.length >= 2) {
    e.preventDefault();
    if (spiralMode) finishSpiralRun();
    else finishMeasurement();
  }"""
assert old_enter_finish in content
content = content.replace(old_enter_finish, new_enter_finish)
changes += 1

# 9. Add S hotkey for spiral mode
old_m_key = "  else if (e.key === 'm' || e.key === 'M') { e.preventDefault(); window.toggleMeasureMode(); }"
new_m_key = """  else if (e.key === 'm' || e.key === 'M') { e.preventDefault(); window.toggleMeasureMode(); }
  else if (e.key === 's' || e.key === 'S') { e.preventDefault(); window.toggleSpiralMode(); }"""
assert old_m_key in content
content = content.replace(old_m_key, new_m_key)
changes += 1

# 10. Update mousemove to show live feedback in spiral mode too
old_mouse_measure = "  if ((measureMode || calibrationMode) && pdfDoc) {"
new_mouse_measure = "  if ((measureMode || spiralMode || calibrationMode) && pdfDoc) {"
assert old_mouse_measure in content
content = content.replace(old_mouse_measure, new_mouse_measure)
changes += 1

# 11. Update the live drawing in drawMeasureOverlay to show spiral tool preview
old_live_draw = """  // Draw in-progress measurement
  if (measureMode && measPoints.length > 0) {"""
new_live_draw = """  // Draw in-progress measurement or spiral duct
  if ((measureMode || spiralMode) && measPoints.length > 0) {"""
assert old_live_draw in content
content = content.replace(old_live_draw, new_live_draw)
changes += 1

# 12. For spiral mode live preview, show the spiral rendering instead of plain line
old_live_render = """    _currentRenderMeas = null;
    drawMeasurementLine(pts, dist.formatted, null, '#00ff88', true);"""
new_live_render = """    _currentRenderMeas = null;
    if (spiralMode) {
      const liveDuct = getSpiralToolDuct();
      drawMeasurementLine(pts, dist.formatted, liveDuct, '#00ff88', true);
    } else {
      drawMeasurementLine(pts, dist.formatted, null, '#00ff88', true);
    }"""
assert old_live_render in content
content = content.replace(old_live_render, new_live_render)
changes += 1

# 13. Block canvas interaction when clicking spiral config bar
old_click_guard = "e.target.closest('.anno-controls'))"
new_click_guard = "e.target.closest('.anno-controls') || e.target.closest('.spiral-config'))"
assert old_click_guard in content
content = content.replace(old_click_guard, new_click_guard)
changes += 1

old_pan_guard = "  if (e.target.closest('.anno-controls')) return;"
new_pan_guard = "  if (e.target.closest('.anno-controls') || e.target.closest('.spiral-config')) return;"
assert old_pan_guard in content
content = content.replace(old_pan_guard, new_pan_guard)
changes += 1

# 14. Make sure Escape also cancels spiral mode in-progress points
old_escape = "    if (calibrationMode) { cancelCalibration(); return; }\n    if (measPoints.length > 0) { measPoints = []; drawMeasureOverlay(); }"
new_escape = "    if (calibrationMode) { cancelCalibration(); return; }\n    if (measPoints.length > 0) { measPoints = []; drawMeasureOverlay(); }\n    else if (spiralMode) { toggleSpiralMode(); }"
assert old_escape in content
content = content.replace(old_escape, new_escape)
changes += 1

# 15. Update mousedown guard: spiral mode should also block panning
old_pan_check = "  if (measureMode && !e.shiftKey) return;"
new_pan_check = "  if ((measureMode || spiralMode) && !e.shiftKey) return;"
assert old_pan_check in content
content = content.replace(old_pan_check, new_pan_check)
changes += 1

with open('index.html', 'w') as f:
    f.write(content)
print(f"OK: {changes} changes applied")
