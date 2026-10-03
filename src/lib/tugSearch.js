import { matchesMaterialSearch } from "./sap.js";

export function matchesTugHistorySearch(txn, query, { enrichedStocks = [], katalogList = [] } = {}) {
  if (!query?.trim()) return true;
  const fields = [txn?.id, txn?.namaPekerjaan, txn?.pekerjaan, txn?.judulKontrak,
    ...Object.values(txn?.docNumbers || {})];
  if (txn?.docType === "TUG3") fields.push(txn.dariSupplier);
  if (txn?.docType === "TUG10") fields.push(txn.menyerahkanUnit, txn.menyerahkanNama);
  (txn?.stockItems || []).forEach(si => {
    const stock = enrichedStocks.find(s => s.id === si.stockId);
    const katalog = katalogList.find(k => k.id === si.katalogId);
    fields.push(si.namaBaru, si.katalogBaru, si.katalog, si.katalogId, si.unit, si.snapshot?.name,
      si.snapshot?.katalog, si.snapshot?.nama, katalog?.name, katalog?.katalog, katalog?.id,
      stock?.name, stock?.katalog, stock?.id, stock?.keteranganBarang);
    if (txn?.docType === "TUG8" || txn?.docType === "TUG9") {
      const hasSnapshot = si.sourceSnapshot && typeof si.sourceSnapshot === "object";
      const contracts = hasSnapshot ? (si.sourceSnapshot.contracts || []) : (si.sourceLot?.contracts || []);
      contracts.forEach(ref => fields.push(ref?.supplier, ref?.noKontrak, ref?.docNo));
      if (!hasSnapshot) (stock?.kontrakRefs || []).forEach(ref => fields.push(ref?.supplier, ref?.noKontrak, ref?.docNo));
    }
  });
  return matchesMaterialSearch(fields, query);
}
