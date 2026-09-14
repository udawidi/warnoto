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
  assert.match(hub, /t\.approvedBy \|\| t\.approvedByAsman/);
  assert.match(hub, /t\.approvedAt \|\| t\.approvedAtAsman/);
  assert.match(hub, /uptId:t\.uptId, requestedBy:t\.createdBy/);
  assert.match(hub, /subtypeFiltered = \(approvalTypeFilter!=="ALL" && approvalTypeFilter!=="TUG"\) \|\| historyTugFilter === "ALL"/);
  assert.match(hub, /label:"Semua TUG"/);
  assert.match(hub, /x\.docType==="TUG3"\?"TUG-3\/4"/);
  assert.match(hub, /setApprovalHistoryPage\(1\); \}, \[historyTugFilter\]/);
});
