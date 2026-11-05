-- Idempotent, synthetic dev/test examples. No login sessions or usable invitations.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
DECLARE @people TABLE(id uniqueidentifier,email nvarchar(254),name nvarchar(120),kind varchar(20),released bit);
INSERT @people VALUES
('32400000-0000-4000-8000-000000000001',N'ofek-demo-noa@example.invalid',N'[דוגמה] נועה לוי','unit_member',0),
('32400000-0000-4000-8000-000000000002',N'ofek-demo-uri@example.invalid',N'[דוגמה] אורי כהן','unit_member',1),
('32400000-0000-4000-8000-000000000003',N'ofek-demo-recruiter@example.invalid',N'[דוגמה] מגייסת בחברת הדגמה','external_recruiter',0);
IF EXISTS(SELECT 1 FROM authn.accounts a JOIN @people p ON p.id=a.id WHERE a.email<>p.email)
 THROW 50000,'demo_identity_collision',1;
INSERT authn.accounts(id,email,status,kind,can_seek,can_post,approved_at,verified_name,unit_start_year,unit_end_year,
 verified_release_date,verified_released)
SELECT id,email,'approved',kind,CASE WHEN kind='unit_member' THEN 1 ELSE 0 END,1,SYSUTCDATETIME(),name,
 CASE WHEN kind='unit_member' THEN 2019 END,CASE WHEN kind='unit_member' THEN 2026 END,
 CASE WHEN kind='unit_member' THEN DATEADD(month,2,CONVERT(date,SYSUTCDATETIME())) END,released
FROM @people p WHERE NOT EXISTS(SELECT 1 FROM authn.accounts a WHERE a.id=p.id);
INSERT app.verifications(member_id,full_name,requested_kind,unit_start_year,unit_end_year,release_date,already_released,linkedin_url)
SELECT id,name,kind,CASE WHEN kind='unit_member' THEN 2019 END,CASE WHEN kind='unit_member' THEN 2026 END,
 CASE WHEN kind='unit_member' THEN DATEADD(month,2,CONVERT(date,SYSUTCDATETIME())) END,released,
 'https://www.linkedin.com/in/synthetic-ofek-example'
FROM @people p WHERE NOT EXISTS(SELECT 1 FROM app.verifications WHERE member_id=p.id);
INSERT app.member_cards(member_id,full_name,unit_start_year,unit_end_year,headline,current_title,company,published)
SELECT id,name,CASE WHEN kind='unit_member' THEN 2019 END,CASE WHEN kind='unit_member' THEN 2026 END,
 N'כרטיס סינתטי לצורכי הדגמה',N'תפקיד לדוגמה',N'חברת הדגמה',1
FROM @people p WHERE NOT EXISTS(SELECT 1 FROM app.member_cards WHERE member_id=p.id);
INSERT app.invites(inviter_id,slot)
SELECT id,n FROM @people p CROSS JOIN(VALUES(1),(2),(3),(4),(5)) slots(n)
WHERE kind='unit_member' AND NOT EXISTS(SELECT 1 FROM app.invites WHERE inviter_id=p.id AND slot=n);
INSERT app.profiles(member_id,full_name,headline,release_date,already_released,years_experience,skills,preferred_roles,preferred_locations,bio,status)
SELECT id,name,CASE WHEN released=1 THEN N'מפתח Backend פתוח להזדמנויות' ELSE N'מפתחת Full Stack לקראת שחרור' END,
 DATEADD(month,2,CONVERT(date,SYSUTCDATETIME())),released,3,N'["python","react","sql"]',N'["פיתוח תוכנה"]',
 N'["תל אביב","מרחוק"]',N'פרופיל סינתטי לבדיקת האתר. אין מדובר באדם אמיתי ואין כאן פרטי שירות אמיתיים.',
 CASE WHEN released=1 THEN 'open_to_offers' ELSE 'actively_looking' END
FROM @people p WHERE kind='unit_member' AND NOT EXISTS(SELECT 1 FROM app.profiles WHERE member_id=p.id);
INSERT app.jobs(id,creator_id,title,company,city,work_mode,job_type,seniority,tech_tags,description,apply_method,referral_available)
SELECT j.id,'32400000-0000-4000-8000-000000000002',j.title,N'חברת הדגמה — אינה חברה אמיתית',j.city,
 j.mode,j.type,j.seniority,j.tags,N'## משרת הדגמה בלבד

זו משרה סינתטית שנועדה לבדוק את חיפוש המשרות והגשת המועמדות. אין כאן הצעת עבודה אמיתית.

### מה עושים?
- מפתחים תוכנה בסביבת צוות.
- עובדים עם טכנולוגיות מוכרות.
- משתפים ידע ולומדים יחד.

אין לפרסם מידע מסווג או פרטי שירות שלא אושרו לפרסום.','profile',1
FROM (VALUES
 ('32410000-0000-4000-8000-000000000001',N'[דוגמה] Full Stack Developer',N'תל אביב','hybrid','full_time','junior',N'["react","typescript","sql"]'),
 ('32410000-0000-4000-8000-000000000002',N'[דוגמה] Data Analyst',N'חיפה','onsite','student','junior',N'["python","sql"]'),
 ('32410000-0000-4000-8000-000000000003',N'[דוגמה] Backend Engineer',NULL,'remote','full_time','mid',N'["python","azure"]')
) j(id,title,city,mode,type,seniority,tags)
WHERE NOT EXISTS(SELECT 1 FROM app.jobs WHERE id=j.id);
INSERT app.recommendations(id,author_id,seeker_id,text,relationship,status,revision,approved_revision)
SELECT '32420000-0000-4000-8000-000000000001','32400000-0000-4000-8000-000000000002','32400000-0000-4000-8000-000000000001',
 N'המלצה סינתטית לדוגמה: יכולת למידה, אחריות מקצועית ושיתוף פעולה מעולה. אין מדובר בהמלצה על אדם אמיתי.',
 N'היכרות לדוגמה בלבד','approved',1,1
WHERE NOT EXISTS(SELECT 1 FROM app.recommendations WHERE id='32420000-0000-4000-8000-000000000001');
COMMIT;
