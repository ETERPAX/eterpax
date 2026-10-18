#!/usr/bin/env python3
"""Local-only manual concurrency validator. NEVER runs on import.

Requires explicit approval of synthetic database commits, not Git commits.
PostgreSQL cannot expose uncommitted fixtures/results to another connection.
This harness commits only its synthetic rows, rolls back the rollback scenario,
and deletes its fixtures transactionally before comparing original fingerprints.
Passwords are read by psql -W directly from /dev/tty, never by this program.
No migrations, temporary SQL files, credentials, or production connections.
"""
import argparse
import hashlib
import json
import os
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
          'public.guardian_verification_responses')
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
 UNION ALL SELECT 'policy:'||p.oid,to_jsonb(p)::text FROM pg_policy p
 JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth')
 ) SELECT md5(coalesce(string_agg(k||v,'' ORDER BY k),'')) FROM definitions;""")
    return result


def preflight(s):
    s.query("""DO $guard$ DECLARE n text; BEGIN
 IF EXISTS(SELECT 1 FROM pg_event_trigger WHERE evtenabled <> 'D')
 THEN RAISE EXCEPTION 'BLOCKED: enabled event trigger'; END IF;
 FOREACH n IN ARRAY ARRAY['auth.users','public.check_ins','public.guardians',
 'public.guardian_escalations','public.guardian_escalation_participants',
 'public.guardian_verification_rounds','public.guardian_verification_requests',
 'public.guardian_verification_tokens','public.guardian_verification_notifications',
 'public.guardian_verification_responses'] LOOP
  IF to_regclass(n) IS NULL THEN RAISE EXCEPTION 'BLOCKED: prerequisite table'; END IF;
  IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass(n)
    AND NOT tgisinternal AND tgenabled<>'D')
  THEN RAISE EXCEPTION 'BLOCKED: unreviewed trigger'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='auth.users'::regclass
 AND attname='id' AND atttypid='uuid'::regtype AND NOT attisdropped)
 OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='auth.users'::regclass
 AND attnum>0 AND NOT attisdropped AND attname<>'id' AND attnotnull AND NOT atthasdef
 AND attidentity='' AND attgenerated='')
 THEN RAISE EXCEPTION 'BLOCKED: auth.users fixture incompatible'; END IF;
 IF NOT has_function_privilege('service_role','public.prepare_guardian_verification(uuid)','EXECUTE')
 OR has_function_privilege('anon','public.prepare_guardian_verification(uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.prepare_guardian_verification(uuid)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.confirm_check_in()','EXECUTE')
 THEN RAISE EXCEPTION 'BLOCKED: RPC grants'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('service_role','authenticated') AND rolsuper)
 THEN RAISE EXCEPTION 'BLOCKED: application role is superuser'; END IF;
 END $guard$;""")
    # Compare installed bodies to repository originals; print neither definition.
    root = Path(__file__).resolve().parents[1] / 'supabase' / 'migrations'
    for filename, fn in (
        ('202610090003_guardian_verification_preparation.sql', 'prepare_guardian_verification(uuid)'),
        ('202610090002_guardian_verification_emissions_owner_compatibility.sql', 'confirm_check_in()')):
        body = (root / filename).read_text().split('$function$')[1]
        expected = hashlib.md5(body.encode()).hexdigest()
        actual = s.scalar(f"SELECT md5(prosrc) FROM pg_proc WHERE oid='public.{fn}'::regprocedure;")
        require(actual == expected, 'installed RPC differs from repository')


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


def prep_sql(f):
    return f"SELECT row_to_json(r) FROM public.prepare_guardian_verification('{f['e']}') r;"


def owner_setup(s, f):
    s.query(f"""DO $claims$ BEGIN
 -- Laboratory auth.uid() reads this transaction-local synthetic identity.
 PERFORM set_config('eterpax_test.user_id','{f['u']}',true);
 IF auth.uid() IS DISTINCT FROM '{f['u']}'::uuid
 THEN RAISE EXCEPTION 'FAIL: synthetic owner identity'; END IF;
 END $claims$;
 SET LOCAL ROLE authenticated;""")


def owner_sql():
    return 'SELECT row_to_json(r) FROM public.confirm_check_in() r;'


def record(rows):
    require(len(rows) == 1, 'RPC returned unexpected row count')
    return json.loads(rows[0])


def await_block(observer, follower, leader):
    # Evidence barrier, not a guessed sleep: inspect PostgreSQL's real blockers.
    end = time.monotonic() + 8
    while time.monotonic() < end:
        require(follower.process.poll() is None, 'follower failed before lock barrier')
        blocked = observer.scalar(
            f'SELECT {leader.pid}=ANY(pg_blocking_pids({follower.pid}));')
        if blocked == 't':
            return
        time.sleep(0.05)
    raise RuntimeError('expected parent lock contention was not observed')


def inventory(s, f, expected_rounds):
    e = f['e']
    data = json.loads(s.scalar(f"""SELECT json_build_object(
 'rounds',(SELECT count(*) FROM public.guardian_verification_rounds WHERE escalation_id='{e}'),
 'requests',(SELECT count(*) FROM public.guardian_verification_requests WHERE escalation_id='{e}'),
 'ids',(SELECT array_agg(source_guardian_id::text ORDER BY source_guardian_id) FROM public.guardian_verification_requests WHERE escalation_id='{e}'),
 'tokens',(SELECT count(*) FROM public.guardian_verification_tokens WHERE escalation_id='{e}'),
 'emissions',(SELECT count(*) FROM public.guardian_verification_notifications WHERE escalation_id='{e}'),
 'responses',(SELECT count(*) FROM public.guardian_verification_responses WHERE escalation_id='{e}'),
 'timing_ok',NOT EXISTS(SELECT 1 FROM public.guardian_verification_rounds r WHERE r.escalation_id='{e}' AND
 (r.dispatch_deadline_at<>r.prepared_at+interval '24 hours' OR r.first_accepted_at IS NOT NULL OR r.reminder_due_at IS NOT NULL
 OR r.response_deadline_at IS NOT NULL OR r.majority_reached_at IS NOT NULL OR r.safety_deadline_at IS NOT NULL
 OR EXISTS(SELECT 1 FROM public.guardian_verification_requests q WHERE q.escalation_id=r.escalation_id AND q.created_at<>r.prepared_at))));"""))
    require(data['rounds'] == expected_rounds, 'round count')
    require(data['requests'] == len(f['g'])*expected_rounds, 'request count')
    require((data['ids'] or []) == (sorted(f['g']) if expected_rounds else []), 'request identities or duplicates')
    require(data['timing_ok'] and not any(data[k] for k in ('tokens', 'emissions', 'responses')), 'unexpected timing/side effects')


def cancellation_state(s, f, result):
    e = json.loads(s.scalar(f"SELECT row_to_json(e) FROM public.guardian_escalations e WHERE id='{f['e']}';"))
    require(e['status'] == 'cancelled_owner_check_in', 'owner did not cancel')
    require(e['closed_at'] == e['owner_checked_in_at'] == result['last_check_in_at'], 'cancellation timestamps')
    require(result['escalation_generation'] == 8 and result['status'] == 'scheduled'
            and result['missed_count'] == 0, 'owner parent reset')


def run_a(a, b, observer, f, rollback_first=False):
    begin(a)
    a.query('SET LOCAL ROLE service_role;')
    first = record(a.query(prep_sql(f)))
    require(first['outcome'] == 'prepared', 'A first preparation')
    begin(b)
    b.query('SET LOCAL ROLE service_role;')
    b.send(prep_sql(f))
    await_block(observer, b, a)
    a.query('ROLLBACK;' if rollback_first else 'COMMIT;')
    second = record(b.finish())
    require(second['outcome'] == ('prepared' if rollback_first else 'already_prepared'), 'A follower outcome')
    require(first['request_count'] == second['request_count'] == len(f['g']), 'A participant counts')
    if not rollback_first:
        require(first['prepared_at'] == second['prepared_at'] and
                first['dispatch_deadline_at'] == second['dispatch_deadline_at'], 'A clock reset')
    b.query('ROLLBACK;' if rollback_first else 'COMMIT;')
    if not rollback_first:
        # Compare timestamptz in PostgreSQL, independent of output time zone.
        persisted = observer.scalar(
            "SELECT prepared_at='" + first['prepared_at'] + "'::timestamptz "
            "AND dispatch_deadline_at='" + first['dispatch_deadline_at'] +
            "'::timestamptz FROM public.guardian_verification_rounds WHERE escalation_id='" + f['e'] + "';")
        require(persisted == 't', 'A persisted clock changed')
    inventory(observer, f, 0 if rollback_first else 1)
    print('PASS: A rollback recovery' if rollback_first else 'PASS: A concurrent preparation', flush=True)


def run_b(a, b, observer, f, owner_first):
    begin(a)
    if owner_first:
        owner_setup(a, f)
        owner = record(a.query(owner_sql()))
        begin(b)
        b.query('SET LOCAL ROLE service_role;')
        b.send(prep_sql(f))
    else:
        a.query('SET LOCAL ROLE service_role;')
        prepared = record(a.query(prep_sql(f)))
        require(prepared['outcome'] == 'prepared', 'B preparation')
        begin(b)
        owner_setup(b, f)
        b.send(owner_sql())
    await_block(observer, b, a)
    a.query('COMMIT;')
    second = record(b.finish())
    if owner_first:
        require(second['outcome'] == 'ineligible' and second['request_count'] == 0, 'B owner-first eligibility')
    else:
        owner = second
    b.query('COMMIT;')
    cancellation_state(observer, f, owner)
    inventory(observer, f, 0 if owner_first else 1)
    begin(a)
    a.query('SET LOCAL ROLE service_role;')
    again = record(a.query(prep_sql(f)))
    require(again['outcome'] == 'ineligible' and again['request_count'] == 0, 'B stale preparation authorized')
    a.query('ROLLBACK;')
    inventory(observer, f, 0 if owner_first else 1)
    print('PASS: B cancellation first' if owner_first else 'PASS: B preparation first', flush=True)


def cleanup(s, fixtures):
    s.query(IDENTITY)
    begin(s)
    for f in fixtures:
        # IDs were proven absent before initial insertion. Never delete by email,
        # broad pattern or any production identity. Children are removed explicitly.
        e, c, u = (f[k] for k in ('e', 'c', 'u'))
        for table in ('guardian_verification_responses', 'guardian_verification_notifications',
                      'guardian_verification_tokens', 'guardian_verification_requests',
                      'guardian_verification_rounds', 'guardian_escalation_participants'):
            s.query(f"DELETE FROM public.{table} WHERE escalation_id='{e}';")
        s.query(f"DELETE FROM public.guardian_escalations WHERE id='{e}' AND user_id='{u}';"
                f"DELETE FROM public.check_ins WHERE id='{c}' AND user_id='{u}';"
                f"DELETE FROM auth.users WHERE id='{u}';")
    s.query('COMMIT;')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--approve-synthetic-commits', action='store_true',
                        help='Explicitly authorize temporary committed fixtures/results and their cleanup')
    args = parser.parse_args()
    require(args.approve_synthetic_commits, 'approval required for synthetic database commits')
    require(sys.stdin.isatty(), 'run directly from Terminal for psql password prompts')
    executable = shutil.which('psql')
    require(executable is not None, 'psql unavailable')
    fixtures = [case(3), case(2), case(6), case(2)]
    observer = a = b = None
    baseline = None
    cleanup_allowed = False
    failed = False
    try:
        observer = Session('Observer', executable)
        preflight(observer)
        # Reject other clients: the fingerprint/cleanup test requires a quiet lab.
        require(observer.scalar("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid();") == '0', 'close other laboratory clients first')
        baseline = fingerprint(observer)
        for f in fixtures:
            require(observer.scalar(f"SELECT EXISTS(SELECT 1 FROM auth.users WHERE id='{f['u']}') OR EXISTS(SELECT 1 FROM public.check_ins WHERE id='{f['c']}') OR EXISTS(SELECT 1 FROM public.guardian_escalations WHERE id='{f['e']}');") == 'f', 'synthetic identity collision')
        a = Session('Session A', executable)
        b = Session('Session B', executable)
        cleanup_allowed = True
        # Print only synthetic IDs to allow manual recovery after terminal loss.
        print('Synthetic recovery identities: ' + json.dumps(fixtures), flush=True)
        begin(observer)
        for f in fixtures:
            create_fixture(observer, f)
        observer.query('COMMIT;')
        run_a(a, b, observer, fixtures[0])
        run_b(a, b, observer, fixtures[1], True)
        run_b(a, b, observer, fixtures[2], False)
        run_a(a, b, observer, fixtures[3], True)
    except (Exception, KeyboardInterrupt) as error:
        failed = True
        if isinstance(error, RuntimeError):
            print('FAIL: ' + str(error), flush=True)
        print('FAIL: stopped on unexpected error, prerequisite failure or interruption; only cleanup follows.', flush=True)
    finally:
        # Close both workers first, rolling back any unfinished transaction and
        # releasing parent locks before cleanup. The observer may also have lost
        # its connection on SQL error; never silently replace it or change target.
        for worker in (a, b):
            if worker:
                worker.close()
        if cleanup_allowed:
            try:
                require(observer.process.poll() is None and observer.pending is None,
                        'observer unavailable; manual synthetic cleanup required')
                observer.query('ROLLBACK;')
                cleanup(observer, fixtures)
                # Worker connections are gone: observer reads committed state
                # independently of both actors, including disappearance of fixtures.
                require(fingerprint(observer) == baseline, 'original fingerprint differs')
                print('PASS: synthetic cleanup and original data/schema restoration', flush=True)
            except Exception:
                failed = True
                print('FAIL: cleanup/restoration not proven. Use printed synthetic IDs for CTO review; do not rerun blindly.', flush=True)
        if observer:
            observer.close()
    print('FAIL: complete concurrency validation' if failed else 'PASS: complete concurrency validation')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
