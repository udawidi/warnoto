# Security Contract

1. Query langsung sebagai akun UPT hanya mengembalikan row yang lolos `can_access_upt`.
2. Payload tidak dapat memindahkan row ke UPT lain karena `WITH CHECK`.
3. Tidak ada policy authenticated-wide atau policy untuk `anon/public`.
4. Tidak ada jalur `TRUNCATE` bagi `authenticated`.
5. Filter client adalah defense-in-depth; hilangnya filter tidak boleh membuka data karena RLS tetap aktif.
6. Cache tanpa scope tidak dipercaya untuk user non-nasional.
