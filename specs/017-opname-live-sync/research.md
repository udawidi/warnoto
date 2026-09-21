# Research: Sinkronisasi Langsung Stock Opname

- **Decision**: Pakai publication Realtime existing dan resync saat reconnect/focus.  
  **Rationale**: Menutup stale cache tanpa polling/dependensi baru.  
  **Alternatives considered**: Refresh saat buka saja tidak memenuhi sinkron langsung.
- **Decision**: Patch freeze lewat RPC satu baris dan lindungi dengan trigger role.  
  **Rationale**: Full-list sync berisiko menimpa/menghapus sesi dari cache lama; UI-only bukan batas keamanan.  
  **Alternatives considered**: Gate tombol saja mudah dilewati.
- **Decision**: Reuse merge per blok dan antrean save.  
  **Rationale**: Pola sudah diuji dan mencegah lost update lintas perangkat.  
  **Alternatives considered**: Model item-per-row adalah refactor besar dan tidak diperlukan.
