# Feature Specification: BA Pengeluaran Material Non Stock dan Pinjam

**Feature Branch**: `033-ba-nonstock-loan`

**Created**: 2026-10-15

**Status**: Approved for implementation

**Input**: Tambahkan menu TUG untuk membuat Berita Acara Pengeluaran Material Non Stock atau Pinjam dari input material manual, lengkap dengan qty, satuan, keterangan, foto bukti, Satpam, Team Leader, dan Penerima Material.

## User Scenarios & Testing

### User Story 1 - Admin mengajukan BA manual (Priority: P1)

Admin Gudang membuat draft BA tanpa memilih material dari Data Stock. Admin mengisi identitas pengeluaran, penerima, satpam, material manual, dan dua bukti foto lalu mengajukannya kepada TL.

**Why this priority**: Ini kemampuan inti yang memungkinkan pengeluaran material di luar stok WARNOTO tetap terdokumentasi.

**Independent Test**: Admin dapat menyimpan draft parsial, melengkapinya, dan mengirim satu BA valid sampai berstatus menunggu TL tanpa perubahan saldo stok.

**Acceptance Scenarios**:

1. **Given** Admin berada di TUG Barang Keluar, **When** membuka BA Non Stock / Pinjam, **Then** form tidak menampilkan pilihan Data Stock atau katalog.
2. **Given** draft belum lengkap, **When** disimpan, **Then** draft tetap dapat dibuka dan dilanjutkan.
3. **Given** semua data wajib dan dua foto tersedia, **When** Admin mengajukan, **Then** BA masuk antrean TL tanpa nomor final.
4. **Given** data wajib atau bukti foto belum lengkap, **When** Admin mengajukan, **Then** sistem menolak dan menunjukkan bagian yang harus diperbaiki.

---

### User Story 2 - TL memutuskan dan menerbitkan BA (Priority: P1)

TL UPT memeriksa isi dan bukti BA, lalu menyetujui atau menolak. Persetujuan final menerbitkan nomor BA unik dan mengunci identitas penandatangan.

**Why this priority**: Dokumen resmi harus melalui pemeriksaan manual dan memiliki identitas penerbit yang dapat diaudit.

**Independent Test**: TL pada UPT yang sama dapat menyetujui BA valid, sedangkan pengguna lain atau TL UPT berbeda ditolak.

**Acceptance Scenarios**:

1. **Given** BA menunggu TL, **When** TL UPT menyetujui, **Then** BA menjadi final dan memperoleh nomor berurutan per UPT per tahun.
2. **Given** BA menunggu TL, **When** TL menolak dengan alasan, **Then** Admin dapat memperbaiki dan mengajukannya kembali.
3. **Given** pengguna tanpa kewenangan mencoba mengambil keputusan, **When** permintaan diproses, **Then** keputusan ditolak tanpa mengubah dokumen.
4. **Given** dua persetujuan terjadi bersamaan, **When** keduanya selesai, **Then** keduanya memperoleh nomor berbeda dan berurutan.

---

### User Story 3 - Pengguna melihat dan mencetak BA final (Priority: P2)

Pengguna dalam scope UPT dapat mencari riwayat, melihat pratinjau, dan mencetak BA final beserta dua foto bukti dan tiga penandatangan.

**Why this priority**: BA harus dapat dipakai sebagai arsip operasional dan bukti pengeluaran material.

**Independent Test**: Satu BA final dapat ditemukan dari riwayat dan dicetak dalam format A4 yang memuat seluruh data wajib.

**Acceptance Scenarios**:

1. **Given** BA final, **When** pratinjau dibuka, **Then** halaman pertama memuat identitas dan tabel material, sedangkan lampiran memuat dua foto.
2. **Given** BA berstatus DRAFT atau PENDING, **When** tombol Print BA dipilih, **Then** dokumen boleh dicetak untuk review dengan watermark `DRAFT / BELUM DISETUJUI`.
3. **Given** BA berstatus APPROVED, **When** tombol Print BA dipilih, **Then** dokumen dicetak sebagai versi final dengan nomor BA dan snapshot penandatangan.
4. **Given** master satpam atau profil TL kemudian berubah, **When** BA lama dicetak, **Then** identitas penandatangan tetap sesuai snapshot saat final.

### Edge Cases

- Draft dapat kosong sebagian, tetapi pengajuan memerlukan jenis BA, tanggal, gudang, sumber material, unit tujuan, referensi, keperluan, penerima, satpam, minimal satu material, dan dua foto.
- Qty nol, negatif, bukan angka, nama material kosong, atau satuan kosong harus ditolak.
- Kegagalan unggah foto tidak boleh menyimpan data gambar base64 ke database.
- BA yang ditolak dapat diperbaiki dan diajukan ulang; nomor baru diterbitkan hanya setelah persetujuan final.
- Nomor pertama pada tahun baru kembali ke 001 untuk masing-masing UPT.
- Material banyak atau teks panjang boleh menambah halaman tanpa memotong tabel atau tanda tangan.
- Jenis Pinjam tidak membuat jatuh tempo, status pengembalian, atau BA kembali.

## Requirements

### Functional Requirements

- **FR-001**: Sistem MUST menampilkan menu `BA Non Stock / Pinjam` di kelompok TUG Barang Keluar.
- **FR-002**: Sistem MUST membatasi pembuatan dan pengajuan BA kepada ADMIN pada scope UPT-nya, dengan SUPERADMIN sebagai bypass operasional existing.
- **FR-003**: Sistem MUST menyediakan jenis dokumen `NON_STOCK` dan `PINJAM` sebagai label tanpa lifecycle pengembalian.
- **FR-004**: Sistem MUST menerima material manual dengan nama, qty positif, satuan, dan keterangan tanpa membaca Data Stock atau katalog.
- **FR-005**: Sistem MUST menyediakan input sumber/pengirim, unit tujuan, referensi, keperluan, penerima, gudang, satpam, pengemudi opsional, dan kendaraan opsional.
- **FR-006**: Sistem MUST mengizinkan penyimpanan draft parsial yang durable dan dapat dilanjutkan dari perangkat lain dalam scope yang sama.
- **FR-007**: Sistem MUST mewajibkan foto label atau packing list dan foto material telah dimuat sebelum pengajuan.
- **FR-008**: Sistem MUST menyimpan foto sebagai object Storage dan MUST NOT menyimpan data URL/base64 dalam record BA.
- **FR-009**: Sistem MUST menjalankan alur `DRAFT → PENDING_TL → APPROVED atau REJECTED` dan mengizinkan perbaikan BA yang ditolak.
- **FR-010**: Sistem MUST membatasi approval/reject kepada TL pada UPT dokumen atau SUPERADMIN dan memvalidasinya di server.
- **FR-011**: Sistem MUST menerbitkan nomor atomik saat approval final dengan format `001.BA/UPT-SBY/10/2026`, urutan reset per UPT per tahun, dan bulan/tahun dari waktu server.
- **FR-012**: Sistem MUST menyimpan snapshot Penerima Material, Satpam, dan TL approver untuk cetakan historis.
- **FR-013**: Sistem MUST menyediakan riwayat dan pencarian berdasarkan nomor, sumber, penerima, referensi, dan material.
- **FR-014**: Sistem MUST menghasilkan pratinjau A4 dan hasil Print/Save PDF dengan tabel `Nama Material | Qty | Satuan | Keterangan`, dua foto, dan tanda tangan Penerima Material, Satpam, serta Team Leader.
- **FR-015**: Sistem MUST menyediakan tombol Print BA pada daftar TUG, antrean Approval, dan review untuk semua status; DRAFT/PENDING wajib memakai watermark `DRAFT / BELUM DISETUJUI`, sedangkan cetakan APPROVED memakai nomor dan snapshot final.
- **FR-016**: Sistem MUST mengisolasi data per UPT mengikuti aturan akses WARNOTO yang sudah berlaku.
- **FR-017**: Sistem MUST NOT mengubah Data Stock, source lot, katalog, MARA, stock movements, canonical TUG-8/9, atau laporan TUG-15.
- **FR-018**: Sistem MUST mempertahankan audit pembuat, pengaju, approver atau penolak, alasan penolakan, dan waktu transisi.

### Key Entities

- **BA Non Stock**: Header dokumen, jenis, scope UPT, status, penerima, satpam, bukti, nomor, snapshot, dan audit.
- **Item BA**: Satu baris material manual yang dimiliki sebuah BA.
- **Counter BA Tahunan**: Urutan nomor unik untuk satu UPT dan satu tahun.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Admin dapat membuat dan mengajukan BA lengkap dari desktop atau ponsel tanpa memilih material stok.
- **SC-002**: Seratus persen pengajuan tanpa salah satu dari dua foto atau tanpa item lengkap ditolak sebelum masuk antrean TL.
- **SC-003**: Seratus persen keputusan oleh role atau UPT yang tidak berwenang ditolak tanpa perubahan status.
- **SC-004**: Dua approval simultan pada UPT dan tahun yang sama tidak pernah menghasilkan nomor duplikat.
- **SC-005**: Saldo stok dan laporan TUG-15 tetap identik sebelum dan sesudah approval BA.
- **SC-006**: Cetakan final menampilkan semua item, dua foto, dan tiga snapshot penandatangan tanpa clipping pada A4.

## Assumptions

- Gudang dan Satpam memakai master existing; Satpam wajib berasal dari gudang yang dipilih.
- Nama, jabatan, dan unit Penerima Material memakai pola input manual TUG-8/9.
- Foto bukti dapat disimpan di bucket existing `tug-photos` karena tidak memuat SIM/KTP.
- Notifikasi WhatsApp, pelacakan pengembalian pinjaman, tanda tangan digital, dan ekspor DOCX di luar scope v1.
- Perubahan schema production hanya diterapkan setelah persetujuan eksplisit pengguna.
