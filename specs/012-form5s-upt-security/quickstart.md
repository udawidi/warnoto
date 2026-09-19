# Quickstart

1. Run `npm run dev` and open `http://localhost:3001/`.
2. Login as UPT: sidebar shows `Form Pengisian 5S`; Maturity has no 5S subtab.
3. Login as UIT: page shows every UPT in the UIT, including `Belum Mengisi`; click a row to open history.
4. Open a saved history row, wait for thumbnails, then use `Cetak / PDF`.
5. Verify browser requests contain assessment ID + photo index only.
6. Run `npm test`, targeted Playwright tests, `npm run build`, and `git diff --check`.

Production rollout remains separate: backup, apply migration, deploy Edge Function, run verifier, backfill legacy photos, then verify missing self-host objects are zero.
