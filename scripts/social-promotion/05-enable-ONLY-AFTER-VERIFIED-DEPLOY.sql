-- NO EJECUTAR COMO PARTE DE LA INSTALACIÓN MANUAL.
-- Requiere: pruebas completas aprobadas, 04 verificado, aplicación desplegada
-- compatible y recibo autenticado de /api/promotions/readiness con revision del
-- commit aprobado y compatible=true. Las variables de Vercel permanecen false
-- hasta verificar la DB. Nunca cambiar gates de continuidad/entrega existentes.
BEGIN;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.social_promotion_readiness();
 IF r->>'policy_version'<>'read_only_finish_started_cycles_v1'
 OR r->>'expiry_policy'<>'read_only_finish_started_cycles_v1'
 OR (r->>'engine_gated')::boolean IS DISTINCT FROM true
 OR (r->>'benefits')::integer<>0
 OR (SELECT count(*) FROM public.promotion_codes WHERE platform='instagram')<>10
 OR (SELECT count(*) FROM public.promotion_codes WHERE platform='facebook')<>10
 THEN RAISE EXCEPTION 'Campaign prerequisites failed'; END IF;
END $$;
UPDATE public.promotion_notice_settings SET enabled=true WHERE singleton;
UPDATE public.promotion_campaign SET enabled=true WHERE id='social-annual-2026'
 AND expiry_policy='read_only_finish_started_cycles_v1';
SELECT public.social_promotion_readiness() AS activation_receipt;
COMMIT;
-- Después: habilitar SOLO SOCIAL_PROMOTION_ENABLED y
-- PROMOTION_EXPIRY_NOTICES_ENABLED en Production de Vercel; redesplegar el mismo
-- commit y verificar readiness autenticado y conteos. No canjear ningún código.
