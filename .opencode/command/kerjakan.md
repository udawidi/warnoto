---
description: Arsitek susun spek lalu delegasi ke tukang yang tepat (biasa dulu; senior jika kompleks).
agent: arsitek
---

Tugas dari user: $ARGUMENTS

Alur Vendor C:
1. Baca konteks relevan (HANDOFF + file terkait). Jangan redesign keputusan lama.
2. Tulis spek singkat (tujuan, langkah, file, batasan, kriteria selesai).
3. Routing:
   - micro (≤~5 baris, lokasi pasti, bukan skema/API) → arsitek edit sendiri
   - standar → Task `tukang-biasa`
   - sulit multi-file / bug dalam → Task `tukang-senior`
   - ragu → `tukang-biasa`
4. Sertakan kontrak serah-terima lengkap di prompt tukang.
5. Review diff hasil tukang independen.
6. Laporkan ke user + minta izin commit jika siap. JANGAN push/deploy/DDL/HANDOFF tanpa izin.
