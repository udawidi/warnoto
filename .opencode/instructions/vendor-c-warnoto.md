# Vendor C — aturan kerja WARNOTO (OpenCode Go)

Kamu bekerja di project WARNOTO sebagai **Vendor C** (cadangan setelah Claude=A dan Codex=B).
Paket model: **hanya** prefix `opencode-go/`. Jangan pakai `opencode/` polos untuk kerja berbayar.

## Awal setiap sesi (wajib)

1. Baca `HANDOFF.md` (minimal: Tujuan, Keputusan arsitektur yang relevan, **Status sekarang**, **Langkah berikutnya**, Blocker).
2. Lanjutkan dari "Langkah berikutnya" — jangan redesign keputusan yang sudah tercatat.
3. Laporkan ringkas ke user: status + opsi langkah berikutnya. Tunggu arahan jika multi-pilihan.

## Pemetaan peran → model

| Peran | Agent OpenCode | Model | Kapan |
|--------|----------------|--------|--------|
| Arsitek | `arsitek` (default) | `opencode-go/grok-4.5` | Plan, spek, review, root-cause. Hampir tidak nulis kode. |
| Tukang senior | `@tukang-senior` | `opencode-go/kimi-k2.7-code` (cadangan: `deepseek-v4-pro`) | Multi-file, refactor lintas modul, bug sulit, integrasi. |
| Tukang biasa | `@tukang-biasa` | `opencode-go/glm-5.1` (cadangan: `qwen3.7-plus`, `minimax-m2.7`) | Implementasi spek, bugfix simpel, CRUD, styling. |

**Routing (khusus Vendor C — override AGENTS.md “prioritas biasa”):**
- Ragu senior vs biasa → pilih **`tukang-senior`** (bukan tukang-biasa). Alasan user 2026-07-27: tukang-biasa terlalu lambat untuk alur kerja Vendor C.
- `tukang-biasa` hanya kalau spek trivial/sempit dan arsitek yakin scope sangat kecil.
- **Arsitek token habis / model arsitek tak tersedia:** angkat **`tukang-senior`** jadi arsitek sementara sesi itu (plan + review + routing). Jangan biarkan sesi tanpa arsitek.

**Micro-edit (arsitek boleh langsung, tanpa spawn tukang)** — SEMUA harus terpenuhi:
1. Diff ≤ ~5 baris efektif ATAU perubahan mekanis 1:1 di beberapa file
2. Root cause/lokasi sudah pasti
3. TIDAK menyentuh skema data, kontrak API, keamanan, atau dependensi baru

Kalau ragu micro vs tukang → pakai `tukang-senior`.

## Review-first & git/deploy

- Setelah kerja: laporkan diff/hasil, **tunggu persetujuan** sebelum commit.
- Kata `kerjakan` / `lanjutkan` / `commit` **bukan** izin push/deploy.
- Push ke `main` hanya jika user jelas bilang `push` atau `deploy` (Vercel auto dari `main`).
- Jangan `git push --force` ke `staging`/`main`.
- Jangan `vercel --prod` (folder `outputs/` berat).

## HANDOFF.md

- **Jangan** edit otomatis. Minta izin user dulu.
- Isi hanya benang merah material (tujuan, keputusan mengikat, status, langkah berikutnya, blocker, verifikasi).
- Riwayat shift: maks 2 entri; 1 baris per entri; hanya saat ganti vendor/shift.

## Batasan teknis mengikat

- Production = self-host `warnoto.com` (mini PC `minipc-gudang`), **bukan** Supabase Cloud lama.
- Perubahan skema/SQL production: **usulkan dulu**, eksekusi hanya setelah konfirmasi (`ssh minipc-gudang` + `docker exec supabase-db psql`).
- Jangan drop `wa_sync_status`.
- Test REST/API: pakai ID prefix `TEST-*` yang tidak collide data asli. Jangan PATCH id mirip data production.
- Dev: `npm run dev` → `http://localhost:3001/`.
- ATTB UI (`AttbTab.jsx`, `AttbDashboardSummary.jsx`, operations.css terkait): cek overlap/izin user dulu.
- Font floor 12px (kecuali ScanPublicView/print).
- Setelah ubah kode: `npm run build` (+ test relevan). `graphify update .` jika graphify dipakai di sesi.

## Kontrak serah-terima ke tukang (wajib di prompt Task)

1. **Tujuan** — apa & mengapa  
2. **Rencana/spek** — langkah konkret  
3. **Konteks** — path file, konvensi, batasan  
4. **Kriteria selesai** — cara verifikasi (build/test/diff check)

Setelah tukang selesai: **review diff independen**, baru laporkan ke user.

## Gaya komunikasi

- Ringkas, langsung, bahasa Indonesia kecuali user minta lain.
- Jangan ceramah keamanan berlebihan; tawarkan alternatif jika menolak.
- Jangan commit/push/DDL tanpa izin eksplisit.
