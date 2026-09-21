import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const app = await readFile(new URL("../../App.jsx", import.meta.url), "utf8");

test("cached profile cannot bypass Supabase auth bootstrap", () => {
  assert.match(app, /const \[currentUser, setCurrentUser\] = useState\(readCachedProfile\);/);
  assert.match(app, /const \[authLoading, setAuthLoading\] = useState\(true\);/);
  assert.match(app, /supabase\.auth\.onAuthStateChange\(\(_event, session\)/);
});

test("cloud bootstrap clears refresh state when a loader throws", () => {
  assert.match(app, /loadCloud\(\)\.catch\(error =>/);
  assert.match(app, /setDataRefreshing\(false\);/);
  assert.match(app, /Bootstrap cloud gagal:/);
});

test("cloud bootstrap bounds pending loaders", () => {
  assert.match(app, /const bootstrapLoad = \(promise, label = "bootstrap cloud"\)/);
  assert.match(app, /_withTimeout\(Promise\.resolve\(promise\), 15000, label\)/);
});

test("dismissed maturity migration does not abort cloud bootstrap", () => {
  assert.doesNotMatch(app, /maturityMigrationDismissedSigRef\.current === migrationSignature\) return;/);
  assert.match(app, /maturityMigrationDismissedSigRef\.current !== migrationSignature/);
});
