# Riset titik peta Gardu Induk

Tanggal: 2026-09-18  
Sumber identitas: `public.mtu_khs_gardu_induk` pada self-host `minipc-gudang`.

## Hasil audit final

- GI canonical: **189**.
- Record dengan `data.sourceUrl`: **82**.
- Record dengan `data.lat`: **0**.
- Record dengan `data.lng`: **0**.
- Source URL yang tersedia mengarah ke Google Sheet `1P4uzA61kt5-B8SejwifQqQAmziDY5E3kPAKcXAFBI7g`, sheet `gid=2023228375`.
- Sheet tersebut berisi inventaris peralatan; kolomnya tidak memuat lintang, bujur, atau titik peta GI.

## Hasil pencarian peta

- Query pass 1: `Gardu Induk <nama>` untuk seluruh 189 GI.
- Query pass 2: `PLN GI <nama>` untuk 69 GI tanpa kandidat awal.
- Query pass 3: `GI <nama>` untuk 61 GI yang masih kosong.
- Status final: **139 verified_candidate**, **39 unverified**, **11 manual_review**.
- Semua status verified memiliki koordinat dan `exact_map_url`. Status unverified/manual tetap tanpa koordinat.
- 11 manual review mencakup mismatch voltage/site type dan POI yang sama untuk dua GI berbeda.

## Keputusan riset

Koordinat di ledger berasal dari hasil POI Google Maps. Search URL dipakai sebagai provenance; `exact_map_url` menunjuk pin koordinat. Nominatim/OpenStreetMap tidak mengembalikan titik untuk pencarian contoh `GI 150KV AMLAPURA Indonesia`; centroid kota dan hasil geocoding umum tidak dipakai.

## Jalur aman berikutnya

Sebanyak **39 GI unverified** dan **11 GI manual_review** masih membutuhkan titik resmi atau verifikasi lapangan. Jangan mengisi centroid atau hasil geocoding umum. Setelah alamat resmi/POI PLN tersedia, cocokkan nama, voltage/site type, UPT/ULTG, koordinat, dan URL pin sebelum mengubah status ledger.
