import test from "node:test";
import assert from "node:assert/strict";
import { AUDIT_ASPECTS } from "../../src/data/auditAspects.js";
import { evaluateMaturityWarehouseGate, maturityAspectKey, maturitySampleCompleteness } from "../../src/lib/maturityWarehouse.js";

const aspect = id => AUDIT_ASPECTS.find(entry => entry.id === id);

test("legacy maturity audit keeps the old evidence gate", () => {
  const result = maturitySampleCompleteness(aspect("1.2"), [], {});
  assert.equal(result.complete, true);
  assert.deepEqual(result.missing, []);
});

test("sampling groups require every configured item for every named sample", () => {
  const audit = {
    samplingVersion: 1,
    samplingGroups: {
      "1.2-1.5": {
        id: "1.2-1.5",
        samples: [{ id: "mat-a", label: "Trafo A" }, { id: "mat-b", label: "Trafo B" }],
        aspectIds: ["1.2", "1.3", "1.4", "1.5"],
      },
    },
  };
  const files = aspect("1.2").requiredEvidence.map(item => ({ itemId: item.id, sampleId: "mat-a", sampleGroupId: "1.2-1.5" }));
  const result = maturitySampleCompleteness(aspect("1.2"), files, audit);
  assert.equal(result.complete, false);
  assert.ok(result.missing.some(gap => gap.sampleId === "mat-b"));
});

test("5.1 keeps Persediaan and Cadang sample groups independent", () => {
  const audit = {
    samplingVersion: 1,
    samplingGroups: {
      "5.1-persediaan": { id: "5.1-persediaan", samples: [{ id: "p1" }, { id: "p2" }, { id: "p3" }], aspectIds: ["5.1"] },
      "5.1-cadang": { id: "5.1-cadang", samples: [{ id: "c1" }, { id: "c2" }, { id: "c3" }], aspectIds: ["5.1"] },
    },
  };
  const files = [{ itemId: "it_ams_pdf" }];
  for (const id of ["p1", "p2", "p3", "c1", "c2", "c3"]) {
    files.push({ itemId: id.startsWith("p") ? "it_tableau_persediaan" : "it_tableau_cadang", sampleId: id });
    files.push({ itemId: "it_foto_fisik_material", sampleId: id });
  }
  assert.equal(maturitySampleCompleteness(aspect("5.1"), files, audit).complete, true);
  assert.equal(maturitySampleCompleteness(aspect("5.1"), files.filter(file => file.itemId !== "it_tableau_cadang"), audit).complete, false);
});

test("sample and supplementary uploads cannot fill a global evidence slot", () => {
  const target = aspect("5.1");
  const audit = { samplingVersion: 1, samplingGroups: {
    "5.1-persediaan": { id: "5.1-persediaan", samples: ["p1", "p2", "p3"].map(id => ({ id })) },
    "5.1-cadang": { id: "5.1-cadang", samples: ["c1", "c2", "c3"].map(id => ({ id })) },
  } };
  const files = [
    { itemId: "it_ams_pdf", sampleId: "p1" },
    { itemId: "it_ams_pdf", supplementary: true, extraFolderId: "notes" },
  ];
  for (const id of ["p1", "p2", "p3", "c1", "c2", "c3"]) {
    files.push({ itemId: id.startsWith("p") ? "it_tableau_persediaan" : "it_tableau_cadang", sampleId: id });
    files.push({ itemId: "it_foto_fisik_material", sampleId: id });
  }
  const assessments = { PERSEDIAAN: { evidence: { "5.1": files } }, ATTB_MRWI: { evidence: {} } };
  assert.equal(maturitySampleCompleteness(target, files, audit).complete, false);
  assert.equal(evaluateMaturityWarehouseGate([target], assessments, {}, audit).evidenceComplete, false);
});

test("review gate checks the sample review key for each uploaded sample", () => {
  const target = aspect("1.2");
  const audit = { samplingVersion: 1, samplingGroups: { "1.2-1.5": {
    id: "1.2-1.5", aspectIds: ["1.2"], samples: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
  } } };
  const files = target.requiredEvidence.flatMap(item => ["a", "b"].map(sampleId => ({ itemId: item.id, sampleId, savedAt: 10 })));
  const reviews = Object.fromEntries(files.map(file => [
    `${maturityAspectKey("PERSEDIAAN", "1.2")}::${file.itemId}::${file.sampleId}`,
    { state: "CHECKED", reviewedAt: 20, finalScore: 4 },
  ]));
  const result = evaluateMaturityWarehouseGate([target], { PERSEDIAAN: { evidence: { "1.2": files } }, ATTB_MRWI: { evidence: {} } }, reviews, audit);
  assert.equal(result.evidenceComplete, true);
  assert.equal(result.allItemsChecked, true);
  assert.equal(result.allItemsScored, true);
});
