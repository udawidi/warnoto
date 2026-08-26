-- Review paralel per-point (per-aspek) — MATLEV Audit System.
--
-- Sebelum ini: status audit tunggal per-baris; UIT hanya bisa menilai setelah UPT
-- melengkapi SEMUA aspek dan menekan "Kirim ke UIT" (status = REVIEW_UIT). Akibatnya
-- input UPT dan review UIT berjalan serial → boros waktu.
--
-- Perubahan: status "Checked/Rejected" per-aspek disimpan di TABEL TERPISAH ini,
-- BUKAN di maturity_audits.data. Alasan: UPT autosave menulis seluruh blob `data`;
-- kalau review UIT menumpang di sana, tulis paralel UPT akan menimpanya (clobber).
-- Tabel terpisah dengan RLS sendiri melepas tulis UIT dari baris audit sepenuhnya —
-- UPT tidak pernah menyentuhnya, jadi review bisa jalan selagi audit masih
-- SELF_ASSESSMENT (paralel dengan UPT yang masih mengunggah aspek lain).

create table if not exists public.maturity_aspect_reviews (
  audit_id    text not null references public.maturity_audits(id) on delete cascade,
  aspect_id   text not null,
  upt_id      text not null,               -- denormalisasi supaya bisa pakai helper RLS existing
  state       text not null default 'PENDING'
              check (state in ('PENDING', 'CHECKED', 'REJECTED')),
  note        text,                         -- alasan reject / catatan reviewer
  reviewed_by text,
  reviewed_at bigint,                       -- epoch ms; dibanding dgn timestamp evidence utk deteksi "perlu re-review"
  primary key (audit_id, aspect_id)
);

create index if not exists maturity_aspect_reviews_upt_idx
  on public.maturity_aspect_reviews (upt_id);

alter table public.maturity_aspect_reviews enable row level security;

-- BACA: UPT lihat review UPT-nya sendiri; UIT/Pusat/Superadmin lintas UPT
-- (helper can_read_maturity_upt sudah meloloskan role induk, lihat approval_chain).
drop policy if exists "Aspect reviews read scoped" on public.maturity_aspect_reviews;
create policy "Aspect reviews read scoped" on public.maturity_aspect_reviews
  for select to authenticated
  using (public.can_read_maturity_upt(upt_id));

-- TULIS (insert/update): HANYA peninjau UIT atau Pusat. Sengaja TANPA syarat status
-- audit — inilah yang membuat review bisa paralel dengan input UPT. UPT & role lain
-- tidak bisa menulis (badge review bersifat read-only bagi mereka).
drop policy if exists "Aspect reviews insert by reviewer" on public.maturity_aspect_reviews;
create policy "Aspect reviews insert by reviewer" on public.maturity_aspect_reviews
  for insert to authenticated
  with check (public.can_review_maturity_uit() or public.can_review_maturity_pusat());

drop policy if exists "Aspect reviews update by reviewer" on public.maturity_aspect_reviews;
create policy "Aspect reviews update by reviewer" on public.maturity_aspect_reviews
  for update to authenticated
  using (public.can_review_maturity_uit() or public.can_review_maturity_pusat())
  with check (public.can_review_maturity_uit() or public.can_review_maturity_pusat());
-- Tidak ada policy DELETE: jejak review tidak dihapus lewat aplikasi.

-- Edge Function memakai service_role; tanpa grant eksplisit, query tabel baru gagal
-- senyap "permission denied" (hasil kosong). Lihat memory selfhost-new-table-service-role-grant.
grant select, insert, update on public.maturity_aspect_reviews to authenticated;
grant select, insert, update on public.maturity_aspect_reviews to service_role;

-- === Pelonggaran policy update maturity_audits ===
-- Setelah semua aspek di-Check, UIT yang menekan "Kirim ke Pusat" (SELF_ASSESSMENT →
-- REVIEW_PUSAT). Policy lama hanya mengizinkan UIT saat status = REVIEW_UIT, jadi
-- transisi dari fase paralel (SELF_ASSESSMENT/REVISION) akan ditolak. Perluas cabang
-- UIT ke status-status fase paralel. WITH CHECK sudah longgar (tak diubah).
drop policy if exists "Maturity audits update by stage" on public.maturity_audits;
create policy "Maturity audits update by stage" on public.maturity_audits
  for update to authenticated
  using (
    (public.can_write_maturity_upt(upt_id) and status in ('DRAFT', 'SELF_ASSESSMENT', 'REVISION'))
    or (public.can_review_maturity_uit() and status in ('SELF_ASSESSMENT', 'REVISION', 'REVIEW_UIT'))
    or (public.can_review_maturity_pusat() and status in ('REVIEW_PUSAT', 'FINAL'))
  )
  with check (
    public.can_write_maturity_upt(upt_id)
    or public.can_review_maturity_uit()
    or public.can_review_maturity_pusat()
  );
