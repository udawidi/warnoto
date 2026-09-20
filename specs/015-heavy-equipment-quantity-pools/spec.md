# Feature Specification: Pool Kuantitas Alat Bantu

**Feature Branch**: `main`
**Created**: 2026-09-20
**Status**: Approved for implementation

## User Scenarios & Testing

### User Story 1 - TL Mencatat Pool Plat (P1)

TL mencatat satu pool untuk alat bantu homogen berdasarkan UPT, lokasi, dan spesifikasi, lalu memasukkan jumlah awal satu kali.

**Independent Test**: TL membuat pool berjumlah 40; registry menampilkan 40 total dan 40 tersedia setelah refresh.

### User Story 2 - TL Meminjamkan Jumlah Parsial (P1)

TL memilih pool dan jumlah yang dipinjam. Beberapa peminjam dapat memakai pool yang sama selama saldo masih cukup.

**Independent Test**: Dari total 40, pinjam 12; sistem menampilkan 28 tersedia dan menolak checkout berikutnya yang melebihi saldo.

### User Story 3 - TL Mengembalikan Sebagian dengan Kondisi (P1)

TL mencatat pengembalian bertahap sebagai jumlah baik, rusak, dan hilang, disertai foto pada setiap kejadian.

**Independent Test**: Return baik 5 menyisakan 7; return berikutnya 4 baik, 2 rusak, 1 hilang menyelesaikan loan tanpa membuat rusak/hilang tersedia.

### User Story 4 - Pengguna Melihat dan Mencetak History Detail (P2)

Owner dan requester melihat timeline checkout, approval, setiap return parsial, saldo sesudah kejadian, pelaku, catatan, dan bukti foto.

**Independent Test**: Dua return parsial tetap muncul berurutan setelah refresh dan tercetak pada dokumen transaksi.

## Edge Cases

- Dua checkout paralel berebut saldo terakhir.
- Return melebihi sisa pinjaman atau seluruh nilai nol.
- Pool memiliki loan aktif saat mode atau total hendak diubah.
- Foto berhasil diunggah tetapi RPC gagal.
- Loan pending ditolak setelah kuantitas direservasi.
- Aset dan loan individual lama tetap memakai kuantitas satu.

## Requirements

- **FR-001**: Pool MUST terisolasi menggunakan `upt_id` seperti aset existing.
- **FR-002**: Pool MUST memiliki mode kuantitas dan total awal bilangan bulat positif.
- **FR-003**: Total dan mode MUST terkunci setelah pool dibuat atau dikonversi.
- **FR-004**: Checkout MUST menerima jumlah per pool, mereservasi loan pending, dan menolak oversubscription atomik.
- **FR-005**: Beberapa loan aktif MUST diperbolehkan pada pool yang sama selama saldo cukup.
- **FR-006**: Return MUST menerima jumlah baik, rusak, dan hilang dengan total antara satu dan sisa loan.
- **FR-007**: Foto MUST wajib pada setiap return; catatan wajib jika rusak atau hilang lebih dari nol.
- **FR-008**: History return MUST append-only dan menyimpan aktor, waktu, bukti, kondisi, serta sisa setelah event.
- **FR-009**: Baik menambah saldo tersedia; rusak dan hilang tetap tidak tersedia.
- **FR-010**: Loan MUST selesai hanya saat sisa pinjaman nol.
- **FR-011**: Approval dan RLS owner/requester MUST mengikuti alur live existing.
- **FR-012**: Existing unit asset, loan, RPC, dan history MUST tetap kompatibel.
- **FR-013**: Timeline detail MUST dapat dicetak.
- **FR-014**: Alur utama MUST usable tanpa overflow pada 360 px, 768 px, dan desktop.

## Key Entities

- **Quantity Pool**: aset homogen dengan total awal yang immutable.
- **Quantity Loan**: jumlah dipinjam dan total return per kondisi.
- **Return Event**: kejadian append-only untuk satu return parsial.

## Success Criteria

- **SC-001**: TL mencatat puluhan plat sebagai satu pool dalam kurang dari dua menit.
- **SC-002**: Dua checkout bersamaan tidak pernah membuat saldo negatif.
- **SC-003**: Seluruh return parsial dan bukti tetap tersedia setelah reload/perangkat berganti.
- **SC-004**: UPT ketiga tidak dapat membaca loan atau bukti private.
- **SC-005**: Semua alur utama selesai tanpa horizontal overflow pada 360 px.

## Assumptions

- Pool dikelompokkan per UPT, gudang/lokasi, dan spesifikasi.
- Satuan default `unit`.
- Rusak/hilang langsung final oleh TL.
- Penyesuaian total, perbaikan barang rusak, dan penemuan barang hilang berada di luar scope.

