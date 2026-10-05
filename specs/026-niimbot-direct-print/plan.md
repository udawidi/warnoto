# Implementation Plan: Cetak Langsung NIIMBOT M2-H

**Branch**: `026-niimbot-direct-print` | **Date**: 2026-10-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/026-niimbot-direct-print/spec.md`

## Summary

Tambahkan jalur Web Bluetooth khusus tombol compact 70×50 mm. Render label ke canvas 567×827 px, putar desain landscape sesuai arah feed, identifikasi printer sebagai M2-H sebelum cetak, lalu kirim dengan density 3. Pertahankan A4 dan preview compact existing tanpa perubahan perilaku.

## Technical Context

**Language/Version**: JavaScript/JSX, Node.js >=20.19

**Primary Dependencies**: React 18, Vite 8, qrcode existing, `niimbot-web-bluetooth` 2.6.0

**Storage**: N/A

**Testing**: Node test runner, Vite production build, manual Android Chrome + M2-H smoke test

**Target Platform**: Android Chrome melalui HTTPS atau localhost; NIIMBOT M2-H 300 dpi

**Project Type**: Web application

**Performance Goals**: Satu klik setelah pairing aktif; tepat satu pekerjaan cetak per aksi

**Constraints**: Web Bluetooth membutuhkan user gesture; model harus ID 4608; raster 567×827; density 3; A4 tidak boleh memanggil Bluetooth

**Scale/Scope**: Satu modal, satu helper printer, satu renderer canvas, unit tests; tanpa backend atau perubahan skema

## Constitution Check

*GATE: Passed sebelum dan sesudah desain.*

- Solusi memakai alur modal, QR generator, dan fallback preview existing.
- Satu dependensi diperlukan untuk protokol perangkat proprietary; dipin ke versi yang telah memvalidasi M2-H.
- Tidak ada skema, API, autentikasi, atau data bisnis yang berubah.
- Validasi model fail-closed dan error pengguna tidak disederhanakan.
- A4 tetap terpisah dan tidak memiliki jalur ke Web Bluetooth.
- Renderer dan aturan koneksi memiliki unit test; perangkat fisik diverifikasi manual.

## Project Structure

### Documentation (this feature)

```text
specs/026-niimbot-direct-print/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── niimbot-print.md
└── tasks.md
```

### Source Code (repository root)

```text
src/components/KartuGantungModal.jsx
src/lib/niimbotM2h.js
tests/unit/niimbotM2h.test.mjs
tests/unit/kartuGantungCompact.test.mjs
package.json
package-lock.json
```

**Structure Decision**: Satu helper lokal menampung renderer dan lifecycle printer agar modal hanya mengelola status UI. Import side-effect driver dilakukan statis agar pemilih perangkat tetap dipanggil dalam user gesture. Builder HTML existing tetap menjadi preview fallback.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Dependensi protokol printer | Protokol BLE NIIMBOT bersifat proprietary dan M2-H sudah divalidasi library | Implementasi byte protocol sendiri lebih besar dan berisiko |
