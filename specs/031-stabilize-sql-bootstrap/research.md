# Research: Stabilize SQL Bootstrap

## Decision: Dua artefak dengan tanggung jawab tegas

- **Decision**: migrations = histori upgrade; `schema.sql` = final-state bootstrap.
- **Rationale**: data repair aman sebagai migration tetapi tidak valid pada database kosong.
- **Alternatives considered**: menempel semua migration ke snapshot ditolak karena membawa asumsi data historis.

## Decision: Bersihkan bertahap

- **Decision**: hapus data repair dan definisi lama yang jelas tertimpa; jangan pecah file per domain sekarang.
- **Rationale**: mengurangi risiko perubahan ordering/dependency besar.
- **Alternatives considered**: regenerasi total langsung dari production ditunda karena perlu audit ownership/extension/grant lebih luas.

## Decision: Rehearsal kosong dua kali

- **Decision**: validasi di PostgreSQL scratch, bukan production.
- **Rationale**: membuktikan fresh bootstrap dan idempotency tanpa risiko data.
