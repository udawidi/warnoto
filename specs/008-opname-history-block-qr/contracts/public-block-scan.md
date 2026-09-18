# Kontrak Scan Blok Publik

- Label QR: `https://pln.warnoto.com/?loc=<lokasiId>#t=<publicToken>`. Bagian `loc` dipakai juga oleh pemilih blok Opname; token hanya dibaca browser halaman publik.
- RPC baca saja: `public.public_block_stock(p_lokasi_id text, p_token uuid) -> jsonb`; pemanggil `anon` dan `authenticated` diizinkan. Token tidak valid, lokasi tidak ada, dan label lama tanpa token tidak mengembalikan informasi blok.
- Respons berhasil: identitas gudang/blok dan array material `{noKatalog, nama, satuan, qty}` dengan `qty > 0`, digabung per katalog. Tidak ada informasi transaksi, sumber lot, pengguna, atau blok lain.
- Halaman publik menampilkan keadaan kosong, token salah, dan kegagalan server secara jelas. Tidak menyediakan operasi tulis.
