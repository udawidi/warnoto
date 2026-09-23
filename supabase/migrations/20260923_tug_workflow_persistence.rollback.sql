-- Rollback for 20260923_tug_workflow_persistence.sql.
-- Run only after confirming no durable drafts remain in the feature table.
drop function if exists public.transition_tug_workflow_transaction(text,integer,text,text,jsonb);
drop function if exists public.transition_tug_workflow_with_child(text,text,integer,text,jsonb);
drop function if exists public.issue_tug_workflow_document_number(text,integer,text);
drop function if exists public.delete_tug_workflow_transaction(text,integer);
drop function if exists public.save_tug_workflow_transaction(text,text,text,text,text,text,text,text,bigint,jsonb,integer);
drop function if exists public.tug_workflow_contains_data_url(jsonb);
drop function if exists public.tug_workflow_scope_allowed(text,text,text);
drop function if exists public.tug_workflow_actor();
drop policy if exists "Scoped read tug workflow" on public.tug_workflow_transactions;
drop table if exists public.tug_workflow_transactions;
