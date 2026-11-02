-- SOLO LECTURA; ejecutar después de ambas migraciones y de cargar hashes.
BEGIN READ ONLY;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.social_promotion_readiness();
 IF r->>'policy_version'<>'read_only_finish_started_cycles_v1'
 OR r->>'expiry_policy'<>'read_only_finish_started_cycles_v1'
 OR (r->>'engine_gated')::boolean IS DISTINCT FROM true
 OR (r->>'campaign_enabled')::boolean IS DISTINCT FROM false
 OR (r->>'notices_enabled')::boolean IS DISTINCT FROM false
 OR (r->>'benefits')::integer<>0 THEN RAISE EXCEPTION 'Compatibility or disabled-state verification failed'; END IF;
 IF (SELECT count(*) FROM public.promotion_codes)<>20
 OR (SELECT count(*) FROM public.promotion_codes WHERE platform='instagram')<>10
 OR (SELECT count(*) FROM public.promotion_codes WHERE platform='facebook')<>10
 OR EXISTS(SELECT 1 FROM public.promotional_access) THEN RAISE EXCEPTION 'Expected twenty UNUSED codes, ten per platform'; END IF;
 IF has_function_privilege('authenticated','public.redeem_social_promotion(uuid,text)','EXECUTE')
 OR has_function_privilege('anon','public.claim_promotion_expiry_notice()','EXECUTE')
 OR has_table_privilege('authenticated','public.promotion_codes','SELECT,INSERT,UPDATE,DELETE')
 OR has_table_privilege('authenticated','public.promotion_expiry_notices','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Private privilege check failed'; END IF;
END $$;
SELECT public.social_promotion_readiness() AS installation_receipt;
SELECT relname,relrowsecurity FROM pg_class WHERE oid IN (
 'public.promotion_codes'::regclass,'public.promotional_access'::regclass,'public.promotion_attempts'::regclass,
 'public.promotion_expiry_notices'::regclass);
SELECT tgrelid::regclass,tgname FROM pg_trigger WHERE tgname LIKE 'promotion_%' AND NOT tgisinternal ORDER BY tgname;
COMMIT;
