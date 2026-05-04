#!/usr/bin/env python3
"""Add endpoint dragging for measurements/ductwork with live annotation update"""

with open('index.html', 'r') as f:
    content = f.read()

changes = 0

# 1. Add drag state variables near other measurement state
old_vars = "let fittingMousePos = null;"
new_vars = """let fittingMousePos = null;

// Endpoint drag state
let dragMeasId = null;      // measurement being dragged
let dragPointIdx = null;    // which point index is being dragged
let isDraggingEndpoint = false;"""
assert old_vars in content
content = content.replace(old_vars, new_vars)
changes += 1

# 2. Add hit-test function near findMeasurement
old_find = "function findMeasurement(id) {"
new_find = """// Hit-test: find if a click is near a measurement endpoint
function hitTestEndpoint(pdfX, pdfY, hitRadius) {
  const measurements = pageMeasurements[currentPage] || [];
  for (let mi = measurements.length - 1; mi >= 0; mi--) {
    const m = measurements[mi];
    for (let pi = 0; pi < m.points.length; pi++) {
      const dx = pdfX - m.points[pi].x;
      const dy = pdfY - m.points[pi].y;
      if (Math.sqrt(dx*dx + dy*dy) < hitRadius) {
        return { measId: m.id, pointIdx: pi };
      }
    }
  }
  return null;
}

function findMeasurement(id) {"""
assert old_find in content
content = content.replace(old_find, new_find)
changes += 1

# 3. Modify mousedown to detect endpoint drag
# Need to intercept before the panning logic
old_mousedown = """viewer.addEventListener('mousedown', (e) => {
  if (!pdfDoc) return;
  if (calibrationMode) return;
  if (e.target.closest('.anno-controls') || e.target.closest('.duct-draw-bar') || e.target.closest('.fitting-palette')) return;
  if (measureMode && !e.shiftKey) return;"""
new_mousedown = """viewer.addEventListener('mousedown', (e) => {
  if (!pdfDoc) return;
  if (calibrationMode) return;
  if (e.target.closest('.anno-controls') || e.target.closest('.duct-draw-bar') || e.target.closest('.fitting-palette')) return;
  
  // Check for endpoint drag (when NOT in measure/duct/fitting mode)
  if (!measureMode && !fittingMode) {
    const pt = screenToPdf(e.clientX, e.clientY);
    // Hit radius in PDF coords: ~8px at current zoom
    const displayScale = currentScale / baseScale;
    const hitR = 8 / displayScale;
    const hit = hitTestEndpoint(pt.x, pt.y, hitR);
    if (hit) {
      isDraggingEndpoint = true;
      dragMeasId = hit.measId;
      dragPointIdx = hit.pointIdx;
      e.preventDefault();
      e.stopPropagation();
      viewer.classList.add('grabbing');
      return;
    }
  }
  
  if (measureMode && !e.shiftKey) return;"""
assert old_mousedown in content
content = content.replace(old_mousedown, new_mousedown)
changes += 1

# 4. Modify mousemove to handle endpoint dragging
old_mousemove = """window.addEventListener('mousemove', (e) => {
  if (isPanning) {
    panX = e.clientX - startX;
    panY = e.clientY - startY;
    applyTransform();
    drawMeasureOverlay();
    return;
  }"""
new_mousemove = """window.addEventListener('mousemove', (e) => {
  // Handle endpoint dragging
  if (isDraggingEndpoint && dragMeasId != null) {
    const pt = screenToPdf(e.clientX, e.clientY);
    const m = findMeasurement(dragMeasId);
    if (m && dragPointIdx >= 0 && dragPointIdx < m.points.length) {
      m.points[dragPointIdx] = { x: pt.x, y: pt.y };
      // Recalculate distance
      const scale = m.scale || getScaleForPage(currentPage);
      m.pxLength = computePolylineLength(m.points);
      m.distance = computeRealDistance(m.pxLength, scale);
      drawMeasureOverlay();
    }
    return;
  }
  
  if (isPanning) {
    panX = e.clientX - startX;
    panY = e.clientY - startY;
    applyTransform();
    drawMeasureOverlay();
    return;
  }"""
assert old_mousemove in content
content = content.replace(old_mousemove, new_mousemove)
changes += 1

# 5. Modify mouseup to finalize endpoint drag
old_mouseup = """window.addEventListener('mouseup', () => {
  if (isPanning) scheduleViewSave();
  isPanning = false;
  viewer.classList.remove('grabbing');
});"""
new_mouseup = """window.addEventListener('mouseup', () => {
  if (isDraggingEndpoint) {
    isDraggingEndpoint = false;
    dragMeasId = null;
    dragPointIdx = null;
    viewer.classList.remove('grabbing');
    drawMeasureOverlay();
    updatePanel();
    scheduleSave();
    return;
  }
  if (isPanning) scheduleViewSave();
  isPanning = false;
  viewer.classList.remove('grabbing');
});"""
assert old_mouseup in content
content = content.replace(old_mouseup, new_mouseup)
changes += 1

# 6. Show grab cursor when hovering over endpoints
# Add to the mousemove handler where mousePos is set for measure mode
old_cursor_section = """  if ((measureMode || spiralMode || calibrationMode) && pdfDoc) {"""
# Hmm, spiralMode might not exist anymore. Let me check what the actual line is.
# Let me try a more targeted search
old_cursor_check = "  if ((measureMode || calibrationMode) && pdfDoc) {"
if old_cursor_check not in content:
    # Try with ductDrawMode or other variants
    import re
    m = re.search(r'if \(\(measureMode.*calibrationMode\) && pdfDoc\) \{', content)
    if m:
        old_cursor_check = m.group(0)
        print(f"Found cursor check: {old_cursor_check[:60]}")

if old_cursor_check in content:
    new_cursor_check = """  // Show grab cursor on endpoint hover (when not in a tool mode)
  if (!measureMode && !fittingMode && !isDraggingEndpoint && pdfDoc) {
    const hpt = screenToPdf(e.clientX, e.clientY);
    const displayScale = currentScale / baseScale;
    const hitR = 8 / displayScale;
    const hit = hitTestEndpoint(hpt.x, hpt.y, hitR);
    viewer.style.cursor = hit ? 'grab' : '';
  }
  
  """ + old_cursor_check
    content = content.replace(old_cursor_check, new_cursor_check)
    changes += 1

# 7. Draw endpoint dots slightly larger and with a hover indicator
# In drawMeasurementLine, the endpoint dots are drawn at radius 4. Let's make them 5 for better click targets.
old_dots = """  for (const p of points) {
    mCtx.fillStyle = color;
    mCtx.beginPath();
    mCtx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    mCtx.fill();
    mCtx.strokeStyle = '#1a1a2e';
    mCtx.lineWidth = 1;
    mCtx.stroke();
  }"""
new_dots = """  for (const p of points) {
    mCtx.fillStyle = color;
    mCtx.beginPath();
    mCtx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    mCtx.fill();
    mCtx.strokeStyle = '#1a1a2e';
    mCtx.lineWidth = 1.5;
    mCtx.stroke();
  }"""
assert old_dots in content
content = content.replace(old_dots, new_dots)
changes += 1

with open('index.html', 'w') as f:
    f.write(content)
print(f"OK: {changes} changes applied")
