-- REVIEW ONLY. Install separately after review; never part of the voting RPC.
-- Requires the existing Guardian Verification schema. No table/RLS changes.
begin;
create function public.get_guardian_verification_owner(p_token_digest bytea)
returns uuid language sql stable security definer
set search_path to '' set "TimeZone" to 'UTC'
as $function$
  select e.user_id
  from public.guardian_verification_tokens t
  join public.guardian_escalations e on e.id=t.escalation_id
  join public.check_ins c on c.id=e.check_in_id and c.user_id=e.user_id
  join public.guardian_verification_rounds r on r.escalation_id=e.id
  where pg_catalog.octet_length(p_token_digest)=32 and t.token_digest=p_token_digest
    and t.created_at<=pg_catalog.statement_timestamp()
    and t.expires_at>pg_catalog.statement_timestamp()
    and t.consumed_at is null and t.revoked_at is null
    and c.enabled is true and c.status='escalation_pending' and c.missed_count=3
    and c.next_check_in_at is null and c.response_deadline_at is null
    and c.escalation_generation=e.generation
    and e.status='waiting_for_responses' and e.closed_at is null and e.owner_checked_in_at is null
    and r.prepared_at<=pg_catalog.statement_timestamp()
    and r.first_accepted_at<=pg_catalog.statement_timestamp()
    and r.response_deadline_at>pg_catalog.statement_timestamp()
    and r.dispatch_exhausted_at is null and r.operational_incident_code is null
    and r.majority_reached_at is null and r.safety_deadline_at is null
    and exists(select 1 from public.guardian_verification_notifications n
      where n.token_id=t.id and n.escalation_id=t.escalation_id
        and n.source_guardian_id=t.source_guardian_id and n.status='accepted'
        and n.accepted_at<=pg_catalog.statement_timestamp())
    and not exists(select 1 from public.guardian_verification_responses v
      where v.escalation_id=t.escalation_id and v.source_guardian_id=t.source_guardian_id);
$function$;
alter function public.get_guardian_verification_owner(bytea) owner to postgres;
revoke all on function public.get_guardian_verification_owner(bytea) from public,anon,authenticated,service_role;
grant execute on function public.get_guardian_verification_owner(bytea) to service_role;
comment on function public.get_guardian_verification_owner(bytea) is
  'Server-only identity eligibility at the query snapshot. Read-only; never records votes or consumes credentials.';
commit;
