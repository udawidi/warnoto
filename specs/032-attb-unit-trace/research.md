# Research: ATTB Unit Trace

- **Decision**: Grain identitas adalah satu baris TUG-10 ATTB dengan qty 1.
  **Rationale**: Foto, seri/aset, source index, dan approval sudah per baris.
  **Alternatives considered**: split qty otomatis; sub-form unit dalam satu baris.
- **Decision**: QR memakai `?attb=<id>#t=<uuid>`.
  **Rationale**: Fragment tidak masuk request/referrer; pola sama dengan QR blok lokasi.
  **Alternatives considered**: katalog QR existing; ID predictable tanpa token.
- **Decision**: Histori append-only di tabel terpisah.
  **Rationale**: Riwayat tidak boleh tertimpa full-blob sync `attb_list`.
  **Alternatives considered**: reuse `stageHistory` JSONB.
- **Decision**: Public access hanya melalui RPC allowlist.
  **Rationale**: Tidak membuka RLS tabel atau raw JSON.
  **Alternatives considered**: anonymous SELECT langsung.

