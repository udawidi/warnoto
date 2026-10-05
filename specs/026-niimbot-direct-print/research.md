# Research: Cetak Langsung NIIMBOT M2-H

## Decision 1: Transport printer

**Decision**: Gunakan `niimbot-web-bluetooth` 2.6.0 melalui Web Bluetooth.

**Rationale**: Library zero-dependency ini menyediakan discovery, identifikasi model, raster printing, dan dukungan M2-H yang telah diuji.

**Alternatives considered**: Dialog cetak browser ditolak untuk direct print karena tidak mengontrol perangkat dan media. Implementasi protokol BLE sendiri ditolak karena menambah risiko dan kode proprietary.

Driver versi ini menyediakan bundle CommonJS/IIFE dan memasang API pada `window.Niimbot`; bukan named ESM export. Import side-effect harus statis agar tidak ada `await` sebelum pemilih perangkat.

## Decision 2: Target dan keamanan model

**Decision**: Izinkan cetak hanya setelah `identify()` mengembalikan model ID 4608 (M2-H).

**Rationale**: Ukuran raster dan perintah printer bergantung model. Fail-closed mencegah output salah pada perangkat lain.

**Alternatives considered**: Memercayai nama Bluetooth ditolak karena nama dapat berbeda atau dipalsukan. Membiarkan semua model ditolak karena media dan resolusi tidak sama.

Profil koneksi memakai prefix M2, task `b1`, density 3, label type 1, dan speed 1. Hasil `identify()` tetap menjadi sumber validasi final.

## Decision 3: Raster dan orientasi

**Decision**: Render desain landscape 70×50 mm, lalu putar 90 derajat ke raster printer 567×827 px pada 300 dpi.

**Rationale**: Media terpasang 50 mm melintang kepala cetak dan 70 mm searah feed. Lebar 567 mengikuti profil M2-H library dengan margin drift.

**Alternatives considered**: 827×591 langsung ditolak karena orientasi feed printer. Screenshot HTML ditolak karena hasil font dan skala lebih sulit dikendalikan.

## Decision 4: Lifecycle koneksi

**Decision**: Simpan instance koneksi selama halaman hidup, gunakan ulang jika masih aktif, dan kosongkan saat disconnect atau error fatal.

**Rationale**: Mengurangi dialog pairing tanpa menyimpan izin atau data sensitif baru.

**Alternatives considered**: Pairing setiap label ditolak karena lambat. Persistensi lintas reload ditolak karena Web Bluetooth tetap mengendalikan izin perangkat.

## Decision 5: Batas format

**Decision**: A4 tetap memakai builder HTML dan `window.print()`. Preview compact existing tetap tersedia sebagai fallback terpisah.

**Rationale**: Pengguna secara eksplisit membatasi NIIMBOT hanya untuk compact 70×50 mm.

**Alternatives considered**: Menyatukan semua tombol cetak ditolak karena berisiko mengubah alur A4.
