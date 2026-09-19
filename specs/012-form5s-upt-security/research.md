# Research

## Temuan codebase

- `Form5STab` dan `Form5SHistory` berada di `src/components/MaturityAuditSystem.jsx` dan sudah memiliki state entry/history sendiri.
- `MaturityDashboardTab` menampilkan `5s` sebagai subtab dan menerima `saveMaturity5SAssessment` dari `useMaturity`.
- `maturity_5s_assessments` sudah memiliki `upt_id`, RLS scoped maturity, dan `sample_photos` JSONB.
- `maturity-drive` sudah dual-write upload 5S ke Google Drive dan bucket `maturity-evidence`, serta memiliki `backfill-5s`.
- `buildForm5SHTML` sudah menerima `uptList`, tetapi harus memprioritaskan lookup ID sebelum nama tersimpan.
- `getScopeUptIds` adalah helper scope aplikasi. RLS self-host tetap sumber otorisasi.

## Keputusan

- Reuse `Form5STab`; wrapper top-level hanya mengatur summary UPT dan pemilihan canonical.
- Endpoint foto memakai `assessmentId` dan `photoIndex`; browser tidak mengirim `storagePath`/`driveFileId` untuk otorisasi.
- History photo dibuat object URL dan direvoke saat unmount/pergantian record.
- Print history membuka window sinkron sebelum fetch; print draft dihapus/ditahan sampai record tersimpan.
- Trigger memeriksa object private bucket via `storage.objects` dalam transaction.
