# Draft dan Riwayat Ringkas Form 5S

**Status:** Approved for implementation  
**Feature:** draft privat, pemilih sumber foto, dan riwayat audit ringkas

## User scenarios

### US1 — Simpan dan lanjutkan draft (P1)

Sebagai pengisi Form 5S, pengguna dapat menyimpan pekerjaan parsial dan melanjutkannya pada perangkat lain tanpa membuka data pengguna atau UPT lain.

**Acceptance:** draft hanya terlihat pemilik pada UPT aktif; pemuatan ulang memulihkan isinya; draft tidak masuk riwayat, rangkuman UIT, atau evidence 4.5; finalisasi menghapus draft hanya setelah audit tersimpan.

### US2 — Pilih kamera atau galeri (P1)

Sebagai pengguna HP, pengguna menekan satu tombol foto lalu memilih Kamera atau Galeri.

**Acceptance:** pilihan sumber muncul setelah tombol ditekan; Kamera meminta capture belakang; Galeri mendukung pilihan foto; kontrol dapat disentuh dan dibaca pembaca layar.

### US3 — Riwayat ringkas (P1)

Sebagai pengguna audit, pengguna melihat ringkasan audit dan tombol PDF tanpa harus memuat checklist serta foto.

**Acceptance:** setiap baris menampilkan periode, gudang, skor, waktu, Detail Audit, dan Cetak/PDF; detail dan foto hanya dimuat setelah Detail Audit ditekan.

## Functional requirements

- **FR-001:** Sistem menyimpan maksimal satu draft aktif per pemilik dan UPT.
- **FR-002:** Semua operasi draft wajib memeriksa pemilik sesi dan hak tulis UPT.
- **FR-003:** Draft wajib memuat periode, gudang, auditor, checklist, catatan, serta metadata foto yang telah tersimpan.
- **FR-004:** Draft tidak boleh dianggap audit final atau evidence Maturity.
- **FR-005:** Setelah audit final berhasil disimpan, sistem menghapus draft terkait; kegagalan penghapusan tidak membatalkan audit final.
- **FR-006:** Kontrol unggah awal hanya satu dan membuka pilihan Kamera atau Galeri.
- **FR-007:** Riwayat awal tidak memuat foto atau detail checklist.
- **FR-008:** Tombol Cetak/PDF selalu tersedia pada setiap baris riwayat di desktop dan HP.
- **FR-009:** Foto detail tetap dimuat melalui akses terproteksi sesuai scope UPT.

## Edge cases

- Simpan draft ditolak bila belum ada isi yang bermakna.
- Draft dari UPT sebelumnya tidak boleh terbawa saat pengguna mengganti UPT.
- Foto lama pada draft tetap dipertahankan saat draft disimpan ulang.
- Audit final tetap valid bila pembersihan draft gagal; UI memberi peringatan nonblokir.

## Assumptions

- Upload foto final yang ada tetap dipakai; fitur ini hanya menyimpan metadata foto dalam draft.
- Draft privat tidak ditampilkan kepada UIT/Pusat atau pengguna lain dalam UPT yang sama.
- Tidak ada dependency baru.

## Success criteria

- **SC-001:** 100% uji akses membuktikan pengguna lain dan UPT lain tidak dapat membaca draft.
- **SC-002:** Draft yang disimpan dapat dipulihkan setelah muat ulang dengan seluruh field dan jumlah foto sama.
- **SC-003:** Riwayat pertama kali tampil tanpa permintaan unduh foto.
- **SC-004:** Tombol Detail Audit dan Cetak/PDF terlihat tanpa scroll horizontal pada viewport HP.
- **SC-005:** Seluruh unit test dan build project lulus.
