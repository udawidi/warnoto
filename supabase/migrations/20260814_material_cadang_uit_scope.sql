-- 20260814_material_cadang_uit_scope.sql
-- Material Cadang bisa di-scope level UIT (spare transmisi dikelola UIT), tidak
-- hanya per-UPT. Data existing (UPT-SBY) di-re-scope ke UIT-JBM supaya SEMUA UPT
-- dalam UIT + UIT tier + Pusat bisa membacanya (bukan cuma SBY).
--
-- Model: material_cadang_state.upt_id = origin/PK (tetap). Kolom baru uit_id;
-- kalau terisi, baris itu dianggap milik UIT (dibaca semua UPT dalam UIT).
-- Baris uit_id NULL = perilaku per-UPT lama (can_access_upt).

ALTER TABLE public.material_cadang_state
  ADD COLUMN IF NOT EXISTS uit_id text;

-- Helper akses UIT (pola sama can_access_upt): SUPERADMIN/PUSAT, atau actor UIT-role
-- dengan uit cocok, atau actor UPT yang UPT-nya berada di bawah uit tsb.
CREATE OR REPLACE FUNCTION public.can_access_uit(p_uit_id text)
  RETURNS boolean
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from profiles actor
    where actor.id = auth.uid()
      and (
        actor.role = 'SUPERADMIN'
        or actor.role = 'ADMIN_LOG_PUSAT'
        or (
          p_uit_id is not null
          and (
            actor.uit_id = p_uit_id
            or exists (select 1 from upt u where u.id = actor.upt_id and u.uit_id = p_uit_id)
          )
        )
      )
  );
$function$;

-- Policy baru: akses lewat UPT (lama) ATAU lewat UIT (baru).
DROP POLICY IF EXISTS "Scoped material_cadang_state" ON public.material_cadang_state;
CREATE POLICY "Scoped material_cadang_state" ON public.material_cadang_state
  FOR ALL
  USING      (can_access_upt(upt_id) OR (uit_id IS NOT NULL AND can_access_uit(uit_id)))
  WITH CHECK (can_access_upt(upt_id) OR (uit_id IS NOT NULL AND can_access_uit(uit_id)));

-- Re-scope data existing: analisa Material Cadang SBY sebenarnya level UIT-JBM.
UPDATE public.material_cadang_state SET uit_id = 'UIT-JBM' WHERE upt_id = 'UPT-SBY';

-- Verifikasi:
--   SELECT upt_id, uit_id FROM public.material_cadang_state;   -- baris SBY -> uit_id UIT-JBM
--   SELECT can_access_uit('UIT-JBM');                          -- true utk profil dalam UIT-JBM
