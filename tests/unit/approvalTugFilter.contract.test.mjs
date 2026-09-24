import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const approval = fs.readFileSync(new URL("../../src/components/ApprovalTab.jsx", import.meta.url), "utf8");
const hub = fs.readFileSync(new URL("../../src/components/ApprovalHubTab.jsx", import.meta.url), "utf8");

test("Approval pending queue keeps sorted pagination without subtype filter", () => {
  assert.match(approval, /const pagedTxns = showTug \? sortedTxns\.slice\(/);
  assert.match(approval, /const sortedTxns = \[\.\.\.pendingTxns\]\.sort\(/);
  assert.doesNotMatch(approval, /tugTypeFilter|approval-tug-filters/);
  assert.doesNotMatch(approval, /visibleTxns/);
});

test("Approval history has permanent TUG subtype filter", () => {
  assert.match(hub, /const \[historyTugFilter, setHistoryTugFilter\] = useState\("ALL"\)/);
  assert.match(hub, /id:`TUG-\$\{t\.id\}`, type:"TUG", docType:t\.docType/);
  assert.match(hub, /t\.approvedByMgrUltg \|\| t\.approvedByManager \|\| t\.approvedBy \|\| t\.approvedByAsman/);
  assert.match(hub, /t\.approvedAtMgrUltg \|\| t\.approvedAtManager \|\| t\.approvedAt \|\| t\.approvedAtAsman/);
  assert.match(hub, /uptId:t\.uptId, requestedBy:t\.createdBy/);
  assert.match(hub, /subtypeFiltered = \(approvalTypeFilter!=="ALL" && approvalTypeFilter!=="TUG"\) \|\| historyTugFilter === "ALL"/);
  assert.match(hub, /label:"Semua TUG"/);
  assert.match(hub, /x\.docType==="TUG3"\?"TUG-3\/4"/);
  assert.match(hub, /setApprovalHistoryPage\(1\); \}, \[historyTugFilter\]/);
});

test("Approval history is actor-only for the active account", () => {
  assert.match(hub, /\.filter\(h => h\.decidedBy === currentUser\.id\)/);
  assert.doesNotMatch(hub, /Approval saya/);
  assert.doesNotMatch(hub, /approvalHistoryMineOnly.*setApprovalHistoryMineOnly/);
  assert.match(hub, /approvedByMgrUltg/);
  assert.match(hub, /approvedAtMgrUltg/);
});

test("legacy Asman stock moves remain in the TL queue only", () => {
  assert.match(approval, /\["TL", "ASMAN"\]\.includes\(s\.lokasiMoveApprover\)/);
  assert.match(hub, /\["TL", "ASMAN"\]\.includes\(s\.lokasiMoveApprover\)/);
  assert.doesNotMatch(hub, /hasRole\(currentUser, "ASMAN"\) && stocks\.some\(s=>s\.lokasiMovePending/);
});
