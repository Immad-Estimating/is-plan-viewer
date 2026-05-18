import { CONNECTOR_DEFAULTS } from './price-defaults.js';

function toNumber(value, fallback = 0) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parseConnectorSize(sizeA, sizeB) {
  const rawA = String(sizeA || '').trim().toLowerCase();
  const rawB = String(sizeB || '').trim().toLowerCase();
  if (rawA.includes('x')) {
    const parts = rawA.split('x').map(v => toNumber(v, NaN));
    if (Number.isFinite(parts[0]) && Number.isFinite(parts[1])) return { W: parts[0], H: parts[1] };
  }
  const dia = toNumber(rawA, NaN);
  if (Number.isFinite(dia)) {
    const b = toNumber(rawB, NaN);
    return Number.isFinite(b) ? { W: dia, H: b } : { D: dia };
  }
  return null;
}

export function inferConnectorShape(item = {}) {
  const ductType = item.duct && (item.duct.type || item.duct.shape);
  const shape = item.shape || ductType || item.type;
  if (shape === 'rect' || shape === 'oval' || shape === 'flex') return shape;
  if (shape === 'spiral') return 'spiral';
  if (shape === 'round') return item.roundType === 'spiral' ? 'spiral' : 'round';
  if (item.roundType === 'spiral') return 'spiral';
  if (item.roundType === 'snaplock') return 'round';
  const size = item.duct ? item.duct.dims : item.sizeA;
  return String(size || '').toLowerCase().includes('x') ? 'rect' : 'spiral';
}

export function getConnectorJointLengthFt(item = {}, shape = inferConnectorShape(item)) {
  const size = item.duct ? parseConnectorSize(item.duct.dims) : parseConnectorSize(item.sizeA, item.sizeB);
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

function getRuleJointLengthFt(rule = {}, item = {}, shape = inferConnectorShape(item)) {
  const size = item.duct ? parseConnectorSize(item.duct.dims) : parseConnectorSize(item.sizeA, item.sizeB);
  if (rule.jointLengthFormula === 'opposingSidesFt' && shape === 'rect' && size && size.W && size.H) {
    return (size.W + size.H) / 12;
  }
  return getConnectorJointLengthFt(item, shape);
}

export function getConnectorJointCount(item = {}, defaults = CONNECTOR_DEFAULTS) {
  if (item.kind === 'duct' || item.duct) {
    const duct = item.duct || item;
    const ductRules = defaults.jointCountDefaults && defaults.jointCountDefaults.duct;
    const shapeRules = ductRules && ductRules[duct.type || duct.shape];
    if (!shapeRules || !shapeRules.standardLengthFt || shapeRules.jointPolicy === 'none' || shapeRules.jointPolicy === 'deferred') return 0;
    const lengthFt = toNumber(item.lengthFt != null ? item.lengthFt : (item.distance && item.distance.value), 0);
    const standardLengthFt = toNumber(shapeRules.standardLengthFt, 0);
    if (!lengthFt || !standardLengthFt) return 0;
    const standardJointCount = Math.max(0, Math.floor((lengthFt - 0.001) / standardLengthFt));
    if (shapeRules.jointPolicy === 'standard-length-coupling') {
      return standardJointCount * toNumber(shapeRules.jointsPerCoupling, 1);
    }
    if (shapeRules.jointPolicy && String(shapeRules.jointPolicy).startsWith('standard-length-')) {
      return standardJointCount * toNumber(shapeRules.jointsPerJoint, 1);
    }
    return 0;
  }
  const fittingCounts = defaults.jointCountDefaults && defaults.jointCountDefaults.fittings;
  return toNumber(fittingCounts && fittingCounts[item.type], 0);
}

function getActiveStandard(defaults) {
  const activeKey = defaults.takeoffDefaults && defaults.takeoffDefaults.activeStandard;
  return (defaults.standards && defaults.standards[activeKey]) || Object.values(defaults.standards || {})[0] || null;
}

function ruleApplies(rule, shape, jointType) {
  if (!rule || rule.enabled === false) return false;
  if (Array.isArray(rule.appliesToShapes) && !rule.appliesToShapes.includes(shape)) return false;
  if (Array.isArray(rule.appliesToJointTypes) && !rule.appliesToJointTypes.includes(jointType)) return false;
  return true;
}

function ruleRangeApplies(rule, jointLengthFt) {
  const min = toNumber(rule.minJointLengthFt, NaN);
  const max = toNumber(rule.maxJointLengthFt, NaN);
  if (Number.isFinite(min) && jointLengthFt < min) return false;
  if (Number.isFinite(max) && jointLengthFt > max) return false;
  return true;
}

export function calculateConnectorApplicationBreakdown(rule = {}, product = {}, jointLengthFt = 0, jointCount = 1) {
  const wasteFactor = toNumber(product.wasteFactor, 1);
  const materialCostRate = toNumber(product.materialCost, 0);
  const safeJointLengthFt = Math.max(0, toNumber(jointLengthFt, 0));
  const safeJointCount = Math.max(0, toNumber(jointCount, 0));
  let qtyPerJoint = 0;
  let costPerJoint = 0;
  let qtyPerJointFt = 0;
  let costPerJointFt = 0;
  if (product.applicationUnit === 'EA') {
    const spacingFt = toNumber(rule.spacingFt, 0);
    qtyPerJoint = (spacingFt > 0 ? Math.ceil(safeJointLengthFt / spacingFt) : 1) * wasteFactor;
  } else {
    const coverage = toNumber(product.coveragePerUnit, 0);
    qtyPerJoint = coverage > 0 ? (safeJointLengthFt / coverage) * wasteFactor : 0;
  }
  costPerJoint = qtyPerJoint * materialCostRate;
  if (safeJointLengthFt > 0) {
    qtyPerJointFt = qtyPerJoint / safeJointLengthFt;
    costPerJointFt = costPerJoint / safeJointLengthFt;
  }
  return {
    jointLengthFt: safeJointLengthFt,
    jointCount: safeJointCount,
    totalJointLengthFt: safeJointLengthFt * safeJointCount,
    materialUnit: product.materialUnit || '',
    applicationUnit: product.applicationUnit || '',
    materialCostRate,
    coveragePerUnit: toNumber(product.coveragePerUnit, 0),
    wasteFactor,
    qtyPerJoint,
    qtyPerJointFt,
    costPerJoint,
    costPerJointFt,
    totalMaterialQty: qtyPerJoint * safeJointCount,
    totalMaterialCost: costPerJoint * safeJointCount,
  };
}

function calculateRuleQuantity(rule, product, jointLengthFt, jointCount) {
  return calculateConnectorApplicationBreakdown(rule, product, jointLengthFt, jointCount).totalMaterialQty;
}

export function calculateConnectorApplicationsForItem(item = {}, defaults = CONNECTOR_DEFAULTS, options = {}) {
  const standard = options.standard || getActiveStandard(defaults);
  if (!standard || !Array.isArray(standard.rules)) return [];

  const shape = options.shape || inferConnectorShape(item);
  const jointType = options.jointType || (item.kind === 'duct' || item.duct ? 'duct-duct' : 'duct-fitting');
  const jointCount = options.jointCount != null ? toNumber(options.jointCount, 0) : getConnectorJointCount(item, defaults);
  const baseJointLengthFt = options.jointLengthFt != null ? toNumber(options.jointLengthFt, 0) : getConnectorJointLengthFt(item, shape);
  if (!jointCount || !baseJointLengthFt) return [];

  const products = defaults.products || {};
  const sourceId = item.id != null ? item.id : null;
  const sourceType = item.kind || (item.duct ? 'duct' : 'fitting');

  return standard.rules
    .filter(rule => ruleApplies(rule, shape, jointType) && ruleRangeApplies(rule, baseJointLengthFt))
    .map(rule => {
      const product = products[rule.product];
      if (!product) return null;
      const jointLengthFt = options.jointLengthFt != null ? baseJointLengthFt : getRuleJointLengthFt(rule, item, shape);
      const breakdown = calculateConnectorApplicationBreakdown(rule, product, jointLengthFt, jointCount);
      const materialQty = breakdown.totalMaterialQty;
      const materialCost = breakdown.totalMaterialCost;
      const laborHrs = materialQty * toNumber(product.laborHrsPerApplicationUnit, 0);
      return {
        standardKey: options.standardKey || (defaults.takeoffDefaults && defaults.takeoffDefaults.activeStandard) || null,
        standardLabel: standard.label || '',
        ruleId: rule.id,
        ruleLabel: rule.label || rule.id,
        productKey: rule.product,
        productLabel: product.label || rule.product,
        family: product.family || '',
        materialUnit: product.materialUnit || '',
        applicationUnit: product.applicationUnit || '',
        sourceType,
        sourceId,
        sourceItemType: item.type || (item.duct && item.duct.type) || '',
        shape,
        jointType,
        jointCount,
        jointLengthFt,
        totalJointLengthFt: jointLengthFt * jointCount,
        materialQty,
        materialCost,
        laborHrs,
        qtyPerJoint: breakdown.qtyPerJoint,
        qtyPerJointFt: breakdown.qtyPerJointFt,
        costPerJoint: breakdown.costPerJoint,
        costPerJointFt: breakdown.costPerJointFt,
        materialCostRate: breakdown.materialCostRate,
        coveragePerUnit: breakdown.coveragePerUnit,
        wasteFactor: breakdown.wasteFactor,
      };
    })
    .filter(Boolean);
}

export function calculateConnectorApplicationsForTakeoff(takeoff = {}, defaults = CONNECTOR_DEFAULTS, options = {}) {
  const rows = [];
  for (const m of takeoff.measurements || []) {
    if (!m || !m.duct) continue;
    rows.push(...calculateConnectorApplicationsForItem({
      ...m,
      kind: 'duct',
      lengthFt: m.distance && m.distance.value,
    }, defaults, options));
  }
  for (const f of takeoff.fittings || []) {
    rows.push(...calculateConnectorApplicationsForItem({ ...f, kind: 'fitting' }, defaults, options));
  }
  return rows;
}
