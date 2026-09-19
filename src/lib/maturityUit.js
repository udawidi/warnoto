import { DEFAULT_UPT_LIST } from "../data/masterUpt.js";
import { AUDIT_ASPECTS } from "../data/auditAspects.js";
import { getScopeUptIds, roleTier } from "./roles.js";
import {
  MATURITY_WAREHOUSE_ASPECTS,
  MATURITY_WAREHOUSE_TYPES,
  countCompletedEvidenceParents,
  countRequiredEvidenceUnits,
  normalizeMaturityAudit,
} from "./maturityWarehouse.js";

export function maturityUptOptions(user, uptList = []) {
  const source = Array.isArray(uptList) && uptList.length ? uptList : DEFAULT_UPT_LIST;
  const tier = roleTier(user?.role);
  if (tier === "GLOBAL" || tier === "PUSAT") return source;
  if (tier === "UIT") return source.filter(upt => upt.uitId === user?.uitId);
  return source.filter(upt => upt.id === user?.uptId);
}

export function latestMaturityAudit(audits = [], upt) {
  const matches = (audits || []).filter(a => {
    if (a?.uptId && upt?.id) return a.uptId === upt.id;
    return (a?.upt || "UPT Surabaya") === upt?.nama;
  });
  return matches.sort((a, b) => Number(b?.updatedAt || b?.createdAt || 0) - Number(a?.updatedAt || a?.createdAt || 0))[0] || null;
}

export function maturityEvidenceProgress(audit) {
  const normalized = normalizeMaturityAudit(audit);
  const assessments = normalized?.warehouseAssessments || {};
  const warehouses = [MATURITY_WAREHOUSE_TYPES.PERSEDIAAN, MATURITY_WAREHOUSE_TYPES.ATTB_MRWI];
  let filledAspects = 0;
  let totalAspects = 0;
  let evidenceFiles = 0;
  const byWarehouse = {};
  warehouses.forEach(type => {
    const assessment = assessments[type] || {};
    const ids = MATURITY_WAREHOUSE_ASPECTS[type] || [];
    const entries = ids.map(id => ({ id, aspect: null }));
    let filled = 0;
    let total = 0;
    entries.forEach(({ id }) => {
      const evidence = assessment.evidence?.[id] || [];
      const aspect = AUDIT_ASPECTS.find(item => item.id === id);
      const completed = aspect
        ? countCompletedEvidenceParents(aspect, evidence) >= countRequiredEvidenceUnits(aspect)
        : false;
      total += 1;
      filled += completed ? 1 : 0;
      evidenceFiles += evidence.length;
    });
    byWarehouse[type] = { filledAspects: filled, totalAspects: total, pct: total ? Math.round((filled / total) * 100) : 0 };
    filledAspects += filled;
    totalAspects += total;
  });
  const evidence = Object.values(assessments).flatMap(assessment => Object.values(assessment?.evidence || {}).flat());
  const driveCount = evidence.filter(file => file?.driveFileId || file?.isDrive).length;
  const storageCount = evidence.filter(file => file?.storagePath || file?.storage_path).length;
  return {
    filledAspects,
    totalAspects,
    pct: totalAspects ? Math.round((filledAspects / totalAspects) * 100) : 0,
    evidenceFiles,
    driveCount,
    storageCount,
    storageStatus: storageCount === 0 ? "DRIVE_ONLY" : "BACKUP_RECORDED",
    byWarehouse,
  };
}

export function maturityEvidenceStorageStatus(file) {
  if (file?.storagePath || file?.storage_path) return "BACKUP_RECORDED";
  if (file?.driveFileId || file?.isDrive) return file?.source === "Form Pengisian 5S" ? "DRIVE_ONLY" : "DRIVE_ONLY";
  return "UNKNOWN";
}

export function maturityScopeIds(user, uptList = []) {
  return getScopeUptIds(user, uptList);
}
