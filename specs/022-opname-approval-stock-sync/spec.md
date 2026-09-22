# Feature Specification: Rekonsiliasi Ringan Stock Opname

**Feature branch:** `022-opname-approval-stock-sync`  
**Date:** 2026-09-22  
**Status:** Implemented locally; migration proposal not applied

## Aturan

- Approval Asman membandingkan Qty SAP, total Qty Fisik, dan total Qty WARNOTO per material/katalog.
- Jika salah satu berbeda, material wajib memiliki keterangan sendiri. Keterangan global tidak cukup.
- Approval tidak mengubah `stocks.qty`; Qty WARNOTO tetap.
- SAP session menyimpan baseline SAP terbaru ke row stok aktif dengan katalog dan UPT yang sama. Nilai baseline tidak dijumlahkan antar lot.
- Non-SAP membandingkan Fisik dan WARNOTO tanpa menyentuh baseline SAP.
- Material baru dari SAP boleh membuat katalog, tetapi approval tidak membuat stok baru.
- TL/Admin dapat menambah `tugReference` opsional setelah `SELESAI`; referensi tidak mengubah status atau qty.
- Qty Fisik selalu hasil hitung manual dan hanya dapat ditulis ADMIN/TL/SUPERADMIN. Asman dan Manager read-only.
- Opname SAP UPT-SBY yang selesai pada 2026-09-22 WIB dapat di-backfill baseline SAP tanpa mengubah dokumen, catatan, atau Qty WARNOTO.

## Saran tindakan

- Fisik > WARNOTO: `TUG penerimaan`.
- Fisik < WARNOTO: `TUG pengeluaran`.
- Fisik = WARNOTO tetapi SAP berbeda atau kosong: `Periksa/koreksi SAP`.
- Fisik dan SAP sama-sama berbeda dari WARNOTO: `TUG + periksa SAP`.
- Semua sama: `Tidak ada tindakan`.

## Acceptance criteria

1. SAP 8 / Fisik 7 / WARNOTO 5 menampilkan selisih, keterangan wajib, dan saran `TUG + periksa SAP`.
2. SAP 7 / Fisik 7 / WARNOTO 5 menyarankan `TUG penerimaan`.
3. SAP 8 / Fisik 7 / WARNOTO 7 menyarankan `Periksa/koreksi SAP`.
4. Semua angka sama tidak membutuhkan keterangan.
5. Keterangan kosong per material memblokir submit dan approval UI serta RPC.
6. Approval sukses memperbarui baseline SAP tanpa perubahan `stocks.data.qty`.
7. `tugReference` dapat disimpan setelah selesai hanya oleh ADMIN/TL/SUPERADMIN melalui RPC terpisah.
8. RPC mempertahankan signature `approve_stock_opname_asman(text,jsonb,jsonb,jsonb)` dan finalisasi dilakukan terakhir.
9. Penulisan draft dari role selain ADMIN/TL/SUPERADMIN ditolak UI, hook, dan RLS.
10. Backfill memakai approval paling akhir per katalog dan membuktikan hash dokumen serta Qty WARNOTO tidak berubah.

## Batasan

- Tidak ada tabel/dependency baru.
- Migration hanya proposal; tidak ada apply produksi atau koreksi data lama.
- Foto, role, UPT, dan idempotency guard existing tetap berlaku.
