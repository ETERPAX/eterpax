#!/usr/bin/env python3
"""PG17 local emission-control validator. Never runs on import.

Default: requires 001-003 installed, installs ONLY 004 inside BEGIN/ROLLBACK,
tests synthetic rows, then verifies original data/schema in a second connection.
Concurrency: requires 004 already installed by the owner; two independent workers
need temporarily committed synthetic fixtures. Requires --concurrency and
--approve-synthetic-commits, cleans exact UUIDs, and compares original fingerprints.
No remote targets, environment changes, real tokens, provider calls or Git writes.
Passwords go directly to psql -W in Terminal, never into Python or a file.
"""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import threading
import time
import uuid

SOCKET = '/Users/Colocha/eterpax-pg17-lab/socket'
DATA = '/Users/Colocha/eterpax-pg17-lab/data'
DATABASE = 'eterpax_change3_test'
TABLES = ('auth.users', 'public.check_ins', 'public.guardians',
          'public.guardian_escalations', 'public.guardian_escalation_participants',
          'public.guardian_verification_rounds', 'public.guardian_verification_requests',
          'public.guardian_verification_tokens', 'public.guardian_verification_notifications',
          'public.guardian_verification_responses', 'public.guardian_verification_emission_attempts')
IDENTITY = """DO $guard$ BEGIN
IF current_database() <> 'eterpax_change3_test' OR current_user <> 'postgres'
OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
OR current_setting('data_directory') <> '/Users/Colocha/eterpax-pg17-lab/data'
OR current_setting('unix_socket_directories') <> '/Users/Colocha/eterpax-pg17-lab/socket'
OR current_setting('port') <> '55432' OR current_setting('listen_addresses') <> ''
OR inet_server_addr() IS NOT NULL
THEN RAISE EXCEPTION 'FAIL: laboratory identity'; END IF;
END $guard$;"""


def require(ok, label):
    if not ok:
        raise RuntimeError(label)


class Session:
    def __init__(self, label, executable):
        self.label = label
        self.process = None
        self.pending = None
        self.lines = queue.Queue()
        env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
        env.update(PGPASSFILE='/dev/null', PGCONNECT_TIMEOUT='5')
        print(f'{label}: introduzca la contraseña LOCAL en el prompt de psql.', flush=True)
        self.process = subprocess.Popen(
            [executable, '-X', '-W', '-q', '-A', '-t', '-P', 'pager=off',
             '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse',
             '-v', 'SHOW_CONTEXT=never', '-h', SOCKET, '-p', '55432',
             '-U', 'postgres', '-d', DATABASE],
            env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=None, text=True, bufsize=1)
        threading.Thread(target=self._read, daemon=True).start()
        try:
            # Startup guard precedes all writes, including fixture cleanup.
            self.query(IDENTITY, timeout=180)
            self.pid = int(self.query('SELECT pg_backend_pid();')[0])
        except BaseException:
            self.close()
            raise

    def _read(self):
        for line in self.process.stdout:
            self.lines.put(line.rstrip('\n'))
        self.lines.put(None)

    def send(self, sql):
        require(self.pending is None, 'session already has a pending command')
        require(self.process.poll() is None, f'{self.label}: psql exited')
        self.pending = 'DONE_' + uuid.uuid4().hex
        self.process.stdin.write(sql + '\n\\echo ' + self.pending + '\n')
        self.process.stdin.flush()

    def finish(self, timeout=25):
        require(self.pending is not None, 'no pending command')
        end = time.monotonic() + timeout
        result = []
        while time.monotonic() < end:
            try:
                line = self.lines.get(timeout=min(0.2, max(0.01, end-time.monotonic())))
            except queue.Empty:
                continue
            if line is None:
                raise RuntimeError(f'{self.label}: SQL/client failure; stop')
            if line == self.pending:
                self.pending = None
                return result
            if line:
                result.append(line)
        raise RuntimeError(f'{self.label}: command timeout')

    def query(self, sql, timeout=25):
        self.send(sql)
        return self.finish(timeout)

    def scalar(self, sql):
        rows = self.query(sql)
        require(len(rows) == 1, 'unexpected result shape')
        return rows[0]

    def close(self):
        if self.process is None:
            return
        # Terminate only OUR psql client; its connection closes and its open
        # transaction rolls back. Never signal the PostgreSQL server.
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        for stream in (self.process.stdin, self.process.stdout):
            if stream:
                stream.close()


def begin(session):
    session.query("BEGIN; SET LOCAL lock_timeout='15s'; "
                  "SET LOCAL statement_timeout='20s'; "
                  "SET LOCAL idle_in_transaction_session_timeout='60s';")


def fingerprint(s):
    result = {}
    for table in TABLES:
        if s.scalar(f"SELECT to_regclass('{table}') IS NOT NULL;") != 't':
            continue
        result[table] = s.scalar(
            "SELECT md5(coalesce(string_agg(h,'' ORDER BY h),'')) FROM "
            f"(SELECT md5(to_jsonb(x)::text) AS h FROM {table} x) q;")
    result['catalog'] = s.scalar("""WITH definitions AS (
 SELECT 'r:'||c.oid::text AS k, to_jsonb(c)::text AS v FROM pg_class c
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth')
 UNION ALL SELECT 'a:'||a.attrelid||':'||a.attnum,to_jsonb(a)::text FROM pg_attribute a
 JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth')
 UNION ALL SELECT 'c:'||x.oid,to_jsonb(x)::text FROM pg_constraint x
 JOIN pg_namespace n ON n.oid=x.connamespace WHERE n.nspname IN ('public','auth')
 UNION ALL SELECT 'p:'||p.oid,to_jsonb(p)::text FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth')
 UNION ALL SELECT 'trigger:'||t.oid,to_jsonb(t)::text FROM pg_trigger t
 JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth')
 UNION ALL SELECT 'index:'||i.indexrelid,to_jsonb(i)::text FROM pg_index i
 JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth')
 UNION ALL SELECT 'policy:'||p.oid,to_jsonb(p)::text FROM pg_policy p
 JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth')
 ) SELECT md5(coalesce(string_agg(k||v,'' ORDER BY k),'')) FROM definitions;""")
    return result


def case(n):
    return {'u': str(uuid.uuid4()), 'c': str(uuid.uuid4()), 'e': str(uuid.uuid4()),
            'g': [str(uuid.uuid4()) for _ in range(n)]}


def create_fixture(s, f):
    u, c, e = (f[k] for k in ('u', 'c', 'e'))
    s.query(f"""INSERT INTO auth.users(id) VALUES('{u}');
 INSERT INTO public.check_ins(id,user_id,frequency_days,enabled,status,missed_count,
 next_check_in_at,response_deadline_at,escalation_generation)
 VALUES('{c}','{u}',30,true,'escalation_pending',3,NULL,NULL,7);
 INSERT INTO public.guardian_escalations(id,check_in_id,user_id,generation,status)
 VALUES('{e}','{c}','{u}',7,'waiting_for_responses');""")
    for i, g in enumerate(f['g']):
        s.query(f"INSERT INTO public.guardian_escalation_participants VALUES "
                f"('{e}','{g}','Synthetic Guardian {i}','Test','guardian-{i}@example.invalid');")


MIGRATION = Path(__file__).resolve().parents[1] / 'supabase/migrations/202610100004_guardian_verification_emission_control.sql'


def check(s, expression, label):
    require(s.scalar('SELECT (' + expression + ');') == 't', label)


def identity(f):
    return [str(uuid.uuid4()) for _ in range(3)]


def reserve(f, ids, guardian=0):
    emission, attempt, claim = ids
    # Synthetic digests, never real credentials. Unique per synthetic emission.
    digest = hashlib.sha256(emission.encode()).hexdigest()
    return ("SELECT row_to_json(r) FROM public.reserve_guardian_verification_initial("
            f"'{f['e']}','{f['g'][guardian]}','{emission}','{attempt}','{claim}',"
            f"decode('{digest}','hex'),decode('{digest}','hex')) r;")


def rpc(s, sql):
    rows = s.query('SET LOCAL ROLE service_role; ' + sql + ' RESET ROLE;')
    require(len(rows) == 1, 'single RPC response')
    return rows[0]


def finish(ids, result, provider=None):
    value = 'NULL' if provider is None else "'" + provider + "'"
    return (f"SELECT public.finalize_guardian_verification_attempt('{ids[1]}','{ids[2]}',"
            f"'{result}',{value});")


def expect_error(s, sql, code):
    # Expected failures are caught in a subtransaction; every other error aborts psql.
    s.query("SET LOCAL ROLE service_role; DO $expected$ BEGIN BEGIN " + sql.replace('SELECT ', 'PERFORM ', 1)
            + f" EXCEPTION WHEN SQLSTATE '{code}' THEN RETURN; END; "
              "RAISE EXCEPTION 'Expected rejection did not occur'; END $expected$; RESET ROLE;")


def prepare(s, f):
    create_fixture(s, f)
    rpc(s, f"SELECT public.prepare_guardian_verification('{f['e']}');")


def age_round(s, f):
    s.query(f"UPDATE public.guardian_verification_rounds SET prepared_at=prepared_at-interval '25 hours', "
            f"dispatch_deadline_at=dispatch_deadline_at-interval '25 hours' WHERE escalation_id='{f['e']}';"
            f"UPDATE public.guardian_verification_requests q SET created_at=r.prepared_at FROM "
            f"public.guardian_verification_rounds r WHERE q.escalation_id=r.escalation_id AND r.escalation_id='{f['e']}';")


def preflight(s):
    s.query(IDENTITY)
    require(s.scalar("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid();") == '0', 'close other laboratory sessions')
    check(s, "NOT EXISTS(SELECT 1 FROM pg_event_trigger WHERE evtenabled<>'D')", 'event triggers forbidden')
    check(s, "NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('service_role','authenticated') AND rolsuper)", 'application roles must not be superusers')
    for name in TABLES[:-1]:
        check(s, f"to_regclass('{name}') IS NOT NULL", 'Changes 1-3 and Change4 001-003 required')
    check(s, "to_regprocedure('public.prepare_guardian_verification(uuid)') IS NOT NULL", '003 required')
    check(s, "NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgenabled<>'D' AND NOT tgisinternal "
          "AND tgrelid IN ('auth.users'::regclass,'public.check_ins'::regclass))", 'unreviewed fixture trigger')
    for filename, fn in [('202610090003_guardian_verification_preparation.sql','prepare_guardian_verification(uuid)'),
                         ('202610090002_guardian_verification_emissions_owner_compatibility.sql','confirm_check_in()')]:
        body = (MIGRATION.parent / filename).read_text().split('$function$')[1]
        check(s, f"(SELECT md5(prosrc)='{hashlib.md5(body.encode()).hexdigest()}' FROM pg_proc WHERE oid='public.{fn}'::regprocedure)", 'prerequisite RPC mismatch')


def verify_installed_control(s):
    for name, body in re.findall(r'create function public\.(\w+)\([\s\S]*?as \$function\$([\s\S]*?)\$function\$;', MIGRATION.read_text()):
        check(s, f"(SELECT count(*)=1 AND bool_and(md5(prosrc)='{hashlib.md5(body.encode()).hexdigest()}') "
              f"FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='{name}')", '004 installed body differs')


def functional(s):
    f = case(2); prepare(s, f); ids = identity(f)
    first = json.loads(rpc(s, reserve(f, ids)))
    require(first['outcome'] == 'reserved' and first['recipient_email'] == 'guardian-0@example.invalid', 'reservation/snapshot')
    again = json.loads(rpc(s, reserve(f, ids)))
    require(again['outcome'] == 'already_reserved' and again['recipient_email'] is None
            and first['lease_expires_at'] == again['lease_expires_at'], 'reservation replay must not authorize send')
    require(json.loads(rpc(s, reserve(f, identity(f))))['outcome'] == 'emission_exists', 'duplicate emission blocked')
    wrong = [ids[0],ids[1],str(uuid.uuid4())]
    expect_error(s, finish(wrong,'accepted','synthetic-provider'), '42501')
    require(rpc(s, finish(ids,'accepted','synthetic-provider')) == 'accepted_window_started', 'first acceptance')
    deadline = s.scalar(f"SELECT response_deadline_at FROM public.guardian_verification_rounds WHERE escalation_id='{f['e']}';")
    require(rpc(s, finish(ids,'accepted','synthetic-provider')) == 'already_finalized', 'finalization replay')
    expect_error(s, finish(ids,'rejected'), '23514')
    expect_error(s, finish(ids,'accepted','different-provider'), '23514')
    ids2 = identity(f); rpc(s, reserve(f, ids2, 1))
    require(rpc(s, finish(ids2,'accepted','synthetic-provider-2')) == 'accepted', 'second acceptance')
    require(s.scalar(f"SELECT response_deadline_at FROM public.guardian_verification_rounds WHERE escalation_id='{f['e']}';") == deadline, 'common deadline preserved')
    check(s, f"(SELECT reminder_due_at=first_accepted_at+interval '72 hours' AND response_deadline_at=first_accepted_at+interval '168 hours' FROM public.guardian_verification_rounds WHERE escalation_id='{f['e']}')", 'window invariants')
    check(s, "NOT has_table_privilege('service_role','public.guardian_verification_emission_attempts','SELECT') AND NOT has_table_privilege('service_role','public.guardian_verification_emission_attempts','INSERT')", 'attempt table ACL')
    check(s, "NOT has_function_privilege('authenticated','public.finalize_guardian_verification_attempt(uuid,uuid,text,text)','EXECUTE')", 'browser RPC ACL')
    print('PASS reservation, snapshot, duplicate prevention, acceptance, replay and permissions')

    # Uncertain remains protected; late acceptance can be recorded using original claim.
    u=case(2); prepare(s,u); ui=identity(u); rpc(s,reserve(u,ui))
    require(rpc(s,finish(ui,'uncertain'))=='uncertain','uncertainty')
    require(rpc(s,finish(ui,'rejected'))=='reconciliation_required','negative reconciliation blocked')
    require(json.loads(rpc(s,reserve(u,identity(u))))['outcome']=='emission_exists','uncertain replacement blocked')
    require(rpc(s,finish(ui,'accepted','late-provider'))=='accepted_window_started','late positive evidence')
    check(s, f"(SELECT uncertain_at IS NOT NULL AND claim_id='{ui[2]}' FROM public.guardian_verification_emission_attempts WHERE id='{ui[1]}')", 'persistent claim/history')

    c=case(2); prepare(s,c); ci=identity(c); rpc(s,reserve(c,ci))
    s.query(f"SELECT set_config('eterpax_test.user_id','{c['u']}',true);")
    check(s, f"auth.uid()='{c['u']}'::uuid", 'owner auth identity')
    s.query('SET LOCAL ROLE authenticated; SELECT public.confirm_check_in(); RESET ROLE;')
    require(rpc(s,finish(ci,'accepted','cancelled-provider'))=='accepted_history_only','cancelled stays cancelled')
    check(s, f"(SELECT status='cancelled_owner_check_in' FROM public.guardian_escalations WHERE id='{c['e']}')", 'owner cancellation')
    check(s, f"(SELECT first_accepted_at IS NULL FROM public.guardian_verification_rounds WHERE escalation_id='{c['e']}')", 'cancelled has no window')

    x=case(2); prepare(s,x); xi=identity(x); rpc(s,reserve(x,xi)); age_round(s,x)
    require(rpc(s,f"SELECT public.expire_guardian_verification_dispatch('{x['e']}');")=='blocked_verification_delivery','dispatch expiration')
    require(rpc(s,f"SELECT public.expire_guardian_verification_dispatch('{x['e']}');")=='already_exhausted','expiration replay')
    require(rpc(s,finish(xi,'accepted','expired-provider'))=='accepted_history_only','expired acceptance history only')
    check(s,f"(SELECT first_accepted_at IS NULL AND operational_incident_code='no_confirmed_acceptance_24h' FROM public.guardian_verification_rounds WHERE escalation_id='{x['e']}')",'no reopening')
    rejected=case(2); prepare(s,rejected); ri=identity(rejected); rpc(s,reserve(rejected,ri))
    require(rpc(s,finish(ri,'rejected'))=='rejected','definite rejection')
    require(rpc(s,finish(ri,'rejected'))=='already_finalized','rejection replay')
    require(json.loads(rpc(s,reserve(rejected,identity(rejected))))['outcome']=='emission_exists','no automatic replacement after rejection')
    expect_error(s,finish(ri,'accepted','contradictory-provider'),'23514')
    print('PASS uncertainty, late acceptance, owner cancellation, rejection and dispatch expiration')

    # Construct an expired synthetic lease at INSERT; never weaken immutable guards.
    z=case(2); prepare(s,z); zi=identity(z); token=str(uuid.uuid4())
    s.query(f"""INSERT INTO public.guardian_verification_tokens(id,escalation_id,source_guardian_id,token_digest,created_at,expires_at)
 VALUES('{token}','{z['e']}','{z['g'][0]}',decode(repeat('ab',32),'hex'),clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '1 day');
 INSERT INTO public.guardian_verification_notifications(id,escalation_id,source_guardian_id,kind,token_id,status,created_at,available_at,attempt_count,last_attempted_at,claim_id,lease_expires_at,emission_number,payload_digest)
 VALUES('{zi[0]}','{z['e']}','{z['g'][0]}','initial','{token}','sending',now()-interval '2 minutes',now()-interval '2 minutes',1,now()-interval '2 minutes','{zi[2]}',now()-interval '1 minute',1,decode(repeat('cd',32),'hex'));
 INSERT INTO public.guardian_verification_emission_attempts(id,notification_id,claim_id,attempt_number,status,created_at,lease_expires_at)
 VALUES('{zi[1]}','{zi[0]}','{zi[2]}',1,'reserved',now()-interval '2 minutes',now()-interval '1 minute');""")
    require(rpc(s,f"SELECT public.mark_guardian_verification_attempt_uncertain('{zi[1]}');")=='uncertain','lease expiration')
    require(json.loads(rpc(s,reserve(z,identity(z))))['outcome']=='emission_exists','expired lease not reclaimable')
    # Trigger check as postgres (service role cannot update this table at all).
    s.query(f"""DO $guard$ BEGIN BEGIN UPDATE public.guardian_verification_emission_attempts
 SET claim_id=gen_random_uuid() WHERE id='{zi[1]}';
 EXCEPTION WHEN check_violation THEN RETURN; END;
 RAISE EXCEPTION 'Immutable claim changed'; END $guard$;""")
    print('PASS lease recovery and immutable claim')


def await_block(observer, blocked, holder):
    end=time.monotonic()+10
    while time.monotonic()<end:
        if observer.scalar(f'SELECT {holder.pid}=ANY(pg_blocking_pids({blocked.pid}));')=='t': return
        time.sleep(.05)
    raise RuntimeError('concurrent session did not block on holder')


def concurrent(observer, a, b, f):
    ids=identity(f)
    begin(a); a.query('SET LOCAL ROLE service_role;')
    first=json.loads(a.scalar(reserve(f,ids)))
    begin(b); b.query('SET LOCAL ROLE service_role;'); b.send(reserve(f,ids))
    await_block(observer,b,a); a.query('COMMIT;')
    second=json.loads(b.finish()[0]); b.query('COMMIT;')
    require(first['outcome']=='reserved' and second['outcome']=='already_reserved','concurrent reservation')
    require(first['lease_expires_at']==second['lease_expires_at'],'concurrent deadline stability')
    check(observer,f"(SELECT count(*)=1 FROM public.guardian_verification_notifications WHERE escalation_id='{f['e']}')",'one emission')
    begin(a); a.query('SET LOCAL ROLE service_role;')
    require(a.scalar(finish(ids,'accepted','concurrent-provider'))=='accepted_window_started','concurrent finalize first')
    begin(b); b.query('SET LOCAL ROLE service_role;'); b.send(finish(ids,'accepted','concurrent-provider'))
    await_block(observer,b,a); a.query('COMMIT;')
    require(b.finish()==['already_finalized'],'concurrent finalization idempotency'); b.query('COMMIT;')
    print('PASS concurrent reservation/finalization, observed blocking, no deadlock')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--concurrency',action='store_true',help='Requires 004 ALREADY installed in the lab')
    parser.add_argument('--approve-synthetic-commits',action='store_true',help='Allow committed synthetic fixtures for two-session visibility')
    args=parser.parse_args()
    require(not args.concurrency or args.approve_synthetic_commits,'concurrency needs synthetic-commit approval')
    require(sys.stdin.isatty(),'Terminal required: passwords go directly to psql -W')
    executable='/usr/local/opt/postgresql@17/bin/psql'
    require(Path(executable).is_file(),'expected PostgreSQL 17 client missing')
    s=a=b=None; baseline=None; fixture=None; failed=False; cleanup_needed=False
    try:
        s=Session('Lab',executable); preflight(s); baseline=fingerprint(s)
        installed=s.scalar("SELECT to_regclass('public.guardian_verification_emission_attempts') IS NOT NULL;")=='t'
        if args.concurrency:
            require(installed,'004 must already be installed; this mode never installs migrations')
            verify_installed_control(s)
            fixture=case(2)
            for table,key in [('auth.users','u'),('public.check_ins','c'),('public.guardian_escalations','e')]:
                check(s,f"NOT EXISTS(SELECT 1 FROM {table} WHERE id='{fixture[key]}')",'fixture collision')
            a=Session('A',executable); b=Session('B',executable)
            print('Synthetic cleanup identities: '+json.dumps(fixture),flush=True)
            begin(s); prepare(s,fixture); cleanup_needed=True; s.query('COMMIT;')
            concurrent(s,a,b,fixture)
        else:
            require(not installed,'functional rollback mode requires 004 absent')
            begin(s)
            text=MIGRATION.read_text(); lines=text.splitlines()
            require(lines.count('begin;')==1 and lines.count('commit;')==1,'unexpected transaction wrappers')
            require(lines[-1]=='commit;','unexpected migration trailer')
            s.query('\n'.join(line for line in lines if line not in ('begin;','commit;')))
            functional(s); s.query('ROLLBACK;')
    except (Exception,KeyboardInterrupt):
        failed=True
        print('FAIL: stopped; no raw SQL/provider data printed. Only rollback/cleanup follows.',flush=True)
    finally:
        for worker in (a,b):
            if worker: worker.close()
        if s:
            try:
                require(s.process.poll() is None and s.pending is None,'connection unavailable')
                s.query('ROLLBACK;')
                if cleanup_needed:
                    s.query(IDENTITY); begin(s)
                    e,c,u=(fixture[k] for k in ('e','c','u'))
                    s.query(f"DELETE FROM public.guardian_escalations WHERE id='{e}' AND check_in_id='{c}' AND user_id='{u}';"
                            f"DELETE FROM public.check_ins WHERE id='{c}' AND user_id='{u}';"
                            f"DELETE FROM auth.users WHERE id='{u}'; COMMIT;")
            except Exception:
                failed=True
                print('FAIL cleanup not proven; review synthetic IDs before any rerun',flush=True)
            finally:
                s.close(); s=None
            if baseline is not None:
                verify=None
                try:
                    # Independent connection, including after a SQL error closed psql.
                    verify=Session('Restoration',executable)
                    require(fingerprint(verify)==baseline,'restoration differs')
                    print('PASS independent original data/schema restoration',flush=True)
                except Exception:
                    failed=True
                    print('FAIL original restoration not proven',flush=True)
                finally:
                    if verify: verify.close()
    print('FAIL complete validation' if failed else 'PASS complete validation')
    return 1 if failed else 0


if __name__=='__main__':
    sys.exit(main())
