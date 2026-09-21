# Data Model: Sinkronisasi Langsung Stock Opname

## Sesi Stock Opname

- Identitas, UPT, status, `data` JSONB existing.
- Tambahan metadata server `updated_at` untuk urutan event canonical.
- Setiap update server menaikkan `updated_at`.

## Freeze

- `aktif`, `gudangIds`, `at`, `by`, `unfrozenAt` tetap di JSONB existing.
- Hanya TL pada UPT sesi boleh mengubahnya.
- Aktivasi hanya untuk gudang yang terdapat dalam sesi; deaktivasi diizinkan walau sesi terminal.

## State Transitions

- Freeze: nonaktif -> aktif -> nonaktif, hanya aksi manual TL.
- Input lokal: dirty -> saving -> saved atau failed/local retained.
- Event remote diterapkan langsung bila state bersih; bila dirty, merge dilakukan setelah antrean save.
