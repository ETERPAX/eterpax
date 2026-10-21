-- Independent welcome queue. No backfill, Auth settings or external calls.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- Durable activation boundary: recovery must never welcome pre-existing accounts.
CREATE TABLE public.welcome_email_activation (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 started_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
INSERT INTO public.welcome_email_activation(singleton) VALUES(true);
ALTER TABLE public.welcome_email_activation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.welcome_email_activation FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.welcome_emails (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 email text NOT NULL,
 first_name text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','accepted','uncertain','invalid')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 claim_token uuid,
 claimed_at timestamptz,
 finished_at timestamptz,
 CHECK ((status='pending' AND claim_token IS NULL AND claimed_at IS NULL)
     OR (status<>'pending' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL))
);
ALTER TABLE public.welcome_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.welcome_emails FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX welcome_emails_pending ON public.welcome_emails(created_at,user_id) WHERE status='pending';

CREATE FUNCTION public.enqueue_new_account_welcome() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF coalesce(NEW.is_anonymous,false)=false AND nullif(NEW.email,'') IS NOT NULL THEN
  INSERT INTO public.welcome_emails(user_id,email,first_name)
  VALUES(NEW.id,NEW.email,coalesce(NEW.raw_user_meta_data->>'firstName',''))
  ON CONFLICT(user_id) DO NOTHING;
 END IF;
 RETURN NEW;
EXCEPTION
 -- Email bookkeeping must not reject account creation. The worker recovers it.
 WHEN query_canceled THEN RETURN NEW;
 WHEN OTHERS THEN RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_new_account_welcome() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER enqueue_new_account_welcome AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.enqueue_new_account_welcome();

CREATE FUNCTION public.claim_welcome_email() RETURNS SETOF public.welcome_emails
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Recover only accounts created since activation. This runs outside signup,
 -- never rewrites an existing reservation and never retries a provider attempt.
 INSERT INTO public.welcome_emails(user_id,email,first_name)
 SELECT u.id,u.email,coalesce(u.raw_user_meta_data->>'firstName','')
 FROM auth.users u CROSS JOIN public.welcome_email_activation a
 WHERE u.created_at>=a.started_at AND coalesce(u.is_anonymous,false)=false
 AND nullif(u.email,'') IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM public.welcome_emails w WHERE w.user_id=u.id)
 ORDER BY u.created_at,u.id LIMIT 100
 ON CONFLICT(user_id) DO NOTHING;
 -- A crashed/ambiguous attempt must never become eligible for another send.
 UPDATE public.welcome_emails SET status='uncertain',finished_at=clock_timestamp()
 WHERE status='sending' AND claimed_at<clock_timestamp()-interval '5 minutes';
 RETURN QUERY
 WITH candidate AS (
  SELECT user_id FROM public.welcome_emails WHERE status='pending'
  ORDER BY created_at,user_id LIMIT 1 FOR UPDATE SKIP LOCKED
 )
 UPDATE public.welcome_emails w SET status='sending',claim_token=gen_random_uuid(),claimed_at=clock_timestamp()
 FROM candidate c WHERE w.user_id=c.user_id AND w.status='pending' RETURNING w.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_welcome_email() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_welcome_email() TO service_role;

CREATE FUNCTION public.finish_welcome_email(p_user_id uuid,p_claim_token uuid,p_status text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_status IS NULL OR p_status NOT IN ('accepted','uncertain','invalid') THEN
  RAISE EXCEPTION 'Invalid welcome outcome' USING ERRCODE='22023';
 END IF;
 UPDATE public.welcome_emails SET status=p_status,finished_at=clock_timestamp()
 WHERE user_id=p_user_id AND claim_token=p_claim_token AND status='sending';
 RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_welcome_email(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_welcome_email(uuid,uuid,text) TO service_role;
COMMIT;
