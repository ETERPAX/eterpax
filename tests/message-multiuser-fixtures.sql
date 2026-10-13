-- Disposable local fixtures ONLY. Executed by message-file-coordination-lab.py.
CREATE TABLE public.guardian_verification_notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),escalation_id uuid,status text);
CREATE TABLE public.guardian_verification_emission_attempts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),notification_id uuid,status text);
-- Seed legacy paths BEFORE global coordination is switched on.
INSERT INTO messages(id,user_id,voice_path) VALUES
('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002/legacy.webm'),
('00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003/legacy.webm'),
('00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002/legacy.webm');
INSERT INTO storage.objects(bucket_id,name) VALUES
('message-audio','00000000-0000-4000-8000-000000000002/legacy.webm'),
('message-audio','00000000-0000-4000-8000-000000000003/legacy.webm');
INSERT INTO check_ins(user_id,status,missed_count) VALUES
('00000000-0000-4000-8000-000000000002','scheduled',0),
('00000000-0000-4000-8000-000000000003','scheduled',0);
