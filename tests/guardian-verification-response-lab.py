#!/usr/bin/env python3
"""Manual PG17-only validation of 005, applied exclusively in BEGIN/ROLLBACK.
Requires 001-004 installed in the existing lab. Passwords go to psql -W.
Does not rerun approved 001-004 tests, send email, or modify persistent rows.
"""
import argparse
import hashlib
import re
import importlib.util
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location('emission_lab', Path(__file__).with_name('guardian-verification-emission-control-lab.py'))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
MIGRATION = Path(__file__).resolve().parents[1] / 'supabase/migrations/202610100005_guardian_verification_dispatch_response.sql'


def vote(ids, decision):
    digest = hashlib.sha256(ids[0].encode()).hexdigest()
    return f"SELECT public.submit_guardian_verification_response(decode('{digest}','hex'),'{decision}');"


def accepted(s, f, index=0):
    ids=h.identity(f)
    h.rpc(s,h.reserve(f,ids,index))
    h.rpc(s,h.finish(ids,'accepted','synthetic-'+str(index)))
    return ids


def tests(s):
    f=h.case(3);h.prepare(s,f)
    one=accepted(s,f,0);two=accepted(s,f,1);three=accepted(s,f,2)
    h.require(h.rpc(s,vote(one,'negative'))=='recorded','negative recorded')
    h.check(s,f"(SELECT status='waiting_for_responses' FROM public.guardian_escalations WHERE id='{f['e']}')",'no individual veto')
    h.require(h.rpc(s,vote(two,'positive'))=='recorded','positive explicit')
    h.check(s,f"(SELECT status='waiting_for_responses' FROM public.guardian_escalations WHERE id='{f['e']}')",'strict majority not yet met')
    h.require(h.rpc(s,vote(three,'positive'))=='recorded','majority vote')
    h.check(s,f"(SELECT status='safety_window' FROM public.guardian_escalations WHERE id='{f['e']}')",'majority transition')
    h.check(s,f"(SELECT safety_deadline_at=majority_reached_at+interval '48 hours' FROM public.guardian_verification_rounds WHERE escalation_id='{f['e']}')",'48 hours only no release')
    h.require(h.rpc(s,vote(three,'negative'))=='unavailable','token replay blocked')
    h.check(s,f"(SELECT count(*)=3 FROM public.guardian_verification_responses WHERE escalation_id='{f['e']}')",'one response per participant')

    impossible=h.case(2);h.prepare(s,impossible);ids=accepted(s,impossible)
    h.require(h.rpc(s,vote(ids,'negative'))=='recorded','negative in two-person quorum')
    h.check(s,f"(SELECT status='frozen_no_majority' FROM public.guardian_escalations WHERE id='{impossible['e']}')",'mathematically impossible')

    cancelled=h.case(2);h.prepare(s,cancelled);ci=h.identity(cancelled);h.rpc(s,h.reserve(cancelled,ci))
    h.require(h.rpc(s,f"SELECT public.check_guardian_verification_dispatch('{ci[1]}','{ci[2]}');")=='t','eligible dispatch')
    s.query(f"SELECT set_config('eterpax_test.user_id','{cancelled['u']}',true);")
    h.check(s,f"auth.uid()='{cancelled['u']}'::uuid",'lab owner identity')
    s.query('SET LOCAL ROLE authenticated; SELECT public.confirm_check_in(); RESET ROLE;')
    h.require(h.rpc(s,f"SELECT public.check_guardian_verification_dispatch('{ci[1]}','{ci[2]}');")=='f','cancelled dispatch blocked')
    h.rpc(s,h.finish(ci,'accepted','late-cancelled'))
    h.require(h.rpc(s,vote(ci,'positive'))=='unavailable','cancelled vote rejected')

    expired=h.case(2);h.prepare(s,expired);ei=accepted(s,expired)
    s.query(f"""UPDATE public.guardian_verification_rounds SET
 prepared_at=now()-interval '9 days',dispatch_deadline_at=now()-interval '8 days',
 first_accepted_at=now()-interval '9 days'+interval '1 hour',
 reminder_due_at=now()-interval '6 days'+interval '1 hour',
 response_deadline_at=now()-interval '2 days'+interval '1 hour'
 WHERE escalation_id='{expired['e']}';
 UPDATE public.guardian_verification_requests SET created_at=now()-interval '9 days' WHERE escalation_id='{expired['e']}';""")
    h.require(h.rpc(s,vote(ei,'positive'))=='unavailable','deadline enforced')
    h.check(s,f"(SELECT count(*)=0 FROM public.guardian_verification_responses WHERE escalation_id='{expired['e']}')",'expired response not inserted')
    h.check(s,"NOT has_function_privilege('anon','public.submit_guardian_verification_response(bytea,text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.submit_guardian_verification_response(bytea,text)','EXECUTE')",'browser cannot call SQL RPC')
    print('PASS new dispatch checks, one-time responses, quorum, cancellation, expiry and permissions')


def functional_main():
    h.require(sys.stdin.isatty(),'run from Terminal for local password prompts')
    s=verify=None;baseline=None;failed=False
    try:
        s=h.Session('005 functional','/usr/local/opt/postgresql@17/bin/psql')
        h.preflight(s);h.verify_installed_control(s)
        h.check(s,"to_regprocedure('public.submit_guardian_verification_response(bytea,text)') IS NULL",'005 must be absent')
        baseline=h.fingerprint(s);h.begin(s)
        lines=MIGRATION.read_text().splitlines()
        h.require(lines.count('begin;')==1 and lines.count('commit;')==1,'transaction wrappers')
        s.query('\n'.join(line for line in lines if line not in ('begin;','commit;')))
        tests(s);s.query('ROLLBACK;')
    except Exception:
        failed=True;print('FAIL 005 validation; stop, no raw data logged')
    finally:
        if s:s.close()
        if baseline is not None:
            try:
                verify=h.Session('005 restoration','/usr/local/opt/postgresql@17/bin/psql')
                h.require(h.fingerprint(verify)==baseline,'restoration mismatch')
                print('PASS independent original restoration')
            except Exception:
                failed=True;print('FAIL restoration not proven')
            finally:
                if verify:verify.close()
    return 1 if failed else 0

def concurrent_main():
    h.require(sys.stdin.isatty(),'Terminal required')
    s=a=b=verify=None;baseline=None;fixtures=[];cleanup=False;failed=False
    try:
        s=h.Session('005 observer','/usr/local/opt/postgresql@17/bin/psql')
        h.preflight(s);h.verify_installed_control(s)
        for name,body in re.findall(r'create function public\.(\w+)\([\s\S]*?as \$function\$([\s\S]*?)\$function\$;',MIGRATION.read_text()):
            h.check(s,f"(SELECT count(*)=1 AND bool_and(md5(prosrc)='{hashlib.md5(body.encode()).hexdigest()}') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='{name}')",'installed 005 differs')
        baseline=h.fingerprint(s)
        a=h.Session('005 A','/usr/local/opt/postgresql@17/bin/psql')
        b=h.Session('005 B','/usr/local/opt/postgresql@17/bin/psql')
        fixtures=[h.case(3) for _ in range(3)]+[h.case(2)]
        for f in fixtures:
            for table,key in [('auth.users','u'),('public.check_ins','c'),('public.guardian_escalations','e')]:
                h.check(s,f"NOT EXISTS(SELECT 1 FROM {table} WHERE id='{f[key]}')",'fixture identity collision')
        print('Synthetic cleanup identities: '+h.json.dumps(fixtures),flush=True)
        h.begin(s)
        identities=[]
        for f in fixtures:
            h.prepare(s,f);identities.append([accepted(s,f,0),accepted(s,f,1)])
        cleanup=True;s.query('COMMIT;')
        # Conflicting decisions on the same token: exactly one can consume it.
        h.begin(a);a.query('SET LOCAL ROLE service_role;')
        h.require(a.scalar(vote(identities[0][0],'positive'))=='recorded','first vote')
        h.begin(b);b.query('SET LOCAL ROLE service_role;');b.send(vote(identities[0][0],'negative'))
        h.await_block(s,b,a);a.query('COMMIT;')
        h.require(b.finish()==['unavailable'],'replayed token');b.query('COMMIT;')
        h.check(s,f"(SELECT count(*)=1 FROM public.guardian_verification_responses WHERE escalation_id='{fixtures[0]['e']}')",'one concurrent response')
        # Owner check-in first, then vote first. No historical reactivation.
        for index,owner_first in [(1,True),(2,False)]:
            f=fixtures[index]
            h.begin(a);h.begin(b)
            owner=a if owner_first else b;voter=b if owner_first else a
            owner.query(f"SELECT set_config('eterpax_test.user_id','{f['u']}',true);")
            h.check(owner,f"auth.uid()='{f['u']}'::uuid",'owner auth')
            owner.query('SET LOCAL ROLE authenticated;');voter.query('SET LOCAL ROLE service_role;')
            if owner_first:
                owner.query('SELECT public.confirm_check_in();');voter.send(vote(identities[index][0],'positive'))
            else:
                h.require(voter.scalar(vote(identities[index][0],'positive'))=='recorded','vote before owner')
                owner.send('SELECT public.confirm_check_in();')
            h.await_block(s,b,a);a.query('COMMIT;');result=b.finish();b.query('COMMIT;')
            if owner_first:h.require(result==['unavailable'],'owner wins race')
            h.check(s,f"(SELECT status='cancelled_owner_check_in' FROM public.guardian_escalations WHERE id='{f['e']}')",'owner always cancels')
        # Distinct voters concurrently reach the strict majority exactly once.
        f=fixtures[3];h.begin(a);a.query('SET LOCAL ROLE service_role;')
        h.require(a.scalar(vote(identities[3][0],'positive'))=='recorded','first majority vote')
        h.begin(b);b.query('SET LOCAL ROLE service_role;');b.send(vote(identities[3][1],'positive'))
        h.await_block(s,b,a);a.query('COMMIT;');h.require(b.finish()==['recorded'],'second majority vote');b.query('COMMIT;')
        h.check(s,f"(SELECT status='safety_window' FROM public.guardian_escalations WHERE id='{f['e']}')",'concurrent majority')
        print('PASS concurrent token consumption, owner cancellation both orders and majority')
    except Exception as error:
        failed=True;print('FAIL new concurrency validation; only cleanup follows');print('CAUSE:', type(error).__name__, str(error))
    finally:
        for worker in (a,b):
            if worker:worker.close()
        if cleanup:
            try:
                s.query('ROLLBACK;');s.query(h.IDENTITY);h.begin(s)
                for f in fixtures:
                    s.query(f"DELETE FROM public.guardian_escalations WHERE id='{f['e']}' AND user_id='{f['u']}';"
                            f"DELETE FROM public.check_ins WHERE id='{f['c']}' AND user_id='{f['u']}';"
                            f"DELETE FROM auth.users WHERE id='{f['u']}';")
                s.query('COMMIT;')
            except Exception:
                failed=True;print('FAIL cleanup; review printed synthetic identities before rerun')
        if s:s.close()
        if baseline is not None:
            try:
                verify=h.Session('005 restoration','/usr/local/opt/postgresql@17/bin/psql')
                h.require(h.fingerprint(verify)==baseline,'restoration differs');print('PASS independent restoration')
            except Exception:
                failed=True;print('FAIL restoration')
            finally:
                if verify:verify.close()
    return 1 if failed else 0


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--concurrency',action='store_true')
    parser.add_argument('--approve-synthetic-commits',action='store_true')
    args=parser.parse_args()
    h.require(not args.concurrency or args.approve_synthetic_commits,'synthetic commit approval required')
    sys.exit(concurrent_main() if args.concurrency else functional_main())
