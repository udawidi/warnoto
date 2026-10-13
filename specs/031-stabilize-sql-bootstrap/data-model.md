# Data Model

Tidak ada entity bisnis baru. Refactor hanya mengatur artefak deployment:

- **Migration**: perubahan berurutan, termasuk data repair historis.
- **Bootstrap snapshot**: definisi final objek database tanpa asumsi data produksi.
- **Verifier**: pemeriksaan statis dan rehearsal database kosong.
