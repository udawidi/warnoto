const asNumber = value => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const itemKey = item => String(item?.katalogId || item?.noKatalog || item?.id || "").trim();

export function stockOpnameRecommendation({ sapQty, physicalQty, warnotoQty, isSap }) {
  const physical = asNumber(physicalQty);
  const warnoto = asNumber(warnotoQty);
  const sap = asNumber(sapQty);
  if (!isSap) {
    if (physical === null || warnoto === null || physical === warnoto) return "Tidak ada tindakan";
    return physical > warnoto ? "TUG penerimaan" : "TUG pengeluaran";
  }
  const differsFromWarnoto = physical !== null && warnoto !== null && physical !== warnoto;
  const differsFromSap = isSap && physical !== null && (sap === null || sap !== physical);
  if (!differsFromWarnoto && !differsFromSap) return "Tidak ada tindakan";
  if (differsFromWarnoto && differsFromSap) return "TUG + periksa SAP";
  if (differsFromWarnoto) return physical > warnoto ? "TUG penerimaan" : "TUG pengeluaran";
  return "Periksa/koreksi SAP";
}

/**
 * Compares SAP at catalog grain while retaining per-lot physical/system rows.
 * SAP is intentionally read from the first row carrying qtySAP because the
 * import shape stores catalog-level SAP only on rowIndex 0.
 */
export function buildStockOpnameComparisons(items = [], { isSap = false } = {}) {
  const groups = new Map();
  items.forEach((item, index) => {
    const key = itemKey(item) || `row:${index}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, itemIndexes: [], sapQty: null, physicalQty: 0, systemQty: 0, missingPhysical: false };
      groups.set(key, group);
    }
    group.itemIndexes.push(index);
    group.systemQty += asNumber(item?.qtySistem) ?? 0;
    const physical = asNumber(item?.qtsFisik);
    if (physical === null) group.missingPhysical = true;
    else group.physicalQty += physical;
    if (group.sapQty === null && asNumber(item?.qtySAP) !== null) group.sapQty = asNumber(item.qtySAP);
  });
  return [...groups.values()].map(group => {
    const representativeIndex = group.itemIndexes.find(index => asNumber(items[index]?.qtySAP) !== null) ?? group.itemIndexes[0];
    const physicalQty = group.missingPhysical ? null : group.physicalQty;
    const comparable = physicalQty !== null;
    const discrepant = comparable && (isSap
      ? group.sapQty === null || group.sapQty !== group.physicalQty || group.physicalQty !== group.systemQty
      : group.physicalQty !== group.systemQty);
    return {
      ...group,
      physicalQty,
      representativeIndex,
      discrepant,
      recommendation: stockOpnameRecommendation({ sapQty: group.sapQty, physicalQty, warnotoQty: group.systemQty, isSap }),
    };
  });
}

export function comparisonForItem(items, index, options) {
  return buildStockOpnameComparisons(items, options).find(comparison => comparison.itemIndexes.includes(index)) || null;
}

export function itemNeedsStockOpnameNote(items, index, options) {
  const comparison = comparisonForItem(items, index, options);
  return Boolean(comparison?.discrepant && comparison.representativeIndex === index);
}

export function stockOpnameDiscrepancyNoteErrors(items = [], options = {}) {
  return buildStockOpnameComparisons(items, options)
    .filter(comparison => comparison.discrepant)
    .filter(comparison => !String(items[comparison.representativeIndex]?.keterangan || "").trim())
    .map(comparison => ({ comparison, index: comparison.representativeIndex }));
}
