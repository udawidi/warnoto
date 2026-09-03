-- BATCH 2 (2026-09-03): client sekarang enqueue notif TUG-8/9 role-based
-- (enqueueTugNotif di useTugApprovals.js, dipanggil dari App.jsx approveTxn) —
-- trigger DB lama (20260902_notif_outbox.sql) cuma tahu akuntansi generik,
-- tidak bisa resolve TL/UIT (butuh users/uptList yang tidak tersedia di SQL).
-- Drop trigger supaya tidak dobel-insert; dedup by target di client sudah
-- menutup celah kalau migration ini BELUM di-apply (idempoten, aman ditunda).
drop trigger if exists trg_notif_outbox_on_tug_final on tug_transactions;
drop function if exists notif_outbox_on_tug_final();
