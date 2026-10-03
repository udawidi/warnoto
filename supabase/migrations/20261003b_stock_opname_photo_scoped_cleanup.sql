-- PROPOSAL ONLY. Apply only after the frontend uses match_stock_photos_scoped.
-- Staged cleanup: keep the old signature during rollout, then remove client access.
revoke all on function public.match_stock_photos(vector(1024), text, int, float)
  from public, anon, authenticated;
