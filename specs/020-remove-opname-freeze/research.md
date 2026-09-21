# Research Notes

## Decision

Freeze Stock Opname tidak dipakai; semua jalur enforcement dihapus.

## Database finding

Objek database yang khusus freeze harus di-drop melalui migration terkontrol. Tabel `stock_opname`, Realtime, `updated_at`, dan legacy data tidak di-drop atau dimutasi massal.

## Regression scope

GI dan QR/Barcode hanya regression verification. Bootstrap heavy-equipment diverifikasi: non-TL/ADMIN skip, fallback write hanya TL.
