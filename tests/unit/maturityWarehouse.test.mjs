import test from "node:test";
import assert from "node:assert/strict";
import { AUDIT_ASPECTS } from "../../src/data/auditAspects.js";
import { MATLEV_SOURCE, MATLEV_MANUAL_CRITERIA, MATLEV_EVIDENCE_SPLITS } from "../../src/data/matlevSource.js";
import { MATURITY_WAREHOUSE_ASPECTS, MATURITY_SHARED_ASPECTS, maturityAspectKey, normalizeMaturityAudit, calculateMaturityDualScore, evaluateMaturityWarehouseGate, isCurrentForm5SSaved, countCompletedEvidenceParents, calculateMaturityWarehouseScore, canonicalMaturityItemId, maturityItemIdsForReview, parseMaturityAuditText, selectedMaturityRequiredItems, reconcileMaturityAuditEvidence } from "../../src/lib/maturityWarehouse.js";
import { analyzeMaturityAspect, hashAspectSnapshot, buildMaturityEvidenceChecklist } from "../../src/lib/maturityAi.js";

test("PROGNOSA applicability is 28 Persediaan and 8 ATTB/MRWI", () => {
  assert.equal(MATURITY_WAREHOUSE_ASPECTS.PERSEDIAAN.length, 28);
  assert.equal(MATURITY_WAREHOUSE_ASPECTS.ATTB_MRWI.length, 8);
  assert.deepEqual(MATURITY_SHARED_ASPECTS, ["3.4", "4.3", "4.4", "5.2"]);
});

test("all 32 aspects expose the exact PROGNOSA J/K source text", () => {
  assert.equal(Object.keys(MATLEV_SOURCE).length, 32);
  assert.equal(AUDIT_ASPECTS.length, 32);
  for (const aspect of AUDIT_ASPECTS) {
    assert.equal(aspect.sourceEvidence, MATLEV_SOURCE[aspect.id].requiredEvidence, `${aspect.id} evidence`);
    assert.equal(aspect.sourceNote, MATLEV_SOURCE[aspect.id].catatan, `${aspect.id} note`);
  }
});

test("fresh and normalized assessments do not persist the retired checklist", () => {
  for (const assessment of Object.values(normalizeMaturityAudit({ formatVersion: 2, warehouseAssessments: { PERSEDIAAN: {}, ATTB_MRWI: {} } }).warehouseAssessments)) assert.equal("subEvidenceChecks" in assessment, false);
  for (const assessment of Object.values(normalizeMaturityAudit({ formatVersion: 2, warehouseAssessments: { PERSEDIAAN: { subEvidenceChecks: { "3.4": {} } }, ATTB_MRWI: {} } }).warehouseAssessments)) assert.equal("subEvidenceChecks" in assessment, false);
});

test("reconcile evidence membuang stale, mempertahankan Form 5S, dan memetakan aspek typed/untyped", () => {
  const result = reconcileMaturityAuditEvidence({
    PERSEDIAAN: { evidence: { "1.1": [{ id: "stale" }, { id: "k3_5s_chk", auto: true }] } },
    ATTB_MRWI: { evidence: { "3.4": [{ id: "stale-attb" }, { id: "k3_5s_foto", auto: true }] } },
  }, [
    { id: "canonical-p", aspectId: "1.1", itemId: "p", name: "p.pdf" },
    { id: "canonical-a", aspectId: "ATTB_MRWI::3.4", itemId: "a", name: "a.jpg" },
  ]);
  assert.equal(result.PERSEDIAAN.evidence["1.1"].some(file => file.id === "canonical-p"), true);
  assert.equal(result.PERSEDIAAN.evidence["4.5"]?.length || 0, 0);
  assert.equal(result.PERSEDIAAN.evidence["1.1"].some(file => file.id === "k3_5s_chk"), true);
  assert.equal(result.PERSEDIAAN.evidence["1.1"].some(file => file.id === "stale"), false);
  assert.equal(result.ATTB_MRWI.evidence["3.4"].some(file => file.id === "stale-attb"), false);
  assert.equal(result.ATTB_MRWI.evidence["3.4"].find(file => file.id === "canonical-a")?.warehouseType, "ATTB_MRWI");
  assert.equal(result.ATTB_MRWI.evidence["3.4"].some(file => file.id === "k3_5s_foto"), true);
});

test("manual criteria are exactly 19 checker-only points across 5 parent patterns", () => {
  const patterns = Object.entries(MATLEV_MANUAL_CRITERIA);
  assert.deepEqual(patterns.map(([id]) => id), ["1.8", "2.3", "3.4", "3.5", "5.2"]);
  assert.equal(patterns.reduce((total, [, items]) => total + Object.values(items).flat().length, 0), 19);
  for (const [aspectId, items] of patterns) for (const itemId of Object.keys(items)) {
    const item = AUDIT_ASPECTS.find(aspect => aspect.id === aspectId)?.requiredEvidence.find(entry => entry.id === itemId);
    assert.ok(item, `${aspectId}/${itemId} parent`);
    assert.deepEqual(item.manualCriteria, items[itemId]);
    assert.equal(item.subpoints, undefined);
  }
});

test("true child upload items are exactly 10 and all have normal evidence IDs", () => {
  const children = Object.values(MATLEV_EVIDENCE_SPLITS).flatMap(aspect => Object.values(aspect).flat());
  assert.equal(children.length, 10);
  assert.equal(new Set(children.map(item => item.id)).size, 10);
  for (const child of children) assert.ok(AUDIT_ASPECTS.some(aspect => aspect.requiredEvidence.some(item => item.id === child.id)));
});

test("evidence card titles do not repeat their visible sequence number", () => {
  for (const aspect of AUDIT_ASPECTS) for (const item of aspect.requiredEvidence) {
    assert.doesNotMatch(item.label, /^\d+[.)]\s*/, `${aspect.id}/${item.id}`);
    assert.equal(item.label.includes("\n"), false, `${aspect.id}/${item.id} single line`);
    assert.ok(item.label.length <= 120, `${aspect.id}/${item.id} concise title`);
  }
});

test("2.5 accepts either standalone rwd_nd or the complete kegiatan pair", () => {
  const aspect = AUDIT_ASPECTS.find(item => item.id === "2.5");
  assert.equal(countCompletedEvidenceParents(aspect, [{ itemId: "rwd_nd" }]), 1);
  assert.equal(countCompletedEvidenceParents(aspect, [{ itemId: "rwd_kegiatan_nd" }]), 0);
  assert.equal(countCompletedEvidenceParents(aspect, [{ itemId: "rwd_kegiatan_nd" }, { itemId: "rwd_kegiatan_foto" }]), 1);
  assert.deepEqual(selectedMaturityRequiredItems(aspect, [{ itemId: "rwd_nd" }]).map(item => item.id), ["rwd_nd"]);
  assert.deepEqual(selectedMaturityRequiredItems(aspect, [{ itemId: "rwd_kegiatan_nd" }, { itemId: "rwd_kegiatan_foto" }]).map(item => item.id), ["rwd_kegiatan_nd", "rwd_kegiatan_foto"]);
});

test("legacy item IDs normalize to canonical child IDs and reviews accept both", () => {
  assert.equal(canonicalMaturityItemId("rwd_foto"), "rwd_kegiatan_foto");
  assert.deepEqual(maturityItemIdsForReview("rwd_kegiatan_foto"), ["rwd_kegiatan_foto", "rwd_foto"]);
  const audit = normalizeMaturityAudit({ formatVersion: 2, warehouseAssessments: { PERSEDIAAN: { evidence: { "2.5": [{ itemId: "rwd_foto" }] } }, ATTB_MRWI: {} } });
  assert.equal(audit.warehouseAssessments.PERSEDIAAN.evidence["2.5"][0].itemId, "rwd_kegiatan_foto");
});

test("duplicate files count once per required evidence item", () => {
  const aspect = AUDIT_ASPECTS.find(item => item.id === "3.5");
  const evidence = { "3.5": [{ itemId: "exops_tug10" }, { itemId: "exops_tug10" }] };
  assert.equal(countCompletedEvidenceParents(aspect, evidence["3.5"]), 1);
  assert.equal(calculateMaturityWarehouseScore([aspect], { warehouseType: "ATTB_MRWI", evidence }, count => count).aspectScores["3.5"], 1);
});

test("manual criteria never create child gate or review requirements", () => {
  const aspect = AUDIT_ASPECTS.find(item => item.id === "3.4");
  const files = [{ itemId: "eval_notulen", savedAt: 100 }];
  const reviews = { [`PERSEDIAAN::3.4::eval_notulen`]: { state: "CHECKED", reviewedAt: 100, finalScore: 4 }, [`ATTB_MRWI::3.4::eval_notulen`]: { state: "CHECKED", reviewedAt: 100, finalScore: 4 } };
  const result = evaluateMaturityWarehouseGate([aspect], { PERSEDIAAN: { evidence: { "3.4": files } }, ATTB_MRWI: { evidence: { "3.4": files } } }, reviews);
  assert.equal(result.evidenceComplete, true);
  assert.equal(result.itemCount, 2);
  assert.deepEqual(result.missingSubpoints, []);
});

test("upload ulang setelah reject membuat review lama tidak current", () => {
  const aspect = AUDIT_ASPECTS.find(item => item.id === "3.5");
  const files = [{ itemId: "exops_tug10", linkedAt: 200 }];
  const reviews = { "PERSEDIAAN::3.5::exops_tug10": { state: "CHECKED", reviewedAt: 100, finalScore: 4 } };
  const result = evaluateMaturityWarehouseGate([aspect], { PERSEDIAAN: { evidence: { "3.5": files } } }, reviews);
  assert.equal(result.allItemsChecked, false);
  assert.equal(result.allItemsScored, false);
});

test("legacy shared evidence remains assigned to Persediaan only", () => {
  const audit = normalizeMaturityAudit({ id: "legacy", aspekScores: { "3.4": { upt: 4 } }, evidence: { "3.4": [{ id: "old" }] } });
  assert.deepEqual(audit.warehouseAssessments.PERSEDIAAN.evidence["3.4"], [{ id: "old" }]);
  assert.equal(audit.warehouseAssessments.ATTB_MRWI.evidence["3.4"], undefined);
  assert.equal(maturityAspectKey("ATTB_MRWI", "3.4"), "ATTB_MRWI::3.4");
});

test("dual score applies 75/25 weights", () => {
  const make = (score, ids) => ({ warehouseType: ids === MATURITY_WAREHOUSE_ASPECTS.PERSEDIAAN ? "PERSEDIAAN" : "ATTB_MRWI", aspekScores: Object.fromEntries(ids.map(id => [id, { upt: score }])), evidence: {}, aiAnalysis: {} });
  const result = calculateMaturityDualScore(AUDIT_ASPECTS, { PERSEDIAAN: make(4, MATURITY_WAREHOUSE_ASPECTS.PERSEDIAAN), ATTB_MRWI: make(2, MATURITY_WAREHOUSE_ASPECTS.ATTB_MRWI) });
  assert.equal(result.score, 3.5);
  assert.equal(result.level, 4);
});

test("Form 5S gate always uses Persediaan evidence", () => {
  const now = new Date("2026-09-15T12:00:00Z");
  assert.equal(isCurrentForm5SSaved({ "4.5": [{ id: "k3_5s_chk", savedAt: "2026-09-01T12:00:00Z" }] }, now), true);
  assert.equal(isCurrentForm5SSaved({ "4.5": [{ id: "k3_5s_chk", savedAt: "2026-08-30T23:59:00Z" }] }, now), false);
});

test("AI snapshot hash changes when manual criteria text changes", () => {
  const evidence = [{ id: "file-1", name: "notulen.pdf", size: 10 }];
  const context = { manualCriteria: ["Kontrak material", "Rencana penyimpanan"] };
  assert.notEqual(hashAspectSnapshot(evidence, { upt: 3 }, context), hashAspectSnapshot(evidence, { upt: 3 }, { manualCriteria: ["Kontrak material berubah", "Rencana penyimpanan"] }));
  assert.equal(hashAspectSnapshot(evidence, { upt: 1 }, context), hashAspectSnapshot(evidence, { upt: 5 }, context));
});

test("AI checklist uses canonical item IDs and treats uploads as unverified metadata", () => {
  const aspect = AUDIT_ASPECTS.find(item => item.id === "2.5");
  const checklist = buildMaturityEvidenceChecklist(aspect, [
    { id: "one", itemId: "rwd_kegiatan_nd", name: "notulen.pdf" },
    { id: "two", itemId: "rwd_foto", name: "foto.pdf" },
    { id: "three", itemId: "rwd_foto", name: "foto-duplikat.pdf" },
  ]);
  assert.deepEqual(checklist.map(item => item.id), ["rwd_kegiatan_nd", "rwd_kegiatan_foto"]);
  assert.equal(checklist.every(item => item.terunggah), true);
  assert.equal(checklist.every(item => item.terpenuhi === false), true);
  assert.equal(checklist.every(item => item.status === "TERUNGGAH_PERLU_VERIFIKASI"), true);
});

test("AI response contract is compact and failures never become Level 1", async () => {
  const aspect = AUDIT_ASPECTS.find(item => item.id === "2.5");
  const evidence = [{ id: "file-1", itemId: "rwd_nd", name: "nd.pdf" }];
  const calls = [];
  let mode = "valid";
  const invoke = async (name, options) => {
    calls.push({ name, options });
    if (mode === "valid") return { data: { choices: [{ message: { content: '{"levelPotensial":3,"alasanPenilaian":"Slot metadata tersedia."}' } }] }, error: null };
    if (mode === "malformed") return { data: { choices: [{ message: { content: "bukan-json" } }] }, error: null };
    return { data: null, error: new Error("Edge Function gagal") };
  };

  const answered = await analyzeMaturityAspect(aspect, evidence, {}, { invoke });
  assert.equal(answered.status, "ANSWERED");
  assert.equal(answered.levelPotensial, 3);
  assert.equal(answered.perEvidence.length > 0, true);
  assert.equal(calls[0].name, "ai-proxy");
  assert.equal(calls[0].options.body.max_tokens, 300);

  mode = "malformed";
  const malformed = await analyzeMaturityAspect(aspect, evidence, {}, { invoke });
  assert.equal(malformed.status, "ERROR");
  assert.equal(malformed.levelPotensial, null);
  assert.equal(malformed.estimasiLevel, null);
  assert.equal(malformed.perEvidence.length > 0, true);

  mode = "error";
  const failed = await analyzeMaturityAspect(aspect, evidence, {}, { invoke });
  assert.equal(failed.status, "ERROR");
  assert.equal(failed.levelPotensial, null);
  assert.equal(failed.perEvidence.length > 0, true);
});

test("evidence notes become numbered lists with nested letter points", () => {
  const blocks = parseMaturityAuditText("Note :\n\n1. Area gudang tertutup:\n  a. Area bongkar muat\n  b. Area penyimpanan\n2. Area gudang terbuka:\n  a. Cluster ATTB standby");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "list");
  assert.deepEqual(blocks[0].items.map(item => item.text), ["Area gudang tertutup:", "Area gudang terbuka:"]);
  assert.deepEqual(blocks[0].items.map(item => item.children.map(child => child.text)), [["Area bongkar muat", "Area penyimpanan"], ["Cluster ATTB standby"]]);
});
