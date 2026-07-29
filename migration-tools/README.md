# Migrasi history AppSheet WARNOTO lama → arsip Supabase

Pipeline baku untuk memindahkan riwayat transaksi (TUG3/5/8/9/10) dari aplikasi
WARNOTO versi lama (AppSheet, DB Excel) ke Supabase sebagai arsip **read-only**,
terpisah dari transaksi live. Berlaku untuk UPT manapun selama workbook export
AppSheet-nya pakai template sheet yang sama.

## Langkah

1. **Export data AppSheet ke Excel.** Workbook harus berisi sheet `listMaterial`
   + salah satu dari `tug34_barang` / `tug10_barang` / `tug9_barang` /
   `tug8_barang` / `tug5_barang` (sesuai template lama).

2. **Cleansing & normalisasi:**
   ```
   python migration-tools/clean_warnoto_history.py --input <file.xlsx> --output-json <cleaned.json>
   ```

3. **(Opsional) Review manual dalam bentuk Excel:**
   ```
   node migration-tools/build_clean_history_workbook.mjs <cleaned.json> <review.xlsx> <preview-dir>
   ```

4. **Load ke Supabase** (tabel `legacy_history_archive`) — jalankan dulu dengan
   `--dry-run` untuk cek ringkasan sebelum benar-benar menulis ke DB:
   ```
   node migration-tools/load_legacy_history_to_supabase.mjs <cleaned.json> [--upt "<Nama UPT>"] --dry-run
   node migration-tools/load_legacy_history_to_supabase.mjs <cleaned.json> [--upt "<Nama UPT>"]
   ```

5. **Upload lampiran (foto & PDF)** dari hasil ekstrak backup AppSheet ke Supabase
   Storage + tabel `legacy_history_documents` — `--dry-run` dulu untuk cek match-rate:
   ```
   node migration-tools/upload_legacy_history_attachments.mjs <cleaned.json> [<extracted-root>] [--upt "<Nama UPT>"] --dry-run
   node migration-tools/upload_legacy_history_attachments.mjs <cleaned.json> [<extracted-root>] [--upt "<Nama UPT>"]
   ```
   `<extracted-root>` default `D:\CLAUDE\WARNOTO data\Appsheet\_extracted\data`.
   Dua bucket dipakai sesuai sensitivitas data:
   - `tug-docs-private` — foto SIM/KTP sopir + PDF dokumen (data pribadi), disimpan
     sebagai `priv:<path>`, diakses lewat signed URL.
   - `tug-photos` (public) — foto surat jalan/permintaan/pengembalian, foto kendaraan
     pengangkut, dan foto barang; tidak memuat data pribadi, sekaligus backup supaya
     tidak selamanya bergantung link Google Drive lama.

   Nama file yang sama bisa muncul di beberapa folder app-instance hasil ekstrak.
   Kalau isinya identik (hash sama) file mana pun dipakai; kalau beda isi, kandidat
   pertama dipakai dan ditandai `AMBIGU` di kolom `match_notes` untuk audit manual.

Data masuk ke tabel `legacy_history_archive` — arsip read-only, terpisah total
dari transaksi live (`tug15_history`/`katalog`), **tidak** divalidasi ulang ke
katalog aktif. Kode katalog lama disimpan apa adanya; kualitas tiap baris
transparan lewat kolom `match_confidence` dan `issue_flags`.
