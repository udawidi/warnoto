# Feature Specification: Lot Sumber Material TUG-8/9

**Feature Branch**: `main`
**Created**: 2026-09-11
**Updated**: 2026-09-15
**Status**: Approved for implementation

## Context

Material dengan katalog yang sama dapat diterima dari beberapa penyedia melalui TUG-3 atau dikembalikan melalui TUG-10. Setiap sumber harus memiliki saldo sendiri agar TUG-8/TUG-9 mengeluarkan material dari sumber yang dipilih, bukan dari saldo gabungan.

## User Scenarios & Testing

### User Story 1 - Memilih sumber material keluar (Priority: P1)

Petugas memilih satu lot sumber beserta saldo tersedianya untuk setiap baris TUG-8/TUG-9.

**Independent Test**: Terima relay katalog sama sebanyak 3 dari PT A dan 4 dari PT B. Picker menampilkan dua sumber; pengeluaran 2 dari PT A menyisakan PT A=1 dan PT B=4.

**Acceptance Scenarios**:

1. **Given** satu katalog memiliki beberapa lot aktif, **When** picker dibuka, **Then** setiap sumber tampil sebagai baris terpisah dengan saldo masing-masing.
2. **Given** petugas memilih satu lot, **When** transaksi disetujui final, **Then** hanya saldo lot tersebut yang berkurang.
3. **Given** kebutuhan melebihi satu lot, **When** petugas mengisi transaksi, **Then** petugas membuat beberapa baris dan memilih satu sumber per baris.
4. **Given** pemindaian katalog menemukan beberapa lot, **When** hasil scan diproses, **Then** aplikasi meminta pemilihan sumber dan tidak memilih lot pertama otomatis.

### User Story 2 - Menjaga sumber penerimaan baru (Priority: P1)

Penerimaan TUG-3 dan retur TUG-10 membuat atau menambah saldo pada lot yang tepat.

**Independent Test**: Dua kontrak penyedia berbeda untuk katalog dan lokasi sama menghasilkan dua baris stok; retry transaksi tidak menggandakan qty.

**Acceptance Scenarios**:

1. **Given** TUG-3 dengan kontrak dan penyedia yang sama telah membentuk lot, **When** penerimaan berikutnya untuk sumber identik disetujui, **Then** saldo lot yang sama bertambah.
2. **Given** kontrak, penyedia, atau dokumen sumber berbeda, **When** penerimaan disetujui, **Then** lot baru dibuat walau katalog dan lokasi sama.
3. **Given** retur TUG-10 disetujui, **When** stok dikembalikan, **Then** tiap item transaksi membentuk lot retur tersendiri.

### User Story 3 - Mengalokasikan stok gabungan lama (Priority: P2)

TL atau SUPERADMIN membagi stok lama yang memiliki beberapa referensi sumber menjadi lot terpisah tanpa mengubah total saldo.

**Independent Test**: Stok gabungan qty 7 dibagi PT A=3 dan PT B=4 secara atomik; total tetap 7 dan pengguna ADMIN tidak dapat mengeluarkannya sebelum alokasi.

**Acceptance Scenarios**:

1. **Given** stok lama memiliki beberapa sumber tetapi belum dialokasikan, **When** ADMIN mencoba memilihnya, **Then** aplikasi memblokir pengeluaran dan menampilkan status Perlu alokasi sumber.
2. **Given** TL memasukkan alokasi yang totalnya sama dengan saldo terkini, **When** pembagian dikonfirmasi, **Then** baris gabungan diarsipkan dan lot aktif dibuat dalam satu transaksi database.
3. **Given** saldo berubah atau total alokasi tidak sama, **When** pembagian dikirim, **Then** tidak ada perubahan stok.

### User Story 4 - Melihat stok dan opname per sumber (Priority: P2)

Petugas melihat Data Stok dan Stock Opname per lot sumber, sedangkan Stock Count, forecast, dan ringkasan tetap menjumlahkan seluruh lot per katalog.

**Independent Test**: Dua lot relay tampil dua baris pada Data Stok/Opname tetapi total Stock Count sama dengan jumlah kedua lot.

## Edge Cases

- Saldo lot nol tidak muncul pada picker pengeluaran.
- Baris transaksi tidak boleh memakai `stockId` yang sama dua kali.
- Metadata sumber lama kosong atau hanya memiliki satu referensi.
- Retry final approval TUG-3/TUG-10 tidak menggandakan saldo.
- Snapshot transaksi lama tetap immutable setelah metadata stok berubah.

## Requirements

### Functional Requirements

- **FR-001**: Sistem MUST menyimpan satu lot sumber aktif per baris `stocks` dan memakai `stockId` sebagai identitas saldo yang dikurangi canonical TUG-8/TUG-9.
- **FR-002**: Lot TUG-3 MUST dibedakan berdasarkan lokasi, katalog, penyedia, dan identitas kontrak/dokumen; sumber identik boleh menambah lot yang sama.
- **FR-003**: Setiap item TUG-10 MUST membentuk lot retur tersendiri.
- **FR-004**: Picker MUST menampilkan setiap lot aktif, identitas sumber, dan saldo; lot kosong MUST disembunyikan.
- **FR-005**: Setiap baris TUG-8/TUG-9 MUST memilih tepat satu lot dan qty MUST tidak melebihi saldo lot tersebut.
- **FR-006**: Jika satu kebutuhan mengambil beberapa sumber, pengguna MUST membuat satu baris per sumber; `stockId` duplikat MUST ditolak.
- **FR-007**: Scan dengan lebih dari satu lot cocok MUST membuka pilihan sumber dan MUST NOT memilih hasil pertama otomatis.
- **FR-008**: Snapshot sumber TUG-8/TUG-9 MUST diturunkan server-side dari lot terpilih, menyimpan `lotKey`, dan tidak dapat dipalsukan client.
- **FR-009**: Stok lama multi-sumber MUST ditandai Perlu alokasi sumber dan MUST diblokir untuk pengeluaran sampai dibagi.
- **FR-010**: Hanya TL dalam lingkup UPT stok atau SUPERADMIN yang boleh membagi stok lama; pembagian MUST atomik, idempoten, memvalidasi saldo terkini, dan mempertahankan total qty.
- **FR-011**: Data Stok dan Stock Opname MUST menampilkan baris per sumber; Stock Count, forecast, dan ringkasan katalog MUST tetap mengagregasi seluruh lot.
- **FR-012**: Signature RPC canonical TUG-8/TUG-9, hash dokumen, approval lama, dan mutasi lama MUST tidak berubah.
- **FR-013**: Finalisasi penerimaan TUG-3/TUG-10 MUST idempoten dan MUST tidak menggandakan qty saat retry.
- **FR-014**: Sistem MUST tidak menambah dependency atau tabel baru untuk fitur ini.

## Key Entities

- **Lot sumber**: Baris stok dengan identitas sumber stabil, jenis sumber, dokumen, penyedia, tanggal, transaksi, item, dan status.
- **Snapshot sumber**: Salinan immutable dari lot terpilih pada item TUG canonical.
- **Alokasi stok lama**: Daftar lot hasil pembagian dengan qty yang totalnya sama dengan saldo stok gabungan.

## Success Criteria

- **SC-001**: Skenario PT A/PT B mempertahankan dua saldo independen setelah penerimaan dan pengeluaran.
- **SC-002**: 100% item baru TUG-8/TUG-9 memiliki snapshot dengan `lotKey` server-derived.
- **SC-003**: Pembagian stok lama mempertahankan total qty dan gagal tanpa perubahan bila saldo/otorisasi/input tidak valid.
- **SC-004**: Data Stok/Opname per sumber dan semua agregasi katalog menghasilkan total yang sama.
- **SC-005**: Unit/contract tests terkait dan `npm run build` lulus.

## Assumptions

- Pemilihan sumber dilakukan eksplisit; tidak ada FIFO otomatis.
- Satu transaksi dapat memiliki beberapa baris katalog sama selama `stockId` berbeda.
- Migrasi/RPC hanya dibuat sebagai proposal dan tidak diterapkan ke Supabase tanpa persetujuan terpisah.
- PDF resmi tidak berubah dalam cakupan ini.
