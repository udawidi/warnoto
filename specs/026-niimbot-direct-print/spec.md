# Feature Specification: Cetak Langsung NIIMBOT M2-H

**Feature Branch**: `026-niimbot-direct-print`

**Created**: 2026-10-05

**Status**: Approved

**Input**: Cetak langsung kartu gantung compact 70×50 mm ke printer NIIMBOT M2-H dari aplikasi. Cetak A4 tetap memakai dialog cetak browser dan tidak memakai NIIMBOT.

## User Scenarios & Testing

### User Story 1 - Cetak kartu compact ke NIIMBOT (Priority: P1)

Petugas gudang dapat mencetak kartu compact dari Android Chrome langsung ke NIIMBOT M2-H setelah memilih printer pada dialog koneksi pertama.

**Why this priority**: Ini tujuan utama integrasi dan menghilangkan langkah ekspor atau aplikasi perantara.

**Independent Test**: Pilih satu material, tekan tombol cetak NIIMBOT, pilih M2-H, lalu pastikan satu label 70×50 mm tercetak dengan isi yang benar.

**Acceptance Scenarios**:

1. **Given** Bluetooth dan Lokasi aktif serta M2-H tersedia, **When** pengguna menekan cetak NIIMBOT dan memilih perangkat, **Then** satu label compact tercetak.
2. **Given** koneksi M2-H masih aktif, **When** pengguna mencetak label berikutnya, **Then** aplikasi memakai koneksi yang sama tanpa pemilihan perangkat ulang.
3. **Given** perangkat terdeteksi bukan M2-H, **When** pengguna mencoba mencetak, **Then** pencetakan dibatalkan dan pesan model tidak didukung tampil.

---

### User Story 2 - Pertahankan cetak A4 (Priority: P2)

Petugas tetap dapat mencetak format A4 existing melalui dialog cetak browser tanpa koneksi NIIMBOT.

**Why this priority**: Alur administrasi existing tidak boleh berubah akibat integrasi printer label.

**Independent Test**: Tekan tombol A4 dan pastikan tab dokumen A4 existing terbuka tanpa permintaan Bluetooth.

**Acceptance Scenarios**:

1. **Given** Bluetooth mati atau tidak tersedia, **When** pengguna menekan A4 Existing, **Then** dokumen A4 tetap terbuka seperti sebelumnya.

---

### User Story 3 - Pulih dari kegagalan printer (Priority: P3)

Petugas mendapat status yang jelas ketika koneksi atau pencetakan gagal dan dapat mencoba ulang tanpa memuat ulang aplikasi.

**Why this priority**: Bluetooth dapat dibatalkan, terputus, atau tidak tersedia pada browser tertentu.

**Independent Test**: Batalkan pemilihan perangkat atau putuskan printer, lalu pastikan tombol kembali aktif, pesan ramah tampil, dan preview compact tetap dapat dibuka.

**Acceptance Scenarios**:

1. **Given** pengguna membatalkan dialog perangkat, **When** dialog ditutup, **Then** tidak ada label dikirim dan tombol dapat dipakai lagi.
2. **Given** koneksi putus saat proses, **When** kegagalan diterima, **Then** status gagal tampil dan percobaan berikutnya memulai koneksi baru.
3. **Given** browser tidak mendukung akses printer langsung, **When** pengguna menekan tombol NIIMBOT, **Then** instruksi memakai Android Chrome tampil dan preview compact tetap tersedia.

### Edge Cases

- Klik berulang saat proses aktif tidak mengirim pekerjaan cetak ganda.
- Deskripsi panjang diperkecil atau dipotong dalam area label tanpa menimpa QR, satuan, atau nomor katalog.
- Data satuan, deskripsi, atau nomor katalog kosong memakai nilai pengganti yang aman.
- Koneksi tersimpan yang sudah putus tidak dipakai untuk mencetak.
- Penolakan izin, Bluetooth mati, Lokasi mati, dan printer tidak ditemukan menghasilkan pesan yang dapat ditindaklanjuti.

## Requirements

### Functional Requirements

- **FR-001**: Sistem MUST menyediakan aksi cetak langsung khusus format compact 70×50 mm.
- **FR-002**: Sistem MUST meminta pengguna memilih printer pada koneksi pertama dan memakai kembali koneksi aktif pada cetak berikutnya.
- **FR-003**: Sistem MUST memverifikasi printer sebagai NIIMBOT M2-H sebelum mengirim label.
- **FR-004**: Sistem MUST membatalkan pencetakan untuk model printer lain.
- **FR-005**: Label MUST menampilkan QR katalog, SATUAN di atas, MATERIAL DESCRIPTION di tengah, dan NO. CATALOG di bawah.
- **FR-006**: Tata letak label MUST landscape 70×50 mm dan dikirim sesuai orientasi media printer.
- **FR-007**: Sistem MUST mencegah pekerjaan cetak ganda selama satu proses masih aktif.
- **FR-008**: Sistem MUST menampilkan status menghubungkan, menyiapkan, mencetak, berhasil, atau gagal.
- **FR-009**: Kegagalan izin, dukungan browser, koneksi, identitas model, atau pencetakan MUST menghasilkan pesan ramah dan tombol coba ulang.
- **FR-010**: Preview compact melalui dialog cetak browser MUST tetap tersedia sebagai fallback.
- **FR-011**: Aksi A4 Existing MUST mempertahankan alur, tampilan, dan dialog cetak browser existing tanpa mengakses printer NIIMBOT.
- **FR-012**: Integrasi MUST tidak mengubah data material, stok, transaksi, atau skema basis data.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Pada perangkat yang didukung, pengguna dapat memulai cetak label pertama dalam paling banyak dua interaksi: tekan cetak dan pilih printer.
- **SC-002**: Setiap aksi yang berhasil menghasilkan tepat satu label, termasuk ketika tombol ditekan berulang selama proses.
- **SC-003**: Seluruh empat elemen wajib terbaca dan berada di dalam area label 70×50 mm pada uji cetak M2-H.
- **SC-004**: 100% percobaan dengan printer selain M2-H dihentikan sebelum label dikirim.
- **SC-005**: Cetak A4 dapat diselesaikan tanpa Bluetooth dan tanpa perubahan hasil existing.
- **SC-006**: Setelah kegagalan koneksi atau pencetakan, pengguna dapat mencoba ulang tanpa memuat ulang halaman.

## Assumptions

- Pengguna memakai Android Chrome langsung, bukan browser dalam aplikasi lain.
- Situs dijalankan melalui HTTPS atau localhost.
- Bluetooth dan Lokasi perangkat aktif saat pairing.
- Media pada M2-H berukuran fisik 50 mm melintang kepala cetak dan 70 mm searah feed.
- Uji cetak fisik diperlukan untuk menyetel offset media bila karakteristik roll berbeda.

