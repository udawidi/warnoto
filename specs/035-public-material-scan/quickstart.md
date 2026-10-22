# Quickstart: Public Material Scan per UPT

## Verifikasi lokal

```text
rtk node --test tests/unit/publicMaterialScan.contract.test.mjs
rtk node scripts/rehearse_public_material_scan.mjs
rtk npm test
rtk npm run build
rtk git diff --check
```

`rehearse_public_material_scan.mjs` membuat PostgreSQL scratch Docker, memasang kontrak minimal dan migration dua kali, lalu menguji katalog shared UPT Surabaya/Probolinggo, qty nol, lokasi, riwayat, QR lama, dan UPT invalid. Jika Docker daemon tidak aktif, rehearsal berhenti di preflight dan tidak menyentuh production.

## Rollout production

1. Review `supabase/migrations/20261022_public_material_scan.sql`.
2. Minta persetujuan terpisah untuk perubahan schema production.
3. Jalankan migration di self-host production sesuai prosedur project.
4. Deploy frontend melalui push ke `main` setelah migration berhasil.
