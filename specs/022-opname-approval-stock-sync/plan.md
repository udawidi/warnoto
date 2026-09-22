# Implementation Plan: Rekonsiliasi Ringan Stock Opname

1. Tambahkan helper murni untuk grouping katalog, perbandingan tiga qty, saran, dan validasi keterangan per material.
2. Ubah hook approval agar memblokir keterangan kosong, tidak membuat stok baru, tidak memutasi qty, dan hanya memberi baseline SAP pada stok aktif satu UPT.
3. Ubah review Asman agar menampilkan tiga qty agregat per material, mismatch, keterangan, dan saran tindakan.
4. Tambahkan RPC proposal untuk approval baseline-only serta RPC SECURITY DEFINER untuk referensi TUG pasca-SELESAI.
5. Tambahkan unit/contract tests, verifier, rollback, lalu jalankan test/build/diff check.
6. Batasi pengisian Qty Fisik secara manual kepada ADMIN/TL/SUPERADMIN pada UI, hook, dan RLS database.
7. Pindahkan penolakan Asman ke RPC agar RLS draft dapat dibuat fail-closed tanpa memutus alur approval.
8. Siapkan preview dan backfill satu kali untuk opname SAP UPT-SBY yang selesai pada 2026-09-22 WIB. Backfill hanya mengubah baseline SAP pada stok dan membuktikan dokumen opname tidak berubah.

## Keputusan teknis

- SAP hanya dibaca dari item pertama yang memiliki `qtySAP`; sibling lot tidak dibandingkan dengan SAP secara terpisah.
- Fisik dan WARNOTO dijumlahkan per katalog.
- Keterangan diwajibkan pada representative item material (item pertama dengan `qtySAP`, atau item pertama Non-SAP).
- `p_stock_rows` hanya boleh memperbarui metadata dan harus mempertahankan qty lama.
- Backfill memilih approval paling akhir per katalog bila satu katalog muncul pada beberapa sesi target.
- Sebelum apply produksi, ambil pg_dump dan snapshot hash/catatan target; migration tetap proposal sampai ada persetujuan apply eksplisit.
