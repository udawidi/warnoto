import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const app = await readFile(new URL("../../App.jsx", import.meta.url), "utf8");

test("cached profile cannot bypass Supabase auth bootstrap", () => {
  assert.match(app, /const \[currentUser, setCurrentUser\] = useState\(readCachedProfile\);/);
  assert.match(app, /const \[authLoading, setAuthLoading\] = useState\(true\);/);
  assert.match(app, /const authGenerationRef = useRef\(0\);/);
  assert.match(app, /const authRecoveryRef = useRef\(null\);/);
  assert.match(app, /const generation = \+\+authGenerationRef\.current;/);
  assert.match(app, /const isCurrent = \(\) => authGenerationRef\.current === generation;/);
  assert.match(app, /supabase\.auth\.onAuthStateChange\(\(_event, session\)/);
});

test("profile validation failure cannot open the scoped data loader from cache", () => {
  assert.match(app, /Sesi login belum dapat diverifikasi\. Silakan masuk kembali\./);
  assert.match(app, /clearLocalAuthState\(\);/);
  assert.match(app, /if \(isCurrent\(\)\) setAuthLoading\(false\);/);
  assert.match(app, /if \(authLoading \|\| !currentUser\) return;/);
  assert.match(app, /supabase\.auth\.refreshSession\(\)/);
});

test("transient profile validation failure preserves session recovery state", () => {
  assert.match(app, /cache dipertahankan untuk retry/);
  assert.match(app, /setAuthRecovery\(\{ message: "Sesi belum dapat diverifikasi/);
  assert.match(app, /const authRetryRef = useRef\(null\);/);
  assert.match(app, /supabase\.auth\.getSession\(\)/);
  assert.match(app, />Coba Lagi<\/button>/);
});

test("manual and invalid-session logout stay local", () => {
  assert.match(app, /supabase\.auth\.signOut\(\{ scope: "local" \}\)/);
  assert.doesNotMatch(app, /supabase\.auth\.signOut\(\s*\)/);
  assert.match(app, /event === "SIGNED_OUT"/);
  assert.match(app, /Promise\.race\([\s\S]*?signOut\(\{ scope: "local" \}\)[\s\S]*?logout timeout/);
});

test("profile bootstrap cannot hang forever on a self-host request", () => {
  assert.match(app, /_withTimeout\(\s*supabase\.from\("profiles"\)[\s\S]*?15000,\s*"profile session"\s*\)\.catch\(error => \(\{ data: null, error \}\)\)/);
  assert.match(app, /_withTimeout\(\s*supabase\.from\("profiles"\)[\s\S]*?15000,\s*"profile session refresh"\s*\)\.catch\(error => \(\{ data: null, error \}\)\)/);
});

test("cloud bootstrap clears refresh state when a loader throws", () => {
  assert.match(app, /loadCloud\(\)\.catch\(error =>/);
  assert.match(app, /setDataRefreshing\(false\);/);
  assert.match(app, /Bootstrap cloud gagal:/);
});

test("cloud bootstrap bounds pending loaders", () => {
  assert.match(app, /const bootstrapLoad = \(promise, label = "bootstrap cloud"\)/);
  assert.match(app, /_withTimeout\(Promise\.resolve\(promise\), 30000, label\)/);
});

test("dismissed maturity migration does not abort cloud bootstrap", () => {
  assert.doesNotMatch(app, /maturityMigrationDismissedSigRef\.current === migrationSignature\) return;/);
  assert.match(app, /maturityMigrationDismissedSigRef\.current !== migrationSignature/);
});
