-- Rollback only after confirming the caller explicitly wants to restore the
-- previous routing behavior. Existing PENDING_MANAGER rows are retained.
drop trigger if exists tug5_asman_final_stage_guard on public.tug_workflow_transactions;
drop function if exists public.guard_tug5_asman_final_stage();
drop function if exists public.approve_tug5_asman_with_child(text, integer, text, jsonb);
notify pgrst, 'reload schema';
