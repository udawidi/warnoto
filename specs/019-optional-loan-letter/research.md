# Research: Optional Heavy Equipment Loan Letter

## Keputusan 1: Kompatibilitas kontrak

- **Decision**: Pertahankan `p_pickup_evidence_path` dan `pickupEvidencePath`; hanya semantik tampilannya berubah menjadi Surat Peminjaman opsional.
- **Rationale**: Data lama, signed URL, storage policy, dan pemanggil lama tetap bekerja tanpa backfill.
- **Alternatives considered**: Rename field/parameter ditolak karena memperbesar migration dan memerlukan migrasi data.

## Keputusan 2: Ruang lingkup opsional

- **Decision**: Nilai kosong hanya diizinkan untuk peminjam `HAR_UIT`; alur lain tetap memakai aturan sebelumnya.
- **Rationale**: Permintaan pengguna khusus peminjaman UIT dan perubahan tidak boleh melonggarkan proses unit lain.
- **Alternatives considered**: Menghapus kewajiban global ditolak karena memperluas scope.

## Keputusan 3: Format surat

- **Decision**: Terima PDF, JPG, PNG, dan WebP; gambar memakai kompresi existing, PDF diunggah tanpa kompresi.
- **Rationale**: Surat lazim berbentuk PDF atau hasil foto, tanpa dependensi baru.
- **Alternatives considered**: Gambar saja terlalu membatasi; konversi PDF menambah dependensi dan tidak diperlukan.

## Keputusan 4: Urutan deploy

- **Decision**: Terapkan migration sebelum frontend.
- **Rationale**: Server lama akan menolak path kosong; server baru tetap kompatibel dengan frontend lama yang selalu mengirim path.
- **Alternatives considered**: Frontend lebih dulu ditolak karena menimbulkan kegagalan transaksi sementara.
