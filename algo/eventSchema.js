/**
 * algo/eventSchema.js
 * Common object model for Price Delivery Operating System (PDOS) events.
 * Defines standard schemas and factory functions for all structural events,
 * ensuring complete database compatibility and pipeline backward compatibility.
 */

const CONCEPT_FAMILIES = {
  fvg: 'Imbalances',
  ifvg: 'Imbalances',
  volume_imbalance: 'Imbalances',
  liquidity_void: 'Imbalances',
  liquidity: 'Liquidity',
  swing: 'Swings',
  strong_swing: 'Swings',
  mss: 'Structure Breaks',
  bos: 'Structure Breaks',
  protected_high_low: 'Structure Breaks',
  ob: 'Order Flow',
  breaker: 'Order Flow',
  displacement: 'Order Flow',
  session: 'Time Context',
  macro: 'Time Context',
  amd: 'Order Flow',
  premium_discount: 'Price Context'
};

/**
 * Maps a concept type to its corresponding concept family.
 * @param {string} type - Concept type (e.g. 'fvg', 'ob', 'mss')
 * @returns {string} Concept family
 */
function getConceptFamily(type) {
  if (!type) return 'Other';
  const lowercaseType = type.toLowerCase();
  if (CONCEPT_FAMILIES[lowercaseType]) {
    return CONCEPT_FAMILIES[lowercaseType];
  }
  const prefix = lowercaseType.split('_')[0];
  if (CONCEPT_FAMILIES[prefix]) {
    return CONCEPT_FAMILIES[prefix];
  }
  // Try matching key prefix in CONCEPT_FAMILIES
  for (const key of Object.keys(CONCEPT_FAMILIES)) {
    if (lowercaseType.startsWith(key)) {
      return CONCEPT_FAMILIES[key];
    }
  }
  return 'Other';
}

/**
 * Common event object factory function.
 * Creates a flat, fully-compatible candidate/event object.
 */
function makeEvent({
  id = null,
  type,
  direction,
  time,
  timeStart,
  timeEnd = null,
  priceHigh,
  priceLow,
  barIndex,
  symbol = '',
  timeframe = 1,
  state = 'active',
  
  // Universal Market Object Contract Fields
  createdBy = null,
  validatedBy = null,
  consumes = null,
  targets = null,
  invalidatedBy = null,
  lifecycleState = null,
  narrativeRole = 'contextual_evidence',
  inheritedFrom = null,
  renderability = null,
  researchMetadata = {},
  
  properties = {},
  ...extraProps
}) {
  if (!type) throw new Error('[eventSchema] Event type is required.');
  if (!direction) throw new Error('[eventSchema] Event direction is required.');
  if (time === undefined || time === null) throw new Error('[eventSchema] Event time is required.');
  if (timeStart === undefined || timeStart === null) throw new Error('[eventSchema] Event timeStart is required.');
  if (priceHigh === undefined || priceHigh === null) throw new Error('[eventSchema] Event priceHigh is required.');
  if (priceLow === undefined || priceLow === null) throw new Error('[eventSchema] Event priceLow is required.');
  if (barIndex === undefined || barIndex === null) throw new Error('[eventSchema] Event barIndex is required.');

  const resolvedLifecycle = lifecycleState || state || 'active';
  const defaultRenderability = renderability || {
    visibleInMode: 'narrative',
    opacity: 0.85
  };

  return {
    // Core identifier and structural properties
    id: id || `${type}_${direction}_${time}`,
    type,
    direction,
    time,
    timeStart,
    timeEnd: timeEnd !== undefined ? timeEnd : null,
    priceHigh,
    priceLow,
    barIndex,
    symbol,
    timeframe,
    state: resolvedLifecycle,
    properties,
    
    // Concept classification
    conceptFamily: getConceptFamily(type),
    
    // Universal Market Object Contract Implementation
    createdBy,
    validatedBy,
    consumes,
    targets,
    invalidatedBy,
    lifecycleState: resolvedLifecycle,
    narrativeRole,
    inheritedFrom,
    renderability: defaultRenderability,
    researchMetadata,
    
    // Capture any and all type-specific fields inline to remain flat (backward compatible)
    ...extraProps,
    
    // Audit trace
    createdAt: Date.now()
  };
}

module.exports = {
  makeEvent,
  getConceptFamily,
  CONCEPT_FAMILIES
};
