# Quickstart Validation

1. Jalankan contract/unit tests sumber dan canonical.
2. Jalankan rehearsal PostgreSQL untuk create, amend, temporal filter, fallback, dan retry migration.
3. Jalankan `npm run build`.
4. Dry-run production harus menunjukkan seluruh TUG-3 resolved dan nol unmatched.
5. Setelah apply migration, query seluruh TUG-8/TUG-9: tidak ada `source_snapshot` kosong.
6. Buka TUG-9 `250.TUG-9/LOG.00.02/SBYA/IX/2026`: tiga alat menunjukkan kontrak TUG-3 198; Micro Ohm menunjukkan TUG-3 202.
7. Pastikan hash dokumen, qty stok, approval, dan stock movements tidak berubah.
