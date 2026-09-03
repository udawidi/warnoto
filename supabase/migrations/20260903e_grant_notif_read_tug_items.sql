-- Fix: notif WA TUG-8/9 tak menampilkan daftar material.
-- Akar: EF notify-dispatch (service_role) join tug_items + tug_transactions untuk
-- rakit daftar material, TAPI kedua tabel tak punya GRANT SELECT ke service_role
-- (cuma authenticated) -> query "permission denied" -> try/catch fallback pesan
-- ringkas tanpa list. [[selfhost-new-table-service-role-grant]]. stocks/katalog
-- sudah ter-grant. Idempoten.
grant select on public.tug_items to service_role;
grant select on public.tug_transactions to service_role;
