#!/usr/bin/env python3
"""Remove all auto-detect elbow/fitting code. Keep unified duct wall rendering."""

with open('index.html', 'r') as f:
    content = f.read()

changes = 0

# 1. Remove detectFittings function
old_detect = '''// ---- Fitting detection ----
function detectFittings(points, duct) {
  if (!duct || points.length < 3) return [];
  const fittings = [];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    // Calculate angle of turn at this point
    const a1 = Math.atan2(curr.y - prev.y, curr.x - prev.x);
    const a2 = Math.atan2(next.y - curr.y, next.x - curr.x);
    let angleDiff = Math.abs(a2 - a1);
    if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
    const degrees = angleDiff * (180 / Math.PI);
    
    let type = null;
    if (degrees >= 80 && degrees <= 100) type = '90el';
    else if (degrees >= 35 && degrees <= 55) type = '45el';
    else if (degrees >= 15 && degrees <= 34) type = '22el';
    else if (degrees > 100 && degrees <= 135) type = '90el'; // generous for hand-drawn
    
    if (type) {
      // Determine turn direction for rendering
      const cross = (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x);
      fittings.push({
        type,
        angle: Math.round(degrees),
        pointIdx: i,
        direction: cross > 0 ? 'cw' : 'ccw',
        size: duct.dims // inherits duct size
      });
    }
  }
  return fittings;
}

function getFittingLabel(type) {
  const labels = { '90el': '90° EL', '45el': '45° EL', '22el': '22.5° EL' };
  return labels[type] || type;
}'''
assert old_detect in content, "detectFittings not found"
content = content.replace(old_detect, '')
changes += 1

# 2. Remove getElbowCLRPx function
old_clr = '''function getElbowCLRPx(duct) {
  const diam = parseFloat(duct.dims) || 14;
  const clrInches = diam * 1.5;
  const scale = getScaleForPage(currentPage);
  if (scale && scale.type === 'arch') {
    const pxPerFoot = (864 * baseScale) / scale.ratio;
    return (clrInches / 12) * pxPerFoot;
  } else if (scale && scale.type === 'custom' && scale.customUnit === 'ft') {
    return (clrInches / 12) * scale.pxPerUnit;
  } else if (scale && scale.type === 'eng') {
    const pxPerInch = (72 * baseScale) / scale.ratio;
    return clrInches * pxPerInch;
  }
  return Math.max(8, diam * 1.2) * (baseScale / 2);
}'''
assert old_clr in content, "getElbowCLRPx not found"
content = content.replace(old_clr, '')
changes += 1

# 3. Remove fittings field from measurement creation
content = content.replace(
    "    fittings: [],           // auto-detected + manual fittings [{type, angle, pointIdx, size}]\n",
    ""
)
changes += 1

# 4. Remove fittings detection in ductDrawMode finish
old_duct_finish = """    meas.duct = getDuctDrawConfig();
    meas.fittings = detectFittings(meas.points, meas.duct);"""
new_duct_finish = """    meas.duct = getDuctDrawConfig();"""
assert old_duct_finish in content
content = content.replace(old_duct_finish, new_duct_finish)
changes += 1

# 5. Remove fittings detection in normal duct tagging
old_tag = """        meas.duct = { type, dims, symbol: symbols[type] };
        meas.fittings = detectFittings(meas.points, meas.duct);"""
new_tag = """        meas.duct = { type, dims, symbol: symbols[type] };"""
assert old_tag in content
content = content.replace(old_tag, new_tag)
changes += 1

# 6. Remove fittings from pageData save
content = content.replace(
    "    fittings: m.fittings || []\n",
    ""
)
changes += 1

# 7. Remove fitting labels section from drawDuctRun (Step 5 block)
old_step5 = """  // Step 5: Fitting labels at turn points
  const effSize = (_currentRenderMeas && _currentRenderMeas.labelSize != null) ? _currentRenderMeas.labelSize : annoSize;
  const effTextOp = (_currentRenderMeas && _currentRenderMeas.labelTextOpacity != null) ? _currentRenderMeas.labelTextOpacity : annoTextOpacity;
  const effFillOp = (_currentRenderMeas && _currentRenderMeas.labelFillOpacity != null) ? _currentRenderMeas.labelFillOpacity : annoFillOpacity;

  for (const fit of fittings) {
    if (fit.pointIdx < 1 || fit.pointIdx >= points.length - 1) continue;
    const segIdx = fit.pointIdx - 1; // incoming segment index
    if (segIdx >= segs.length - 1) continue; // need a next segment too
    const seg = segs[segIdx];
    const nextSeg = segs[segIdx + 1];
    const V = points[fit.pointIdx];

    // Determine outside of the bend via cross product
    const cross = seg.ux * nextSeg.uy - seg.uy * nextSeg.ux;

    // Compute control point on the outside wall for label positioning
    const endWall = cross > 0
      ? { x: V.x - seg.nx * halfW, y: V.y - seg.ny * halfW }   // right wall (outside)
      : { x: V.x + seg.nx * halfW, y: V.y + seg.ny * halfW };  // left wall (outside)
    const outWall = cross > 0
      ? { x: V.x - nextSeg.nx * halfW, y: V.y - nextSeg.ny * halfW }
      : { x: V.x + nextSeg.nx * halfW, y: V.y + nextSeg.ny * halfW };
    const cp = lineLineIntersect(
      endWall, { x: seg.ux, y: seg.uy },
      outWall, { x: -nextSeg.ux, y: -nextSeg.uy }
    );
    const lx = cp ? cp.x : V.x;
    const ly = cp ? cp.y : V.y;

    const labelSz = effSize * 0.65 * baseScale;
    const renderSz = Math.max(28, labelSz);
    const lsc = labelSz / renderSz;
    mCtx.font = `bold ${renderSz}px -apple-system, BlinkMacSystemFont, sans-serif`;
    const ftLabel = getFittingLabel(fit.type);
    const tw = mCtx.measureText(ftLabel).width;

    mCtx.save();
    mCtx.translate(lx, ly);
    mCtx.scale(lsc, lsc);
    mCtx.globalAlpha = effFillOp;
    mCtx.fillStyle = 'rgba(22, 33, 62, 0.9)';
    mCtx.beginPath();
    mCtx.roundRect(-tw/2 - 3, -renderSz/2 - 3, tw + 6, renderSz + 6, 3);
    mCtx.fill();
    mCtx.globalAlpha = effTextOp;
    mCtx.fillStyle = '#00ff88';
    mCtx.textAlign = 'center';
    mCtx.textBaseline = 'middle';
    mCtx.fillText(ftLabel, 0, 0);
    mCtx.restore();
  }

  mCtx.restore();"""
new_step5 = """  mCtx.restore();"""
assert old_step5 in content, "Step 5 fitting labels not found"
content = content.replace(old_step5, new_step5)
changes += 1

# 8. Change drawDuctRun signature to remove fittings param
content = content.replace(
    "function drawDuctRun(points, duct, fittings, color) {",
    "function drawDuctRun(points, duct, color) {"
)
changes += 1

# Remove fitting map building inside drawDuctRun
content = content.replace(
    """  // Build fitting lookup by pointIdx for label rendering
  const fittingMap = {};
  for (const f of fittings) {
    fittingMap[f.pointIdx] = f;
  }

  // Step 1""",
    "  // Step 1"
)
changes += 1

# 9. Update the call in drawMeasurementLine
old_call = """  // Build fittings list for this measurement
  const fittings = (_currentRenderMeas && _currentRenderMeas.fittings) ? _currentRenderMeas.fittings : [];

  if (duct && points.length >= 2) {
    drawDuctRun(points, duct, fittings, color);
  }"""
new_call = """  if (duct && points.length >= 2) {
    drawDuctRun(points, duct, color);
  }"""
assert old_call in content, "drawDuctRun call not found"
content = content.replace(old_call, new_call)
changes += 1

# 10. Remove fitting counts from side panel
old_panel = """      let fittingInfo = '';
      if (m.fittings && m.fittings.length > 0) {
        const counts = {};
        m.fittings.forEach(f => { counts[f.type] = (counts[f.type] || 0) + 1; });
        const parts = Object.entries(counts).map(([t, c]) => `${c}× ${getFittingLabel(t)}`);
        fittingInfo = `<div class="meas-duct" style="color:#00ff88">${parts.join(', ')}</div>`;
      }"""
assert old_panel in content, "fitting panel info not found"
content = content.replace(old_panel, "")
changes += 1

# Remove fittingInfo reference in panel HTML
content = content.replace(
    "          ${fittingInfo}\n",
    ""
)
changes += 1

# 11. Remove fitting CSS
content = content.replace(
    """  .meas-item .meas-fittings-edit { margin-top: 4px; }
  .meas-item .meas-fittings-edit button { background: #1a1a2e; border: 1px solid #0f3460; color: #a0a0c0; padding: 2px 6px; border-radius: 3px; font-size: 10px; cursor: pointer; margin-right: 2px; }
  .meas-item .meas-fittings-edit button:hover { border-color: #e94560; color: #e0e0e0; }""",
    ""
)
changes += 1

with open('index.html', 'w') as f:
    f.write(content)
print(f"OK: {changes} changes applied")
