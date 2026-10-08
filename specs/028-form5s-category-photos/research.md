# Research Decisions

## Data shape

**Decision:** Pertahankan array foto datar dan tambahkan `categoryId` pada foto baru.

**Rationale:** Perubahan terkecil; endpoint indeks, cache, history, dan record legacy tetap kompatibel.

**Alternatives considered:** Struktur nested per kategori ditolak karena membutuhkan normalisasi ulang di seluruh jalur.

## Print timeout

**Decision:** Timeout delapan detik untuk signing dan delapan detik untuk image decode.

**Rationale:** Tombol cetak selalu tersedia maksimal 16 detik dan dokumen tetap dapat dicetak dengan placeholder.

## Compression

**Decision:** Batas khusus foto Form 5S adalah 2 MiB dan 2000 px; batas evidence umum tetap 3 MiB.

**Rationale:** Mengurangi muatan maksimum 15 foto tanpa mengubah kontrak berkas Maturity lain.

## Compatibility

**Decision:** Validasi 15 foto hanya untuk insert baru; data lama tidak dibackfill.

**Rationale:** Riwayat append-only tidak boleh diubah dan tidak memiliki kategori sumber yang dapat dipercaya.
