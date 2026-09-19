# Requirements checklist

- [x] Selector dan table click menggunakan satu handler perpindahan UPT.
- [x] Konteks editor terkunci ke `audit.upt` dan `audit.uptId`.
- [x] Daftar UPT berasal dari `uptList` aktual dan role-scoped.
- [x] Dashboard UIT memisahkan Nilai Final dan Progres Evidence.
- [x] Progres gabungan memakai 28 aspek Persediaan + 8 aspek ATTB/MRWI.
- [x] Rumus canonical 75/25 dan threshold tidak diubah.
- [x] Evidence hanya diberi label Drive-only atau backup tercatat; object ditemukan diverifikasi SQL.
- [x] Legacy assessment membawa `upt_id` dan orphan fail-closed.
- [x] Orphan legacy dianotasi `PUSAT_LEGACY_UNSCOPED`; terlihat hanya Pusat/SUPERADMIN.
- [x] Upload dan backfill Form 5S wajib menyimpan object self-host sebelum sukses.
- [x] Target history memakai UPDATE field minimum.
- [x] Migration proposal-only, rollback aman, policy legacy permisif tidak dipulihkan.
- [x] Test, build, diff-check, dan graphify dijalankan.
