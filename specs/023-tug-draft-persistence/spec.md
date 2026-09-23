# Feature Specification: Persistensi Draft Seluruh TUG

**Feature Branch**: `main`  
**Created**: 2026-09-23  
**Status**: Approved for implementation  
**Input**: Simpan seluruh draft TUG ke database dan buat aman lintas perangkat.

## User Scenarios & Testing

### User Story 1 - Draft tersedia lintas perangkat (Priority: P1)

Sebagai petugas gudang, saya dapat menyimpan pekerjaan TUG yang belum lengkap dan melanjutkannya dari perangkat lain tanpa kehilangan isian.

**Independent Test**: Simpan masing-masing draft TUG-3, TUG-5, TUG-7, TUG-8, TUG-9, dan TUG-10 pada perangkat A; masuk dengan akun berwenang pada perangkat B; seluruh draft yang sesuai scope muncul dengan isi yang sama.

**Acceptance Scenarios**:

1. **Given** draft disimpan dan server tersedia, **When** halaman dimuat ulang atau akun membuka perangkat lain, **Then** draft muncul dari penyimpanan server.
2. **Given** penyimpanan server gagal, **When** pengguna menekan Simpan Draft, **Then** aplikasi tidak menyatakan draft tersimpan permanen.
3. **Given** draft TUG-8/9 belum diajukan, **When** draft disimpan, **Then** stok tidak berubah dan nomor resmi belum diterbitkan.

### User Story 2 - Workflow noncanonical tetap durable (Priority: P1)

Sebagai approver, saya dapat melanjutkan TUG-5 dan TUG-7 pada perangkat berbeda selama seluruh status, referensi, dan hasil approval tetap konsisten.

**Independent Test**: Jalankan TUG-5 sampai menghasilkan TUG-7 dan TUG-8; muat dari perangkat lain pada setiap tahap; referensi induk-anak dan status tetap sama.

**Acceptance Scenarios**:

1. **Given** TUG-5 atau TUG-7 berpindah tahap, **When** pengguna berwenang membuka perangkat lain, **Then** tahap terbaru tersedia.
2. **Given** approval menghasilkan draft turunan, **When** transaksi disimpan, **Then** induk dan draft turunan tersimpan sebagai satu hasil yang konsisten.

### User Story 3 - Konflik dan scope aman (Priority: P1)

Sebagai pengguna, saya mendapat peringatan jika draft telah diubah perangkat lain dan tidak dapat membaca draft di luar scope organisasi saya.

**Independent Test**: Dua sesi mengedit versi yang sama; simpan sesi pertama berhasil dan sesi kedua ditolak. Akun lintas UPT/UIT tidak dapat membaca atau menulis draft di luar scope.

**Acceptance Scenarios**:

1. **Given** versi draft berubah di server, **When** perangkat lama menyimpan, **Then** perubahan ditolak sebagai konflik tanpa menimpa data terbaru.
2. **Given** pengguna tidak memiliki akses UPT/UIT, **When** mencoba membaca atau mengubah draft, **Then** akses ditolak.

### Edge Cases

- Draft lokal lama belum pernah tersimpan ke server.
- Pengguna menekan Simpan/Ajukan dua kali.
- Ajukan TUG-8/9 gagal setelah draft tersimpan.
- Foto belum berhasil diunggah.
- Draft lama telah memiliki nomor karena perilaku versi sebelumnya.
- Dokumen induk berhasil tetapi pembuatan draft turunan gagal.

## Requirements

### Functional Requirements

- **FR-001**: Sistem MUST menyimpan draft TUG-3, TUG-5, TUG-7, TUG-8, TUG-9, dan TUG-10 secara durable di server.
- **FR-002**: Sistem MUST memuat draft dari server saat login/refresh dan tidak menjadikan cache browser sebagai sumber kebenaran.
- **FR-003**: Draft baru MUST tidak memiliki nomor resmi atau mengonsumsi nomor urut sampai diajukan.
- **FR-004**: Sistem MUST mempertahankan nomor yang sudah dimiliki draft lama tanpa menerbitkan ulang.
- **FR-005**: Menyimpan draft MUST tidak mengubah atau mereservasi stok.
- **FR-006**: TUG-8/9 MUST dipromosikan ke transaksi canonical hanya saat Ajukan dan draft MUST dihapus hanya setelah promosi berhasil.
- **FR-007**: TUG-5 dan TUG-7 MUST tetap durable sepanjang lifecycle noncanonical.
- **FR-008**: Sistem MUST menjaga relasi induk-anak TUG-5→TUG-7→TUG-8 dan TUG-5 ULTG→TUG-9.
- **FR-009**: Sistem MUST membatasi baca/tulis berdasarkan scope UPT, UIT, ULTG, role, dan pembuat yang berlaku.
- **FR-010**: Sistem MUST menolak update versi lama agar perubahan perangkat lain tidak tertimpa diam-diam.
- **FR-011**: Draft lokal lama MUST diimpor tanpa menghapus data server; bila ID sama, versi server menang.
- **FR-012**: Kegagalan server MUST menghasilkan pesan gagal dan tidak boleh menampilkan sukses palsu.
- **FR-013**: Foto biner MUST tetap disimpan di media storage, bukan langsung di data transaksi.

### Key Entities

- **Workflow Transaction**: Dokumen TUG noncanonical atau draft pra-canonical beserta scope, tahap, versi, isi, relasi, dan waktu perubahan.
- **Dedicated Receipt Draft**: Draft TUG-3/TUG-10 pada tabel existing.
- **Canonical Outgoing Transaction**: TUG-8/TUG-9 setelah diajukan dan memperoleh nomor resmi.

## Assumptions

- TUG-3 dan TUG-10 tetap memakai tabel dedicated existing.
- TUG-8 dan TUG-9 tetap memakai jalur canonical existing setelah Ajukan.
- Cache browser dipertahankan sementara sebagai recovery, bukan sumber kebenaran.
- Tidak ada perubahan stok saat menyimpan draft atau saat migrasi draft lama.

## Success Criteria

- **SC-001**: 100% jenis TUG 3/5/7/8/9/10 dapat disimpan dan dimuat kembali setelah refresh serta dari perangkat kedua.
- **SC-002**: Tidak ada draft baru yang mengonsumsi nomor resmi sebelum Ajukan.
- **SC-003**: Percobaan edit bersamaan selalu menolak penulis versi lama tanpa kehilangan data terbaru.
- **SC-004**: Uji scope negatif lintas UPT/UIT menghasilkan nol draft terbaca dan nol perubahan tersimpan.
- **SC-005**: Menyimpan, memigrasi, atau gagal mengajukan draft menghasilkan nol perubahan qty stok.

