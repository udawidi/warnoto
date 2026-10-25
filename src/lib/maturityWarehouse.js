/** Canonical warehouse buckets used by the maturity audit. */
export const MATURITY_WAREHOUSE_TYPES = Object.freeze({
  PERSEDIAAN: "PERSEDIAAN",
  ATTB_MRWI: "ATTB_MRWI",
});

export const MATURITY_WAREHOUSE_LABELS = Object.freeze({
  PERSEDIAAN: "Gudang Persediaan",
  ATTB_MRWI: "Gudang ATTB/MRWI",
});

// PROGNOSA: V = Persediaan, X = ATTB/MRWI. N/A is not assessed.
export const MATURITY_WAREHOUSE_ASPECTS = Object.freeze({
  PERSEDIAAN: Object.freeze([
    "1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9", "1.10",
    "2.1", "2.2", "2.3", "2.4", "2.5",
    "3.1", "3.2", "3.3", "3.4",
    "4.1", "4.2", "4.3", "4.4", "4.5", "4.6",
    "5.1", "5.2", "5.3",
  ]),
  ATTB_MRWI: Object.freeze(["3.4", "3.5", "3.6", "3.7", "4.3", "4.4", "5.2", "5.4"]),
});

export const MATURITY_SHARED_ASPECTS = Object.freeze(["3.4", "4.3", "4.4", "5.2"]);

export function isMaturityWarehouseType(value) {
  return value === MATURITY_WAREHOUSE_TYPES.PERSEDIAAN || value === MATURITY_WAREHOUSE_TYPES.ATTB_MRWI;
}

export function maturityWarehouseTypeForAspect(aspectId) {
  const id = String(aspectId || "");
  const result = Object.entries(MATURITY_WAREHOUSE_ASPECTS).filter(([, ids]) => ids.includes(id)).map(([type]) => type);
  return result.length ? result : [MATURITY_WAREHOUSE_TYPES.PERSEDIAAN];
}

export function isMaturityAspectApplicable(aspectId, warehouseType) {
  return isMaturityWarehouseType(warehouseType) && MATURITY_WAREHOUSE_ASPECTS[warehouseType].includes(String(aspectId || ""));
}

/** Form 5S is valid only when its saved checklist belongs to the current month. */
export function isCurrentForm5SSaved(evidence, now = new Date()) {
  const entry = (evidence?.["4.5"] || []).find(file => file?.id === "k3_5s_chk");
  if (!entry?.savedAt) return false;
  const savedAt = new Date(entry.savedAt);
  return savedAt.getMonth() === now.getMonth() && savedAt.getFullYear() === now.getFullYear();
}

export function maturityAspectKey(warehouseType, aspectId) {
  const type = isMaturityWarehouseType(warehouseType) ? warehouseType : MATURITY_WAREHOUSE_TYPES.PERSEDIAAN;
  return `${type}::${String(aspectId || "")}`;
}

function clone(value) {
  return value && typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value ?? {}));
}

export function reconcileMaturityAuditEvidence(assessments, canonicalRows = []) {
  const next = clone(assessments || {});
  for (const [type, assessment] of Object.entries(next)) {
    const source = assessment && typeof assessment === "object" ? assessment : {};
    const evidence = Object.fromEntries(Object.entries(source.evidence || {}).map(([aspectId, files]) => [
      aspectId,
      Array.isArray(files) ? files.filter(file => file?.auto === true) : [],
    ]));
    next[type] = { ...source, evidence };
  }
  for (const row of Array.isArray(canonicalRows) ? canonicalRows : []) {
    const rawAspectId = String(row?.aspectId || "");
    if (!rawAspectId) continue;
    const separator = rawAspectId.indexOf("::");
    const typed = separator > 0 ? rawAspectId.slice(0, separator) : MATURITY_WAREHOUSE_TYPES.PERSEDIAAN;
    const aspectId = separator > 0 ? rawAspectId.slice(separator + 2) : rawAspectId;
    const type = isMaturityWarehouseType(typed) ? typed : MATURITY_WAREHOUSE_TYPES.PERSEDIAAN;
    const assessment = next[type] && typeof next[type] === "object" ? next[type] : emptyAssessment();
    const files = assessment.evidence && typeof assessment.evidence === "object" ? assessment.evidence : {};
    next[type] = {
      ...assessment,
      evidence: {
        ...files,
        [aspectId]: [...(Array.isArray(files[aspectId]) ? files[aspectId] : []), { ...row, aspectId, warehouseType: type }],
      },
    };
  }
  return next;
}

export function parseMaturityAuditText(value) {
  const blocks = [];
  let list = [];
  const flush = () => {
    if (list.length) blocks.push({ type: "list", items: list });
    list = [];
  };
  for (const [index, raw] of String(value || "").replace(/\r/g, "").split("\n").entries()) {
    if (!raw.trim()) continue;
    const indent = raw.match(/^\s*/)?.[0].replace(/\t/g, "    ").length || 0;
    const line = raw.trim().replace(/^[•-]\s*/, "");
    if (/^note\s*:?$/i.test(line)) continue;
    const numbered = line.match(/^(?:\((\d+)\)|(\d+)[.)])\s*(.*)$/);
    const lettered = line.match(/^([a-z])[.)]\s*(.*)$/i);
    const nested = lettered || (numbered && indent >= 4 && list.length);
    if (nested && list.length) {
      list[list.length - 1].children.push({ key: `${index}-${line}`, text: (lettered?.[2] || numbered?.[3] || line).trim() });
      continue;
    }
    if (numbered || lettered) {
      list.push({ key: `${index}-${line}`, text: (numbered?.[3] || lettered?.[2] || line).trim(), marker: numbered?.[1] || numbered?.[2] || lettered?.[1], children: [] });
      continue;
    }
    flush();
    blocks.push({ type: line.endsWith(":") ? "heading" : "text", key: `${index}-${line}`, text: line });
  }
  flush();
  return blocks;
}

function emptyAssessment() {
  return { aspekScores: {}, evidence: {}, aiAnalysis: {} };
}

export const MATURITY_LEGACY_ITEM_ALIASES = Object.freeze({
  so_jurnal: "so_jurnal_selisih",
  rwd_foto: "rwd_kegiatan_foto",
  cls_4cluster: "cls_cluster_standby",
  it_tableau_material: "it_tableau_persediaan",
});

export function canonicalMaturityItemId(itemId) {
  return MATURITY_LEGACY_ITEM_ALIASES[String(itemId || "")] || itemId;
}

export function maturityItemIdsForReview(itemId) {
  const canonical = canonicalMaturityItemId(itemId);
  return [canonical, ...Object.entries(MATURITY_LEGACY_ITEM_ALIASES).filter(([, target]) => target === canonical).map(([legacy]) => legacy)];
}

function normalizeFile(file) {
  if (!file || typeof file !== "object") return file;
  const itemId = canonicalMaturityItemId(file.itemId);
  return itemId && itemId !== file.itemId ? { ...file, itemId } : file;
}

function normalizeAssessment(source) {
  const value = source && typeof source === "object" ? source : {};
  const { subEvidenceChecks: _legacyChecklist, ...cleanValue } = value;
  return {
    ...emptyAssessment(),
    ...cleanValue,
    aspekScores: value.aspekScores || {},
    evidence: Object.fromEntries(Object.entries(value.evidence || {}).map(([aspectId, files]) => [
      aspectId,
      (Array.isArray(files) ? files : []).map(file => normalizeFile(aspectId === "2.3" && !file?.itemId ? { ...file, itemId: "pengelola_struktur" } : file)),
    ])),
    aiAnalysis: value.aiAnalysis || {},
  };
}

export function countRequiredEvidenceUnits(aspect) {
  const items = aspect?.requiredEvidence || [];
  const alternatives = new Set(items.filter(item => item.alternativeGroup).map(item => item.alternativeGroup));
  return items.filter(item => !item.alternativeGroup).length + alternatives.size;
}

export function selectedMaturityRequiredItems(aspect, evidenceFiles = []) {
  const items = aspect?.requiredEvidence || [];
  const files = Array.isArray(evidenceFiles) ? evidenceFiles.filter(file => !file?.supplementary && !file?.isSupplementary) : [];
  const groups = new Map();
  for (const item of items) {
    if (!item.alternativeGroup) continue;
    const key = item.alternativeGroup;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const selected = items.filter(item => !item.alternativeGroup);
  for (const group of groups.values()) {
    const paths = new Map();
    for (const item of group) {
      const path = item.alternativePath || item.id;
      if (!paths.has(path)) paths.set(path, []);
      paths.get(path).push(item);
    }
    const complete = [...paths.values()].find(pathItems => pathItems.every(item => files.some(file => canonicalMaturityItemId(file?.itemId) === item.id)));
    selected.push(...(complete || group));
  }
  return selected;
}

export function isMaturitySamplingEnabled(audit) {
  return audit?.samplingEnabled === true || audit?.samplingVersion === 1 || audit?.data?.samplingEnabled === true || audit?.data?.samplingVersion === 1;
}

function samplingEntries(audit) {
  const value = audit?.samples || audit?.materialSamples || audit?.sampling?.samples;
  if (Array.isArray(value)) return value;
  const groups = audit?.samplingGroups || audit?.sampling?.groups;
  if (!groups || typeof groups !== "object") return [];
  return Object.values(groups).flatMap(group => (Array.isArray(group?.samples) ? group.samples : []).map(sample => ({
    ...sample,
    group: sample?.group || sample?.sampleGroup || group?.id || group?.group,
    aspectIds: Array.isArray(group?.aspectIds) ? group.aspectIds : [],
  })));
}

/**
 * Returns missing sample slots for an opted-in audit. Legacy audits return no
 * gaps so their existing single-folder behavior is unchanged.
 */
export function maturitySampleCompleteness(aspect, evidenceFiles = [], audit = null) {
  if (!isMaturitySamplingEnabled(audit) || !aspect?.sampling) return { complete: true, missing: [], sampleCount: 0 };
  const rule = aspect.sampling;
  const groups = Array.isArray(rule.groups) && rule.groups.length ? rule.groups : [rule];
  const samples = samplingEntries(audit).filter(sample => sample && String(sample.id || "").trim());
  const files = Array.isArray(evidenceFiles) ? evidenceFiles.filter(file => !file?.supplementary && !file?.isSupplementary) : [];
  const missing = [];
  for (const groupRule of groups) {
    const group = String(groupRule.group || rule.group || "");
    const scoped = samples.filter(sample => sample.group || sample.sampleGroup
      ? String(sample.group || sample.sampleGroup) === group
      : sample.aspectIds?.includes(aspect.id));
    if (scoped.length < Number(groupRule.minimum || 0)) {
      missing.push({ type: "minimum", group, required: Number(groupRule.minimum || 0), actual: scoped.length });
      continue;
    }
    const configuredItems = groupRule.sampledItemIds ?? rule.sampledItemIds;
    const itemIds = configuredItems === "*"
      ? (aspect.requiredEvidence || []).map(item => [item.id])
      : (configuredItems || []).map(item => Array.isArray(item) ? item.map(String) : [String(item)]);
    for (const sample of scoped) {
      for (const itemIdsForSlot of itemIds) {
        const present = files.some(file => String(file?.sampleId || "") === String(sample.id)
          && itemIdsForSlot.some(itemId => canonicalMaturityItemId(file?.itemId) === canonicalMaturityItemId(itemId)));
        if (!present) missing.push({ type: "slot", group, sampleId: String(sample.id), sampleLabel: sample.label || "", itemId: itemIdsForSlot[0] });
      }
    }
  }
  for (const itemId of rule.globalItemIds || []) {
    if (!files.some(file => !file?.sampleId && canonicalMaturityItemId(file?.itemId) === canonicalMaturityItemId(itemId))) missing.push({ type: "global", itemId });
  }
  return { complete: missing.length === 0, missing, sampleCount: samples.length };
}

export function countCompletedEvidenceParents(aspect, evidenceFiles = []) {
  const files = Array.isArray(evidenceFiles) ? evidenceFiles.filter(file => !file?.supplementary && !file?.isSupplementary) : [];
  const items = aspect?.requiredEvidence || [];
  const isPresent = item => files.some(file => canonicalMaturityItemId(file?.itemId) === item.id || (!file?.itemId && items.length === 1));
  const regular = items.filter(item => !item.alternativeGroup).filter(isPresent).length;
  const groups = new Set(items.filter(item => item.alternativeGroup).map(item => item.alternativeGroup));
  const alternatives = [...groups].filter(group => {
    const paths = new Map();
    for (const item of items.filter(entry => entry.alternativeGroup === group)) {
      const path = item.alternativePath || item.id;
      if (!paths.has(path)) paths.set(path, []);
      paths.get(path).push(item);
    }
    return [...paths.values()].some(pathItems => pathItems.every(isPresent));
  }).length;
  return regular + alternatives;
}

/** Convert the pre-v2 flat audit without writing to the database. */
export function normalizeMaturityAudit(audit) {
  if (!audit || typeof audit !== "object") return audit;
  if (audit.formatVersion >= 2 && audit.warehouseAssessments) {
    return {
      ...audit,
      warehouseAssessments: {
        PERSEDIAAN: normalizeAssessment(audit.warehouseAssessments.PERSEDIAAN),
        ATTB_MRWI: normalizeAssessment(audit.warehouseAssessments.ATTB_MRWI),
      },
    };
  }
  const assessments = { PERSEDIAAN: emptyAssessment(), ATTB_MRWI: emptyAssessment() };
  const scores = audit.aspekScores || {};
  const evidence = audit.evidence || {};
  const aiAnalysis = audit.aiAnalysis || {};
  for (const [aspectId, score] of Object.entries(scores)) {
    for (const type of maturityWarehouseTypeForAspect(aspectId)) {
      // Shared legacy values belong to Persediaan only by policy.
      if (MATURITY_SHARED_ASPECTS.includes(aspectId) && type !== MATURITY_WAREHOUSE_TYPES.PERSEDIAAN) continue;
      assessments[type].aspekScores[aspectId] = clone(score);
    }
  }
  for (const [aspectId, files] of Object.entries(evidence)) {
    const type = MATURITY_SHARED_ASPECTS.includes(aspectId) ? MATURITY_WAREHOUSE_TYPES.PERSEDIAAN : maturityWarehouseTypeForAspect(aspectId)[0];
    assessments[type].evidence[aspectId] = clone(files || []).map(file => (
      normalizeFile(aspectId === "2.3" && !file?.itemId ? { ...file, itemId: "pengelola_struktur" } : file)
    ));
  }
  for (const [aspectId, analysis] of Object.entries(aiAnalysis)) {
    const type = MATURITY_SHARED_ASPECTS.includes(aspectId) ? MATURITY_WAREHOUSE_TYPES.PERSEDIAAN : maturityWarehouseTypeForAspect(aspectId)[0];
    assessments[type].aiAnalysis[aspectId] = clone(analysis);
  }
  return { ...audit, formatVersion: 2, warehouseAssessments: assessments };
}

export function createMaturityWarehouseAssessments() {
  return { PERSEDIAAN: emptyAssessment(), ATTB_MRWI: emptyAssessment() };
}

export function flattenMaturityWarehouseAssessments(assessments) {
  const normalized = assessments || createMaturityWarehouseAssessments();
  const flat = { aspekScores: {}, evidence: {}, aiAnalysis: {} };
  for (const type of Object.keys(MATURITY_WAREHOUSE_TYPES)) {
    const source = normalized[type] || emptyAssessment();
    for (const [id, value] of Object.entries(source.aspekScores || {})) if (flat.aspekScores[id] == null) flat.aspekScores[id] = clone(value);
    for (const [id, value] of Object.entries(source.evidence || {})) if (flat.evidence[id] == null) flat.evidence[id] = clone(value);
    for (const [id, value] of Object.entries(source.aiAnalysis || {})) if (flat.aiAnalysis[id] == null) flat.aiAnalysis[id] = clone(value);
  }
  return flat;
}

function scoreForAspect(aspect, assessment, calculateItemLevel) {
  const scores = assessment?.aspekScores || {};
  const evidence = assessment?.evidence || {};
  const value = scores[aspect.id] || {};
  for (const key of ["pusat", "uit", "upt"]) if (Number(value[key]) > 0) return Number(value[key]);
  const count = countCompletedEvidenceParents(aspect, evidence[aspect.id] || []);
  return calculateItemLevel(count, countRequiredEvidenceUnits(aspect));
}

export function calculateMaturityWarehouseScore(aspects, assessment, calculateItemLevel = (count, total) => {
  if (!count) return 1;
  if (count >= total) return 5;
  const ratio = count / total;
  return ratio < 0.35 ? 2 : ratio < 0.7 ? 3 : 4;
}) {
  const applicable = (aspects || []).filter(a => isMaturityAspectApplicable(a.id, assessment?.warehouseType || "PERSEDIAAN"));
  const categoryAverages = {};
  for (const aspect of applicable) {
    const cat = aspect.category;
    if (!categoryAverages[cat]) categoryAverages[cat] = [];
    categoryAverages[cat].push(scoreForAspect(aspect, assessment, calculateItemLevel));
  }
  const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const categories = Object.fromEntries(Object.entries(categoryAverages).map(([cat, values]) => [cat, average(values)]));
  const values = Object.values(categories);
  const overall = average(values);
  return { categories, score: overall, aspectScores: Object.fromEntries(applicable.map(a => [a.id, scoreForAspect(a, assessment, calculateItemLevel)])) };
}

export function calculateMaturityDualScore(aspects, assessments, calculateItemLevel) {
  const persediaan = calculateMaturityWarehouseScore(aspects, { ...(assessments?.PERSEDIAAN || {}), warehouseType: MATURITY_WAREHOUSE_TYPES.PERSEDIAAN }, calculateItemLevel);
  const attb = calculateMaturityWarehouseScore(aspects, { ...(assessments?.ATTB_MRWI || {}), warehouseType: MATURITY_WAREHOUSE_TYPES.ATTB_MRWI }, calculateItemLevel);
  const score = persediaan.score * 0.75 + attb.score * 0.25;
  const level = score >= 4.5 ? 5 : score >= 3.5 ? 4 : score >= 2.5 ? 3 : score >= 1.5 ? 2 : 1;
  return { persediaan, attbMrwi: attb, itemA: persediaan.score * 0.75, itemB: attb.score * 0.25, score, total: score, level };
}

/**
 * Evaluate workflow gates across every applicable warehouse. Legacy review
 * keys are accepted only for Persediaan; ATTB/MRWI must use typed keys.
 */
export function evaluateMaturityWarehouseGate(aspects, assessments, reviews = {}, audit = null) {
  const applicable = Object.values(MATURITY_WAREHOUSE_TYPES).flatMap(type =>
    (aspects || [])
      .filter(aspect => isMaturityAspectApplicable(aspect.id, type))
      .map(aspect => ({ type, aspect }))
  );
  const reviewFor = (type, aspectId, itemId, sampleId = null) => {
    const ids = maturityItemIdsForReview(itemId);
    const sampleSuffix = sampleId ? `::${sampleId}` : "";
    return ids.map(id => reviews[`${maturityAspectKey(type, aspectId)}::${id}${sampleSuffix}`]).find(Boolean)
      || (sampleId ? undefined : ids.map(id => reviews[`${maturityAspectKey(type, aspectId)}::${id}`]).find(Boolean))
      || (type === MATURITY_WAREHOUSE_TYPES.PERSEDIAAN ? ids.map(id => reviews[`${aspectId}::${id}${sampleSuffix}`]).find(Boolean) : undefined)
      || (type === MATURITY_WAREHOUSE_TYPES.PERSEDIAAN && !sampleId ? ids.map(id => reviews[`${aspectId}::${id}`]).find(Boolean) : undefined);
  };
  const filesFor = ({ type, aspect }) => (assessments?.[type]?.evidence?.[aspect.id] || []).filter(file => !file?.supplementary && !file?.isSupplementary);
  const toEpoch = value => Number(value) || (value ? Date.parse(value) || 0 : 0);
  const latestFileAt = files => Math.max(0, ...files.map(file => toEpoch(file?.savedAt || file?.uploadedAt || file?.createdAt || file?.linkedAt)));
  const reviewIsCurrent = (review, files) => {
    if (!review || review.state !== "CHECKED") return false;
    return toEpoch(review.reviewedAt) >= latestFileAt(files);
  };
  const filesForItem = ({ type, aspect, item, sampleId = null }) => filesFor({ type, aspect }).filter(file =>
    (sampleId ? String(file?.sampleId || "") === String(sampleId) : !file?.sampleId)
    && canonicalMaturityItemId(file?.itemId) === item.id
    || (!sampleId && !file?.sampleId && !file?.itemId && aspect.requiredEvidence.length === 1)
  );
  const sampledRequiredIds = aspect => {
    if (!isMaturitySamplingEnabled(audit) || !aspect?.sampling) return new Set();
    const rule = aspect.sampling;
    const groups = Array.isArray(rule.groups) && rule.groups.length ? rule.groups : [rule];
    return new Set(groups.flatMap(groupRule => {
      const configured = groupRule.sampledItemIds ?? rule.sampledItemIds;
      if (configured === "*") return (aspect.requiredEvidence || []).filter(item => !(rule.globalItemIds || []).includes(item.id)).map(item => item.id);
      return (configured || []).flatMap(item => Array.isArray(item) ? item : [item]);
    }).flatMap(itemId => (aspect.requiredEvidence || []).filter(item => maturityItemIdsForReview(itemId).includes(item.id)).map(item => item.id)));
  };
  const missingEvidence = applicable.flatMap(({ type, aspect }) => {
    const files = filesFor({ type, aspect });
    const selected = selectedMaturityRequiredItems(aspect, files);
    const sampledIds = sampledRequiredIds(aspect);
    return selected.filter(item => !sampledIds.has(item.id) && filesForItem({ type, aspect, item }).length === 0)
      .map(item => ({ type, aspectId: aspect.id, itemId: item.id }));
  });
  const samplingMissing = applicable.flatMap(({ type, aspect }) => maturitySampleCompleteness(aspect, filesFor({ type, aspect }), audit).missing.map(gap => ({ type, aspectId: aspect.id, ...gap })));
  const evidenceComplete = missingEvidence.length === 0 && samplingMissing.length === 0;
  const sampledReviewChecks = applicable.flatMap(({ type, aspect }) => {
    if (!isMaturitySamplingEnabled(audit) || !aspect?.sampling) return [];
    const rule = aspect.sampling;
    const groups = Array.isArray(rule.groups) && rule.groups.length ? rule.groups : [rule];
    const samples = samplingEntries(audit);
    const files = filesFor({ type, aspect });
    return groups.flatMap(groupRule => {
      const group = String(groupRule.group || rule.group || "");
      const scopedSamples = samples.filter(sample => sample.group || sample.sampleGroup
        ? String(sample.group || sample.sampleGroup) === group
        : sample.aspectIds?.includes(aspect.id));
      const configured = groupRule.sampledItemIds ?? rule.sampledItemIds;
      const itemIds = configured === "*"
        ? (aspect.requiredEvidence || []).filter(item => !(rule.globalItemIds || []).includes(item.id)).map(item => item.id)
        : (configured || []).flatMap(item => Array.isArray(item) ? item : [item]);
      return scopedSamples.flatMap(sample => itemIds.map(itemId => {
        const item = (aspect.requiredEvidence || []).find(candidate => maturityItemIdsForReview(itemId).includes(candidate.id));
        return item ? { type, aspect, item, sampleId: String(sample.id), files } : null;
      }).filter(Boolean));
    });
  });
  const regularItemChecks = applicable.flatMap(({ type, aspect }) => selectedMaturityRequiredItems(aspect, filesFor({ type, aspect })).map(item => ({ type, aspect, item })));
  const sampledItemIds = new Set(sampledReviewChecks.map(({ aspect, item }) => `${aspect.id}::${item.id}`));
  const itemChecks = [...regularItemChecks.filter(({ aspect, item }) => !sampledItemIds.has(`${aspect.id}::${item.id}`)), ...sampledReviewChecks];
  const allItemsChecked = itemChecks.every(({ type, aspect, item, sampleId }) => {
    const files = filesForItem({ type, aspect, item, sampleId });
    if (files.length > 0 && files.every(file => file.auto === true)) return true;
    const parentReview = reviewFor(type, aspect.id, item.id, sampleId);
    return files.length > 0 && reviewIsCurrent(parentReview, files);
  });
  const allItemsScored = itemChecks.every(({ type, aspect, item, sampleId }) => {
    const files = filesForItem({ type, aspect, item, sampleId });
    if (files.length > 0 && files.every(file => file.auto === true)) return true;
    const review = reviewFor(type, aspect.id, item.id, sampleId);
    return files.length > 0 && reviewIsCurrent(review, files) && review?.finalScore != null;
  });
  return { evidenceComplete, allItemsChecked, allItemsScored, applicableCount: applicable.length, itemCount: itemChecks.length, missingEvidence, missingSampling: samplingMissing, missingSubpoints: [] };
}
