# Research: Pengembalian Alat Berat

## Decision: CTA pada kartu Armada

- **Rationale**: Halaman default adalah Armada; tombol lama hanya ada di Peminjaman & Histori sehingga tidak ditemukan TL.
- **Alternatives**: Memindahkan pengguna otomatis ke histori ditolak karena menyembunyikan aksi utama.

## Decision: RPC atomik

- **Rationale**: Handler lama mengubah dua tabel terpisah, mengabaikan kegagalan, dan dapat menampilkan sukses palsu.
- **Alternatives**: Dua upsert client ditolak karena memungkinkan status loan dan availability alat berbeda.

## Decision: ADMIN/TL pemilik

- **Rationale**: Keputusan user; UPT peminjam tidak berwenang menetapkan aset pemilik telah diterima kembali.
- **Alternatives**: ASMAN/peminjam ditolak untuk scope ini.

## Decision: Checklist ringkas

- **Rationale**: Reuse modal existing; waktu dan pelaku dicatat server; foto/kondisi rinci tidak diminta.
- **Alternatives**: Foto wajib dan form kerusakan ditunda.
