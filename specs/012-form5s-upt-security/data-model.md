# Data model

`maturity_5s_assessments` tetap canonical:

- Identity: `id`, `upt_id` FK `upt(id)`, `created_by`, `created_at`.
- Context: `gudang_id`, `gudang_nama`, `bulan`, `tahun`, `auditor`.
- Checklist: `checklist`, `total_items`, `total_checked`, `score_percent`, `catatan`.
- Photos: `sample_photos` array, each entry must contain `storagePath`, `storageStatus=BACKUP_RECORDED`, and Drive metadata for new rows.

Storage object path canonical: `form-5s/<upt_id>/<YYYY-MM>/<driveFileId>/<safeFileName>` in private bucket `maturity-evidence`.

No new table is needed. Trigger validates array length 1..3 for insert and matches each storage object to the row UPT prefix.
