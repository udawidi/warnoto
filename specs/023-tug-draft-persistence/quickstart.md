# Quickstart: Validasi Persistensi Draft TUG

## Prasyarat

- Migration diterapkan ke database uji setelah backup.
- Dua sesi browser dengan akun berwenang pada scope yang sama.

## Verifikasi otomatis

```powershell
npm test
npm run build
```

Jalankan verifier SQL read-only dan pastikan semua nilai bernilai `1`.

## Hasil validasi lokal (2026-09-23)

- `node --test tests/unit/tugWorkflowPersistence.contract.test.mjs`: 10 lulus.
- `npm test`: 413 lulus.
- `npm run build`: berhasil.
- Migration diterapkan ke production self-host setelah backup valid dibuat di `/home/admin_warnoto/vps-backup/dumps/pre-tug-workflow-20260923-codex.dump`.
- Verifier SQL runtime dijalankan dalam transaksi read-only yang di-rollback; 13 dari 13 pemeriksaan bernilai `1`.
- Commit `cead2c3` sudah dipush ke `main`; frontend production versi `2.0.124` terverifikasi aktif di `pln.warnoto.com`.

## Skenario lintas perangkat

1. Perangkat A menyimpan draft TUG-3/5/7/8/9/10.
2. Refresh A; seluruh draft tetap muncul.
3. Perangkat B login dengan akun berwenang; seluruh draft sesuai scope muncul.
4. Edit draft yang sama pada A dan B. Simpan A, lalu simpan B; B harus mendapat konflik.
5. Ajukan TUG-8/9; nomor resmi muncul sekali, draft hilang setelah canonical sukses, qty stok tetap.
6. Putus koneksi saat Ajukan; draft server tetap ada.
7. Login akun beda UPT/UIT; draft di luar scope tidak terlihat.

## Verifikasi draft legacy

1. Siapkan cache dengan draft lama yang belum ada di server.
2. Login dan tunggu bootstrap.
3. Pastikan row server dibuat dengan ID lama.
4. Bila ID sudah ada, pastikan data server tidak tertimpa.
