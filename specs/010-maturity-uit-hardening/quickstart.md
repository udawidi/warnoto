# Quickstart

```text
npm run dev
```

Buka `http://localhost:3001/`, login reviewer UIT, buka Penilaian Maturity, pindah Surabaya → Malang saat editor memiliki perubahan, batalkan konfirmasi, lalu ulangi dan simpan draft. Pastikan konteks editor tidak berubah dan dashboard menampilkan UPT aktual.

Migration di `supabase/proposals/` hanya dibaca/review. Jalankan verifier SQL dengan service role pada database staging/scratch, bukan production tanpa persetujuan.
