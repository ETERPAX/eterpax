-- SOLO LECTURA. Ejecutar primero en SQL Editor del proyecto de PRODUCCIÓN.
-- No contiene códigos, no envía correos y no modifica cuentas.
BEGIN READ ONLY;
SELECT current_database(),current_user,clock_timestamp() AS inspected_at;
SELECT to_regclass('public.promotion_codes') IS NOT NULL AS campaign_already_installed,
 to_regprocedure('public.social_promotion_readiness()') IS NOT NULL AS expiry_policy_already_installed;
SELECT to_regclass('public.lifetime_access') IS NOT NULL AS three_plans_installed,
 to_regclass('public.message_deletion_requests') IS NOT NULL AS managed_deletion_installed,
 to_regclass('public.message_upload_operations') IS NOT NULL AS managed_uploads_installed;
SELECT proname,pg_get_functiondef(oid) AS actual_definition FROM pg_proc
WHERE oid IN ('public.process_continuity_engine()'::regprocedure,
 'public.confirm_check_in()'::regprocedure,'public.guard_check_in_activation()'::regprocedure,
 'public.enqueue_continuity_check_in_request()'::regprocedure);
SELECT tgname,pg_get_triggerdef(oid) FROM pg_trigger
WHERE tgrelid IN ('public.messages'::regclass,'public.check_ins'::regclass) AND NOT tgisinternal;
SELECT conname,pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid='public.guardian_plan_activations'::regclass;
COMMIT;
