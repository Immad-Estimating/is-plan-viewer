import { HANGER_DEFAULTS } from './price-defaults.js';

export function installTakeoffRenderer(ctx = {}) {
  const {
    mCtx,
    getScaleForPage,
    getPxPerRealFoot,
    getCurrentPage = function() { return 1; },
    getBaseScale = function() { return 1; },
    getAutoHangerMarkers = function() { return []; },
    getHangerLabel = function(key) { return key; },
    getSelectedHangerMeasId = function() { return null; },
    getAnnoSettings = function() { return { annoSize: 14, annoTextOpacity: 1, annoFillOpacity: 0.9 }; },
    inchesToPx,
    parseDimension,
    getFittingShape,
    getFittingBoundingRadius,
    getFittingNames = function() { return {}; }
  } = ctx;

  // --- SMACNA elbow helper functions ---
  function getDuctHalfWidthPx(duct) {
    const diam = parseFloat(duct.dims) || 14;
    // For rect/oval WxH, use the larger dimension
    let D = diam;
    if (duct.dims && duct.dims.includes('x')) {
      const parts = duct.dims.split('x').map(Number);
      D = Math.max(parts[0] || 14, parts[1] || 14);
    }
    const scale = getScaleForPage(getCurrentPage());
    if (scale) {
      const pxPerFoot = getPxPerRealFoot(scale);
      if (pxPerFoot) return (D / 12) * pxPerFoot / 2;
    }
    // Fallback: proportional visual size matching spiral duct code
    return Math.max(4, Math.min(30, D * 0.7)) * (getBaseScale() / 2);
  }
  
  
  
  // Line-line intersection: p1 + t*d1 = p2 + s*d2. Returns intersection point or null if parallel.
  function lineLineIntersect(p1, d1, p2, d2) {
    const denom = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(denom) < 0.0001) return null;
    const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom;
    return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
  }
  
  // Unified duct wall rendering: traces both wall paths as one continuous shape with bezier turns
  function drawFlexDuctRun(points, duct, color) {
    if (points.length < 2) return;
    const halfW = getDuctHalfWidthPx(duct);
    const isBlack = !duct.flexColor || duct.flexColor === 'black';
    const fillColor = isBlack ? 'rgba(50,50,50,0.25)' : 'rgba(180,180,180,0.2)';
    const wallColor = color;
  
    // Step 1: Build smooth catmull-rom spline through user points
    // Sample the spline densely for smooth curve rendering
    function catmullRom(p0, p1, p2, p3, t) {
      const t2 = t * t, t3 = t2 * t;
      return {
        x: 0.5 * ((2*p1.x) + (-p0.x+p2.x)*t + (2*p0.x-5*p1.x+4*p2.x-p3.x)*t2 + (-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
        y: 0.5 * ((2*p1.y) + (-p0.y+p2.y)*t + (2*p0.y-5*p1.y+4*p2.y-p3.y)*t2 + (-p0.y+3*p1.y-3*p2.y+p3.y)*t3)
      };
    }
  
    // Pad endpoints for catmull-rom (duplicate first/last)
    const pts = [points[0], ...points, points[points.length - 1]];
    const spline = [];
    const samplesPerSeg = 20;
    for (let i = 0; i < pts.length - 3; i++) {
      for (let s = 0; s <= samplesPerSeg; s++) {
        if (i > 0 && s === 0) continue; // avoid duplicate joints
        spline.push(catmullRom(pts[i], pts[i+1], pts[i+2], pts[i+3], s / samplesPerSeg));
      }
    }
    if (spline.length < 2) return;
  
    // Step 2: Compute cumulative arc lengths along spline
    const arcLen = [0];
    for (let i = 1; i < spline.length; i++) {
      const dx = spline[i].x - spline[i-1].x;
      const dy = spline[i].y - spline[i-1].y;
      arcLen.push(arcLen[i-1] + Math.sqrt(dx*dx + dy*dy));
    }
    const totalLen = arcLen[arcLen.length - 1];
    if (totalLen < 1) return;
  
    // Step 3: Compute normals at each spline point
    const normals = [];
    for (let i = 0; i < spline.length; i++) {
      let dx, dy;
      if (i === 0) { dx = spline[1].x - spline[0].x; dy = spline[1].y - spline[0].y; }
      else if (i === spline.length - 1) { dx = spline[i].x - spline[i-1].x; dy = spline[i].y - spline[i-1].y; }
      else { dx = spline[i+1].x - spline[i-1].x; dy = spline[i+1].y - spline[i-1].y; }
      const len = Math.sqrt(dx*dx + dy*dy) || 1;
      normals.push({ x: -dy/len, y: dx/len });
    }
  
    // Step 4: Build corrugated walls
    // Corrugation: sinusoidal offset added to the base halfW
    // Frequency scales with duct size for consistent visual
    const corrugationWavelength = halfW * 1.8; // px per wave cycle
    const corrugationAmplitude = halfW * 0.18; // ripple depth
    const leftWall = [];
    const rightWall = [];
    for (let i = 0; i < spline.length; i++) {
      const ripple = Math.sin((arcLen[i] / corrugationWavelength) * Math.PI * 2) * corrugationAmplitude;
      const offset = halfW + ripple;
      leftWall.push({ x: spline[i].x + normals[i].x * offset, y: spline[i].y + normals[i].y * offset });
      rightWall.push({ x: spline[i].x - normals[i].x * offset, y: spline[i].y - normals[i].y * offset });
    }
  
    // Step 5: Render
    mCtx.save();
  
    // Fill area between walls (semi-transparent)
    mCtx.beginPath();
    mCtx.moveTo(leftWall[0].x, leftWall[0].y);
    for (let i = 1; i < leftWall.length; i++) mCtx.lineTo(leftWall[i].x, leftWall[i].y);
    // Connect to right wall (reversed)
    for (let i = rightWall.length - 1; i >= 0; i--) mCtx.lineTo(rightWall[i].x, rightWall[i].y);
    mCtx.closePath();
    mCtx.fillStyle = fillColor;
    mCtx.fill();
  
    // Draw corrugated walls
    mCtx.strokeStyle = wallColor;
    mCtx.lineWidth = 2;
    mCtx.globalAlpha = 0.9;
    mCtx.beginPath();
    mCtx.moveTo(leftWall[0].x, leftWall[0].y);
    for (let i = 1; i < leftWall.length; i++) mCtx.lineTo(leftWall[i].x, leftWall[i].y);
    mCtx.stroke();
    mCtx.beginPath();
    mCtx.moveTo(rightWall[0].x, rightWall[0].y);
    for (let i = 1; i < rightWall.length; i++) mCtx.lineTo(rightWall[i].x, rightWall[i].y);
    mCtx.stroke();
  
    // Step 6: Internal corrugation ribs (cross lines for accordion texture)
    mCtx.lineWidth = 1;
    mCtx.globalAlpha = 0.35;
    const ribSpacing = corrugationWavelength * 0.5;
    let nextRib = ribSpacing;
    for (let i = 1; i < spline.length; i++) {
      if (arcLen[i] >= nextRib) {
        mCtx.beginPath();
        mCtx.moveTo(leftWall[i].x, leftWall[i].y);
        mCtx.lineTo(rightWall[i].x, rightWall[i].y);
        mCtx.stroke();
        nextRib += ribSpacing;
      }
    }
  
    // End caps
    mCtx.lineWidth = 2;
    mCtx.globalAlpha = 0.9;
    mCtx.beginPath();
    mCtx.moveTo(leftWall[0].x, leftWall[0].y);
    mCtx.lineTo(rightWall[0].x, rightWall[0].y);
    mCtx.stroke();
    mCtx.beginPath();
    mCtx.moveTo(leftWall[leftWall.length-1].x, leftWall[leftWall.length-1].y);
    mCtx.lineTo(rightWall[rightWall.length-1].x, rightWall[rightWall.length-1].y);
    mCtx.stroke();
  
    // Dashed centerline (subtle)
    mCtx.lineWidth = 1;
    mCtx.globalAlpha = 0.2;
    mCtx.setLineDash([4, 6]);
    mCtx.beginPath();
    mCtx.moveTo(spline[0].x, spline[0].y);
    for (let i = 1; i < spline.length; i++) mCtx.lineTo(spline[i].x, spline[i].y);
    mCtx.stroke();
    mCtx.setLineDash([]);
  
    // Step 7: Drop-to-diffuser endpoint symbol (⊗ circle-with-X)
    const dropIn = duct.dropInches || 0;
    if (dropIn > 0) {
      // Symbol at the LAST point of the flex run, sized to duct diameter at drawing scale
      const endPt = spline[spline.length - 1];
      const symbolR = halfW; // radius = half the duct diameter at scale
      const symColor = isBlack ? 'rgba(80,80,80,0.9)' : 'rgba(190,190,190,0.9)';
  
      // Outer circle — dashed outline
      mCtx.globalAlpha = 0.85;
      mCtx.strokeStyle = wallColor;
      mCtx.lineWidth = 2;
      mCtx.setLineDash([4, 3]);
      mCtx.beginPath();
      mCtx.arc(endPt.x, endPt.y, symbolR, 0, Math.PI * 2);
      mCtx.stroke();
      mCtx.setLineDash([]);
  
      // Fill circle
      mCtx.fillStyle = isBlack ? 'rgba(40,40,40,0.3)' : 'rgba(200,200,200,0.25)';
      mCtx.fill();
  
      // X cross lines through full diameter
      mCtx.globalAlpha = 0.7;
      mCtx.lineWidth = 1.8;
      mCtx.strokeStyle = wallColor;
      const xOff = symbolR * 0.707; // cos(45°)
      mCtx.beginPath();
      mCtx.moveTo(endPt.x - xOff, endPt.y - xOff);
      mCtx.lineTo(endPt.x + xOff, endPt.y + xOff);
      mCtx.stroke();
      mCtx.beginPath();
      mCtx.moveTo(endPt.x + xOff, endPt.y - xOff);
      mCtx.lineTo(endPt.x - xOff, endPt.y + xOff);
      mCtx.stroke();
  
      // Drop distance label
      mCtx.globalAlpha = 1.0;
      const labelFontSize = Math.max(10, Math.min(16, halfW * 0.8));
      mCtx.font = `bold ${labelFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
      const dropLabel = '\u2193 ' + dropIn + '"';
      const tw = mCtx.measureText(dropLabel).width;
      const lx = endPt.x + symbolR + 6;
      const ly = endPt.y + labelFontSize * 0.35;
      // Label background
      mCtx.fillStyle = 'rgba(22,33,62,0.85)';
      mCtx.fillRect(lx - 3, ly - labelFontSize + 1, tw + 6, labelFontSize + 4);
      // Label text
      mCtx.fillStyle = wallColor;
      mCtx.fillText(dropLabel, lx, ly);
    }
  
    mCtx.restore();
  }
  
  function drawDuctRun(points, duct, color) {
    if (points.length < 2) return;
    // Route flex duct to dedicated renderer
    if (duct.type === 'flex') { drawFlexDuctRun(points, duct, color); return; }
    const halfW = getDuctHalfWidthPx(duct);
    const isSpiral = duct.type === 'spiral';
  
    // Step 1: Compute direction and perpendicular for each segment
    const segs = [];
    for (let i = 0; i < points.length - 1; i++) {
      const dx = points[i+1].x - points[i].x;
      const dy = points[i+1].y - points[i].y;
      const len = Math.sqrt(dx*dx + dy*dy) || 1;
      const ux = dx / len, uy = dy / len;
      segs.push({ ux, uy, nx: -uy, ny: ux, len });
    }
  
    // Step 2: Build left and right wall paths with bezier curves at turns
    // Each path element: { type: 'M'|'L'|'Q', ... }
    const leftPath = [];
    const rightPath = [];
  
    // Start points
    const s0 = segs[0];
    const p0L = { x: points[0].x + s0.nx * halfW, y: points[0].y + s0.ny * halfW };
    const p0R = { x: points[0].x - s0.nx * halfW, y: points[0].y - s0.ny * halfW };
    leftPath.push({ type: 'M', x: p0L.x, y: p0L.y });
    rightPath.push({ type: 'M', x: p0R.x, y: p0R.y });
  
    // Track segment start/end wall positions for spiral seams
    const segWalls = []; // per segment: { startL, startR, endL, endR }
  
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      // End of this segment (wall positions at points[i+1])
      const endL = { x: points[i+1].x + seg.nx * halfW, y: points[i+1].y + seg.ny * halfW };
      const endR = { x: points[i+1].x - seg.nx * halfW, y: points[i+1].y - seg.ny * halfW };
  
      // Start of this segment (wall positions at points[i])
      const startL = { x: points[i].x + seg.nx * halfW, y: points[i].y + seg.ny * halfW };
      const startR = { x: points[i].x - seg.nx * halfW, y: points[i].y - seg.ny * halfW };
      segWalls.push({ startL, startR, endL, endR });
  
      // Add straight line to end of segment
      leftPath.push({ type: 'L', x: endL.x, y: endL.y });
      rightPath.push({ type: 'L', x: endR.x, y: endR.y });
  
      // If there's a next segment, add bezier curve at the turn
      if (i < segs.length - 1) {
        const nextSeg = segs[i+1];
        // Outgoing wall start at points[i+1]
        const outL = { x: points[i+1].x + nextSeg.nx * halfW, y: points[i+1].y + nextSeg.ny * halfW };
        const outR = { x: points[i+1].x - nextSeg.nx * halfW, y: points[i+1].y - nextSeg.ny * halfW };
  
        // Control point: intersection of extended incoming wall line and extended outgoing wall line
        const cpL = lineLineIntersect(
          endL, { x: seg.ux, y: seg.uy },
          outL, { x: -nextSeg.ux, y: -nextSeg.uy }
        );
        const cpR = lineLineIntersect(
          endR, { x: seg.ux, y: seg.uy },
          outR, { x: -nextSeg.ux, y: -nextSeg.uy }
        );
  
        if (cpL) {
          leftPath.push({ type: 'Q', cpx: cpL.x, cpy: cpL.y, x: outL.x, y: outL.y });
        } else {
          leftPath.push({ type: 'L', x: outL.x, y: outL.y });
        }
        if (cpR) {
          rightPath.push({ type: 'Q', cpx: cpR.x, cpy: cpR.y, x: outR.x, y: outR.y });
        } else {
          rightPath.push({ type: 'L', x: outR.x, y: outR.y });
        }
      }
    }
  
    // Step 3: Render wall paths
    mCtx.save();
    mCtx.strokeStyle = color;
    mCtx.lineWidth = 2.5;
    mCtx.setLineDash([]);
    mCtx.globalAlpha = 1.0;
  
    function renderPath(path) {
      mCtx.beginPath();
      for (const cmd of path) {
        if (cmd.type === 'M') mCtx.moveTo(cmd.x, cmd.y);
        else if (cmd.type === 'L') mCtx.lineTo(cmd.x, cmd.y);
        else if (cmd.type === 'Q') mCtx.quadraticCurveTo(cmd.cpx, cmd.cpy, cmd.x, cmd.y);
      }
      mCtx.stroke();
    }
  
    renderPath(leftPath);
    renderPath(rightPath);
  
    // End caps
    const firstL = leftPath[0], firstR = rightPath[0];
    mCtx.beginPath();
    mCtx.moveTo(firstL.x, firstL.y);
    mCtx.lineTo(firstR.x, firstR.y);
    mCtx.stroke();
  
    const lastL = leftPath[leftPath.length - 1];
    const lastR = rightPath[rightPath.length - 1];
    mCtx.beginPath();
    mCtx.moveTo(lastL.x, lastL.y);
    mCtx.lineTo(lastR.x, lastR.y);
    mCtx.stroke();
  
    // Step 4: Spiral seam lines (only on straight segments)
    if (isSpiral) {
      mCtx.lineWidth = 1.5;
      mCtx.globalAlpha = 0.8;
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        const sw = segWalls[i];
        const pitch = halfW * 2.5;
        const numSeams = Math.floor(seg.len / pitch);
        for (let s = 1; s <= numSeams; s++) {
          const t1 = (s - 0.5) / (numSeams + 1);
          const t2 = (s + 0.5) / (numSeams + 1);
          const x1 = sw.startL.x + (sw.endL.x - sw.startL.x) * t1;
          const y1 = sw.startL.y + (sw.endL.y - sw.startL.y) * t1;
          const x2 = sw.startR.x + (sw.endR.x - sw.startR.x) * t2;
          const y2 = sw.startR.y + (sw.endR.y - sw.startR.y) * t2;
          mCtx.beginPath();
          mCtx.moveTo(x1, y1);
          mCtx.lineTo(x2, y2);
          mCtx.stroke();
        }
      }
      mCtx.globalAlpha = 1.0;
    }
  
    // Step 5: Internal liner for rectangular duct
    const linerInches = (duct.liner && duct.type === 'rect') ? duct.liner : 0;
    if (linerInches > 0) {
      const linerPx = inchesToPx(linerInches);
      if (linerPx > 1) {
        const innerHalfW = halfW - linerPx;
        if (innerHalfW > 1) {
          // Build inner wall paths (same logic as outer but with reduced offset)
          const innerLeftPath = [];
          const innerRightPath = [];
          const s0i = segs[0];
          innerLeftPath.push({ type: 'M', x: points[0].x + s0i.nx * innerHalfW, y: points[0].y + s0i.ny * innerHalfW });
          innerRightPath.push({ type: 'M', x: points[0].x - s0i.nx * innerHalfW, y: points[0].y - s0i.ny * innerHalfW });
  
          for (let i = 0; i < segs.length; i++) {
            const seg = segs[i];
            const endLi = { x: points[i+1].x + seg.nx * innerHalfW, y: points[i+1].y + seg.ny * innerHalfW };
            const endRi = { x: points[i+1].x - seg.nx * innerHalfW, y: points[i+1].y - seg.ny * innerHalfW };
            innerLeftPath.push({ type: 'L', x: endLi.x, y: endLi.y });
            innerRightPath.push({ type: 'L', x: endRi.x, y: endRi.y });
            if (i < segs.length - 1) {
              const ns = segs[i+1];
              const outLi = { x: points[i+1].x + ns.nx * innerHalfW, y: points[i+1].y + ns.ny * innerHalfW };
              const outRi = { x: points[i+1].x - ns.nx * innerHalfW, y: points[i+1].y - ns.ny * innerHalfW };
              const cpLi = lineLineIntersect(endLi, {x:seg.ux,y:seg.uy}, outLi, {x:-ns.ux,y:-ns.uy});
              const cpRi = lineLineIntersect(endRi, {x:seg.ux,y:seg.uy}, outRi, {x:-ns.ux,y:-ns.uy});
              innerLeftPath.push(cpLi ? { type:'Q', cpx:cpLi.x, cpy:cpLi.y, x:outLi.x, y:outLi.y } : { type:'L', x:outLi.x, y:outLi.y });
              innerRightPath.push(cpRi ? { type:'Q', cpx:cpRi.x, cpy:cpRi.y, x:outRi.x, y:outRi.y } : { type:'L', x:outRi.x, y:outRi.y });
            }
          }
  
          // Draw inner walls (thinner line)
          mCtx.lineWidth = 1.5;
          mCtx.globalAlpha = 0.9;
          renderPath(innerLeftPath);
          renderPath(innerRightPath);
  
          // Inner end caps
          const fiL = innerLeftPath[0], fiR = innerRightPath[0];
          mCtx.beginPath(); mCtx.moveTo(fiL.x, fiL.y); mCtx.lineTo(fiR.x, fiR.y); mCtx.stroke();
          const liL = innerLeftPath[innerLeftPath.length-1], liR = innerRightPath[innerRightPath.length-1];
          mCtx.beginPath(); mCtx.moveTo(liL.x, liL.y); mCtx.lineTo(liR.x, liR.y); mCtx.stroke();
  
          // Cross-hatch between outer and inner walls per segment
          // Standard drafting: diagonal lines at ~45° in the liner zone
          mCtx.lineWidth = 0.8;
          mCtx.globalAlpha = 0.5;
          for (let i = 0; i < segs.length; i++) {
            const seg = segs[i];
            const sw = segWalls[i];
            const hatchSpacing = linerPx * 2.5;
            const numH = Math.max(1, Math.floor(seg.len / hatchSpacing));
            for (let h = 0; h <= numH; h++) {
              const t = h / (numH + 1);
              // Left wall hatch: outer to inner
              const oLx = sw.startL.x + (sw.endL.x - sw.startL.x) * t;
              const oLy = sw.startL.y + (sw.endL.y - sw.startL.y) * t;
              const iLx = oLx - seg.nx * linerPx;
              const iLy = oLy - seg.ny * linerPx;
              mCtx.beginPath(); mCtx.moveTo(oLx, oLy); mCtx.lineTo(iLx + seg.ux * linerPx * 0.7, iLy + seg.uy * linerPx * 0.7); mCtx.stroke();
              // Right wall hatch: outer to inner
              const oRx = sw.startR.x + (sw.endR.x - sw.startR.x) * t;
              const oRy = sw.startR.y + (sw.endR.y - sw.startR.y) * t;
              const iRx = oRx + seg.nx * linerPx;
              const iRy = oRy + seg.ny * linerPx;
              mCtx.beginPath(); mCtx.moveTo(oRx, oRy); mCtx.lineTo(iRx + seg.ux * linerPx * 0.7, iRy + seg.uy * linerPx * 0.7); mCtx.stroke();
            }
          }
          mCtx.globalAlpha = 1.0;
          mCtx.lineWidth = 2.5;
        }
      }
    }
  
    mCtx.restore();
  }
  

  function drawAutoHangersForMeasurement(m) {
    if (!m || !m.duct) return;
    const markers = getAutoHangerMarkers(m);
    if (markers.length === 0) return;
    const selected = getSelectedHangerMeasId() === m.id;
    const preview = markers[0].preview;
    const color = selected ? '#e94560' : '#ffaa00';
    const halfW = Math.max(1.5, getDuctHalfWidthPx(m.duct));
    const edgePad = Math.max(1, Math.min(4, halfW * 0.15));
    const markerHalf = halfW + edgePad;
  
    mCtx.save();
    mCtx.setLineDash([]);
    mCtx.globalAlpha = selected ? 1 : 0.88;
  
    for (const mk of markers) {
      drawHangerSymbol(mk, preview.rule.hangerKey, markerHalf, color, selected);
    }
  
    if (selected) {
      const first = markers[0];
      const label = `${getHangerLabel(preview.rule.hangerKey)} ${m.duct.dims || ''}`;
      const detail = preview.wireTotal
        ? `${markers.length} @ ${preview.rule.spacingFt}ft • wire ${preview.wireTotal.toFixed(1)} LF`
        : (preview.strapTotal ? `${markers.length} @ ${preview.rule.spacingFt}ft • ${preview.strapTotal.toFixed(1)} LF` : `${markers.length} @ ${preview.rule.spacingFt}ft`);
      const text = `${label} | ${detail}`;
      const targetFontSize = Math.max(6, Math.min(getAnnoSettings().annoSize, 10)) * getBaseScale();
      const renderFontSize = Math.max(20, targetFontSize);
      const labelScale = targetFontSize / renderFontSize;
      mCtx.font = `bold ${renderFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
      const tw = mCtx.measureText(text).width;
      const pad = 4 * (renderFontSize / 14);
      const defX = first.x + first.nx * (markerHalf + 12);
      const defY = first.y + first.ny * (markerHalf + 12);
      if (!m._hangerLabelDefault) m._hangerLabelDefault = {};
      m._hangerLabelDefault.x = defX;
      m._hangerLabelDefault.y = defY;
      const lx = defX + ((m.hangerLabelOffset && m.hangerLabelOffset.dx) || 0);
      const ly = defY + ((m.hangerLabelOffset && m.hangerLabelOffset.dy) || 0);
  
      mCtx.save();
      mCtx.translate(lx, ly);
      mCtx.scale(labelScale, labelScale);
      mCtx.globalAlpha = Math.max(0.75, getAnnoSettings().annoFillOpacity);
      mCtx.fillStyle = 'rgba(22,33,62,0.95)';
      mCtx.beginPath();
      mCtx.roundRect(-pad, -renderFontSize - pad, tw + pad * 2, renderFontSize + pad * 2, 4);
      mCtx.fill();
      mCtx.strokeStyle = '#e94560';
      mCtx.lineWidth = 1 / labelScale;
      mCtx.stroke();
      mCtx.globalAlpha = getAnnoSettings().annoTextOpacity;
      mCtx.fillStyle = '#ffffff';
      mCtx.textBaseline = 'alphabetic';
      mCtx.fillText(text, 0, 0);
      mCtx.restore();
  
      m._hangerLabelBox = {
        x: lx - (pad * labelScale),
        y: ly - ((renderFontSize + pad) * labelScale),
        w: (tw + pad * 2) * labelScale,
        h: (renderFontSize + pad * 2) * labelScale
      };
    } else {
      m._hangerLabelBox = null;
    }
  
    mCtx.restore();
  }
  
  function drawHangerSymbol(mk, hangerKey, markerHalf, color, selected) {
    const angle = Math.atan2(mk.uy, mk.ux);
    const crossSpan = markerHalf;
    const bandHalf = Math.max(1.5, Math.min(3, crossSpan * 0.12));
    const tab = Math.max(2, Math.min(5, crossSpan * 0.18));
    const lw = selected ? 3 : 2;
    const family = (HANGER_DEFAULTS.types && HANGER_DEFAULTS.types[hangerKey] && HANGER_DEFAULTS.types[hangerKey].family) || '';
  
    mCtx.save();
    mCtx.translate(mk.x, mk.y);
    mCtx.rotate(angle);
    mCtx.strokeStyle = color;
    mCtx.fillStyle = color;
    mCtx.lineWidth = lw;
    mCtx.lineCap = 'round';
    mCtx.lineJoin = 'round';
  
    if (hangerKey === 'hanger-spiral-wire' || family === 'wire') {
      // Plan view: exposed spiral wire has upper/lower pickup points and a light cable path across the duct.
      const wireY = crossSpan + tab * 0.55;
      mCtx.setLineDash([tab * 0.45, tab * 0.35]);
      mCtx.beginPath();
      mCtx.moveTo(0, -wireY);
      mCtx.lineTo(0, wireY);
      mCtx.stroke();
      mCtx.setLineDash([]);
      mCtx.beginPath();
      mCtx.arc(0, -wireY, tab * 0.5, 0, Math.PI * 2);
      mCtx.arc(0, wireY, tab * 0.5, 0, Math.PI * 2);
      mCtx.fill();
      mCtx.beginPath();
      mCtx.moveTo(-tab * 0.85, -wireY);
      mCtx.lineTo(tab * 0.85, -wireY);
      mCtx.moveTo(-tab * 0.85, wireY);
      mCtx.lineTo(tab * 0.85, wireY);
      mCtx.stroke();
      mCtx.beginPath();
      mCtx.arc(0, 0, tab * 0.28, 0, Math.PI * 2);
      mCtx.stroke();
    } else if (hangerKey === 'hanger-strap' || family === 'strap') {
      // Plan view: a narrow strap band crossing over the duct at this station.
      mCtx.globalAlpha *= 0.22;
      mCtx.fillRect(-bandHalf, -crossSpan, bandHalf * 2, crossSpan * 2);
      mCtx.globalAlpha = selected ? 1 : 0.88;
      mCtx.beginPath();
      mCtx.moveTo(-bandHalf, -crossSpan);
      mCtx.lineTo(-bandHalf, crossSpan);
      mCtx.moveTo(bandHalf, -crossSpan);
      mCtx.lineTo(bandHalf, crossSpan);
      mCtx.moveTo(-tab, -crossSpan);
      mCtx.lineTo(tab, -crossSpan);
      mCtx.moveTo(-tab, crossSpan);
      mCtx.lineTo(tab, crossSpan);
      mCtx.stroke();
    } else if (hangerKey === 'hanger-trapeze' || family === 'trapeze') {
      // Plan view: strut/channel crossbar with rod/anchor points outside duct edges.
      const rodY = crossSpan + tab * 0.65;
      const channelHalf = crossSpan + tab;
      const channelThick = Math.max(3, bandHalf * 0.9);
      mCtx.fillRect(-channelThick * 0.5, -channelHalf, channelThick, channelHalf * 2);
      mCtx.beginPath();
      mCtx.moveTo(0, -rodY);
      mCtx.lineTo(0, rodY);
      mCtx.moveTo(-tab * 0.75, -rodY);
      mCtx.lineTo(tab * 0.75, -rodY);
      mCtx.moveTo(-tab * 0.75, rodY);
      mCtx.lineTo(tab * 0.75, rodY);
      mCtx.stroke();
      mCtx.beginPath();
      mCtx.arc(0, -rodY, tab * 0.42, 0, Math.PI * 2);
      mCtx.arc(0, rodY, tab * 0.42, 0, Math.PI * 2);
      mCtx.fill();
    } else if (hangerKey === 'hanger-threaded-rod' || family === 'rod') {
      // Plan view: paired rod pickup points on each side of the duct.
      const rodY = crossSpan + tab * 0.35;
      mCtx.beginPath();
      mCtx.moveTo(0, -rodY);
      mCtx.lineTo(0, rodY);
      mCtx.stroke();
      mCtx.beginPath();
      mCtx.arc(0, -rodY, tab * 0.45, 0, Math.PI * 2);
      mCtx.arc(0, rodY, tab * 0.45, 0, Math.PI * 2);
      mCtx.fill();
      mCtx.fillRect(-bandHalf * 0.7, -crossSpan, bandHalf * 1.4, crossSpan * 2);
    } else if (family === 'clevis' || family === 'ring') {
      // Plan view: round band/clamp centered on the run.
      mCtx.beginPath();
      mCtx.ellipse(0, 0, crossSpan * 0.34, crossSpan * 0.78, 0, 0, Math.PI * 2);
      mCtx.stroke();
      mCtx.beginPath();
      mCtx.arc(0, -crossSpan * 0.88, tab * 0.36, 0, Math.PI * 2);
      mCtx.arc(0, crossSpan * 0.88, tab * 0.36, 0, Math.PI * 2);
      mCtx.fill();
    } else if (family === 'hardware') {
      // Plan view hardware allowance: compact anchor/part marker at the station.
      mCtx.beginPath();
      mCtx.rect(-tab * 0.5, -tab * 0.5, tab, tab);
      mCtx.moveTo(-tab * 0.75, 0);
      mCtx.lineTo(tab * 0.75, 0);
      mCtx.moveTo(0, -tab * 0.75);
      mCtx.lineTo(0, tab * 0.75);
      mCtx.stroke();
    } else {
      // Plan view generic support: crossbar through the duct with centered pickup.
      mCtx.beginPath();
      mCtx.moveTo(0, -crossSpan);
      mCtx.lineTo(0, crossSpan);
      mCtx.moveTo(-tab, 0);
      mCtx.lineTo(tab, 0);
      mCtx.stroke();
      mCtx.beginPath();
      mCtx.arc(0, 0, tab * 0.42, 0, Math.PI * 2);
      mCtx.fill();
    }
  
    if (selected) {
      mCtx.strokeStyle = 'rgba(233,69,96,0.25)';
      mCtx.lineWidth = Math.max(6, lw * 2);
      mCtx.beginPath();
      mCtx.ellipse(0, 0, tab * 1.35, crossSpan + tab, 0, 0, Math.PI * 2);
      mCtx.stroke();
    }
  
    mCtx.restore();
  }
  

  // ---- Fitting rendering functions ----
  
  function drawFitting(f, isSelected, isMultiSelected) {
    const D = inchesToPx(parseDimension(f.sizeA));
    const D2 = f.sizeB ? inchesToPx(parseDimension(f.sizeB)) : D * 0.7;
    const rot = (f.rotation || 0) * Math.PI / 180;
    const isRoundFitting = getFittingShape(f) === 'round' && f.type !== 'hvac_component';
    const isSpiralFitting = isRoundFitting && (f.roundType || 'spiral') === 'spiral';
  
    mCtx.save();
    mCtx.translate(f.x, f.y);
    mCtx.rotate(rot);
    if (f.mirrored) mCtx.scale(1, -1);
    mCtx.strokeStyle = isSelected ? '#e94560' : isMultiSelected ? '#ffd43b' : '#00ff88';
    mCtx.lineWidth = 2.5;
    mCtx.setLineDash([]);
    mCtx.lineJoin = 'round';
    mCtx.lineCap = 'round';
  
    switch (f.type) {
      case '90el': drawElbow(D, Math.PI / 2); break;
      case '45el': drawElbow(D, Math.PI / 4); break;
      case '22el': drawElbow(D, Math.PI / 8); break;
      case 'tee': drawTee(D, D2); break;
      case 'saddle45y': drawSaddle45Y(D, D2); break;
      case 'lateral': drawLateral(D, D2); break;
      case 'wye': drawWye(D, D2); break;
      case 'reducer': drawReducer(D, D2, false); break;
      case 'eccReducer': drawReducer(D, D2, true); break;
      case 'endcap': drawEndCap(D); break;
      case 'coupling': drawCoupling(D); break;
      case 'transition': drawTransition(D, D2); break;
      case 'sqwing': drawSquareWing(D); break;
      case 'rectTap': drawRectTap(D, D2); break;
      case 'boot': drawBoot(D, D2); break;
      case 'hvac_component': drawHvacMarker(f); break;
    }
    if (isSpiralFitting) drawSpiralFittingSeams(f.type, D, D2);
  
    mCtx.restore();
  
    // Draw selection indicators
    if (isSelected) {
      mCtx.save();
      mCtx.setLineDash([4, 4]);
      mCtx.strokeStyle = '#e94560';
      mCtx.lineWidth = 1.5;
      const r = getFittingBoundingRadius(f);
      mCtx.beginPath();
      mCtx.arc(f.x, f.y, r, 0, Math.PI * 2);
      mCtx.stroke();
      mCtx.setLineDash([]);
      mCtx.restore();
    }
  
    // Label (suppressed for fittings inside vertical stacks - they use callout annotations instead)
    if (!f._noLabel) {
      const roundPrefix = isRoundFitting ? ((f.roundType || 'spiral') === 'spiral' ? 'SPR ' : 'SNP ') : '';
      const labelText = f.label || (roundPrefix + getFittingNames()[f.type] + ' ' + f.sizeA + (f.sizeB ? '/' + f.sizeB : ''));
      const fontSize = Math.max(8, D * 0.3);
      mCtx.save();
      mCtx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
      mCtx.textAlign = 'center';
      mCtx.textBaseline = 'top';
      const labelY = f.y + getFittingBoundingRadius(f) * 0.6;
      const tw = mCtx.measureText(labelText).width;
      mCtx.fillStyle = 'rgba(22, 33, 62, 0.85)';
      mCtx.beginPath();
      mCtx.roundRect(f.x - tw/2 - 3, labelY - 2, tw + 6, fontSize + 4, 3);
      mCtx.fill();
      mCtx.fillStyle = '#e0e0e0';
      mCtx.fillText(labelText, f.x, labelY);
      mCtx.restore();
    }
  }
  
  function drawSpiralFittingSeams(type, D, D2) {
    const halfW = D / 2;
    const halfB = D2 / 2;
    const seamColor = mCtx.strokeStyle;
    mCtx.save();
    mCtx.strokeStyle = seamColor;
    mCtx.lineWidth = 1.1;
    mCtx.globalAlpha = 0.72;
    mCtx.setLineDash([]);
  
    function seamOnRun(x, y, half, angle) {
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      const nx = -uy;
      const ny = ux;
      const skew = half * 0.45;
      mCtx.beginPath();
      mCtx.moveTo(x - nx * half - ux * skew, y - ny * half - uy * skew);
      mCtx.lineTo(x + nx * half + ux * skew, y + ny * half + uy * skew);
      mCtx.stroke();
    }
  
    function seamAt(x, y, half) {
      seamOnRun(x, y, half, 0);
    }
  
    function capSeam(x1, y1, x2, y2) {
      mCtx.beginPath();
      mCtx.moveTo(x1, y1);
      mCtx.lineTo(x2, y2);
      mCtx.stroke();
    }
  
    function drawElbowSeams(sweep) {
      const CLR = D * 1.5;
      const innerR = D;
      const outerR = D * 2;
      const arcStart = -Math.PI / 2;
      const pad = Math.max(2, D * 0.08);
      const count = Math.max(1, Math.ceil(sweep / (Math.PI / 6)));
      for (let i = 1; i <= count; i++) {
        const a = arcStart + sweep * (i / (count + 1));
        const rx = Math.cos(a);
        const ry = Math.sin(a);
        const tx = -Math.sin(a);
        const ty = Math.cos(a);
        const skew = D * 0.08;
        mCtx.beginPath();
        mCtx.moveTo(rx * (innerR + pad) - tx * skew, CLR + ry * (innerR + pad) - ty * skew);
        mCtx.lineTo(rx * (outerR - pad) + tx * skew, CLR + ry * (outerR - pad) + ty * skew);
        mCtx.stroke();
      }
    }
  
    if (type === '90el' || type === '45el' || type === '22el') {
      const sweep = type === '90el' ? Math.PI / 2 : (type === '45el' ? Math.PI / 4 : Math.PI / 8);
      seamAt(-D * 0.25, 0, halfW);
      drawElbowSeams(sweep);
      mCtx.restore();
      return;
    }
  
    if (type === 'endcap') {
      capSeam(D * 0.06, -halfW * 0.55, D * 0.2, halfW * 0.55);
      mCtx.restore();
      return;
    }
  
    if (type === 'coupling') {
      seamAt(-D * 0.24, 0, halfW * 0.75);
      seamAt(D * 0.24, 0, halfW * 0.75);
      seamOnRun(0, 0, halfW * 1.08, Math.PI / 2);
      mCtx.restore();
      return;
    }
  
    if (type === 'reducer' || type === 'eccReducer') {
      const len = Math.abs(D - D2) * 1.5 || D;
      const xLimit = len * 0.22;
      seamAt(-xLimit, 0, halfW * 0.75);
      seamAt(xLimit, 0, Math.max(2, halfB * 0.75));
      mCtx.restore();
      return;
    }
  
    if (type === 'transition') {
      const len = Math.max(D, D2) * 1.5;
      const xLimit = len * 0.32;
      seamAt(-xLimit, 0, halfW * 0.72);
      seamAt(xLimit, 0, Math.max(2, halfB * 0.72));
      mCtx.restore();
      return;
    }
  
    if (type === 'wye') {
      seamAt(-D * 0.45, 0, halfW * 0.75);
      seamOnRun(D * 0.65, -D * 0.85, halfB, -Math.PI / 6);
      seamOnRun(D * 0.65, D * 0.85, halfB, Math.PI / 6);
      mCtx.restore();
      return;
    }
  
    if (type === 'saddle45y') {
      // Saddle taps keep the main duct clean; only the takeoff branch shows spiral detail.
      seamOnRun(D * 0.58, -D * 0.58, halfB * 0.75, -Math.PI / 4);
      seamOnRun(D * 0.95, -D * 0.95, halfB * 0.75, -Math.PI / 4);
      mCtx.restore();
      return;
    }
  
    const mainXs = [-D * 0.9, -D * 0.25, D * 0.4, D * 0.95];
    for (const x of mainXs) seamAt(x, 0, halfW);
  
    if (type === 'tee') {
      seamOnRun(0, D * 1.05, halfB, Math.PI / 2);
    } else if (type === 'lateral') {
      seamOnRun(D * 0.65, D * 1.15, halfB, Math.PI / 4);
    }
  
    mCtx.restore();
  }
  
  function drawHvacMarker(f) {
    const W = inchesToPx(parseFloat(f.sizeA) || 24);
    const H = inchesToPx(parseFloat(f.sizeB) || 16);
    const hw = W / 2, hh = H / 2;
    const cat = f.hvacCategory || 'equipment';
    const typ = (f.hvacType || '').toLowerCase();
  
    // Category-specific rendering
    if (cat === 'equipment' || cat === 'makeup-air' || cat === 'energy-recovery') {
      _drawRTUSymbol(hw, hh, typ);
    } else if (cat === 'fan') {
      _drawFanSymbol(hw, hh, typ);
    } else if (cat === 'air-distribution') {
      _drawDiffuserSymbol(hw, hh, typ);
    } else if (cat === 'terminal') {
      _drawTerminalSymbol(hw, hh);
    } else if (cat === 'heating') {
      _drawHeaterSymbol(hw, hh);
    } else if (cat === 'specialty') {
      _drawSpecialtySymbol(hw, hh, typ);
    } else {
      _drawGenericBox(hw, hh);
    }
  
    // Tag label below unit
    mCtx.save();
    mCtx.rotate(-(f.rotation || 0) * Math.PI / 180);
    const fontSize = Math.max(8, Math.min(14, W * 0.22));
    mCtx.font = `bold ${fontSize}px sans-serif`;
    mCtx.fillStyle = '#00ff88';
    mCtx.textAlign = 'center';
    mCtx.textBaseline = 'top';
    mCtx.fillText(f.hvacTag || 'HVAC', 0, hh + 4);
    mCtx.restore();
  }
  
  // ── Rooftop Unit / Package Unit / AHU (plan view: rectangle with supply+return circles) ──
  function _drawRTUSymbol(hw, hh, typ) {
    // Outer cabinet
    mCtx.fillStyle = 'rgba(40, 60, 100, 0.6)';
    mCtx.strokeStyle = '#4dabf7';
    mCtx.lineWidth = 1.5;
    _roundRect(-hw, -hh, hw * 2, hh * 2, 3);
    mCtx.fill();
    mCtx.stroke();
  
    // Internal divider (evaporator/condenser split)
    mCtx.beginPath();
    mCtx.moveTo(0, -hh);
    mCtx.lineTo(0, hh);
    mCtx.strokeStyle = 'rgba(77,171,247,0.4)';
    mCtx.lineWidth = 1;
    mCtx.stroke();
  
    // Supply opening (circle, left side)
    const portR = Math.min(hw, hh) * 0.28;
    mCtx.beginPath();
    mCtx.arc(-hw * 0.45, 0, portR, 0, Math.PI * 2);
    mCtx.fillStyle = 'rgba(0,255,136,0.3)';
    mCtx.fill();
    mCtx.strokeStyle = '#00ff88';
    mCtx.lineWidth = 1;
    mCtx.stroke();
  
    // Return opening (circle, right side)
    mCtx.beginPath();
    mCtx.arc(hw * 0.45, 0, portR, 0, Math.PI * 2);
    mCtx.fillStyle = 'rgba(77,171,247,0.2)';
    mCtx.fill();
    mCtx.strokeStyle = '#4dabf7';
    mCtx.stroke();
  
    // Fan symbol (small circle with blades in center-left)
    _drawMiniBlades(-hw * 0.45, 0, portR * 0.5);
  }
  
  // ── Fan (circle with blades) ──
  function _drawFanSymbol(hw, hh, typ) {
    const r = Math.min(hw, hh);
    const isExhaust = typ.includes('exhaust');
  
    // Housing (circle or square depending on mount type)
    if (typ.includes('curb') || typ.includes('roof') || typ.includes('centrifugal')) {
      // Square housing
      mCtx.fillStyle = 'rgba(40, 70, 50, 0.5)';
      mCtx.strokeStyle = '#69db7c';
      mCtx.lineWidth = 1.5;
      _roundRect(-hw, -hh, hw * 2, hh * 2, 3);
      mCtx.fill();
      mCtx.stroke();
    } else {
      // Circular housing
      mCtx.beginPath();
      mCtx.arc(0, 0, r, 0, Math.PI * 2);
      mCtx.fillStyle = 'rgba(40, 70, 50, 0.5)';
      mCtx.fill();
      mCtx.strokeStyle = '#69db7c';
      mCtx.lineWidth = 1.5;
      mCtx.stroke();
    }
  
    // Fan blades
    _drawMiniBlades(0, 0, r * 0.55);
  
    // Arrow showing airflow direction
    const arrowY = isExhaust ? -hh - 6 : hh + 6;
    const arrowDir = isExhaust ? -1 : 1;
    mCtx.beginPath();
    mCtx.moveTo(0, arrowDir > 0 ? hh : -hh);
    mCtx.lineTo(0, arrowY);
    mCtx.moveTo(-4, arrowY - arrowDir * 5);
    mCtx.lineTo(0, arrowY);
    mCtx.lineTo(4, arrowY - arrowDir * 5);
    mCtx.strokeStyle = '#69db7c';
    mCtx.lineWidth = 1.2;
    mCtx.stroke();
  }
  
  // ── Diffuser / Grille / Register (plan view: square or rectangular with vanes) ──
  function _drawDiffuserSymbol(hw, hh, typ) {
    const isLinear = typ.includes('linear') || typ.includes('slot');
    const isRound = typ.includes('round');
  
    if (isRound) {
      const r = Math.min(hw, hh);
      mCtx.beginPath();
      mCtx.arc(0, 0, r, 0, Math.PI * 2);
      mCtx.fillStyle = 'rgba(80, 70, 20, 0.4)';
      mCtx.fill();
      mCtx.strokeStyle = '#ffd43b';
      mCtx.lineWidth = 1.5;
      mCtx.stroke();
      // Concentric rings
      for (let i = 1; i <= 3; i++) {
        mCtx.beginPath();
        mCtx.arc(0, 0, r * i / 4, 0, Math.PI * 2);
        mCtx.strokeStyle = 'rgba(255,212,59,0.3)';
        mCtx.lineWidth = 0.7;
        mCtx.stroke();
      }
    } else {
      // Square/rectangular grille
      mCtx.fillStyle = 'rgba(80, 70, 20, 0.4)';
      mCtx.strokeStyle = '#ffd43b';
      mCtx.lineWidth = 1.5;
      _roundRect(-hw, -hh, hw * 2, hh * 2, 2);
      mCtx.fill();
      mCtx.stroke();
  
      // Vane lines
      const vaneCount = isLinear ? 2 : Math.max(2, Math.floor(hh * 2 / 8));
      mCtx.strokeStyle = 'rgba(255,212,59,0.35)';
      mCtx.lineWidth = 0.7;
      for (let i = 1; i < vaneCount; i++) {
        const y = -hh + (hh * 2 * i / vaneCount);
        mCtx.beginPath();
        mCtx.moveTo(-hw + 2, y);
        mCtx.lineTo(hw - 2, y);
        mCtx.stroke();
      }
    }
  }
  
  // ── Terminal Unit / VAV Box (rectangle with damper symbol) ──
  function _drawTerminalSymbol(hw, hh) {
    mCtx.fillStyle = 'rgba(70, 40, 80, 0.4)';
    mCtx.strokeStyle = '#da77f2';
    mCtx.lineWidth = 1.5;
    _roundRect(-hw, -hh, hw * 2, hh * 2, 3);
    mCtx.fill();
    mCtx.stroke();
  
    // Damper butterfly
    mCtx.beginPath();
    mCtx.moveTo(-hw * 0.6, -hh * 0.3);
    mCtx.lineTo(0, 0);
    mCtx.lineTo(-hw * 0.6, hh * 0.3);
    mCtx.moveTo(hw * 0.6, -hh * 0.3);
    mCtx.lineTo(0, 0);
    mCtx.lineTo(hw * 0.6, hh * 0.3);
    mCtx.strokeStyle = 'rgba(218,119,242,0.5)';
    mCtx.lineWidth = 1;
    mCtx.stroke();
  
    // Inlet circle
    mCtx.beginPath();
    mCtx.arc(-hw * 0.7, 0, Math.min(hw, hh) * 0.2, 0, Math.PI * 2);
    mCtx.strokeStyle = '#da77f2';
    mCtx.lineWidth = 1;
    mCtx.stroke();
  }
  
  // ── Heater (rectangle with heating element zigzag) ──
  function _drawHeaterSymbol(hw, hh) {
    mCtx.fillStyle = 'rgba(80, 30, 30, 0.4)';
    mCtx.strokeStyle = '#ff8787';
    mCtx.lineWidth = 1.5;
    _roundRect(-hw, -hh, hw * 2, hh * 2, 3);
    mCtx.fill();
    mCtx.stroke();
  
    // Heating element zigzag
    const segs = 5;
    const step = (hw * 1.6) / segs;
    mCtx.beginPath();
    mCtx.moveTo(-hw * 0.8, -hh * 0.3);
    for (let i = 0; i < segs; i++) {
      const x = -hw * 0.8 + step * (i + 0.5);
      const y = (i % 2 === 0) ? hh * 0.3 : -hh * 0.3;
      mCtx.lineTo(x, y);
    }
    mCtx.lineTo(hw * 0.8, -hh * 0.3);
    mCtx.strokeStyle = 'rgba(255,135,135,0.6)';
    mCtx.lineWidth = 1.2;
    mCtx.stroke();
  }
  
  // ── Specialty (damper, louver, etc) ──
  function _drawSpecialtySymbol(hw, hh, typ) {
    if (typ.includes('damper')) {
      // Damper: rectangle with butterfly
      mCtx.fillStyle = 'rgba(50, 60, 30, 0.4)';
      mCtx.strokeStyle = '#a9e34b';
      mCtx.lineWidth = 1.5;
      _roundRect(-hw, -hh, hw * 2, hh * 2, 2);
      mCtx.fill();
      mCtx.stroke();
      // Butterfly blades
      mCtx.beginPath();
      mCtx.moveTo(-hw * 0.7, -hh * 0.7);
      mCtx.lineTo(hw * 0.7, hh * 0.7);
      mCtx.moveTo(-hw * 0.7, hh * 0.7);
      mCtx.lineTo(hw * 0.7, -hh * 0.7);
      mCtx.strokeStyle = 'rgba(169,227,75,0.5)';
      mCtx.lineWidth = 1.5;
      mCtx.stroke();
    } else {
      _drawGenericBox(hw, hh);
    }
  }
  
  // ── Generic fallback ──
  function _drawGenericBox(hw, hh) {
    mCtx.fillStyle = 'rgba(40, 40, 60, 0.5)';
    mCtx.strokeStyle = '#a0a0c0';
    mCtx.lineWidth = 1.5;
    _roundRect(-hw, -hh, hw * 2, hh * 2, 3);
    mCtx.fill();
    mCtx.stroke();
    // X mark
    mCtx.beginPath();
    mCtx.moveTo(-hw * 0.6, -hh * 0.6);
    mCtx.lineTo(hw * 0.6, hh * 0.6);
    mCtx.moveTo(hw * 0.6, -hh * 0.6);
    mCtx.lineTo(-hw * 0.6, hh * 0.6);
    mCtx.strokeStyle = 'rgba(160,160,192,0.3)';
    mCtx.lineWidth = 1;
    mCtx.stroke();
  }
  
  // ── Shared helpers ──
  function _roundRect(x, y, w, h, r) {
    mCtx.beginPath();
    mCtx.moveTo(x + r, y);
    mCtx.lineTo(x + w - r, y);
    mCtx.arcTo(x + w, y, x + w, y + r, r);
    mCtx.lineTo(x + w, y + h - r);
    mCtx.arcTo(x + w, y + h, x + w - r, y + h, r);
    mCtx.lineTo(x + r, y + h);
    mCtx.arcTo(x, y + h, x, y + h - r, r);
    mCtx.lineTo(x, y + r);
    mCtx.arcTo(x, y, x + r, y, r);
    mCtx.closePath();
  }
  
  function _drawMiniBlades(cx, cy, r) {
    const bladeCount = 4;
    mCtx.save();
    mCtx.translate(cx, cy);
    for (let i = 0; i < bladeCount; i++) {
      const angle = (Math.PI * 2 * i / bladeCount);
      mCtx.beginPath();
      mCtx.ellipse(0, 0, r, r * 0.25, angle, 0, Math.PI);
      mCtx.fillStyle = 'rgba(200,220,255,0.25)';
      mCtx.fill();
      mCtx.strokeStyle = 'rgba(200,220,255,0.5)';
      mCtx.lineWidth = 0.7;
      mCtx.stroke();
    }
    // Hub
    mCtx.beginPath();
    mCtx.arc(0, 0, r * 0.15, 0, Math.PI * 2);
    mCtx.fillStyle = 'rgba(200,220,255,0.4)';
    mCtx.fill();
    mCtx.restore();
  }
  
  function drawElbow(D, sweep) {
    // SMACNA round elbow: entry from left, turns downward (CW) by sweep angle
    // CLR = 1.5D, inner throat = CLR - D/2 = D, outer heel = CLR + D/2 = 2D
    const halfW = D / 2;
    const CLR = D * 1.5;
    const innerR = CLR - halfW; // = D
    const outerR = CLR + halfW; // = 2D
    const stub = D * 0.5;
  
    // Arc center: entry duct comes from left along y=0 centerline.
    // The turn goes downward, so arc center is BELOW the centerline at (0, CLR).
    const cx = 0, cy = CLR;
  
    // Entry tangent point is where the arc meets the incoming duct.
    // At the arc center (0, CLR), the point directly above at distance CLR is (0, 0) - the centerline.
    // Inner wall (top, closer to center) is at y = -halfW → distance from center = CLR - halfW = innerR ✓
    // Outer wall (bottom, farther from center) is at y = halfW → distance from center = CLR - halfW... no.
    // Wait: arc center is at (0, CLR). Top wall at y=-halfW: distance = CLR + halfW = outerR.
    // Bottom wall at y=halfW: distance = CLR - halfW = innerR.
    // So top wall = outer (heel), bottom wall = inner (throat). That's correct for a downward turn.
  
    // Arc angles: entry is at angle -PI/2 (pointing straight up from center).
    // For a 90° CW turn, sweep to angle 0 (pointing right from center).
    const arcStart = -Math.PI / 2;
    const arcEnd = -Math.PI / 2 + sweep;
  
    // Entry stub: horizontal duct coming from the left
    // Top wall (outer/heel)
    mCtx.beginPath();
    mCtx.moveTo(-stub, -halfW);
    mCtx.lineTo(0, -halfW);
    mCtx.stroke();
    // Bottom wall (inner/throat)
    mCtx.beginPath();
    mCtx.moveTo(-stub, halfW);
    mCtx.lineTo(0, halfW);
    mCtx.stroke();
    // Entry end cap
    mCtx.beginPath();
    mCtx.moveTo(-stub, -halfW);
    mCtx.lineTo(-stub, halfW);
    mCtx.stroke();
  
    // Inner arc (throat - bottom/inside of turn)
    mCtx.beginPath();
    mCtx.arc(cx, cy, innerR, arcStart, arcEnd, false);
    mCtx.stroke();
  
    // Outer arc (heel - top/outside of turn)
    mCtx.beginPath();
    mCtx.arc(cx, cy, outerR, arcStart, arcEnd, false);
    mCtx.stroke();
  
    // Exit: compute where arcs end
    const eiX = cx + innerR * Math.cos(arcEnd);
    const eiY = cy + innerR * Math.sin(arcEnd);
    const eoX = cx + outerR * Math.cos(arcEnd);
    const eoY = cy + outerR * Math.sin(arcEnd);
  
    // Exit direction: tangent to the arc at exit (perpendicular to radial)
    const edX = -Math.sin(arcEnd); // tangent direction
    const edY = Math.cos(arcEnd);
  
    // Exit stub walls
    mCtx.beginPath();
    mCtx.moveTo(eiX, eiY);
    mCtx.lineTo(eiX + edX * stub, eiY + edY * stub);
    mCtx.stroke();
    mCtx.beginPath();
    mCtx.moveTo(eoX, eoY);
    mCtx.lineTo(eoX + edX * stub, eoY + edY * stub);
    mCtx.stroke();
  
    // Exit end cap
    mCtx.beginPath();
    mCtx.moveTo(eiX + edX * stub, eiY + edY * stub);
    mCtx.lineTo(eoX + edX * stub, eoY + edY * stub);
    mCtx.stroke();
  }
  
  function drawTee(D, branchD) {
    const halfW = D / 2;
    const halfB = branchD / 2;
    const mainLen = D * 1.5;
    const branchLen = D * 1.5;
  
    // Main duct
    mCtx.beginPath();
    mCtx.moveTo(-mainLen, -halfW);
    mCtx.lineTo(mainLen, -halfW);
    mCtx.stroke();
    mCtx.beginPath();
    mCtx.moveTo(-mainLen, halfW);
    mCtx.lineTo(-halfB, halfW);
    mCtx.stroke();
    mCtx.beginPath();
    mCtx.moveTo(halfB, halfW);
    mCtx.lineTo(mainLen, halfW);
    mCtx.stroke();
  
    // End caps on main
    mCtx.beginPath();
    mCtx.moveTo(-mainLen, -halfW);
    mCtx.lineTo(-mainLen, halfW);
    mCtx.stroke();
    mCtx.beginPath();
    mCtx.moveTo(mainLen, -halfW);
    mCtx.lineTo(mainLen, halfW);
    mCtx.stroke();
  
    // Branch going down
    mCtx.beginPath();
    mCtx.moveTo(-halfB, halfW);
    mCtx.lineTo(-halfB, halfW + branchLen);
    mCtx.stroke();
    mCtx.beginPath();
    mCtx.moveTo(halfB, halfW);
    mCtx.lineTo(halfB, halfW + branchLen);
    mCtx.stroke();
  
    // Branch end cap
    mCtx.beginPath();
    mCtx.moveTo(-halfB, halfW + branchLen);
    mCtx.lineTo(halfB, halfW + branchLen);
    mCtx.stroke();
  }
  
  function drawRectTap(D, branchD) {
    // Straight Rectangular Tap - capacitor-style symbol
    // Two parallel perpendicular lines with empty space (gap) between them
    // Represents a cut/opening in ductwork where a branch taps in
    // Width of each line = branch dimension (sizeB), gap = scaled spacing
    const bD = (branchD && branchD > 0 && branchD !== D) ? branchD : D * 0.7;
    const halfB = bD / 2;
    const gap = bD * 0.3;  // empty space between the two plates
  
    // Left plate (perpendicular line)
    mCtx.beginPath();
    mCtx.moveTo(-gap / 2, -halfB);
    mCtx.lineTo(-gap / 2, halfB);
    mCtx.stroke();
  
    // Right plate (perpendicular line)
    mCtx.beginPath();
    mCtx.moveTo(gap / 2, -halfB);
    mCtx.lineTo(gap / 2, halfB);
    mCtx.stroke();
  }
  
  function drawSaddle45Y(D, branchD) {
    // SMACNA Saddle Tap 45° Wye - branch takeoff on main duct.
    // D = main duct diameter, branchD = branch diameter (0/empty/same → branch = D)
    // The main duct is shown as a horizontal line with an OPENING where the branch cuts through.
    // The branch angles at exactly 45° upward from the main.
    const halfW = D / 2;
    const bD = (branchD && branchD > 0 && branchD !== D) ? branchD : D;
    const halfB = bD / 2;
    const branchLen = bD * 2.0; // SMACNA standard ~2x branch diameter
  
    // Main duct extends left and right
    const mainHalf = D * 1.2;
    const tickH = halfW * 0.3;
  
    // End ticks on main
    mCtx.beginPath(); mCtx.moveTo(-mainHalf, -tickH); mCtx.lineTo(-mainHalf, tickH); mCtx.stroke();
    mCtx.beginPath(); mCtx.moveTo(mainHalf, -tickH); mCtx.lineTo(mainHalf, tickH); mCtx.stroke();
  
    // Branch at exactly 45° from the main duct centerline.
    // Direction vector: 45° up-right = (sin45, -cos45) = (0.707, -0.707)
    // Perpendicular to branch (for wall offset): (-dirY, dirX) = (cos45, sin45)
    const cos45 = Math.cos(Math.PI / 4);
    const sin45 = Math.sin(Math.PI / 4);
    const dirX = sin45, dirY = -cos45;
    const perpX = cos45, perpY = sin45; // perpendicular to branch direction
  
    // Branch starts at center of main line (0, 0).
    // Walls offset by halfB perpendicular to the branch direction.
    // Left wall start:
    const lSx = 0 - perpX * halfB;
    const lSy = 0 - perpY * halfB;
    // Right wall start:
    const rSx = 0 + perpX * halfB;
    const rSy = 0 + perpY * halfB;
  
    // Branch end points
    const lEx = lSx + dirX * branchLen;
    const lEy = lSy + dirY * branchLen;
    const rEx = rSx + dirX * branchLen;
    const rEy = rSy + dirY * branchLen;
  
    // Where each branch wall intersects the main line (y=0):
    // Left wall goes from (lSx, lSy) at 45°. Find where it crosses y=0 going backwards.
    // lSy is negative (below center), so the wall already starts below y=0.
    // We need the x-position where each wall line crosses y=0.
    // Left wall line: point (lSx, lSy) + t*(dirX, dirY). At y=0: lSy + t*dirY = 0 → t = -lSy/dirY
    const tL = -lSy / dirY;
    const lMainX = lSx + tL * dirX; // where left wall meets main line
    // Right wall: same calc
    const tR = -rSy / dirY;
    const rMainX = rSx + tR * dirX; // where right wall meets main line
  
    // Main duct line: continuous but trimmed at the branch opening
    // Left side: from left end to where left branch wall meets main
    mCtx.beginPath(); mCtx.moveTo(-mainHalf, 0); mCtx.lineTo(lMainX, 0); mCtx.stroke();
    // Right side: from where right branch wall meets main to right end
    mCtx.beginPath(); mCtx.moveTo(rMainX, 0); mCtx.lineTo(mainHalf, 0); mCtx.stroke();
  
    // Left branch wall: from its intersection on the main line up to branch end
    mCtx.beginPath(); mCtx.moveTo(lMainX, 0); mCtx.lineTo(lEx, lEy); mCtx.stroke();
  
    // Right branch wall: from its intersection on the main line up to branch end
    mCtx.beginPath(); mCtx.moveTo(rMainX, 0); mCtx.lineTo(rEx, rEy); mCtx.stroke();
  
    // Branch end cap
    mCtx.beginPath(); mCtx.moveTo(lEx, lEy); mCtx.lineTo(rEx, rEy); mCtx.stroke();
  }
  
  function drawLateral(D, branchD) {
    const halfW = D / 2;
    const halfB = branchD / 2;
    const mainLen = D * 1.5;
    const branchLen = D * 1.5;
    const angle = Math.PI / 4; // 45°
  
    // Main duct
    mCtx.beginPath();
    mCtx.moveTo(-mainLen, -halfW);
    mCtx.lineTo(mainLen, -halfW);
    mCtx.stroke();
    mCtx.beginPath();
    mCtx.moveTo(-mainLen, halfW);
    mCtx.lineTo(mainLen, halfW);
    mCtx.stroke();
    mCtx.beginPath();
    mCtx.moveTo(-mainLen, -halfW);
    mCtx.lineTo(-mainLen, halfW);
    mCtx.stroke();
    mCtx.beginPath();
    mCtx.moveTo(mainLen, -halfW);
    mCtx.lineTo(mainLen, halfW);
    mCtx.stroke();
  
    // Branch departing at 45° from center bottom
    const bx = Math.cos(angle) * branchLen;
    const by = Math.sin(angle) * branchLen;
    const perpX = -Math.sin(angle) * halfB;
    const perpY = Math.cos(angle) * halfB;
  
    mCtx.beginPath();
    mCtx.moveTo(perpX, halfW);
    mCtx.lineTo(perpX + bx, halfW + by + perpY);
    mCtx.stroke();
    mCtx.beginPath();
    mCtx.moveTo(-perpX, halfW);
    mCtx.lineTo(-perpX + bx, halfW + by - perpY);
    mCtx.stroke();
  
    // Branch end cap
    mCtx.beginPath();
    mCtx.moveTo(perpX + bx, halfW + by + perpY);
    mCtx.lineTo(-perpX + bx, halfW + by - perpY);
    mCtx.stroke();
  }
  
  function drawWye(D, branchD) {
    const halfW = D / 2;
    const halfB = branchD / 2;
    const entryLen = D * 0.8;
    const branchLen = D * 1.5;
    const angle = Math.PI / 6; // 30° each side
  
    // Entry stub
    mCtx.beginPath();
    mCtx.moveTo(-entryLen, -halfW);
    mCtx.lineTo(0, -halfW);
    mCtx.stroke();
    mCtx.beginPath();
    mCtx.moveTo(-entryLen, halfW);
    mCtx.lineTo(0, halfW);
    mCtx.stroke();
    mCtx.beginPath();
    mCtx.moveTo(-entryLen, -halfW);
    mCtx.lineTo(-entryLen, halfW);
    mCtx.stroke();
  
    // Upper branch
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    mCtx.beginPath();
    mCtx.moveTo(0, -halfW);
    mCtx.lineTo(cosA * branchLen, -halfW - sinA * branchLen);
    mCtx.stroke();
    mCtx.beginPath();
    mCtx.moveTo(0, -halfW + halfB * 2 * cosA);
    mCtx.lineTo(cosA * branchLen, -halfW + halfB * 2 * cosA - sinA * branchLen);
    mCtx.stroke();
  
    // Lower branch
    mCtx.beginPath();
    mCtx.moveTo(0, halfW);
    mCtx.lineTo(cosA * branchLen, halfW + sinA * branchLen);
    mCtx.stroke();
    mCtx.beginPath();
    mCtx.moveTo(0, halfW - halfB * 2 * cosA);
    mCtx.lineTo(cosA * branchLen, halfW - halfB * 2 * cosA + sinA * branchLen);
    mCtx.stroke();
  
    // Branch end caps
    mCtx.beginPath();
    mCtx.moveTo(cosA * branchLen, -halfW - sinA * branchLen);
    mCtx.lineTo(cosA * branchLen, -halfW + halfB * 2 * cosA - sinA * branchLen);
    mCtx.stroke();
    mCtx.beginPath();
    mCtx.moveTo(cosA * branchLen, halfW + sinA * branchLen);
    mCtx.lineTo(cosA * branchLen, halfW - halfB * 2 * cosA + sinA * branchLen);
    mCtx.stroke();
  }
  
  function drawReducer(D, D2, eccentric) {
    const halfW = D / 2;
    const halfW2 = D2 / 2;
    const len = Math.abs(D - D2) * 1.5 || D;
  
    if (eccentric) {
      // Bottom flat, top tapers
      mCtx.beginPath();
      mCtx.moveTo(-len/2, halfW);  // bottom-left
      mCtx.lineTo(len/2, halfW);   // bottom-right
      mCtx.stroke();
      mCtx.beginPath();
      mCtx.moveTo(-len/2, -halfW);  // top-left
      mCtx.lineTo(len/2, halfW - halfW2 * 2);  // top-right (tapered)
      mCtx.stroke();
    } else {
      // Symmetric taper
      mCtx.beginPath();
      mCtx.moveTo(-len/2, -halfW);
      mCtx.lineTo(len/2, -halfW2);
      mCtx.stroke();
      mCtx.beginPath();
      mCtx.moveTo(-len/2, halfW);
      mCtx.lineTo(len/2, halfW2);
      mCtx.stroke();
    }
  
    // End caps
    mCtx.beginPath();
    mCtx.moveTo(-len/2, -halfW);
    mCtx.lineTo(-len/2, halfW);
    mCtx.stroke();
    if (eccentric) {
      mCtx.beginPath();
      mCtx.moveTo(len/2, halfW);
      mCtx.lineTo(len/2, halfW - halfW2 * 2);
      mCtx.stroke();
    } else {
      mCtx.beginPath();
      mCtx.moveTo(len/2, -halfW2);
      mCtx.lineTo(len/2, halfW2);
      mCtx.stroke();
    }
  }
  
  function drawSquareWing(D) {
    // SMACNA Square-Throat (Square Wing) 90° Elbow for rectangular duct.
    // Entry from left, exit downward. No radius - sharp 90° outer corner.
    // Inner diagonal with turning vanes.
    const halfW = D / 2;
    const stub = D * 0.5;
  
    // Outer wall path: entry top → sharp corner → exit right wall
    // Entry comes from left, top wall at y = -halfW
    // After the turn, exit goes downward, right wall at x = halfW
  
    // Entry stub: horizontal from left
    // Top wall (outer wall through the turn)
    mCtx.beginPath();
    mCtx.moveTo(-halfW - stub, -halfW);
    mCtx.lineTo(halfW, -halfW);        // top wall runs to the sharp corner
    mCtx.lineTo(halfW, halfW + stub);   // outer wall turns 90° down
    mCtx.stroke();
  
    // Bottom wall (inner wall through the turn) - diagonal shortcut
    mCtx.beginPath();
    mCtx.moveTo(-halfW - stub, halfW);  // entry bottom wall
    mCtx.lineTo(-halfW, halfW);          // to the inner corner start
    mCtx.stroke();
  
    mCtx.beginPath();
    mCtx.moveTo(-halfW, halfW + stub);  // exit left wall
    mCtx.lineTo(-halfW, halfW);          // up to inner corner
    mCtx.stroke();
  
    // Inner diagonal (throat) connecting entry bottom to exit left
    mCtx.beginPath();
    mCtx.moveTo(-halfW, halfW);
    mCtx.lineTo(-halfW, halfW);          // this is the corner point
    mCtx.stroke();
    // Actually the inner throat is the diagonal from entry-inner-end to exit-inner-start:
    // From (-halfW, halfW) [end of entry bottom wall] to (-halfW, halfW) [start of exit left wall]
    // These are the same point! The inner wall meets at the corner.
  
    // Turning vanes: parallel diagonal lines inside the elbow
    // Vanes run from top-left to bottom-right across the turn
    // Standard SMACNA: equally spaced vanes between the inner corner and outer corner
    const numVanes = Math.max(2, Math.round(D / (D * 0.25))); // ~4 vanes
    for (let v = 1; v <= numVanes; v++) {
      const t = v / (numVanes + 1);
      // Vane start: on the entry bottom wall, between (-halfW, halfW) and (halfW*(t), -halfW + ...)
      // Actually vanes go from the inner diagonal toward the outer corner
      // They're parallel to the inner diagonal which goes from (-halfW, halfW) to (halfW, -halfW) conceptually
      // Each vane is at fraction t between inner and outer
      const vx1 = -halfW + t * (halfW - (-halfW)); // = -halfW + t * D
      const vy1 = halfW;                             // on the bottom/left inner wall
      const vx2 = halfW;                              // on the top/right outer wall
      const vy2 = -halfW + t * (halfW - (-halfW));   // = -halfW + t * D
      mCtx.beginPath();
      mCtx.moveTo(vx1, vy1);
      mCtx.lineTo(vx2, vy2);
      mCtx.stroke();
    }
  
    // Entry end cap
    mCtx.beginPath();
    mCtx.moveTo(-halfW - stub, -halfW);
    mCtx.lineTo(-halfW - stub, halfW);
    mCtx.stroke();
  
    // Exit end cap
    mCtx.beginPath();
    mCtx.moveTo(-halfW, halfW + stub);
    mCtx.lineTo(halfW, halfW + stub);
    mCtx.stroke();
  }
  
  function drawEndCap(D) {
    const halfW = D / 2;
    const depth = D * 0.25;
    mCtx.beginPath();
    mCtx.moveTo(0, -halfW);
    mCtx.lineTo(0, halfW);
    mCtx.lineTo(depth, halfW);
    mCtx.lineTo(depth, -halfW);
    mCtx.closePath();
    mCtx.stroke();
  }
  
  function drawCoupling(D) {
    const halfW = D / 2;
    const len = D * 1.2;
    const bandW = D * 0.15; // coupling band width
    // Outer sleeve (slightly wider than duct to show the coupling collar)
    const sleeveH = halfW * 1.15;
    mCtx.beginPath();
    mCtx.moveTo(-len/2, -halfW);
    mCtx.lineTo(-len/2, halfW);
    mCtx.stroke();
    mCtx.beginPath();
    mCtx.moveTo(len/2, -halfW);
    mCtx.lineTo(len/2, halfW);
    mCtx.stroke();
    // Top and bottom lines
    mCtx.beginPath();
    mCtx.moveTo(-len/2, -halfW);
    mCtx.lineTo(len/2, -halfW);
    mCtx.stroke();
    mCtx.beginPath();
    mCtx.moveTo(-len/2, halfW);
    mCtx.lineTo(len/2, halfW);
    mCtx.stroke();
    // Center band (the coupling collar / raised ring)
    mCtx.beginPath();
    mCtx.moveTo(-bandW, -sleeveH);
    mCtx.lineTo(-bandW, sleeveH);
    mCtx.lineTo(bandW, sleeveH);
    mCtx.lineTo(bandW, -sleeveH);
    mCtx.closePath();
    mCtx.stroke();
  }
  
  function drawTransition(D, D2) {
    const halfW = D / 2;
    const halfW2 = D2 / 2;
    const len = Math.max(D, D2) * 1.5;
  
    // Rect end (left)
    mCtx.beginPath();
    mCtx.moveTo(-len/2, -halfW);
    mCtx.lineTo(-len/2, halfW);
    mCtx.stroke();
  
    // Round end (right, shown as narrower rect in 2D)
    mCtx.beginPath();
    mCtx.moveTo(len/2, -halfW2);
    mCtx.lineTo(len/2, halfW2);
    mCtx.stroke();
  
    // Taper lines
    mCtx.beginPath();
    mCtx.moveTo(-len/2, -halfW);
    mCtx.lineTo(len/2, -halfW2);
    mCtx.stroke();
    mCtx.beginPath();
    mCtx.moveTo(-len/2, halfW);
    mCtx.lineTo(len/2, halfW2);
    mCtx.stroke();
  
    // Small circle at round end to indicate round
    mCtx.beginPath();
    mCtx.arc(len/2, 0, halfW2, 0, Math.PI * 2);
    mCtx.stroke();
  }
  
  function drawBoot(D, D2) {
    // Register boot in plan view: rectangle (face size) with X pattern
    // D = sizeA (width), D2 = sizeB (height, defaults to D if square)
    const hw = D / 2;
    const hh = D2 / 2;
  
    // Outer rectangle (register face)
    mCtx.strokeRect(-hw, -hh, D, D2);
  
    // X pattern inside (industry convention: register/diffuser in plan)
    mCtx.beginPath();
    mCtx.moveTo(-hw, -hh);
    mCtx.lineTo(hw, hh);
    mCtx.stroke();
    mCtx.beginPath();
    mCtx.moveTo(hw, -hh);
    mCtx.lineTo(-hw, hh);
    mCtx.stroke();
  
    // Inner rectangle (slightly inset — represents the register neck)
    const inset = Math.min(hw, hh) * 0.2;
    mCtx.globalAlpha = 0.5;
    mCtx.setLineDash([3, 3]);
    mCtx.strokeRect(-hw + inset, -hh + inset, D - inset * 2, D2 - inset * 2);
    mCtx.setLineDash([]);
    mCtx.globalAlpha = 1.0;
  }
  


  return {
    getDuctHalfWidthPx,
    drawFlexDuctRun,
    drawDuctRun,
    drawAutoHangersForMeasurement,
    drawHangerSymbol,
    drawFitting,
    drawSpiralFittingSeams
  };
}
