# Feature Specification: TUG-10 Target Stok

**Feature Branch**: `main`
**Created**: 2026-10-01
**Status**: Approved
**Input**: Approval TUG-10 untuk katalog dan blok yang sudah memiliki stok harus menambah baris stok yang dipilih, misalnya 3 + 3 = 6, atau membuat lot retur terpisah bila pengguna memilih Pisah.

## User Scenarios & Testing

### User Story 1 - Tambah ke stok tujuan (Priority: P1)

Sebagai pembuat TUG-10, saya memilih baris stok tujuan agar Asman menambahkan material retur ke lot yang tepat.

**Independent Test**: Pilih stok qty 3, ajukan retur qty 3, setujui sebagai Asman, lalu pastikan baris yang sama menjadi qty 6.

**Acceptance Scenarios**:

1. **Given** satu baris stok cocok, **When** TUG-10 disetujui, **Then** qty baris itu bertambah tepat satu kali dan transaksi final.
2. **Given** beberapa baris cocok, **When** form diajukan, **Then** pengguna wajib memilih target yang jelas.
3. **Given** dokumen lama tanpa target dan tepat satu kandidat, **When** disetujui, **Then** kandidat itu dipakai otomatis.
4. **Given** beberapa kandidat cocok, **When** pengguna memilih Gabungkan, **Then** pengguna wajib memilih satu lot tujuan.
5. **Given** pengguna memilih Pisah, **When** disetujui, **Then** sistem membuat satu lot retur TUG-10 deterministik dan tidak mengubah target yang dipilih sebelumnya.

### Edge Cases

- Target hilang, berpindah lokasi, beda katalog, beda UPT, atau perlu alokasi sumber harus ditolak tanpa perubahan.
- Retry dengan kunci sama tidak boleh menggandakan qty.
- Nol kandidat membuat lot TUG-10 baru; lebih dari satu kandidat legacy diblokir.
- Perubahan katalog, lokasi, gudang, atau sub gudang mereset pilihan penanganan dan target.

## Requirements

### Functional Requirements

- **FR-001**: Form MUST menyimpan identitas baris stok tujuan untuk material katalog existing.
- **FR-001a**: Setiap item MUST menyimpan `stockHandling` sebagai `MERGE` atau `SEPARATE`; pada form baru nilainya kosong bila kandidat existing tersedia sampai pengguna memilih Gabungkan/Pisah.
- **FR-001b**: `MERGE` MUST memerlukan `targetStockId`, mengunci dan memvalidasi target berdasarkan katalog, lokasi, dan UPT. `SEPARATE` MUST mengabaikan target dan membuat lot TUG-10 baru dengan `sourceLot=TUG10_RETURN`, `returnStatus`, serta mapping `jenisBarang` dari `statusMaterial`.
- **FR-002**: Persetujuan final MUST memvalidasi dan mengunci baris target sebelum menambah qty.
- **FR-003**: Persetujuan final MUST atomik dan idempoten.
- **FR-004**: Source lot target MUST dipertahankan.
- **FR-005**: Sistem MUST mencatat efek retur per transaksi dan indeks item tanpa marker sumber campuran lama.
- **FR-006**: Dokumen legacy tanpa `stockHandling` dengan target memakai `MERGE`; tanpa target memakai `MERGE` bila tepat satu kandidat, `SEPARATE` bila nol kandidat, dan ditolak ambigu bila lebih dari satu.
- **FR-007**: Efek retur MUST idempoten berdasarkan pasangan transaksi dan indeks item untuk jalur Gabungkan maupun Pisah.

### Key Entities

- **Item TUG-10**: Material retur, qty, katalog, lokasi, `stockHandling`, dan `targetStockId`.
- **Stok tujuan**: Baris/lot yang qty-nya ditambah.
- **Efek retur**: Bukti idempoten keyed oleh transaksi dan indeks item.
- **Lot retur terpisah**: Lot baru dengan ID deterministik, `sourceLot=TUG10_RETURN`, `returnStatus`, dan `upt_id` fisik transaksi.

## Success Criteria

- **SC-001**: Kasus qty 3 ditambah 3 menghasilkan tepat 6 pada baris yang sama.
- **SC-002**: Nol skenario retry menghasilkan penambahan ganda.
- **SC-003**: Semua target tidak sah gagal tanpa perubahan stok maupun status transaksi.
- **SC-004**: Dokumen 276 dapat disetujui ulang tanpa perbaikan data manual dan skenario 3 + 3 menjadi 6.
- **SC-005**: Retry pada jalur MERGE atau SEPARATE tidak menggandakan qty.

## Assumptions

- Target yang dipilih adalah lot asal material yang dikembalikan.
- Rantai approval TL lalu Asman tidak berubah.
- Migration production memerlukan persetujuan eksplisit pengguna.
