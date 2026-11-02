-- READ ONLY. Run against the intended project before applying the migration.
-- Review actual deployed definitions, especially AFTER UPDATE Check-in triggers.
begin read only;
select current_database(), current_setting('server_version');
select n.nspname, p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
 'has_paid_plan','guard_check_in_activation','sync_guardian_plan_subscription',
 'get_account_activation_eligibility','queue_guardian_notifications',
 'save_guardian_selection','claim_guardian_notifications','enqueue_continuity_check_in_request'
);
select tgname,pg_get_triggerdef(oid) from pg_trigger
where tgrelid='public.check_ins'::regclass and not tgisinternal;
select conname,pg_get_constraintdef(oid) from pg_constraint
where conrelid='public.guardian_plan_activations'::regclass;
select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname='public' and tablename in ('messages','check_ins','subscriptions');
rollback;
