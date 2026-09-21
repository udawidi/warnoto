# Quickstart Validation

1. Jalankan `node --test tests/unit/stockOpnameFlow.test.mjs tests/unit/stockOpnameLiveSync.contract.test.mjs`.
2. Jalankan verifier SQL terhadap self-host setelah migration disetujui.
3. Jalankan `npm run build`.
4. Buka sesi test pada dua konteks akun; isi qty sebagai Admin dan pastikan TL berubah <=2 detik.
5. Pastikan kontrol freeze hanya muncul untuk TL dan kegagalan RPC tidak mengubah UI.
6. Bandingkan sesi produksi Fajar sebelum/sesudah: ID sama dan progres tidak kurang dari 68/258.
