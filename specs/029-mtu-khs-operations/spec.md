# Feature Specification: Operasional MTU KHS

**Feature Branch**: `029-mtu-khs-operations`
**Created**: 2026-10-09
**Status**: Approved for implementation
**Input**: Perluas MTU KHS agar TL dapat mengedit katalog/status, mencari dan memfilter material, mengelola foto, serta memindahkan material di dalam UPT atau ke UPT lain dalam satu UIT.

## User Scenarios & Testing

### User Story 1 - TL memperbarui material (Priority: P1)

TL membuka detail material, memilih Code Catalog canonical, mengubah lifecycle status, dan memindahkan lokasi gudang/blok atau GI/Bay dalam UPT yang sama tanpa approval.

**Independent Test**: Login sebagai TL, simpan setiap jenis perubahan, muat ulang, dan pastikan nilai serta audit tetap benar.

**Acceptance Scenarios**:

1. **Given** record milik UPT TL, **When** TL memilih katalog dan status valid, **Then** perubahan langsung tersimpan.
2. **Given** lokasi target dalam UPT yang sama, **When** TL memindahkan material, **Then** hierarki lokasi tervalidasi dan langsung berubah.
3. **Given** record sudah terikat penerimaan, TUG, atau stok, **When** katalog diubah, **Then** perubahan ditolak tanpa mutasi parsial.

### User Story 2 - Pengguna menemukan material dengan cepat (Priority: P1)

Pengguna mencari material dengan kata tidak berurutan, variasi spasi/tanda baca, atau typo ringan serta memfilter berdasarkan RFQ dan nomor Kontrak KR.

**Independent Test**: Cari satu record memakai nama, katalog, RFQ, dan KR dalam beberapa variasi lalu bandingkan urutan serta filter hasil.

**Acceptance Scenarios**:

1. **Given** beberapa token pencarian, **When** urutan atau tanda baca berbeda, **Then** record relevan tetap ditemukan.
2. **Given** Code Catalog/RFQ/KR tepat, **When** dicari, **Then** hasil tepat berada di urutan teratas.
3. **Given** filter RFQ dan KR, **When** dipilih, **Then** hanya record scoped yang cocok ditampilkan.

### User Story 3 - TL mengelola foto material (Priority: P1)

TL menambahkan satu foto barang aktif dan satu foto nameplate aktif. Penggantian foto mempertahankan riwayat.

**Independent Test**: Upload, ganti, muat ulang, dan buka riwayat kedua jenis foto dengan akun scoped.

**Acceptance Scenarios**:

1. **Given** gambar valid, **When** TL mengunggah, **Then** foto aktif tersimpan di self-host dan tampil kembali.
2. **Given** foto aktif sudah ada, **When** diganti, **Then** foto lama tetap tercatat dalam riwayat.
3. **Given** akun di luar scope, **When** meminta foto, **Then** akses ditolak.

### User Story 4 - Transfer material antar-UPT (Priority: P1)

TL memindahkan sebagian atau seluruh qty ke UPT lain dalam satu UIT. Transfer berlaku setelah ASMAN UPT asal menyetujui dan langsung terlihat di UPT tujuan.

**Independent Test**: Ajukan transfer parsial, setujui sebagai ASMAN asal, lalu login sebagai TL tujuan dan verifikasi record, qty, lokasi, foto, dan audit.

**Acceptance Scenarios**:

1. **Given** qty tersedia, **When** ASMAN asal menyetujui transfer parsial, **Then** sumber berkurang dan record tujuan dibuat atomik.
2. **Given** seluruh qty bebas ikatan, **When** transfer penuh disetujui, **Then** record yang sama berpindah ke UPT tujuan.
3. **Given** tujuan beda UIT, version stale, atau qty melebihi saldo bebas, **When** diproses, **Then** transfer ditolak tanpa perubahan.
4. **Given** transfer disetujui, **When** UPT tujuan membuka MTU KHS, **Then** record dan foto langsung terbaca sesuai RLS.

### Edge Cases

- Klik simpan/approve berulang tidak membuat event, split, atau transfer ganda.
- Kegagalan upload atau registrasi foto tidak mengganti foto aktif.
- Qty yang terikat penerimaan, TUG approved, atau stok tidak dapat dipindahkan lewat MTU KHS.
- Lokasi gudang/blok dan GI/Bay harus berasal dari hierarki UPT yang dipilih.
- Record SUPERVISI tetap tidak dihitung sebagai material fisik.

## Requirements

### Functional Requirements

- **FR-001**: TL MUST dapat membuka detail record milik UPT-nya dan menyimpan Code Catalog canonical serta lifecycle status secara langsung.
- **FR-002**: Pemilihan katalog MUST mengambil nomor katalog, nama, dan satuan dari master canonical; input katalog bebas MUST ditolak.
- **FR-003**: Perubahan operasional MUST memakai version check, idempotency, validasi server, dan audit append-only.
- **FR-004**: TL MUST dapat memindahkan record langsung ke gudang/blok atau GI/Bay lain dalam UPT yang sama.
- **FR-005**: Pencarian MUST normal terhadap kapital, spasi, tanda baca, urutan token, dan typo ringan serta meranking Code Catalog/RFQ/KR tepat lebih tinggi.
- **FR-006**: Daftar MUST menyediakan filter RFQ dan Kontrak KR yang mengikuti scope pengguna.
- **FR-007**: TL MUST dapat menyimpan satu foto barang aktif dan satu foto nameplate aktif di self-host private storage dengan riwayat penggantian.
- **FR-008**: Foto MUST berupa gambar, maksimal 2 MiB setelah kompresi, dan maksimal 2000 px.
- **FR-009**: TL MUST dapat meminta transfer sebagian atau seluruh qty ke UPT lain dalam UIT yang sama dengan lokasi tujuan detail.
- **FR-010**: Transfer antar-UPT MUST disetujui atau ditolak hanya oleh ASMAN UPT asal.
- **FR-011**: Approval transfer MUST atomik, version-safe, idempotent, dan menghormati saldo yang sudah terikat penerimaan/TUG/stok.
- **FR-012**: Transfer parsial MUST membuat record tujuan ber-lineage; transfer penuh MUST mempertahankan identitas record.
- **FR-013**: Record, evidence, dan audit hasil transfer MUST langsung dapat dibaca UPT tujuan dan tetap dapat diaudit UPT asal.
- **FR-014**: Fitur baru MUST tidak membuat job sinkronisasi Google Sheet dan MUST tidak memutasi tabel stok.
- **FR-015**: UI MUST dapat dipakai pada desktop dan viewport mobile 360 px dengan error/loading/empty state yang terlihat.
- **FR-016**: FR-010 pada `002-mtu-khs` disupersede hanya untuk edit operasional TL dan pindah internal; approval tetap wajib untuk transfer antar-UPT.

### Key Entities

- **MTU Record**: Material canonical dengan pemilik UPT, qty, katalog, lifecycle, dan lokasi.
- **Record Event**: Audit immutable untuk edit, foto, dan transfer.
- **Record Evidence**: Foto barang/nameplate aktif atau superseded.
- **Transfer Request**: Permintaan lintas-UPT, qty, tujuan, keputusan ASMAN asal, dan lineage hasil.

## Success Criteria

### Measurable Outcomes

- **SC-001**: TL dapat menyelesaikan edit katalog/status/lokasi dalam maksimal 60 detik.
- **SC-002**: Pencarian scoped menampilkan hasil pertama dalam maksimal 1 detik untuk dataset produksi saat ini.
- **SC-003**: Seluruh percobaan akses lintas-scope yang tidak sah menghasilkan nol data dan nol mutasi.
- **SC-004**: Percobaan ulang request/approval yang sama menghasilkan tepat satu mutasi canonical.
- **SC-005**: Setelah approval, UPT tujuan melihat record dan foto tanpa refresh data manual atau import ulang.

## Assumptions

- Database WARNOTO adalah canonical; Google Sheet hanya sumber import.
- Pindah internal UPT tidak memerlukan ASMAN.
- Transfer antar-UPT hanya dalam satu UIT dan hanya memerlukan ASMAN asal.
- Foto aktif diwariskan sebagai referensi metadata saat split; object storage tidak diduplikasi.
- Migration production hanya diterapkan setelah konfirmasi pengguna.
