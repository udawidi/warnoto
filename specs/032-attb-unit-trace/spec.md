# Feature Specification: ATTB Unit Trace

**Feature Branch**: `main`
**Created**: 2026-10-13
**Status**: Approved implementation
**Input**: Setiap unit fisik retur TUG-10 ATTB memiliki barcode dan histori sendiri tanpa tercampur walau katalog sama.

## User Scenarios & Testing

### User Story 1 - Identitas Unit Saat Penerimaan (Priority: P1)

Admin/TL memasukkan setiap material `Bongkaran ATTB (MTU)` sebagai satu unit fisik tersendiri. Final Asman menerbitkan satu identitas ATTB dan satu QR untuk unit tersebut.

**Why this priority**: Tanpa identitas unit, material berkatalog sama tidak dapat ditelusuri terpisah.

**Independent Test**: Finalkan dua baris berkatalog sama dan pastikan dua record, QR, serta histori berbeda terbentuk tepat sekali.

**Acceptance Scenarios**:
1. **Given** dua unit berkatalog sama, **When** keduanya final Asman, **Then** masing-masing memiliki tracking code, token, QR, dan histori sendiri.
2. **Given** item ATTB memiliki qty selain 1 atau tidak memiliki nomor seri maupun nomor aset, **When** diajukan/final, **Then** proses ditolak.
3. **Given** approval yang sama diulang, **When** idempotency key dipakai ulang, **Then** tidak ada record, token, atau histori ganda.

### User Story 2 - Riwayat Unit ATTB (Priority: P2)

Petugas membuka detail ATTB dan melihat sumber TUG-10, identitas, foto, lokasi, serta timeline unit itu saja.

**Why this priority**: Petugas membutuhkan jejak unit yang dapat diaudit sepanjang lifecycle ATTB.

**Independent Test**: Ubah tahap/lokasi dua unit berkatalog sama dan pastikan timeline tidak saling bercampur.

**Acceptance Scenarios**:
1. **Given** satu unit berpindah tahap/lokasi, **When** detail dibuka, **Then** hanya event unit tersebut yang tampil berurutan.
2. **Given** record legacy, **When** detail dibuka, **Then** record tetap terbaca internal tetapi tidak memiliki QR baru.

### User Story 3 - Scan QR Publik (Priority: P3)

Siapa pun dapat memindai QR dan melihat informasi material serta histori operasional yang aman tanpa login.

**Why this priority**: Label fisik harus berguna di lapangan tanpa bergantung pada akun aplikasi.

**Independent Test**: Scan token valid dan invalid; token valid hanya menampilkan allowlist publik, token invalid tidak membocorkan data.

**Acceptance Scenarios**:
1. **Given** QR valid, **When** dipindai, **Then** identitas material, sumber TUG-10, lokasi, foto, status, dan timeline tampil.
2. **Given** token salah atau sudah diganti, **When** URL dibuka, **Then** halaman tidak valid dan data kosong.
3. **Given** halaman publik, **When** payload diperiksa, **Then** identitas pegawai, nilai aset, catatan internal, dan raw JSON tidak tersedia.

### Edge Cases

- Dua unit berkatalog sama dan lokasi sama tetap berbeda.
- Nomor seri atau nomor aset wajib minimal salah satu; keduanya boleh terisi.
- Foto harus berasal dari slot TUG-10 dan object Storage yang sah.
- QR hanya tersedia setelah final Asman, tidak saat draft/TL.
- Rotasi token membatalkan QR lama dan tercatat sebagai event internal.

## Requirements

### Functional Requirements

- **FR-001**: Setiap baris TUG-10 berstatus `Bongkaran ATTB (MTU)` MUST mewakili tepat satu unit dengan qty 1.
- **FR-002**: Setiap unit MUST memiliki minimal nomor seri atau nomor aset serta dua foto wajib.
- **FR-003**: Final Asman MUST membuat record ATTB, token QR, dan event penerimaan secara atomik dan idempoten.
- **FR-004**: Identitas sumber MUST memakai kunci canonical `TUG10|transactionId|itemIndex`.
- **FR-005**: Histori unit MUST append-only dan tidak dapat ditulis langsung oleh client.
- **FR-006**: Detail internal MUST menampilkan sumber, identitas, foto, lokasi, status, dan timeline unit sendiri.
- **FR-007**: Halaman publik MUST memakai bearer token acak dan hanya mengembalikan field allowlist.
- **FR-008**: Token MUST dapat diganti oleh TL/SUPERADMIN dengan konfirmasi; token lama langsung invalid.
- **FR-009**: Record lama MUST tidak di-backfill token/QR.
- **FR-010**: Agregasi stok existing MUST tetap berjalan tanpa menggunakan identitas ATTB sebagai grain stok.
- **FR-011**: Scope internal MUST mengikuti UPT/UIT/Pusat existing; anonymous tidak boleh SELECT tabel ATTB/token/histori.
- **FR-012**: Label MUST berukuran 70×50 mm, berisi QR, tracking code, katalog, nama, seri/aset, dan nomor TUG-10.

### Key Entities

- **ATTB Unit**: Kondisi terkini satu unit fisik dan relasi ke sumber TUG-10.
- **Public Link**: Token capability unik untuk satu ATTB Unit baru.
- **Unit History**: Event append-only per unit dengan waktu server dan snapshot terkontrol.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Dua unit berkatalog sama selalu menghasilkan dua QR dan timeline berbeda.
- **SC-002**: Retry approval menghasilkan nol duplikasi record, token, dan event.
- **SC-003**: 100% payload publik bebas identitas pegawai, nilai aset, catatan internal, dan raw record.
- **SC-004**: Scan QR valid menampilkan detail dalam satu halaman responsif; token invalid menampilkan nol data.
- **SC-005**: Seluruh contract test, rehearsal database kosong dua kali, full test, dan build lulus.

## Assumptions

- Barcode diwujudkan sebagai QR URL publik.
- Cetak memakai browser print; direct NIIMBOT di luar v1.
- Foto transaksi non-PII berada di bucket publik existing; KTP/SIM tidak pernah masuk payload.
- Production migration memerlukan backup dan persetujuan pengguna terpisah.

