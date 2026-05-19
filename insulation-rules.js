import {
  INSULATION_DEFAULTS,
  RECT_PERIM_CLASSES,
  INSULATION_ROUND_DIAM_CLASSES,
} from './price-defaults.js';

const WRAP_PRODUCT_KEY = 'fiberglass-duct-wrap-fsk';
const TAPE_PRODUCT_KEY = 'foil-scrim-vapor-tape';
const TAPE_RULE_ID = 'vapor-barrier-seam-tape';

function toNumber(value, fallback = 0) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

export function getInsulationPriceBookLaborKey(defaults = INSULATION_DEFAULTS) {
  return (defaults.takeoffDefaults && defaults.takeoffDefaults.priceBookLaborKey) || 'insulation-fiberglass-wrap';
}

/** Classify duct size for insulation labor (perimeter inches or nominal diameter). */
export function classifyInsulationSize(shape, dims, sizeB) {
  const size = parseInsulationSize(dims, sizeB);
  if (shape === 'rect' || shape === 'oval') {
    if (!size || !size.W || !size.H) {
      const pc0 = RECT_PERIM_CLASSES[0];
      return { mode: 'perim', refPerim: pc0.refPerim, label: pc0.label };
    }
    const perimIn = 2 * (size.W + size.H);
    for (const pc of RECT_PERIM_CLASSES) {
      if (perimIn <= pc.maxPerim) {
        return { mode: 'perim', refPerim: pc.refPerim, label: pc.label, perimIn };
      }
    }
    const last = RECT_PERIM_CLASSES[RECT_PERIM_CLASSES.length - 1];
    return { mode: 'perim', refPerim: last.refPerim, label: last.label, perimIn };
  }
  const d = size?.D || size?.W || 14;
  for (const dc of INSULATION_ROUND_DIAM_CLASSES) {
    if (d <= dc.maxDia) {
      return { mode: 'dia', refDia: dc.refDia, label: dc.label, diameterIn: d };
    }
  }
  const lastD = INSULATION_ROUND_DIAM_CLASSES[INSULATION_ROUND_DIAM_CLASSES.length - 1];
  return { mode: 'dia', refDia: lastD.refDia, label: lastD.label, diameterIn: d };
}

export function getInsulationLaborPriceBookKey(defaults, classification) {
  const base = getInsulationPriceBookLaborKey(defaults);
  if (!classification) return base;
  if (classification.mode === 'dia') {
    return `${base}-dia-${classification.refDia}`;
  }
  return `${base}-perim-${classification.refPerim}`;
}

/** Labor key for a duct run or preview example from stored dimensions. */
export function resolveInsulationLaborPriceBookKey(item = {}, defaults = INSULATION_DEFAULTS) {
  const duct = item.duct || item;
  const shape = inferInsulationShape(item);
  const cls = classifyInsulationSize(shape, duct.dims || item.sizeA, item.sizeB);
  return getInsulationLaborPriceBookKey(defaults, cls);
}

/** Stable key for thickness-specific price book / cost maps (1, 1-5, 2, 3). */
export function insulationThicknessKey(thicknessIn) {
  const t = toNumber(thicknessIn, 1.5);
  if (Math.abs(t - 1) < 0.01) return '1';
  if (Math.abs(t - 1.5) < 0.01) return '1-5';
  if (Math.abs(t - 2) < 0.01) return '2';
  if (Math.abs(t - 3) < 0.01) return '3';
  return String(t).replace('.', '-');
}

export function insulationWrapPriceBookKey(thicknessIn, defaults = INSULATION_DEFAULTS) {
  return `${getInsulationPriceBookLaborKey(defaults)}-t${insulationThicknessKey(thicknessIn)}`;
}

export function getWrapMaterialCostPerSf(thicknessIn, defaults = INSULATION_DEFAULTS, priceBookCache = null) {
  const pbKey = insulationWrapPriceBookKey(thicknessIn, defaults);
  const pbEntry = priceBookCache && priceBookCache[pbKey];
  if (pbEntry && pbEntry.materialCost != null) return toNumber(pbEntry.materialCost, 0);

  const product = (defaults.products || {})[WRAP_PRODUCT_KEY] || {};
  const tKey = insulationThicknessKey(thicknessIn);
  const byThickness = product.materialCostByThickness || {};
  if (byThickness[tKey] != null) return toNumber(byThickness[tKey], 0);
  return toNumber(product.materialCost, 0);
}

export function getDefaultWrapPieceLengthFt(defaults = INSULATION_DEFAULTS, rule = {}) {
  return toNumber(
    rule.wrapPieceLengthFt,
    toNumber(defaults.takeoffDefaults && defaults.takeoffDefaults.wrapPieceLengthFt, 50)
  );
}

/**
 * Circumferential vapor-barrier tape at wrap piece joints and duct run ends.
 * Industry rolls are typically 48" W × 50' or 100' L along the duct run.
 */
export function calculateTapeSeamLf(lengthFt, perimeterFt, rule = {}, defaults = INSULATION_DEFAULTS) {
  const wrapPieceLengthFt = getDefaultWrapPieceLengthFt(defaults, rule);
  if (!lengthFt || !perimeterFt || wrapPieceLengthFt <= 0) {
    return { tapeLf: 0, seamCount: 0, pieceCount: 0, wrapPieceLengthFt, internalSeams: 0, endSeams: 0 };
  }
  const pieceCount = Math.max(1, Math.ceil(lengthFt / wrapPieceLengthFt));
  const internalSeams = Math.max(0, pieceCount - 1);
  const endSeams = rule.tapeAtDuctEnds !== false ? 2 : 0;
  const seamCount = internalSeams + endSeams;
  const tapeLf = seamCount * perimeterFt;
  return { tapeLf, seamCount, pieceCount, wrapPieceLengthFt, internalSeams, endSeams };
}

export function parseInsulationSize(sizeA, sizeB) {
  const rawA = String(sizeA || '').trim().toLowerCase();
  const rawB = String(sizeB || '').trim().toLowerCase();
  if (rawA.includes('x')) {
    const parts = rawA.split('x').map(v => toNumber(v, NaN));
    if (Number.isFinite(parts[0]) && Number.isFinite(parts[1])) return { W: parts[0], H: parts[1] };
  }
  const a = toNumber(rawA, NaN);
  const b = toNumber(rawB, NaN);
  if (Number.isFinite(a) && Number.isFinite(b)) return { W: a, H: b };
  if (Number.isFinite(a)) return { D: a };
  return null;
}

export function inferInsulationShape(item = {}) {
  const duct = item.duct || item;
  const shape = item.shape || duct.type || duct.shape || item.type;
  if (shape === 'rect' || shape === 'oval' || shape === 'flex') return shape;
  if (shape === 'spiral') return 'spiral';
  if (shape === 'round') return 'round';
  return String(duct.dims || item.sizeA || '').includes('x') ? 'rect' : 'round';
}

export function getInsulationPerimeterFt(item = {}, shape = inferInsulationShape(item)) {
  const duct = item.duct || item;
  const size = parseInsulationSize(duct.dims || item.sizeA, item.sizeB);
  if (!size) return 0;
  if (shape === 'rect' && size.W && size.H) return (2 * (size.W + size.H)) / 12;
  if (shape === 'oval' && size.W && size.H) {
    const a = size.W / 2;
    const b = size.H / 2;
    return (Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))) / 12;
  }
  const d = size.D || size.W;
  return d ? (Math.PI * d) / 12 : 0;
}

function getActiveStandard(defaults) {
  const activeKey = defaults.takeoffDefaults && defaults.takeoffDefaults.activeStandard;
  return (defaults.standards && defaults.standards[activeKey]) || Object.values(defaults.standards || {})[0] || null;
}

function getSelectedStandard(defaults, externalInsulation = {}) {
  return (externalInsulation.standardKey && defaults.standards && defaults.standards[externalInsulation.standardKey])
    || getActiveStandard(defaults);
}

function ruleApplies(rule, shape) {
  if (!rule || rule.enabled === false) return false;
  return !Array.isArray(rule.appliesToShapes) || rule.appliesToShapes.includes(shape);
}

function getTapeRule(standard) {
  return (standard.rules || []).find(rule => rule.id === TAPE_RULE_ID || rule.isTapeAddon) || null;
}

function getWrapRule(standard) {
  return (standard.rules || []).find(rule => rule.product === WRAP_PRODUCT_KEY) || null;
}

function calculateWrapComponent(rule, product, basis, materialCostRate) {
  const wasteFactor = toNumber(product.wasteFactor, 1);
  const coveragePerUnit = toNumber(product.coveragePerUnit, 1);
  const surfaceAreaSf = toNumber(basis.surfaceAreaSf, 0);
  const lengthFt = toNumber(basis.lengthFt, 0);
  const perimeterFt = toNumber(basis.perimeterFt, 0);
  const materialQty = coveragePerUnit > 0 ? (surfaceAreaSf / coveragePerUnit) * wasteFactor : surfaceAreaSf * wasteFactor;
  const materialCost = materialQty * materialCostRate;
  const costPerLf = lengthFt > 0 ? materialCost / lengthFt : 0;

  return {
    ruleId: rule.id,
    productKey: rule.product,
    productLabel: product.label || rule.product,
    surfaceAreaSf,
    perimeterFt,
    lengthFt,
    basisQty: surfaceAreaSf,
    materialQty,
    materialCost,
    materialUnit: product.materialUnit || 'SF',
    materialCostRate,
    coveragePerUnit,
    wasteFactor,
    costPerLf,
  };
}

function calculateTapeComponent(rule, product, basis, defaults, tapeEnabled) {
  const wasteFactor = toNumber(product.wasteFactor, 1);
  const coveragePerUnit = toNumber(product.coveragePerUnit, 150);
  const materialCostRate = toNumber(product.materialCost, 0);
  const lengthFt = toNumber(basis.lengthFt, 0);
  const perimeterFt = toNumber(basis.perimeterFt, 0);
  const seamInfo = calculateTapeSeamLf(lengthFt, perimeterFt, rule, defaults);
  const tapeLf = tapeEnabled ? seamInfo.tapeLf : 0;
  const materialQty = coveragePerUnit > 0 ? (tapeLf / coveragePerUnit) * wasteFactor : 0;
  const materialCost = materialQty * materialCostRate;
  const costPerLf = lengthFt > 0 ? materialCost / lengthFt : 0;

  return {
    ruleId: rule.id,
    productKey: rule.product,
    productLabel: product.label || rule.product,
    surfaceAreaSf: basis.surfaceAreaSf,
    perimeterFt,
    lengthFt,
    basisQty: tapeLf,
    materialQty,
    materialCost,
    materialUnit: product.materialUnit || 'roll',
    materialCostRate,
    coveragePerUnit,
    wasteFactor,
    costPerLf,
    seamCount: seamInfo.seamCount,
    pieceCount: seamInfo.pieceCount,
    wrapPieceLengthFt: seamInfo.wrapPieceLengthFt,
    internalSeams: seamInfo.internalSeams,
    endSeams: seamInfo.endSeams,
  };
}

/** Combined wrap + optional tape bundle for one duct run. */
export function calculateInsulationBundleForItem(item = {}, defaults = INSULATION_DEFAULTS, options = {}) {
  const duct = item.duct || {};
  const externalInsulation = options.externalInsulation || duct.externalInsulation || {};
  if (externalInsulation.enabled === false && !options.forceEnabled) return null;
  const standard = options.standard || getSelectedStandard(defaults, externalInsulation);
  if (!standard) return null;
  const shape = options.shape || inferInsulationShape(item);
  if (shape === 'flex') return null;
  const lengthFt = toNumber(options.lengthFt != null ? options.lengthFt : (item.lengthFt != null ? item.lengthFt : (item.distance && item.distance.value)), 0);
  const perimeterFt = options.perimeterFt != null ? toNumber(options.perimeterFt, 0) : getInsulationPerimeterFt(item, shape);
  if (!lengthFt || !perimeterFt) return null;

  const surfaceAreaSf = perimeterFt * lengthFt;
  const products = defaults.products || {};
  const wrapRule = getWrapRule(standard);
  const tapeRule = getTapeRule(standard);
  if (!wrapRule || !ruleApplies(wrapRule, shape)) return null;

  const wrapProduct = products[wrapRule.product || WRAP_PRODUCT_KEY];
  if (!wrapProduct) return null;

  const thicknessIn = toNumber(
    externalInsulation.thicknessIn,
    toNumber(defaults.takeoffDefaults && defaults.takeoffDefaults.defaultThicknessIn, 1.5)
  );
  const priceBookCache = options.priceBookCache || null;
  const wrapMaterialCostRate = getWrapMaterialCostPerSf(thicknessIn, defaults, priceBookCache);

  const basis = { surfaceAreaSf, perimeterFt, lengthFt };
  const wrap = calculateWrapComponent(wrapRule, wrapProduct, basis, wrapMaterialCostRate);

  let tape = null;
  const tapeRuleEnabled = !!(tapeRule && tapeRule.enabled !== false);
  if (tapeRule && ruleApplies(tapeRule, shape)) {
    const tapeProduct = products[tapeRule.product || TAPE_PRODUCT_KEY];
    if (tapeProduct) tape = calculateTapeComponent(tapeRule, tapeProduct, basis, defaults, tapeRuleEnabled);
  }

  const standardKey = externalInsulation.standardKey || (defaults.takeoffDefaults && defaults.takeoffDefaults.activeStandard) || '';
  const tapeIncluded = !!(tape && tapeRuleEnabled);
  const totalMaterialCost = wrap.materialCost + (tapeIncluded ? tape.materialCost : 0);
  const costPerLf = lengthFt > 0 ? totalMaterialCost / lengthFt : 0;

  return {
    standardKey,
    standardLabel: standard.label || standardKey,
    shape,
    thicknessIn,
    thicknessKey: insulationThicknessKey(thicknessIn),
    lengthFt,
    perimeterFt,
    surfaceAreaSf,
    wrap,
    tape,
    tapeIncluded,
    totalMaterialCost,
    costPerLf,
    priceBookLaborKey: resolveInsulationLaborPriceBookKey(item, defaults),
    insulationSizeClass: classifyInsulationSize(
      shape,
      duct.dims || item.sizeA,
      item.sizeB
    ),
  };
}

/** Legacy per-component rows (wrap and tape separately). */
export function calculateInsulationApplicationsForItem(item = {}, defaults = INSULATION_DEFAULTS, options = {}) {
  const bundle = calculateInsulationBundleForItem(item, defaults, options);
  if (!bundle) return [];
  const rows = [{
    ...bundle.wrap,
    standardKey: bundle.standardKey,
    standardLabel: bundle.standardLabel,
    shape: bundle.shape,
    thicknessIn: bundle.thicknessIn,
    family: 'fiberglass-wrap',
    laborHrs: 0,
    laborDistribution: {},
  }];
  if (bundle.tapeIncluded && bundle.tape) {
    rows.push({
      ...bundle.tape,
      standardKey: bundle.standardKey,
      standardLabel: bundle.standardLabel,
      shape: bundle.shape,
      thicknessIn: bundle.thicknessIn,
      family: 'insulation-tape',
      laborHrs: 0,
      laborDistribution: {},
    });
  }
  return rows;
}

export function calculateInsulationExample(shape = 'rect', defaults = INSULATION_DEFAULTS, input = {}) {
  const examples = defaults.examples || {};
  const ex = { ...(examples[shape] || examples.rect || {}), ...input };
  return calculateInsulationBundleForItem({
    kind: 'duct',
    lengthFt: ex.lengthFt || 10,
    duct: {
      type: shape,
      dims: ex.dims || (shape === 'rect' || shape === 'oval' ? '24x12' : '14'),
      externalInsulation: {
        enabled: true,
        thicknessIn: ex.thicknessIn || defaults.takeoffDefaults?.defaultThicknessIn,
      },
    },
  }, defaults, { forceEnabled: true, priceBookCache: ex.priceBookCache || null });
}

export { WRAP_PRODUCT_KEY, TAPE_PRODUCT_KEY, TAPE_RULE_ID };
