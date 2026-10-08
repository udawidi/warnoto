# Implementation Plan: Foto Kategori dan Cetak Form 5S

## Technical Context

- React/Vite frontend dengan Form 5S di `MaturityAuditSystem.jsx`.
- Supabase self-host: `maturity_5s_assessments.sample_photos` JSONB, bucket private `maturity-evidence`, dan Edge Function `maturity-drive`.
- Foto tetap array datar agar record legacy dan API indeks tetap kompatibel; record baru menambahkan `categoryId`.
- Tidak ada dependency atau kolom baru.

## Constitution Check

`constitution.md` masih template. Aturan mengikat berasal dari `AGENTS.md` dan `HANDOFF.md`: perubahan minimum, isolasi UPT fail-closed, migration production proposal-only, dan `HANDOFF.md` tidak diperbarui tanpa izin.

## Design

1. Tambah kontrak kategori canonical `sort`, `set`, `shine`, `standardize`, `sustain`; masing-masing tepat tiga foto pada insert baru.
2. Pertahankan `sample_photos` sebagai array datar berurutan. Record baru memiliki `categoryId`; record legacy tanpa kategori tetap dibaca.
3. Kompres foto Form 5S dengan batas 2 MiB dan dimensi 2000 px melalui helper existing; evidence Maturity umum tetap 3 MiB. Edge upload menolak payload Form 5S di atas 2 MiB.
4. Ganti uploader global menjadi tiga slot pada tiap kartu kategori. Draft menyimpan metadata parsial dan finalisasi memvalidasi 15 foto.
5. Perluas signing/download dari indeks 0–2 menjadi 0–14 tanpa mengubah pemeriksaan assessment, UPT, atau prefix path.
6. History dan PDF mengelompokkan foto baru per kategori. PDF membuat lima halaman lampiran; record legacy memakai satu blok sampling legacy.
7. Batasi signing delapan detik dan image decode delapan detik. Timeout menghasilkan placeholder dan mengaktifkan tombol cetak.
8. Evidence 4.5 menyimpan satu entri checklist dan satu entri agregat lampiran foto.

## Data and Security

- Migration mengganti trigger insert existing. Record baru harus tepat 15 foto, lima kategori eksak, tiga per kategori, storage status `BACKUP_RECORDED`, path UPT canonical, dan object tersedia.
- Trigger hanya `BEFORE INSERT`; data lama tidak diubah.
- Edge Function tetap memperoleh path dari record server, bukan input browser.
- Production migration dan redeploy Edge Function menunggu persetujuan eksplisit pengguna.

## Verification

- Contract/unit test untuk kompresi, kategori, trigger, indeks endpoint, timeout cetak, evidence agregat, legacy compatibility, dan layout lampiran.
- `npm test` dan `npm run build`.
- Smoke desktop/HP: draft parsial, upload 15 foto, history, PDF normal, dan simulasi foto macet.

## Structure

- Frontend/data: `src/components/MaturityAuditSystem.jsx`, `src/lib/maturityDrive.js`, `src/lib/maturitySync.js`, `src/hooks/useMaturity.jsx`, `src/lib/docBuilders.js`.
- Server/schema: `supabase/functions/maturity-drive/index.ts`, migration baru, `supabase/schema.sql`.
- Tests: `tests/unit/form5sSecurity.contract.test.mjs` dan test fokus baru bila diperlukan.
