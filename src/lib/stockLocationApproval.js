/**
 * Decide whether an ADMIN stock-location change needs TL approval.
 * A move within the same warehouse (including sub-warehouse/block/location)
 * is applied immediately. Moving an already-located stock to another
 * warehouse is reviewed by TL. Initial assignment without a source location
 * remains immediate.
 */
export function getAdminStockLocationChange(sourceLocation, targetLocation) {
  const sourceWarehouse = sourceLocation?.gudangId ?? null;
  const targetWarehouse = targetLocation?.gudangId ?? null;
  const crossWarehouse = Boolean(sourceLocation && targetLocation) && sourceWarehouse !== targetWarehouse;
  return {
    requiresApproval: crossWarehouse,
    approver: crossWarehouse ? "TL" : null,
  };
}

export function buildAdminStockLocationUpdate(stock, sourceLocation, targetLocation, requestedBy, requestedAt = Date.now()) {
  const decision = getAdminStockLocationChange(sourceLocation, targetLocation);
  if (decision.requiresApproval) {
    return {
      ...stock,
      lokasiMovePending: true,
      lokasiMoveApprover: decision.approver,
      pendingGudangId: targetLocation.gudangId ?? null,
      pendingLokasiId: targetLocation.id,
      pendingLokasiKode: targetLocation.kode || "-",
      moveRequestedBy: requestedBy,
      moveRequestedAt: requestedAt,
    };
  }

  return {
    ...stock,
    lokasiId: targetLocation?.id || null,
    lokasi: targetLocation?.kode || "-",
    gudangId: targetLocation?.gudangId ?? stock.gudangId ?? null,
    lokasiMovePending: false,
    lokasiMoveApprover: null,
    pendingGudangId: null,
    pendingLokasiId: null,
    pendingLokasiKode: null,
    moveRequestedBy: null,
    moveRequestedAt: null,
  };
}

export function approveStockLocationMove(stock, targetLocation, approvedBy, approvedAt = Date.now()) {
  return {
    ...stock,
    lokasiId: targetLocation.id,
    lokasi: targetLocation.kode || "-",
    gudangId: targetLocation.gudangId ?? stock.pendingGudangId ?? stock.gudangId ?? null,
    lokasiMovePending: false,
    lokasiMoveApprover: null,
    pendingGudangId: null,
    pendingLokasiId: null,
    pendingLokasiKode: null,
    moveRequestedBy: null,
    moveRequestedAt: null,
    moveApprovedBy: approvedBy,
    moveApprovedAt: approvedAt,
  };
}

export function rejectStockLocationMove(stock) {
  return {
    ...stock,
    lokasiMovePending: false,
    lokasiMoveApprover: null,
    pendingGudangId: null,
    pendingLokasiId: null,
    pendingLokasiKode: null,
    moveRequestedBy: null,
    moveRequestedAt: null,
  };
}
