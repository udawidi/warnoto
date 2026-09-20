# Verification Quickstart

```powershell
rtk node --test tests/unit/stockScopeMigration.contract.test.mjs tests/unit/stockOpnameServerIsolation.contract.test.mjs
rtk npm run build
```

Production verifier dijalankan melalui `psql` setelah backup dan migration. Hasil wajib: scoped policies saja, nol null/orphan, nol grant anon, nol privilege TRUNCATE authenticated, dan simulasi role UPT/nasional sesuai scope.
