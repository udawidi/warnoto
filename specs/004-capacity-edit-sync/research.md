# Research: Perbaikan Edit dan Sinkron Kapasitas Gudang

## Keputusan 1: Makna persentase

- **Decision**: Lima kategori menjadi input utama. `utilisasi = totalKomposisi` dan `luasTerpakai = luasLahan × totalKomposisi`.
- **Rationale**: Keputusan awal yang memisahkan utilisasi dari komposisi diganti setelah uji localhost menunjukkan input ganda membingungkan pengguna.
- **Alternatives considered**: Mempertahankan input luas terpakai ditolak. Normalisasi massal 31 dari 44 record lama juga ditolak karena mengubah data historis tanpa review per record.

## Keputusan 2: Urutan sinkron

- **Decision**: Upsert DB satu baris lebih dahulu, kemudian preview dan konfirmasi Sheet satu baris.
- **Rationale**: DB sumber kebenaran dan proyek mewajibkan review-first.
- **Alternatives considered**: Push otomatis tanpa konfirmasi ditolak; push massal tiap edit terlalu luas.

## Keputusan 3: Penegakan batas

- **Decision**: Validasi UI dan CHECK constraint DB memakai toleransi `0.000001`.
- **Rationale**: UI memberi pesan ramah; DB melindungi semua jalur tulis. Preflight 44 baris menunjukkan nol pelanggaran dan selisih rumus maksimum di bawah toleransi.
- **Alternatives considered**: UI-only ditolak karena import/API dapat melewati UI.

Constraint aktif belum memaksa kesamaan komposisi dan utilisasi agar record lama tetap dapat dibaca. Record yang disimpan ulang melalui form edit selalu canonical.
