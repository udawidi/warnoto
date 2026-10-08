# Contract: Foto Form 5S

## Upload

- Input: file gambar, `uptId`, bulan, tahun.
- Client menghasilkan berkas maksimal 2 MiB dan maksimum 2000 px.
- Server menolak berkas di atas 2 MiB.
- Output metadata storage/Drive existing; client menambahkan `categoryId` canonical sesuai slot aktif.

## Sign batch

- Input hanya `assessmentId`.
- Server membaca seluruh `sample_photos` dari assessment scoped.
- Maksimum 15 foto; output mempertahankan indeks array.

## Sign/download tunggal

- Input `assessmentId` dan `photoIndex` 0–14.
- Server memeriksa scope UPT dan prefix `storagePath` dari record.
- Path atau ID file bebas dari client tidak diterima.

## Persistence

- Insert baru wajib tepat tiga foto untuk setiap kategori canonical.
- Record legacy tidak diubah.
