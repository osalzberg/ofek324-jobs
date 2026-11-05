-- LOCAL/TEST ONLY. Every identity, employer, and vacancy below is synthetic.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, is_anonymous, created_at, updated_at
)
select
  ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated',
  'fixture-' || n || '@example.invalid',
  case when n = 10 then null else now() end,
  '{"provider":"email","providers":["email"]}'::jsonb,
  case when n = 4 then '{"is_admin":true,"status":"approved"}'::jsonb else '{}'::jsonb end,
  false, now(), now()
from generate_series(1, 12) as n;

insert into public.verification_requests (
  member_id, full_name, requested_kind, unit_start_year, unit_end_year,
  release_date, already_released, linkedin_url
)
select id, 'משתמש לדוגמה ' || right(id::text, 2),
  case when right(id::text, 2) in ('07', '08') then 'external_recruiter'::public.member_kind
    else 'unit_member'::public.member_kind end,
  case when right(id::text, 2) in ('07', '08') then null else 2020 end,
  case when right(id::text, 2) in ('07', '08') then null else 2023 end,
  case when right(id::text, 2) in ('07', '08') then null else current_date + 45 end,
  right(id::text, 2) in ('07', '08'),
  'https://www.linkedin.com/in/ofek-fixture-' || right(id::text, 2)
from public.members;

update public.verification_requests set already_released = true, release_date = null
where member_id in (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000006',
  '00000000-0000-4000-8000-000000000011'
);

update public.members set status = 'approved', approved_at = now(), can_post = true,
  can_seek = right(id::text, 2) <> '07',
  kind = case when right(id::text, 2) = '07' then 'external_recruiter'::public.member_kind
    else 'unit_member'::public.member_kind end,
  is_admin = right(id::text, 2) = '01'
where right(id::text, 2) in ('01', '02', '03', '06', '07', '09', '11');
update public.members set status = 'banned', can_seek = false, can_post = false
  where id = '00000000-0000-4000-8000-000000000006';
update public.members set status = 'rejected' where id = '00000000-0000-4000-8000-000000000012';

insert into public.jobs (
  id, creator_id, title, company, city, work_mode, job_type, seniority,
  tech_tags, description, apply_method, referral_available, salary_min, salary_max
) values (
  '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
  'פיתוח Full Stack', 'חברת הדגמה', 'תל אביב', 'hybrid', 'full_time', 'junior',
  array['TypeScript', 'React'], '## התפקיד' || E'\n' ||
  'פיתוח מוצרי תוכנה עם TypeScript ו-React בצוות קטן. זו משרה פיקטיבית לבדיקות בלבד.',
  'profile', true, 18000, 24000
);
insert into public.jobs (
  id, creator_id, title, company, work_mode, job_type, seniority,
  tech_tags, description, apply_method, apply_url
) values (
  '10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000007',
  'פיתוח Backend', 'מגייסים לדוגמה', 'remote', 'part_time', 'mid',
  array['Python', 'Postgres'], 'פיתוח שירותי Backend עם Python ו-Postgres. משרה פיקטיבית לבדיקות.',
  'external_link', 'https://example.invalid/jobs/backend'
);
insert into public.jobs (
  id, creator_id, title, company, work_mode, job_type, seniority,
  tech_tags, description, apply_method, is_open, created_at, expires_at
)
select ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  case when n = 5 then '00000000-0000-4000-8000-000000000006'::uuid
    else '00000000-0000-4000-8000-000000000002'::uuid end,
  'משרת בדיקה ' || n, 'חברת הדגמה', 'remote', 'student', 'junior',
  array['SQL'], 'משרה פיקטיבית לבדיקת תפוגה, סגירה והרשאות גישה.', 'profile',
  n <> 4,
  case when n = 3 then now() - interval '61 days' else now() end,
  case when n = 3 then now() - interval '1 day'
    when n = 6 then now() + interval '6 days' else now() + interval '60 days' end
from generate_series(3, 6) as n;

insert into public.seeker_profiles (
  member_id, full_name, headline, release_date, already_released, years_experience,
  skills, preferred_roles, preferred_locations, bio, status
) values
('00000000-0000-4000-8000-000000000003', 'נועם לדוגמה', 'פיתוח תוכנה ונתונים',
  current_date + 45, false, 3, array['TypeScript', 'Python'], array['Full Stack'],
  array['תל אביב', 'מרחוק'], 'ניסיון בפיתוח מערכות תוכנה ובשיתוף פעולה בצוות. פרופיל פיקטיבי.', 'actively_looking'),
('00000000-0000-4000-8000-000000000009', 'טל לדוגמה', 'פרופיל מוסתר לבדיקה',
  current_date + 30, false, 2, array['Python'], array['Backend'],
  array['מרחוק'], 'הפרופיל הזה אינו מופיע בחיפוש.', 'hidden'),
('00000000-0000-4000-8000-000000000011', 'עדי לדוגמה', 'פיתוח Backend',
  null, true, 5, array['Python', 'SQL'], array['Backend'],
  array['חיפה'], 'פרופיל פיקטיבי של בוגר שכבר השתחרר.', 'open_to_offers'),
('00000000-0000-4000-8000-000000000006', 'חשבון חסום לדוגמה', 'פרופיל של חשבון חסום',
  null, true, 4, array['SQL'], array['Data'],
  array['מרחוק'], 'אין להציג פרופיל של חשבון חסום.', 'actively_looking');

insert into public.applications(id, job_id, applicant_id) values (
  '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000003'
);
insert into public.saved_searches(id, owner_id, name, tags, email_enabled) values (
  '30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003',
  'משרות React עם הפניה', array['React'], true
);

insert into public.member_cards(
  member_id, full_name, headline, current_title, current_company,
  unit_start_year, unit_end_year, published_at
)
select member_id, full_name, 'פיתוח תוכנה וניהול צוותים', 'ראש צוות', 'חברת הדגמה',
  unit_start_year, unit_end_year, now()
from public.verification_requests where member_id in (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000011'
);

insert into public.recommendations(
  id, author_id, seeker_id, recommendation_text, relationship,
  approval_status, approved_revision, approved_at, reviewed_at
) values (
  '40000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003',
  'עבדנו יחד בצוות תוכנה. נועם הפגין יכולת למידה עצמאית, אחריות ושיתוף פעולה מצוין.',
  'שירתנו באותו צוות', 'approved', 1, now(), now()
), (
  '40000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000003',
  'היכרות מקצועית טובה וניסיון משותף בפתרון בעיות. זו המלצה פיקטיבית לבדיקות בלבד.',
  null, 'pending', null, null, null
), (
  '40000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003',
  'המלצה פיקטיבית שהוסתרה על ידי בעל הפרופיל, ואינה מוצגת ברשימות המועמדים.',
  'עבודה משותפת', 'hidden', null, null, now()
);

commit;
