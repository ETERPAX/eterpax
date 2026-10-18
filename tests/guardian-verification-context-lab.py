#!/usr/bin/env python3
"""Local PG17-only context checks; synthetic fixtures and new SQL in BEGIN/ROLLBACK.
Requires 001-004 installed in the existing guarded laboratory. Never sends mail.
Run interactively: python3 tests/guardian-verification-context-lab.py
"""
import hashlib
import importlib.util
from pathlib import Path
import re
import sys

spec = importlib.util.spec_from_file_location('response_lab', Path(__file__).with_name('guardian-verification-response-lab.py'))
response = importlib.util.module_from_spec(spec)
spec.loader.exec_module(response)
h = response.h
SQL = Path(__file__).resolve().parents[1] / 'scripts/guardian-verification-owner-context.sql'


def lookup(ids):
    digest = hashlib.sha256(ids[0].encode()).hexdigest()
    return f"SELECT coalesce(public.get_guardian_verification_owner(decode('{digest}','hex'))::text,'unavailable');"


def tests(s):
    fixtures = [h.case(3), h.case(3)]
    credentials = []
    for f in fixtures:
        h.prepare(s, f)
        credentials.append(response.accepted(s, f))
    before = h.fingerprint(s)
    for f, ids in zip(fixtures, credentials):
        for _ in range(2):
            h.require(h.rpc(s, lookup(ids)) == f['u'], 'owner isolation')
    h.require(h.fingerprint(s) == before, 'opening must not write any data or schema')
    for role in ['anon', 'authenticated']:
        h.check(s, f"NOT has_function_privilege('{role}','public.get_guardian_verification_owner(bytea)','EXECUTE')", 'restricted ACL')
    h.check(s, "has_function_privilege('service_role','public.get_guardian_verification_owner(bytea)','EXECUTE')", 'server ACL')
    h.require(h.rpc(s, "SELECT coalesce(public.get_guardian_verification_owner(decode('00','hex'))::text,'unavailable');") == 'unavailable', 'bad digest')
    h.require(h.rpc(s, lookup([str(h.uuid.uuid4())])) == 'unavailable', 'unknown token')
    f, ids = fixtures[0], credentials[0]
    token_where = f"token_digest=decode('{hashlib.sha256(ids[0].encode()).hexdigest()}','hex')"
    scenarios = {
        'expired token': f"UPDATE public.guardian_verification_tokens SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE {token_where};",
        'revoked token': f"UPDATE public.guardian_verification_tokens SET revoked_at=clock_timestamp() WHERE {token_where};",
        'consumed token': f"UPDATE public.guardian_verification_tokens SET consumed_at=clock_timestamp() WHERE {token_where};",
        'closed escalation': f"UPDATE public.guardian_escalations SET status='frozen_no_majority',closed_at=clock_timestamp() WHERE id='{f['e']}';",
        'owner cancellation': "SELECT set_config('eterpax_test.user_id','" + f['u'] + "',true); SET LOCAL ROLE authenticated; SELECT public.confirm_check_in(); RESET ROLE;",
        'generation changed': f"UPDATE public.check_ins SET escalation_generation=escalation_generation+1 WHERE id='{f['c']}';",
        'unaccepted notification': f"UPDATE public.guardian_verification_notifications SET status='uncertain',accepted_at=NULL,provider_message_id=NULL WHERE escalation_id='{f['e']}';",
        'incident': f"UPDATE public.guardian_verification_rounds SET prepared_at=prepared_at-interval '2 days',dispatch_deadline_at=dispatch_deadline_at-interval '2 days',dispatch_exhausted_at=statement_timestamp(),first_accepted_at=NULL,reminder_due_at=NULL,response_deadline_at=NULL,operational_incident_code='no_confirmed_acceptance_24h' WHERE escalation_id='{f['e']}';",
        'majority': f"UPDATE public.guardian_verification_rounds SET majority_reached_at=clock_timestamp(),safety_deadline_at=clock_timestamp()+interval '48 hours' WHERE escalation_id='{f['e']}';",
        'expired round': f"UPDATE public.guardian_verification_rounds SET prepared_at=prepared_at-interval '9 days',dispatch_deadline_at=dispatch_deadline_at-interval '9 days',first_accepted_at=first_accepted_at-interval '9 days',reminder_due_at=reminder_due_at-interval '9 days',response_deadline_at=response_deadline_at-interval '9 days' WHERE escalation_id='{f['e']}';",
        'prior guardian response': f"INSERT INTO public.guardian_verification_responses(escalation_id,source_guardian_id,token_id,decision,responded_at) SELECT escalation_id,source_guardian_id,id,'positive',clock_timestamp() FROM public.guardian_verification_tokens WHERE {token_where};",
    }
    # statement_timestamp is identical for both majority timestamps.
    scenarios['majority'] = scenarios['majority'].replace('clock_timestamp()', 'statement_timestamp()')
    for label, mutation in scenarios.items():
        s.query('SAVEPOINT scenario;')
        s.query(mutation)
        before = h.fingerprint(s)
        h.require(h.rpc(s, lookup(ids)) == 'unavailable', label)
        h.require(h.rpc(s, lookup(credentials[1])) == fixtures[1]['u'], 'other owner unaffected')
        h.require(h.fingerprint(s) == before, 'rejected lookup must not write')
        s.query('ROLLBACK TO SAVEPOINT scenario; RELEASE SAVEPOINT scenario;')
    print('PASS owner isolation, repeated read-only access, ACLs and all invalid/closed states')


def main():
    h.require(sys.stdin.isatty(), 'Interactive Terminal required for local lab password')
    s = None
    try:
        s = h.Session('identity context', '/usr/local/opt/postgresql@17/bin/psql')
        h.preflight(s)
        h.verify_installed_control(s)
        baseline = h.fingerprint(s)
        h.begin(s)
        s.query(re.sub(r'^begin;|^commit;', '', SQL.read_text(), flags=re.M | re.I))
        tests(s)
        s.query('ROLLBACK;')
        h.require(h.fingerprint(s) == baseline, 'lab restored')
        print('PASS rollback restored schema and data')
        return 0
    finally:
        if s:
            s.close()  # Closing also rolls back on any failure.


if __name__ == '__main__':
    sys.exit(main())
