# Riset titik peta Gardu Induk

Tanggal: 2026-09-18  
Sumber identitas: `public.mtu_khs_gardu_induk` pada self-host `minipc-gudang`.

## Hasil audit sumber data

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
- Query pass 4: pencarian spesifik nama, jenis GI/GIS/GITET, tegangan, dan wilayah untuk 50 GI yang masih kosong atau ambigu.
- Pass 5 menggunakan alamat dan plus code yang diberikan pemilik data untuk Kapal, Segoromadu 150/70 kV, Ispatindo, Waru 70 kV, GIS Ujung, dan GIS Wonokromo. Titik dicocokkan dengan objek gardu OpenStreetMap atau titik plus code.
- Status riset saat ini: **156 titik kandidat**, **29 unverified**, **4 manual_review**.
- Semua status verified memiliki koordinat dan `exact_map_url`. Status unverified/manual tetap tanpa koordinat.
- Sepuluh kandidat baru ditemukan pada pass 4: GIS Celukan Bawang, dua entri ejaan GI 150 kV Guluk Guluk, GI 70 kV Maspion SBM, GISTET 500 kV Gresik, GI 70 kV Caruban, GIS PLTU Pacitan, GITET 500 kV Grati, GIS Gembong, dan GIS 150 kV Waru.
- Empat manual review tersisa mencakup tegangan yang berbeda pada satu nama situs dan POI yang tidak menyebut tegangan.
- GI 70 kV Segoromadu memakai titik situs yang sama dengan GI 150 kV Segoromadu berdasarkan alamat pemilik data; objek OpenStreetMap hanya mencantumkan 150 kV. GI 70 kV Waru memakai situs yang sama dengan GIS 150 kV Waru; objek OpenStreetMap mencantumkan 150 kV dan 70 kV. GI Ispatindo memakai pusat sel plus code yang diberikan pemilik data karena belum ada objek gardu terpisah di OpenStreetMap.

## Keputusan riset

Koordinat di ledger berasal dari POI Google Maps, objek gardu OpenStreetMap, dan plus code yang diberikan pemilik data. `provenance_source_url` menyimpan sumber; `exact_map_url` menunjuk pin koordinat. Nominatim/OpenStreetMap tidak mengembalikan titik untuk pencarian contoh `GI 150KV AMLAPURA Indonesia`; centroid kota dan hasil geocoding umum tidak dipakai.

## Status penerapan produksi

Pada 2026-09-18, 156 koordinat kandidat diterapkan ke `public.mtu_khs_gardu_induk` self-host setelah preflight ID, UPT, ULTG, nama, dan konflik koordinat menunjukkan 0 baris bermasalah. Trigger menyinkronkan koordinat ke 156 baris gudang GI dan 156 baris lokasi GI; pengecekan silang koordinat master/shadow menghasilkan 0 selisih. Tidak ada perubahan skema. Skrip dan rollback batch tersedia di `scripts/gi-map-import.mjs`. Koordinat kandidat dapat dikoreksi oleh TL sesuai UPT jika verifikasi lapangan menemukan pin yang lebih tepat.

## Pengisian sisa oleh TL per UPT

Pemilik data memutuskan 33 GI yang belum memiliki titik diisi kemudian oleh TL masing-masing UPT melalui Master Data → Gardu Induk / GI → pilih GI → isi latitude, longitude, dan URL sumber peta → Simpan titik peta. Jumlah sisa: UPT Gresik 2, UPT Madiun 17, UPT Malang 10, UPT Probolinggo 4. UPT Bali dan UPT Surabaya sudah memiliki kandidat untuk semua GI. TL dapat menyimpan hanya untuk UPT yang tercakup oleh akunnya; RPC membatasi peran dan cakupan UPT di server.

Sebanyak **29 GI unverified** dan **4 GI manual_review** masih membutuhkan titik resmi atau verifikasi lapangan. Jangan mengisi centroid atau hasil geocoding umum. TL perlu memastikan nama, voltage/site type, UPT/ULTG, koordinat, dan URL pin sebelum menyimpan.
