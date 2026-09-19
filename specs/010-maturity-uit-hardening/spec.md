# Maturity UIT hardening

## Tujuan

Penilaian Maturity untuk reviewer UIT harus scoped per UPT yang berada di UIT-nya, tidak boleh mempertahankan konteks audit saat UPT berpindah, dan harus membedakan nilai final dari progres evidence. Dashboard tetap compact, corporate PLN, dan memakai rumus canonical 75/25.

## Acceptance criteria

- Selector dan tabel UPT memakai satu handler. Saat editor audit aktif, perubahan UPT menunggu upload/autosave selesai dan konfirmasi keluar; batal tidak mengubah UPT.
- Editor selalu memakai `audit.upt`/`audit.uptId` yang dibuka, bukan state selector global.
- Daftar UPT memakai `uptList` aktual dan role scope: UPT sendiri, UIT dalam `uitId`, atau nasional untuk Pusat/SUPERADMIN.
- Dashboard menampilkan KPI cakupan, nilai final, perlu tindakan, dan coverage evidence; progres gabungan Persediaan 28 + ATTB/MRWI 8 aspek.
- Nilai final hanya berasal dari history FINAL; progress evidence tidak diberi label sebagai nilai final.
- RLS proposal mencakup audits, history, aspect reviews, 5S, evidence, dan legacy assessments; review `upt_id` wajib sama dengan audit.
- Evidence DTO membawa `storagePath`; Form 5S menyimpan `storagePath` dan `storageSyncedAt` setelah backup self-host wajib berhasil.
- Rumus canonical tidak berubah; test deterministik 4 Persediaan + 2 ATTB/MRWI menghasilkan 3.5 / Level 4.

## Batasan

Migration hanya proposal. Tidak apply production, tidak deploy Edge Function, tidak mengarang ownership orphan.
