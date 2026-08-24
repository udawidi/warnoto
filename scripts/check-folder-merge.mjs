// Mirrors chooseFolderMerge() in supabase/functions/maturity-drive/index.ts
// (duplicated because that file is Deno TS; keep both in sync on change).
function chooseFolderMerge(foundIds, dbId) {
  const keep = dbId && foundIds.includes(dbId) ? dbId : foundIds[0];
  const extras = foundIds.filter((id) => id !== keep);
  return { keep, extras };
}

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
  console.log(`ok - ${label}`);
}

assertEqual(chooseFolderMerge(["a", "b"], "b"), { keep: "b", extras: ["a"] }, "dbId matches second found id");
assertEqual(chooseFolderMerge(["a", "b"], "z"), { keep: "a", extras: ["b"] }, "dbId not among found ids falls back to first");
assertEqual(chooseFolderMerge(["a"], "a"), { keep: "a", extras: [] }, "single folder is a no-op");

console.log("check-folder-merge: all checks passed");
