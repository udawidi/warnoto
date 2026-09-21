# Contract: `set_stock_opname_freeze`

Input: ID sesi, boolean aktif, dan daftar ID gudang. Caller wajib authenticated TL pada UPT sesi.

Output sukses: record sesi canonical setelah metadata freeze diperbarui. Output gagal: error role, scope, status, gudang, atau penyimpanan; tidak ada perubahan parsial.

Invariants:

- RPC tidak mengganti items, status, atau sesi lain.
- Aktivasi ditolak bila daftar gudang kosong/di luar sesi.
- Deaktivasi boleh dilakukan pada sesi selesai/ditolak yang masih freeze.
- Tulis langsung yang mengubah freeze oleh authenticated non-TL ditolak trigger.
