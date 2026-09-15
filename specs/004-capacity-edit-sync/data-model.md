# Data Model: Kapasitas Gudang

## Warehouse Capacity

- Identitas: `id`, `upt`, `gudang`, `sub_gudang`.
- Komposisi: `persediaan_pct`, `cadang_pct`, `pre_memory_pct`, `attb_pct`, `lainnya_pct`; masing-masing 0–1 dan total maksimum 1 dengan toleransi enam desimal.
- Luas: `luas_lahan_m2 >= 0`, `luas_terpakai_m2 = luas_lahan_m2 × totalKomposisi`, dan `sisa_luas_m2 = luas_lahan_m2 - luas_terpakai_m2` untuk record yang disimpan melalui form edit.
- Utilisasi: `persentase_terpakai = totalKomposisi`; luas lahan nol hanya valid dengan total komposisi nol.
- Status: `KRITIS` bila utilisasi >=0,90; `WASPADA` bila >=0,75; selain itu `AMAN`.
- Sinkron: `waktu_update` untuk label pengguna dan `updated_at` untuk waktu persistence.

Tidak ada entity atau kolom baru. Constraint existing tetap dipakai. Sebanyak 31 dari 44 record lama belum dipaksa mengikuti relasi baru dan tidak dinormalisasi massal.
