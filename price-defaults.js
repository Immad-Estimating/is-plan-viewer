// =====================================================
// IS Plan Viewer — Price & Labor Defaults
// =====================================================
// Centralized default data for material costs, labor hours,
// sheet metal reference, and shop settings.
// User overrides (stored in IndexedDB priceBook) always win.
// =====================================================

// ── Spiral duct & fitting material defaults ($/LF by gauge) ──────────
export const SPIRAL_DEFAULTS = {
  'duct-spiral-3':  { '26': 1.38, '22': 2.23 },
  'duct-spiral-4':  { '26': 1.60, '22': 2.81 },
  'duct-spiral-5':  { '26': 1.95, '22': 3.46 },
  'duct-spiral-6':  { '26': 2.55, '22': 4.13 },
  'duct-spiral-7':  { '26': 2.85, '22': 4.79 },
  'duct-spiral-8':  { '26': 3.35, '22': 5.45 },
  'duct-spiral-9':  { '26': 3.60, '22': 6.27 },
  'duct-spiral-10': { '26': 3.70, '22': 6.93 },
  'duct-spiral-11': { '26': 4.09, '22': 7.59 },
  'duct-spiral-12': { '26': 4.25, '22': 8.25 },
  'duct-spiral-13': { '26': 4.81, '22': 8.91 },
  'duct-spiral-14': { '26': 5.05, '22': 9.57 },
  'duct-spiral-15': { '26': 5.53, '22': 10.23 },
  'duct-spiral-16': { '26': 6.25, '22': 10.89 },
  'duct-spiral-17': { '26': 6.19, '22': 11.71 },
  'duct-spiral-18': { '26': 7.25, '22': 12.38 },
  'duct-spiral-20': { '26': 8.90, '24': 12.76, '22': 12.76 },
  'duct-spiral-22': { '26': 8.06, '24': 13.96, '22': 13.96 },
  'duct-spiral-24': { '26': 9.73, '24': 12.97, '22': 12.97 },
  'duct-spiral-26': { '26': 11.39, '24': 13.82, '22': 13.83 },
  'duct-spiral-28': { '26': 13.06, '24': 14.68, '22': 14.68 },
  'duct-spiral-30': { '26': 14.72, '24': 15.54, '22': 15.54 },
  'duct-spiral-32': { '26': 16.39, '24': 16.39, '22': 16.39 },
  'duct-spiral-34': { '26': 17.50, '24': 17.50, '22': 17.50 },
  'duct-spiral-36': { '26': 18.60, '24': 18.60, '22': 18.60 },
  // Spiral 90° Elbow pricing
  'spiral-90el-4':  { '26': 8.80 },
  'spiral-90el-5':  { '26': 12.17 },
  'spiral-90el-6':  { '26': 13.43 },
  'spiral-90el-7':  { '26': 16.22 },
  'spiral-90el-8':  { '26': 17.02 },
  'spiral-90el-9':  { '26': 26.17 },
  'spiral-90el-10': { '26': 26.29 },
  'spiral-90el-12': { '26': 34.87 },
  'spiral-90el-14': { '26': 41.35 },
  'spiral-90el-16': { '26': 106.71, '22': 17.26 },
  'spiral-90el-18': { '26': 125.44, '22': 24.36 },
  'spiral-90el-20': { '26': 157.03, '22': 27.63 },
  'spiral-90el-22': { '26': 197.93, '22': 42.48 },
  'spiral-90el-24': { '26': 212.14, '22': 46.67 },
  'spiral-90el-30': { '26': 95.00, '24': 95.00, '22': 95.00 },
  // Spiral 45° Elbow pricing
  'spiral-45el-4':  { '26': 13.58, '24': 13.58 },
  'spiral-45el-5':  { '26': 13.85, '24': 13.85 },
  'spiral-45el-6':  { '26': 14.33, '24': 14.33 },
  'spiral-45el-7':  { '26': 15.08, '24': 15.08 },
  'spiral-45el-8':  { '26': 19.47, '24': 19.47 },
  'spiral-45el-9':  { '26': 23.71, '24': 23.71 },
  'spiral-45el-10': { '26': 26.48, '24': 26.48 },
  'spiral-45el-12': { '26': 27.80, '24': 27.80 },
  'spiral-45el-14': { '26': 33.87, '24': 33.87 },
  'spiral-45el-16': { '26': 50.02, '24': 50.02 },
  'spiral-45el-18': { '26': 53.92, '24': 53.92 },
  'spiral-45el-20': { '26': 75.57, '24': 75.57 },
  'spiral-45el-22': { '26': 152.97, '24': 152.97 },
  'spiral-45el-24': { '26': 169.63, '24': 169.63 },
  // Spiral Tee pricing (main x branch, 26 ga)
  'spiral-tee-8x8':   { '26': 28.10 },
  'spiral-tee-10x10': { '26': 28.58 },
  'spiral-tee-12x12': { '26': 40.33 },
  'spiral-tee-14x14': { '26': 51.99 },
  'spiral-tee-16x16': { '26': 65.97 },
  'spiral-tee-18x18': { '26': 82.33 },
  'spiral-tee-20x20': { '26': 85.29 },
  // Spiral Coupling pricing
  'spiral-coupling-4':  { '26': 2.97 },
  'spiral-coupling-5':  { '26': 3.05 },
  'spiral-coupling-6':  { '26': 3.14 },
  'spiral-coupling-7':  { '26': 3.81 },
  'spiral-coupling-8':  { '26': 4.50 },
  'spiral-coupling-9':  { '26': 4.93 },
  'spiral-coupling-10': { '26': 5.93 },
  'spiral-coupling-12': { '26': 6.40 },
  'spiral-coupling-14': { '26': 7.54 },
  'spiral-coupling-16': { '26': 7.78, '24': 7.97 },
  'spiral-coupling-18': { '26': 8.75, '24': 9.54 },
  'spiral-coupling-20': { '26': 9.63, '24': 11.23 },
  'spiral-coupling-22': { '26': 11.15, '24': 13.05 },
  'spiral-coupling-24': { '26': 12.67, '24': 15.00 },
  'spiral-coupling-26': { '26': 14.10, '24': 14.10 },
  'spiral-coupling-28': { '26': 15.77 },
  'spiral-coupling-30': { '26': 18.90 },
  'spiral-coupling-32': { '26': 22.10 },
  'spiral-coupling-34': { '26': 25.43 },
  'spiral-coupling-36': { '26': 26.00 },
  // Spiral End Cap pricing
  'spiral-endcap-4':  { '26': 4.04 },
  'spiral-endcap-5':  { '26': 4.50 },
  'spiral-endcap-6':  { '26': 4.84 },
  'spiral-endcap-7':  { '26': 5.65 },
  'spiral-endcap-8':  { '26': 6.33 },
  'spiral-endcap-9':  { '26': 7.08 },
  'spiral-endcap-10': { '26': 7.35 },
  'spiral-endcap-12': { '24': 8.553 },
  'spiral-endcap-14': { '24': 9.557 },
  'spiral-endcap-16': { '24': 12.50 },
  'spiral-endcap-18': { '24': 13.85 },
  'spiral-endcap-20': { '22': 15.50 },
  'spiral-endcap-22': { '22': 25.85 },
  'spiral-endcap-24': { '22': 30.89 },
  // Spiral Concentric Reducer pricing
  'spiral-reducer-10': { '26': 20.95 },
  'spiral-reducer-12': { '26': 23.86 },
  'spiral-reducer-14': { '26': 26.74 },
  'spiral-reducer-16': { '26': 29.45 },
  'spiral-reducer-18': { '26': 32.17 },
  'spiral-reducer-20': { '26': 37.51 },
  'spiral-reducer-22': { '26': 40.41 },
  'spiral-reducer-28': { '26': 45.64 },
  'spiral-reducer-32': { '26': 49.13 },
  'spiral-reducer-36': { '26': 52.62 },
  // Spiral Wye fitting pricing
  'spiral-wye-4':  { '26': 14.03 },
  'spiral-wye-5':  { '26': 14.03 },
  'spiral-wye-6':  { '26': 14.03 },
  'spiral-wye-7':  { '26': 15.68 },
  'spiral-wye-8':  { '26': 16.50 },
  'spiral-wye-9':  { '26': 18.14 },
  'spiral-wye-10': { '26': 19.15 },
  'spiral-wye-12': { '26': 25.91 },
  'spiral-wye-14': { '26': 32.72 },
  'spiral-wye-16': { '26': 43.34 },
  'spiral-wye-18': { '26': 57.22 },
  'spiral-wye-20': { '26': 68.28 },
  'spiral-wye-22': { '26': 92.11 },
  'spiral-wye-24': { '26': 96.95 },
};

// ── Snaplock duct & fitting material defaults ($/LF by gauge) ─────────
export const SNAPLOCK_DEFAULTS = {
  // Snaplock 90° Elbow pricing
  'snaplock-90el-4':  { '26': 1.40 },
  'snaplock-90el-5':  { '26': 1.90 },
  'snaplock-90el-6':  { '26': 2.60 },
  'snaplock-90el-7':  { '26': 2.75 },
  'snaplock-90el-8':  { '26': 4.25 },
  'snaplock-90el-9':  { '26': 7.15 },
  'snaplock-90el-10': { '26': 6.14 },
  'snaplock-90el-12': { '26': 7.75 },
  'snaplock-90el-14': { '26': 9.50 },
  'snaplock-90el-16': { '26': 19.205, '24': 19.205 },
  'snaplock-90el-18': { '26': 24.224, '24': 24.224 },
  'snaplock-90el-20': { '26': 31.434, '24': 31.434 },
  'snaplock-90el-22': { '26': 62.11, '24': 62.11 },
  'snaplock-90el-24': { '26': 75.91, '24': 75.91 },
  'snaplock-90el-26': { '26': 80.17, '24': 406.83 },
  'snaplock-90el-28': { '26': 85.00 },
  'snaplock-90el-30': { '26': 90.00 },
  'snaplock-90el-32': { '26': 95.00 },
  // Snaplock 45° Elbow pricing (same as 90°)
  'snaplock-45el-4':  { '26': 1.40 },
  'snaplock-45el-5':  { '26': 1.90 },
  'snaplock-45el-6':  { '26': 2.60 },
  'snaplock-45el-7':  { '26': 2.75 },
  'snaplock-45el-8':  { '26': 4.25 },
  'snaplock-45el-9':  { '26': 7.15 },
  'snaplock-45el-10': { '26': 6.14 },
  'snaplock-45el-12': { '26': 7.75 },
  'snaplock-45el-14': { '26': 9.50 },
  'snaplock-45el-16': { '26': 19.205, '24': 19.205 },
  'snaplock-45el-18': { '26': 24.224, '24': 24.224 },
  'snaplock-45el-20': { '26': 31.434, '24': 31.434 },
  'snaplock-45el-22': { '26': 62.11, '24': 62.11 },
  'snaplock-45el-24': { '26': 75.91, '24': 75.91 },
  'snaplock-45el-26': { '26': 80.17, '24': 406.83 },
  'snaplock-45el-28': { '26': 85.00 },
  'snaplock-45el-30': { '26': 90.00 },
  'snaplock-45el-32': { '26': 95.00 },
  // Snaplock Saddle 45° Wye pricing
  'snaplock-saddle45y-4':  { '26': 3.51, '24': 3.51 },
  'snaplock-saddle45y-5':  { '26': 3.51, '24': 3.51 },
  'snaplock-saddle45y-6':  { '26': 3.92, '24': 3.92 },
  'snaplock-saddle45y-7':  { '26': 4.13, '24': 4.13 },
  'snaplock-saddle45y-8':  { '26': 4.53, '24': 4.53 },
  'snaplock-saddle45y-9':  { '26': 4.79, '24': 4.79 },
  'snaplock-saddle45y-10': { '26': 6.48, '24': 6.48 },
  'snaplock-saddle45y-12': { '26': 8.18, '24': 8.18 },
  'snaplock-saddle45y-14': { '26': 10.83, '24': 10.83 },
  'snaplock-saddle45y-16': { '26': 14.31, '24': 14.31 },
  'snaplock-saddle45y-18': { '26': 17.07, '24': 17.07 },
  'snaplock-saddle45y-20': { '26': 23.03, '24': 23.03 },
  'snaplock-saddle45y-22': { '26': 24.24, '24': 24.24 },
  'snaplock-starting-collar-4':  { '26': 0.62 },
  'snaplock-starting-collar-5':  { '26': 0.74 },
  'snaplock-starting-collar-6':  { '26': 0.84 },
  'snaplock-starting-collar-7':  { '26': 0.92 },
  'snaplock-starting-collar-8':  { '26': 1.00 },
  'snaplock-starting-collar-9':  { '26': 1.10 },
  'snaplock-starting-collar-10': { '26': 1.32 },
  'snaplock-starting-collar-12': { '26': 1.56 },
  'snaplock-starting-collar-14': { '26': 1.78 },
  'snaplock-starting-collar-16': { '26': 2.08 },
  'snaplock-starting-collar-18': { '26': 2.28 },
  'snaplock-starting-collar-20': { '26': 2.58 },

  'rect-boot-12x12':  { '26': 8.06 },
  'rect-boot-14x14':  { '26': 8.75 },
  'rect-boot-15x15':  { '26': 12.05 },
  'rect-boot-18x18':  { '26': 12.10 },
  'rect-boot-20x20':  { '26': 12.10 },
  'rect-boot-30x20':  { '26': 17.00 },
  'snaplock-tee-6x6x4':   { '26': 6.219 },
  'snaplock-tee-8x4x4':   { '26': 7.328 },
  'snaplock-tee-8x6x4':   { '26': 7.328 },
  'snaplock-tee-8x6x6':   { '26': 7.328 },
  'snaplock-tee-8x8x4':   { '26': 7.328 },
  'snaplock-tee-8x8x6':   { '26': 7.328 },
  'snaplock-tee-10x8x8':  { '26': 9.087 },
  'snaplock-reducer-20-18': { '26': 14.30 },
  'snaplock-reducer-18-16': { '26': 11.90 },
  'snaplock-reducer-18-14': { '26': 11.90 },
  'snaplock-reducer-18-12': { '26': 11.90 },
  'snaplock-reducer-16-14': { '26': 10.25 },
  'snaplock-reducer-16-12': { '26': 9.35 },
  'snaplock-reducer-14-12': { '26': 8.75 },
  'snaplock-reducer-12-10': { '26': 8.75 },
  'snaplock-reducer-10-8':  { '26': 8.25 },
  'snaplock-reducer-8-6':   { '26': 7.05 },
  'snaplock-reducer-6-4':   { '26': 4.50 },
  'snaplock-volume-damper-4':  { '26': 2.50 },
  'snaplock-volume-damper-5':  { '26': 3.05 },
  'snaplock-volume-damper-6':  { '26': 3.10 },
  'snaplock-volume-damper-7':  { '26': 3.45 },
  'snaplock-volume-damper-8':  { '26': 3.90 },
  'snaplock-volume-damper-9':  { '26': 4.01 },
  'snaplock-volume-damper-10': { '26': 4.40 },
  'snaplock-volume-damper-12': { '26': 5.163 },
  'snaplock-volume-damper-14': { '26': 5.25 },
  'snaplock-volume-damper-16': { '26': 5.90 },
  'snaplock-volume-damper-18': { '26': 6.454 },
  'snaplock-volume-damper-20': { '26': 7.70 },
  'duct-snaplock-4':  { '26': 1.80 },
  'duct-snaplock-5':  { '26': 1.90 },
  'duct-snaplock-6':  { '26': 2.10 },
  'duct-snaplock-7':  { '26': 2.20 },
  'duct-snaplock-8':  { '26': 2.27 },
  'duct-snaplock-9':  { '26': 2.45 },
  'duct-snaplock-10': { '26': 2.85 },
  'duct-snaplock-12': { '26': 3.15 },
  'duct-snaplock-14': { '26': 3.40 },
  'duct-snaplock-16': { '26': 6.05 },
  'duct-snaplock-18': { '26': 6.62 },
  'duct-snaplock-20': { '26': 7.12 },
  'duct-snaplock-22': { '26': 15.07 },
  'duct-snaplock-24': { '26': 16.47 },
  // Flex duct pricing stored as $/ft (vendor roll price ÷ 25ft per roll)
  // Price Book UI displays as $/Roll by multiplying × 25
  'flex-black-4':  { '26': 0.862 },
  'flex-black-5':  { '26': 1.013 },
  'flex-black-6':  { '26': 1.130 },
  'flex-black-7':  { '26': 1.254 },
  'flex-black-8':  { '26': 1.344 },
  'flex-black-9':  { '26': 1.587 },
  'flex-black-10': { '26': 1.770 },
  'flex-black-12': { '26': 2.196 },
  'flex-black-14': { '26': 2.652 },
  'flex-black-16': { '26': 3.143 },
  'flex-black-18': { '26': 3.588 },
  'flex-black-20': { '26': 4.717 },
  'flex-silver-4':  { '26': 0.965 },
  'flex-silver-5':  { '26': 1.140 },
  'flex-silver-6':  { '26': 1.270 },
  'flex-silver-7':  { '26': 1.398 },
  'flex-silver-8':  { '26': 1.470 },
  'flex-silver-9':  { '26': 1.700 },
  'flex-silver-10': { '26': 1.850 },
  'flex-silver-12': { '26': 2.300 },
  'flex-silver-14': { '26': 2.790 },
  'flex-silver-16': { '26': 3.200 },
  'flex-silver-18': { '26': 3.700 },
  'flex-silver-20': { '26': 4.383 },
};

// ── Rectangular fitting reference data ───────────────────────────────
// cuts: fabrication complexity reference (display-only)
export const RECT_FITTING_REF = {
  'rect-90el':       { cuts: 4 },
  'rect-45el':       { cuts: 3 },
  'rect-22el':       { cuts: 2 },
  'rect-tee':        { cuts: 5 },
  'rectTap':         { cuts: 2 },
  'rect-wye':        { cuts: 6 },
  'rect-lateral':    { cuts: 6 },
  'rect-reducer':    { cuts: 3 },
  'rect-eccReducer': { cuts: 4 },
  'rect-sqwing':     { cuts: 5 },
  'rect-endcap':     { cuts: 1 },
  'rect-transition': { cuts: 4 },
  'rect-flex-conn':  { cuts: 0 },
};

// ── Rectangular flex connector defaults ($/EA by min-width class) ────
// Flat vendor/shop pricing, no SA formula. Scaled from $25 avg at 11-12" class.
export const RECT_FLEX_CONN_DEFAULTS = {
  6:  12.50,
  8:  16.75,
  10: 20.75,
  12: 25.00,
  16: 32.00,
  20: 39.00,
  24: 45.75,
  30: 54.25,
};

// ── Rectangular fitting surface area model ───────────────────────────
// Per-fitting SA formula returning surface area in SF from W,H (and branch
// W,H where relevant). SA × gauge_weight_per_SF × $/lb = raw material cost.
// W is the duct width (in), H is height (in). branchW/branchH default to W/H.
// For elbows, the smaller dim is treated as the turning (bend-plane) dim.
export const RECT_FITTING_SA = {
  'rect-90el':       function(W, H)         { var t = Math.min(W, H); return 2*(W+H) * t * 1.57 / 144; },
  'rect-45el':       function(W, H)         { var t = Math.min(W, H); return (2*(W+H) * t * 1.57 / 144) * 0.6; },
  'rect-22el':       function(W, H)         { var t = Math.min(W, H); return (2*(W+H) * t * 1.57 / 144) * 0.35; },
  'rect-tee':        function(W, H, bW, bH) { return (2*(W+H) * W / 144) + (2*(bW+bH) * bW / 144); },
  'rectTap':         function(W, H, bW, bH) { return 2*(bW+bH) * 3 / 144; },
  'rect-wye':        function(W, H, bW, bH) { return ((2*(W+H) * W / 144) + (2*(bW+bH) * bW / 144)) * 1.2; },
  'rect-lateral':    function(W, H, bW, bH) { return ((2*(W+H) * W / 144) + (2*(bW+bH) * bW / 144)) * 1.2; },
  'rect-reducer':    function(W, H, bW, bH) { var avgP = ((2*(W+H)) + (2*(bW+bH))) / 2; return avgP * Math.max(W, H) / 144; },
  'rect-eccReducer': function(W, H, bW, bH) { var avgP = ((2*(W+H)) + (2*(bW+bH))) / 2; return (avgP * Math.max(W, H) / 144) * 1.1; },
  'rect-sqwing':     function(W, H)         { var t = Math.min(W, H); return (2*(W+H) * t * 1.57 / 144) * 1.1; },
  'rect-endcap':     function(W, H)         { return W * H / 144; },
  'rect-transition': function(W, H, bW, bH) { var avgP = ((2*(W+H)) + (2*(bW+bH))) / 2; return avgP * Math.max(W, H) / 144; },
};

export function calcRectFittingSA(fittingKey, widthIn, heightIn, branchW, branchH) {
  var fn = RECT_FITTING_SA[fittingKey];
  if (!fn) return 0;
  var W = widthIn || 12;
  var H = heightIn || W;
  var bW = branchW || W;
  var bH = branchH || H;
  return fn(W, H, bW, bH);
}

// ── Rectangular perimeter classes ────────────────────────────────────
export const RECT_PERIM_CLASSES = [
  { label: '\u226436\u2033',     maxPerim: 36,  refPerim: 36 },
  { label: '37\u201348\u2033',   maxPerim: 48,  refPerim: 48 },
  { label: '49\u201360\u2033',   maxPerim: 60,  refPerim: 60 },
  { label: '61\u201372\u2033',   maxPerim: 72,  refPerim: 72 },
  { label: '73\u201396\u2033',   maxPerim: 96,  refPerim: 96 },
  { label: '97\u2013120\u2033',  maxPerim: 120, refPerim: 120 },
  { label: '121\u2013144\u2033', maxPerim: 144, refPerim: 144 },
  { label: '145\u2013168\u2033', maxPerim: 168, refPerim: 168 },
];

// \u2500\u2500 Rectangular min-width classes (rect fittings) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// The narrow dimension drives fabrication difficulty and labor for fittings,
// so fitting prices are keyed by min(W,H) bucket. repW/repH are representative
// dimensions (~2:1 aspect) used for SA preview and auto-calc in the Price Book.
export const RECT_MIN_WIDTH_CLASSES = [
  { label: '\u22646\u2033',    maxMin: 6,  repW: 12, repH: 6 },
  { label: '7\u20138\u2033',   maxMin: 8,  repW: 16, repH: 8 },
  { label: '9\u201310\u2033',  maxMin: 10, repW: 20, repH: 10 },
  { label: '11\u201312\u2033', maxMin: 12, repW: 24, repH: 12 },
  { label: '13\u201316\u2033', maxMin: 16, repW: 30, repH: 16 },
  { label: '17\u201320\u2033', maxMin: 20, repW: 36, repH: 20 },
  { label: '21\u201324\u2033', maxMin: 24, repW: 42, repH: 24 },
  { label: '25\u201330\u2033', maxMin: 30, repW: 48, repH: 30 },
];

// ── Duct weight per linear foot (lbs) by perimeter class & gauge ─────
// Derived from sheet weight: lbs/LF = (perim_in / 12) × lbs/SF
// 26ga galvanized = 0.906 lbs/SF, 24ga = 1.156 lbs/SF, 22ga = 1.406 lbs/SF
export const DUCT_WEIGHT_PER_LF = {
  36:  { '26': 2.718,  '24': 3.468,  '22': 4.218 },
  48:  { '26': 3.624,  '24': 4.624,  '22': 5.624 },
  60:  { '26': 4.530,  '24': 5.780,  '22': 7.030 },
  72:  { '26': 5.436,  '24': 6.936,  '22': 8.436 },
  96:  { '26': 7.248,  '24': 9.248,  '22': 11.248 },
  120: { '26': 9.060,  '24': 11.560, '22': 14.060 },
  144: { '26': 10.872, '24': 13.872, '22': 16.872 },
  168: { '26': 12.684, '24': 16.184, '22': 19.684 },
  192: { '26': 14.496, '24': 18.496, '22': 22.496 },
  216: { '26': 16.308, '24': 20.808, '22': 25.308 },
  240: { '26': 18.120, '24': 23.120, '22': 28.120 },
  300: { '26': 22.650, '24': 28.900, '22': 35.150 },
  360: { '26': 27.180, '24': 34.680, '22': 42.180 },
  420: { '26': 31.710, '24': 40.460, '22': 49.210 },
};

// ── Shop settings defaults ───────────────────────────────────────────
export const SHOP_DEFAULTS = {
  sheetMetalPricePerLb: 0.90,
  wrapInsulationPerSF: 0,   // external wrap insulation $/SF
};

// ── Liner thickness options ──────────────────────────────────────
// Standard rectangular duct liner thicknesses. User enters $/SF per thickness
// in the Price Book accessories section. Active liner selection is a radio button.
export const LINER_OPTIONS = [
  { key: 'liner-1', label: '1\u2033 Liner', thickness: 1.0 },
  { key: 'liner-1.5', label: '1.5\u2033 Liner', thickness: 1.5 },
];

// ── Labor categories ─────────────────────────────────────────────────
export const LABOR_CATEGORIES = [
  { key: 'rough',       label: 'Rough',        short: 'R',  color: '#4dabf7', applies: ['duct','fitting'] },
  { key: 'air-handler', label: 'Air Handler',   short: 'AH', color: '#69db7c', applies: ['equipment'] },
  { key: 'condenser',   label: 'Condenser',     short: 'CU', color: '#69db7c', applies: ['equipment'] },
  { key: 'lineset',     label: 'Line Set',      short: 'LS', color: '#ffd43b', applies: ['equipment'] },
  { key: 'trim',        label: 'Trim',          short: 'T',  color: '#da77f2', applies: ['duct','fitting','accessory'] },
  { key: 'venting',     label: 'Venting',       short: 'V',  color: '#ff8787', applies: ['duct','fitting'] },
  { key: 'stocking',    label: 'Stocking',      short: 'SK', color: '#a9e34b', applies: ['duct','fitting','equipment','accessory'] },
  { key: 'startup',     label: 'Startup',       short: 'SU', color: '#ffa94d', applies: ['equipment'] },
  { key: 'qc',          label: 'Quality Ctrl',  short: 'QC', color: '#74c0fc', applies: ['duct','fitting','equipment','accessory'] },
];

// ── Default labor hours ──────────────────────────────────────────────
// Keyed by item type. Size-specific overrides use "type-size" keys.
// Values are hours per labor category. User overrides in IndexedDB win.
//
// Structure:
//   'spiral-90el':      { rough: 0.35, stocking: 0.05, qc: 0.02 }     ← base default for all sizes
//   'spiral-90el-12':   { rough: 0.40, stocking: 0.05, qc: 0.03 }     ← size-specific override
//   'duct-spiral':      { rough: 0.10, stocking: 0.02 }               ← per-LF base for spiral duct
//   'duct-spiral-14':   { rough: 0.12, stocking: 0.02 }               ← per-LF for 14" spiral
//
// Add entries as you estimate — this grows over time.
// Empty = no defaults yet (user enters via Price Book radar chart, saved to IndexedDB).
export const LABOR_DEFAULTS = {
  // ── Spiral fittings (hours per fitting) ──
  // 'spiral-90el':     { rough: 0, stocking: 0, qc: 0 },
  // 'spiral-45el':     { rough: 0, stocking: 0, qc: 0 },
  // 'spiral-tee':      { rough: 0, stocking: 0, qc: 0 },
  // 'spiral-wye':      { rough: 0, stocking: 0, qc: 0 },
  // 'spiral-reducer':  { rough: 0, stocking: 0, qc: 0 },
  // 'spiral-endcap':   { rough: 0, stocking: 0, qc: 0 },

  // ── Snaplock fittings ──
  // 'snaplock-90el':   { rough: 0, trim: 0, stocking: 0, qc: 0 },

  // ── Spiral duct (hours per linear foot) ──
  // 'duct-spiral':     { rough: 0, stocking: 0, qc: 0 },

  // ── Rectangular fittings (hours per fitting, per perimeter class) ──
  // 'rect-90el':       { rough: 0, trim: 0, stocking: 0, qc: 0 },
  // 'rect-90el-p36':   { rough: 0, trim: 0, stocking: 0, qc: 0 },
  // 'rect-90el-p48':   { rough: 0, trim: 0, stocking: 0, qc: 0 },

  // ── Rectangular duct (hours per LF, per perimeter class) ──
  // 'duct-rect-p36':   { rough: 0, stocking: 0, qc: 0 },
  // 'duct-rect-p48':   { rough: 0, stocking: 0, qc: 0 },

  // ── Accessories ──
  // 'rect-liner':      { rough: 0, trim: 0 },
  // 'rect-wrap':       { rough: 0, trim: 0 },
  // 'rect-volume-damper': { rough: 0 },
  // 'rect-fire-damper':   { rough: 0 },
};

// ── Spiral Saddle Tap pricing (exposed, $/EA by branch×main) ─────────
// Key format: spiral-tap-{main}x{branch} (matches Price Book pair key pattern)
export const SPIRAL_TAP_DEFAULTS = {
  'spiral-tap-8x8':   { '26': 14.51 },  // General Metals
  'spiral-tap-10x6':  { '26': 12.45 },  // General Metals
  'spiral-tap-10x8':  { '26': 8.50 },   // Hercules
  'spiral-tap-10x9':  { '26': 15.08 },  // General Metals
  'spiral-tap-10x10': { '26': 15.47 },  // General Metals
  'spiral-tap-12x8':  { '26': 17.50 },  // Hercules
  'spiral-tap-12x10': { '26': 10.75 },  // Hercules
  'spiral-tap-12x12': { '26': 16.89 },  // General Metals
  'spiral-tap-14x8':  { '26': 14.51 },  // General Metals
  'spiral-tap-14x12': { '26': 13.90 },  // Hercules
  'spiral-tap-16x12': { '26': 16.90 },  // General Metals
  'spiral-tap-16x14': { '26': 15.60 },  // Hercules
  'spiral-tap-18x12': { '26': 16.89 },  // General Metals
  'spiral-tap-18x14': { '26': 22.46 },  // General Metals
  'spiral-tap-20x10': { '26': 15.47 },  // General Metals
  'spiral-tap-20x12': { '26': 16.89 },  // General Metals
  // Rectangular branch saddle taps on spiral main
  'spiral-tap-12x10on12': { '26': 16.89 },  // General Metals
  'spiral-tap-12x10on14': { '26': 16.90 },  // General Metals
};

// ── Snaplock Saddle Tap pricing (unexposed, $/EA by branch×main) ─────
// Most have no vendor pricing yet — placeholders for manual entry
export const SNAPLOCK_TAP_DEFAULTS = {
  'snaplock-tap-10x6':  {},  // no pricing
  'snaplock-tap-8x8':   {},  // no pricing
  'snaplock-tap-10x8':  { '26': 17.50 },  // Hercules
  'snaplock-tap-12x8':  { '26': 13.93 },  // General Metals
  'snaplock-tap-14x8':  {},  // no pricing
  'snaplock-tap-10x9':  {},  // no pricing
  'snaplock-tap-10x10': {},  // no pricing
  'snaplock-tap-12x10': {},  // no pricing
  'snaplock-tap-20x10': {},  // no pricing
  'snaplock-tap-12x12': {},  // no pricing
  'snaplock-tap-14x12': {},  // no pricing
  'snaplock-tap-16x12': {},  // no pricing
  'snaplock-tap-18x12': {},  // no pricing
  'snaplock-tap-20x12': {},  // no pricing
  'snaplock-tap-16x14': {},  // no pricing
  'snaplock-tap-18x14': {},  // no pricing
  // Rectangular branch
  'snaplock-tap-12x10on12': {},  // no pricing
  'snaplock-tap-12x10on14': {},  // no pricing
};

// ── Rectangular duct shop overhead defaults ($/LF by perimeter class) ──
// Back-calculated from Immad's total pricing (includes fab labor, not liner/metal)
// Total = Raw Metal (auto-calc) + Liner (accessory) + Shop Adder (below)
export const RECT_DUCT_SHOP_DEFAULTS = {
  36:  13.00,   // Small (<33")
  48:  13.87,   // Small-Med (33-48")
  60:  13.68,   // Medium (48-96")
  72:  13.68,   // Medium
  96:  13.68,   // Medium
  120: 54.05,   // XL (>96")
  144: 54.05,   // XL
  168: 54.05,   // XL
};
