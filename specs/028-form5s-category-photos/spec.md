# Foto Kategori dan Cetak Form 5S

**Status:** Approved for implementation
**Feature:** tiga foto per kategori 5S dan cetak yang tidak terkunci

## User Scenarios & Testing

### US1 — Foto lengkap per kategori (P1)

Sebagai pengisi Form 5S, pengguna melampirkan tepat tiga foto untuk masing-masing kategori Sort, Set in Order, Shine, Standardize, dan Sustain sebelum menyimpan audit final.

**Acceptance:** form menampilkan tiga slot pada tiap kategori; draft boleh parsial; finalisasi ditolak sampai seluruh 15 foto tersedia; setiap foto hasil unggah maksimal 2 MiB.

### US2 — Cetak tetap tersedia saat foto lambat (P1)

Sebagai pengguna riwayat Form 5S, pengguna dapat membuka dan mencetak laporan tanpa menunggu foto tanpa batas.

**Acceptance:** halaman cetak segera terbuka; persiapan sumber foto dan pemuatan gambar masing-masing berhenti setelah delapan detik; foto gagal berubah menjadi placeholder; tombol cetak kemudian aktif.

### US3 — Riwayat lama tetap terbaca (P2)

Sebagai peninjau, pengguna tetap dapat membuka dan mencetak audit lama yang hanya memiliki satu sampai tiga foto tanpa kategori.

**Acceptance:** data lama tidak wajib dilengkapi atau dimigrasi; lampirannya diberi label sampling legacy.

## Functional Requirements

- **FR-001:** Pengisian baru wajib menyimpan tepat 15 foto: tiga untuk setiap lima kategori 5S canonical.
- **FR-002:** Setiap foto baru wajib memiliki kategori canonical dan metadata object private yang valid.
- **FR-003:** Foto Form 5S wajib dikompres menjadi maksimal 2 MiB sebelum upload; evidence Maturity selain Form 5S tetap maksimal 3 MiB.
- **FR-004:** Server wajib menolak upload Form 5S di atas 2 MiB serta record baru dengan jumlah/kategori/path/status/object foto yang tidak valid.
- **FR-005:** Draft boleh menyimpan kumpulan foto parsial dan tetap terisolasi berdasarkan pemilik serta UPT.
- **FR-006:** History dan PDF wajib mengelompokkan tiga foto per kategori untuk record baru.
- **FR-007:** PDF record baru wajib memiliki satu halaman lampiran A4 per kategori.
- **FR-008:** Kegagalan atau kelambatan foto tidak boleh mengunci tombol cetak lebih dari 16 detik.
- **FR-009:** Record lama tanpa kategori tetap dapat dibaca dan dicetak tanpa backfill.
- **FR-010:** Akses foto tetap menggunakan assessment ID dan indeks, memeriksa scope UPT serta prefix storage, dan hanya menerima indeks 0–14.
- **FR-011:** Evidence Maturity 4.5 tetap dua bukti logis: checklist dan satu referensi agregat lampiran foto.

## Edge Cases

- Satu atau beberapa signed URL gagal atau tidak pernah selesai.
- Foto terhapus dari storage setelah record tersimpan.
- Draft lama berisi satu sampai tiga foto tanpa `categoryId`.
- Pengguna memilih lebih dari sisa slot kategori.
- Upload terkompresi masih melebihi 2 MiB.

## Assumptions

- “Setiap poin indikator” berarti lima kategori utama 5S, bukan 23 kalimat checklist.
- Aturan baru hanya berlaku pada insert audit final baru.
- Penghapusan orphan upload tetap di luar scope.
- Tidak ada dependency atau kolom database baru.

## Success Criteria

- **SC-001:** Semua pengisian baru yang tersimpan memiliki lima kategori dengan tepat tiga foto per kategori.
- **SC-002:** Tidak ada foto Form 5S baru yang diterima server dengan ukuran di atas 2 MiB.
- **SC-003:** Tombol cetak aktif paling lambat 16 detik setelah halaman cetak dibuka walau foto macet.
- **SC-004:** Semua 15 foto yang tersedia tampil dalam lima lampiran kategori.
- **SC-005:** Seluruh record lama tetap dapat dibuka dan dicetak.
