# Data Model

## Form5SPhoto

- `categoryId`: salah satu `sort`, `set`, `shine`, `standardize`, `sustain` untuk record baru; absen pada legacy.
- `name`, `size`, `mimeType`: metadata file.
- `driveFileId`: referensi backup Drive.
- `storagePath`: object private dengan prefix `form-5s/<upt_id>/`.
- `storageStatus`: wajib `BACKUP_RECORDED` untuk insert baru.
- Field sinkronisasi existing dipertahankan.
- `preview` hanya state lokal dan tidak dipersistenkan.

## Maturity5SAssessment

- `samplePhotos`: array datar.
- Record baru: tepat 15 item; lima kategori canonical; tepat tiga item per kategori.
- Record legacy: satu sampai tiga item tanpa `categoryId` tetap valid untuk baca/cetak.

## Draft

- Boleh memiliki 0–15 foto dan jumlah parsial per kategori.
- Tetap unik serta terisolasi berdasarkan `owner_id + upt_id`.
