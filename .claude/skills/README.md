# Skills WARNOTO — Panduan Pengelompokan

Ringkasan skill yang tersedia di project ini, dipisah **buatan sendiri** (aset yang kamu rawat) vs **import** (generik/pihak ketiga, bisa dibuang tanpa kehilangan kerja sendiri).

> Cara memanggil: ketik `/<nama-skill>` (tanpa slash saat rujuk di teks). Skill dipanggil lewat **NAMA**, bukan lokasi folder — lihat catatan folder di bawah.

## 🛠️ Buatan sendiri (custom WARNOTO)
Direktori nyata di `.claude/skills/`, konten Indonesia + spesifik project. **Ini aset project — rawat & jangan asal hapus.**

Ditandai awalan **`war-`** biar mudah dibedakan dari skill import saat memanggil.

| Skill | Fungsi |
|---|---|
| `war-plan-warnoto` | Planning/brainstorm fitur WARNOTO (planning-only, tak sentuh kode) |
| `war-uimobile` | Perbaiki UI mobile WARNOTO (review-first, edit presentasi terbatas) |
| `war-pendingitem` | Review pending item WARNOTO (read-only) |
| `war-mulai` | Start dev server WARNOTO (`npm run dev`, port 3001) |
| `war-update-data` | Sync commit+push ke repo + flag Supabase schema |

> Skill custom ada di 2 tempat: `.claude/skills/` (Claude Code) + `.agents/skills/` (Codex) biar konsisten lintas-vendor.
> **Isi keduanya harus sama.** Sampai 2026-08-15 sisi `.agents/` cuma berisi ringkasan 8-10 baris berbahasa Inggris sementara sisi `.claude/` berisi langkah lengkap 21-73 baris — artinya Codex selama ini menerima instruksi yang jauh lebih miskin. Sudah disamakan; kalau salah satu diubah, salin ke sisi satunya.
> Rename `war-uimobile` sudah selesai di kedua sisi (folder `.claude/` sempat ke-lock file handle Windows, diselesaikan dengan membuat folder baru lalu menghapus yang lama, bukan `git mv`).

## 📦 Import (generik / pihak ketiga)
Nol sebutan WARNOTO. Bundle desain generik, bisa dibuang/diganti tanpa kehilangan kerja sendiri.

**Bundle desain (di `.claude/skills/`, ter-commit di repo):**
`banner-design` · `brand` · `design` · `design-system` · `responsive-design` · `slides` · `ui-styling` · `ui-ux-pro-max`

- `design` / `design-system` / `banner-design` = router yang memanggil `ui-styling` / `ui-ux-pro-max` (saling terkait — jangan hapus sebagian, nanti referensi menggantung).
- Konvensi WARNOTO = Tailwind v4 CSS-global + inline `sty` (BUKAN shadcn/className). `ui-styling` (basis shadcn) & `ui-ux-pro-max` kurang cocok di sini; dipertahankan tapi nganggur.

**Global (di luar project, otomatis tersedia di semua project):**
- User-scope (`~/.claude/skills`): `frontend-design`, `redesign-existing-projects`, `web-design-guidelines`, `design-taste-frontend`, `brandkit`, `image-to-code`
- Referensi non-skill: `~/.agents/reference/awesome-design-md` — 74 sistem desain merek (termasuk `apple/`, `linear.app/`, `stripe/`) dalam bentuk markdown. Dibaca manual saat butuh acuan rasa, bukan dipanggil sebagai skill.
- Plugin (`~/.claude/plugins`): `caveman`, `ponytail`, `rtk-plugin`, `n8n-mcp-skills`, `speckit/specify`

## Catatan folder (penting)
Claude Code menemukan skill hanya di `.claude/skills/<nama>/SKILL.md` (**scan 1 level**). Menyusun skill ke sub-folder grup (mis. `.claude/skills/import/design/`) membuatnya **TIDAK ditemukan** → otomatis hilang dari daftar panggil (efeknya = nonaktif, walau file masih ada).

Artinya pengelompokan tak bisa lewat sub-folder tanpa menonaktifkan. Dua cara sah:
1. **Biarkan folder datar** + pakai README ini sebagai indeks (semua tetap bisa dipanggil). — *default sekarang*
2. **Arsipkan import** ke folder yang tak di-scan (mis. `_archive-import/`) → daftar panggil jadi ringkas (cuma custom + WARNOTO), file tetap ada & bisa dipulihkan. Konsekuensi: skill import jadi tak bisa dipanggil sampai dikembalikan.
