# Research

## Keputusan

- Reuse kolom JSON `stock_opname`; tidak perlu skema baru.
- Reuse `saveOpname`, `users`, `uptList`, `gudangList`, dan relasi `sourceSapOpnameId`.
- Reuse format builder resmi yang sudah ada, tetapi satukan bagian di dalam satu dokumen HTML.
- PID tetap input manual sampai contoh Excel tersedia.

## Alternatif yang ditolak

- localStorage ditolak karena tidak lintas perangkat.
- Mencetak dua full HTML dengan concatenation ditolak karena struktur dokumen tidak valid.
- Menebak Manager pertama ditolak karena dapat menghasilkan penandatangan salah.
- Menambah library PDF ditolak karena browser print sudah cukup.
