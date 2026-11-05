CREATE SCHEMA authn AUTHORIZATION dbo;
GO
CREATE SCHEMA app AUTHORIZATION dbo;
GO
CREATE SCHEMA guard AUTHORIZATION dbo;
GO
CREATE ROLE ofek_runtime;
CREATE USER ofek_worker WITHOUT LOGIN;
CREATE USER ofek_test_runtime WITHOUT LOGIN;
ALTER ROLE ofek_runtime ADD MEMBER ofek_test_runtime;

CREATE TABLE authn.accounts (
 id uniqueidentifier NOT NULL CONSTRAINT PK_accounts PRIMARY KEY DEFAULT NEWID(),
 email nvarchar(254) NOT NULL UNIQUE,
 status varchar(12) NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected','banned')),
 kind varchar(20) NOT NULL DEFAULT 'unit_member' CHECK(kind IN('unit_member','external_recruiter')),
 can_seek bit NOT NULL DEFAULT 0, can_post bit NOT NULL DEFAULT 0, is_admin bit NOT NULL DEFAULT 0,
 invited_by uniqueidentifier NULL REFERENCES authn.accounts(id),
 verified_name nvarchar(120) NULL, unit_start_year int NULL, unit_end_year int NULL,
 verified_release_date date NULL, verified_released bit NOT NULL DEFAULT 0,
 approved_at datetime2 NULL, created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 CHECK(kind <> 'external_recruiter' OR (can_seek=0 AND is_admin=0)),
 CHECK(status <> 'approved' OR approved_at IS NOT NULL),
 CHECK(invited_by IS NULL OR invited_by <> id)
);
CREATE TABLE authn.login_links (
 token_hash binary(32) NOT NULL PRIMARY KEY, challenge_hash binary(32) NOT NULL,
 email nvarchar(254) NOT NULL, ip_hash binary(32) NOT NULL,
 created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 expires_at datetime2 NOT NULL DEFAULT DATEADD(minute,15,SYSUTCDATETIME()), consumed_at datetime2 NULL
);
CREATE INDEX IX_login_rate ON authn.login_links(email,created_at);
CREATE INDEX IX_login_ip ON authn.login_links(ip_hash,created_at);
CREATE TABLE authn.sessions (
 token_hash binary(32) NOT NULL PRIMARY KEY,
 member_id uniqueidentifier NOT NULL REFERENCES authn.accounts(id),
 expires_at datetime2 NOT NULL DEFAULT DATEADD(day,14,SYSUTCDATETIME()),
 created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), revoked bit NOT NULL DEFAULT 0
);
CREATE INDEX IX_sessions_member ON authn.sessions(member_id);
CREATE TABLE app.verifications (
 member_id uniqueidentifier NOT NULL PRIMARY KEY REFERENCES authn.accounts(id),
 full_name nvarchar(120) NOT NULL CHECK(LEN(TRIM(full_name)) BETWEEN 2 AND 120),
 requested_kind varchar(20) NOT NULL CHECK(requested_kind IN('unit_member','external_recruiter')),
 unit_start_year int NULL CHECK(unit_start_year BETWEEN 1950 AND 2200),
 unit_end_year int NULL CHECK(unit_end_year BETWEEN 1950 AND 2200),
 release_date date NULL, already_released bit NOT NULL DEFAULT 0,
 linkedin_url nvarchar(500) NOT NULL CHECK(linkedin_url LIKE 'https://linkedin.com/in/%' OR linkedin_url LIKE 'https://www.linkedin.com/in/%'),
 submitted_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 CHECK(unit_end_year IS NULL OR unit_end_year>=unit_start_year),
 CHECK((requested_kind='external_recruiter' AND unit_start_year IS NULL AND unit_end_year IS NULL AND release_date IS NULL)
 OR (requested_kind='unit_member' AND unit_start_year IS NOT NULL AND (already_released=1 OR release_date IS NOT NULL)))
);
CREATE TABLE app.invites (
 id uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
 inviter_id uniqueidentifier NOT NULL REFERENCES authn.accounts(id),
 slot tinyint NOT NULL CHECK(slot BETWEEN 1 AND 5),
 code_hash binary(32) NULL, redeemed_by uniqueidentifier NULL REFERENCES authn.accounts(id),
 issued_at datetime2 NULL, redeemed_at datetime2 NULL, revoked_at datetime2 NULL,
 UNIQUE(inviter_id,slot), CHECK(inviter_id<>redeemed_by)
);
CREATE UNIQUE INDEX UX_invite_hash ON app.invites(code_hash) WHERE code_hash IS NOT NULL;
CREATE UNIQUE INDEX UX_invite_recipient ON app.invites(redeemed_by) WHERE redeemed_by IS NOT NULL;
CREATE TABLE app.jobs (
 id uniqueidentifier NOT NULL CONSTRAINT PK_jobs PRIMARY KEY DEFAULT NEWID(),
 creator_id uniqueidentifier NOT NULL REFERENCES authn.accounts(id),
 title nvarchar(160) NOT NULL CHECK(LEN(TRIM(title))>=3),
 company nvarchar(120) NOT NULL CHECK(LEN(TRIM(company))>=2), city nvarchar(120) NULL,
 work_mode varchar(10) NOT NULL CHECK(work_mode IN('onsite','remote','hybrid')),
 job_type varchar(12) NOT NULL CHECK(job_type IN('full_time','part_time','student','freelance')),
 seniority varchar(10) NOT NULL CHECK(seniority IN('junior','mid','senior')),
 tech_tags nvarchar(2000) NOT NULL DEFAULT N'[]' CHECK(ISJSON(tech_tags)=1 AND LEFT(tech_tags,1)='['),
 description nvarchar(max) NOT NULL CHECK(LEN(TRIM(description)) BETWEEN 20 AND 30000),
 salary_min decimal(12,2) NULL CHECK(salary_min>=0), salary_max decimal(12,2) NULL CHECK(salary_max>=0),
 salary_currency char(3) NOT NULL DEFAULT 'ILS', salary_period varchar(6) NOT NULL DEFAULT 'month' CHECK(salary_period IN('hour','month','year')),
 apply_method varchar(15) NOT NULL CHECK(apply_method IN('email','external_link','profile')),
 apply_email nvarchar(254) NULL, apply_url nvarchar(2000) NULL,
 referral_available bit NOT NULL DEFAULT 0, is_open bit NOT NULL DEFAULT 1,
 created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), updated_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 expires_at datetime2 NOT NULL DEFAULT DATEADD(day,60,SYSUTCDATETIME()), deleted_at datetime2 NULL,
 CHECK(work_mode='remote' OR LEN(TRIM(city))>=2),
 CHECK(salary_min IS NULL OR salary_max IS NULL OR salary_max>=salary_min),
 CHECK((apply_method='profile' AND apply_email IS NULL AND apply_url IS NULL)
 OR (apply_method='email' AND apply_email LIKE '%_@_%._%' AND apply_url IS NULL)
 OR (apply_method='external_link' AND apply_url LIKE 'https://_%' AND apply_email IS NULL))
);
CREATE INDEX IX_jobs_discovery ON app.jobs(is_open,expires_at,created_at);
CREATE INDEX IX_jobs_creator ON app.jobs(creator_id);
CREATE TABLE app.profiles (
 member_id uniqueidentifier NOT NULL PRIMARY KEY REFERENCES authn.accounts(id),
 full_name nvarchar(120) NOT NULL CHECK(LEN(TRIM(full_name))>=2),
 headline nvarchar(200) NOT NULL CHECK(LEN(TRIM(headline))>=3),
 release_date date NULL, already_released bit NOT NULL DEFAULT 0,
 years_experience decimal(4,1) NOT NULL DEFAULT 0 CHECK(years_experience BETWEEN 0 AND 70),
 skills nvarchar(4000) NOT NULL DEFAULT N'[]' CHECK(ISJSON(skills)=1 AND LEFT(skills,1)='['),
 preferred_roles nvarchar(2000) NOT NULL DEFAULT N'[]' CHECK(ISJSON(preferred_roles)=1 AND LEFT(preferred_roles,1)='['),
 preferred_locations nvarchar(2000) NOT NULL DEFAULT N'[]' CHECK(ISJSON(preferred_locations)=1 AND LEFT(preferred_locations,1)='['),
 linkedin_url nvarchar(500) NULL, github_url nvarchar(500) NULL, bio nvarchar(3000) NOT NULL DEFAULT N'',
 status varchar(20) NOT NULL DEFAULT 'hidden' CHECK(status IN('actively_looking','open_to_offers','hidden')),
 cv_document_id uniqueidentifier NULL, moderated_at datetime2 NULL,
 created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), updated_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 CHECK(already_released=1 OR release_date IS NOT NULL),
 CHECK(linkedin_url IS NULL OR linkedin_url LIKE 'https://linkedin.com/in/%' OR linkedin_url LIKE 'https://www.linkedin.com/in/%'),
 CHECK(github_url IS NULL OR github_url LIKE 'https://github.com/%' OR github_url LIKE 'https://www.github.com/%')
);
CREATE INDEX IX_profiles_discovery ON app.profiles(status,release_date,years_experience);
CREATE TABLE app.cv_documents (
 id uniqueidentifier NOT NULL PRIMARY KEY, owner_id uniqueidentifier NOT NULL REFERENCES app.profiles(member_id),
 object_name AS (LOWER(CONVERT(varchar(36),owner_id))+'/'+LOWER(CONVERT(varchar(36),id))+'.pdf') PERSISTED,
 original_filename nvarchar(200) NOT NULL CHECK(original_filename LIKE '%.pdf'),
 byte_size int NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880),
 sha256 binary(32) NOT NULL, attested_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 attestation_version varchar(30) NOT NULL DEFAULT '2026-11-05-v1',
 state varchar(10) NOT NULL DEFAULT 'pending' CHECK(state IN('pending','ready')),
 created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), verified_at datetime2 NULL,
 UNIQUE(owner_id,id), CHECK(state<>'ready' OR verified_at IS NOT NULL)
);
ALTER TABLE app.profiles ADD CONSTRAINT FK_profile_cv FOREIGN KEY(member_id,cv_document_id) REFERENCES app.cv_documents(owner_id,id);
CREATE TABLE app.applications (
 id uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
 job_id uniqueidentifier NOT NULL REFERENCES app.jobs(id),
 applicant_id uniqueidentifier NOT NULL REFERENCES app.profiles(member_id),
 created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), UNIQUE(job_id,applicant_id)
);
CREATE INDEX IX_applications_applicant ON app.applications(applicant_id);
CREATE TABLE app.member_cards (
 member_id uniqueidentifier NOT NULL PRIMARY KEY REFERENCES authn.accounts(id),
 full_name nvarchar(120) NOT NULL, unit_start_year int NULL, unit_end_year int NULL,
 headline nvarchar(200) NOT NULL DEFAULT N'', current_title nvarchar(120) NOT NULL DEFAULT N'',
 company nvarchar(120) NOT NULL DEFAULT N'', published bit NOT NULL DEFAULT 0,
 updated_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE app.recommendations (
 id uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
 author_id uniqueidentifier NOT NULL REFERENCES authn.accounts(id),
 seeker_id uniqueidentifier NOT NULL REFERENCES app.profiles(member_id),
 text nvarchar(4000) NOT NULL CHECK(LEN(TRIM(text)) BETWEEN 20 AND 4000),
 relationship nvarchar(160) NULL CHECK(relationship IS NULL OR LEN(TRIM(relationship))>=2),
 status varchar(10) NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','hidden')),
 revision int NOT NULL DEFAULT 1 CHECK(revision>0), approved_revision int NULL,
 created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), updated_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 UNIQUE(author_id,seeker_id), CHECK(author_id<>seeker_id),
 CHECK(status<>'approved' OR approved_revision=revision)
);
CREATE INDEX IX_recommendations_seeker ON app.recommendations(seeker_id,status);
CREATE TABLE app.saved_searches (
 id uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
 owner_id uniqueidentifier NOT NULL REFERENCES authn.accounts(id),
 name nvarchar(100) NOT NULL CHECK(LEN(TRIM(name))>0),
 filters nvarchar(4000) NOT NULL CHECK(ISJSON(filters)=1),
 email_enabled bit NOT NULL DEFAULT 0, consent_at datetime2 NULL,
 next_digest_at datetime2 NOT NULL DEFAULT DATEADD(day,7,SYSUTCDATETIME()),
 last_digest_at datetime2 NULL, created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 CHECK(email_enabled=0 OR consent_at IS NOT NULL)
);
CREATE TABLE app.audit_events (
 id bigint IDENTITY PRIMARY KEY, actor_id uniqueidentifier NULL,
 action varchar(50) NOT NULL, entity_id uniqueidentifier NULL, reason nvarchar(1000) NULL,
 created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE authn.email_outbox (
 id uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
 recipient_id uniqueidentifier NOT NULL REFERENCES authn.accounts(id),
 kind varchar(24) NOT NULL CHECK(kind IN('recommendation','job_expiring','weekly_digest')),
 reference_id uniqueidentifier NOT NULL, dedupe_key varchar(160) NOT NULL UNIQUE,
 state varchar(12) NOT NULL DEFAULT 'pending' CHECK(state IN('pending','processing','sent','failed','cancelled')),
 attempts int NOT NULL DEFAULT 0, lease_until datetime2 NULL,
 created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), sent_at datetime2 NULL,
 provider_id nvarchar(200) NULL, last_error nvarchar(500) NULL
);
CREATE TABLE authn.renewal_tokens (
 token_hash binary(32) NOT NULL PRIMARY KEY, job_id uniqueidentifier NOT NULL REFERENCES app.jobs(id),
 poster_id uniqueidentifier NOT NULL REFERENCES authn.accounts(id),
 job_expires_at datetime2 NOT NULL, expires_at datetime2 NOT NULL, used_at datetime2 NULL
);
CREATE TABLE authn.blob_cleanup (
 object_name varchar(80) NOT NULL PRIMARY KEY, created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 attempts int NOT NULL DEFAULT 0, last_error nvarchar(500) NULL
);
GO
CREATE FUNCTION guard.actor() RETURNS uniqueidentifier WITH SCHEMABINDING
AS BEGIN
 RETURN (SELECT member_id FROM authn.sessions WHERE token_hash=TRY_CONVERT(binary(32),SESSION_CONTEXT(N'session_hash'))
 AND expires_at>SYSUTCDATETIME() AND revoked=0);
END;
GO
CREATE FUNCTION guard.system_actor() RETURNS bit WITH SCHEMABINDING
AS BEGIN RETURN CASE WHEN USER_NAME() IN(N'dbo',N'ofek_worker') THEN 1 ELSE 0 END; END;
GO
CREATE FUNCTION guard.approved() RETURNS bit WITH SCHEMABINDING
AS BEGIN RETURN CASE WHEN EXISTS(SELECT 1 FROM authn.accounts WHERE id=guard.actor() AND status='approved') THEN 1 ELSE 0 END; END;
GO
CREATE FUNCTION guard.admin() RETURNS bit WITH SCHEMABINDING
AS BEGIN RETURN CASE WHEN EXISTS(SELECT 1 FROM authn.accounts WHERE id=guard.actor() AND status='approved' AND is_admin=1) THEN 1 ELSE 0 END; END;
GO
CREATE FUNCTION guard.alumnus(@id uniqueidentifier) RETURNS bit WITH SCHEMABINDING
AS BEGIN RETURN CASE WHEN EXISTS(SELECT 1 FROM authn.accounts WHERE id=@id AND status='approved' AND kind='unit_member'
 AND (verified_released=1 OR verified_release_date<=CONVERT(date,SYSUTCDATETIME()))) THEN 1 ELSE 0 END; END;
GO
CREATE FUNCTION guard.owner(@id uniqueidentifier) RETURNS TABLE WITH SCHEMABINDING
AS RETURN SELECT 1 AS allowed WHERE guard.system_actor()=1 OR guard.admin()=1 OR (guard.approved()=1 AND @id=guard.actor());
GO
CREATE FUNCTION guard.private_owner(@id uniqueidentifier) RETURNS TABLE WITH SCHEMABINDING
AS RETURN SELECT 1 AS allowed WHERE guard.system_actor()=1 OR guard.admin()=1 OR @id=guard.actor();
GO
CREATE FUNCTION guard.admin_only(@id bigint) RETURNS TABLE WITH SCHEMABINDING
AS RETURN SELECT 1 AS allowed WHERE guard.system_actor()=1 OR guard.admin()=1;
GO
CREATE FUNCTION guard.job_read(@creator uniqueidentifier,@is_open bit,@expires datetime2,@deleted datetime2)
RETURNS TABLE WITH SCHEMABINDING AS RETURN SELECT 1 AS allowed
WHERE guard.system_actor()=1 OR (guard.approved()=1 AND
 (guard.admin()=1 OR (@deleted IS NULL AND (@creator=guard.actor() OR
 (@is_open=1 AND @expires>SYSUTCDATETIME() AND EXISTS(SELECT 1 FROM authn.accounts WHERE id=@creator AND status='approved'))))));
GO
CREATE FUNCTION guard.job_write(@creator uniqueidentifier) RETURNS TABLE WITH SCHEMABINDING
AS RETURN SELECT 1 AS allowed WHERE guard.system_actor()=1 OR guard.admin()=1 OR
EXISTS(SELECT 1 FROM authn.accounts WHERE id=guard.actor() AND id=@creator AND status='approved' AND can_post=1);
GO
CREATE FUNCTION guard.profile_read(@owner uniqueidentifier,@status varchar(20),@moderated datetime2)
RETURNS TABLE WITH SCHEMABINDING AS RETURN SELECT 1 AS allowed
WHERE guard.system_actor()=1 OR (guard.approved()=1 AND (guard.admin()=1 OR @owner=guard.actor() OR
(@status<>'hidden' AND @moderated IS NULL AND EXISTS(SELECT 1 FROM authn.accounts WHERE id=@owner AND status='approved' AND can_seek=1))));
GO
CREATE FUNCTION guard.profile_write(@owner uniqueidentifier) RETURNS TABLE WITH SCHEMABINDING
AS RETURN SELECT 1 AS allowed WHERE guard.system_actor()=1 OR guard.admin()=1 OR
EXISTS(SELECT 1 FROM authn.accounts WHERE id=guard.actor() AND id=@owner AND status='approved' AND can_seek=1);
GO
CREATE FUNCTION guard.card_read(@owner uniqueidentifier,@published bit) RETURNS TABLE WITH SCHEMABINDING
AS RETURN SELECT 1 AS allowed WHERE guard.system_actor()=1 OR (guard.approved()=1 AND
(guard.admin()=1 OR @owner=guard.actor() OR (@published=1 AND EXISTS(SELECT 1 FROM authn.accounts WHERE id=@owner AND status='approved'))));
GO
CREATE FUNCTION guard.cv_read(@owner uniqueidentifier,@id uniqueidentifier,@state varchar(10))
RETURNS TABLE WITH SCHEMABINDING AS RETURN SELECT 1 AS allowed WHERE guard.system_actor()=1 OR (guard.approved()=1 AND
(guard.admin()=1 OR @owner=guard.actor() OR (@state='ready' AND EXISTS(
 SELECT 1 FROM app.profiles WHERE member_id=@owner AND cv_document_id=@id AND status<>'hidden' AND moderated_at IS NULL
))));
GO
CREATE FUNCTION guard.application_read(@job uniqueidentifier,@applicant uniqueidentifier)
RETURNS TABLE WITH SCHEMABINDING AS RETURN SELECT 1 AS allowed WHERE guard.system_actor()=1 OR
(guard.approved()=1 AND (guard.admin()=1 OR @applicant=guard.actor() OR EXISTS(
 SELECT 1 FROM app.jobs WHERE id=@job AND creator_id=guard.actor() AND deleted_at IS NULL)));
GO
CREATE FUNCTION guard.recommendation_published(@author uniqueidentifier,@seeker uniqueidentifier,@status varchar(10))
RETURNS bit WITH SCHEMABINDING AS BEGIN RETURN CASE WHEN @status='approved' AND guard.alumnus(@author)=1 AND
EXISTS(SELECT 1 FROM authn.accounts WHERE id=@seeker AND status='approved' AND can_seek=1) AND
EXISTS(SELECT 1 FROM app.member_cards WHERE member_id=@author AND published=1) AND
EXISTS(SELECT 1 FROM app.profiles WHERE member_id=@seeker AND status<>'hidden' AND moderated_at IS NULL)
THEN 1 ELSE 0 END; END;
GO
CREATE FUNCTION guard.recommendation_read(@author uniqueidentifier,@seeker uniqueidentifier,@status varchar(10))
RETURNS TABLE WITH SCHEMABINDING AS RETURN SELECT 1 AS allowed WHERE guard.system_actor()=1 OR
(guard.approved()=1 AND (guard.admin()=1 OR @author=guard.actor() OR @seeker=guard.actor()
OR guard.recommendation_published(@author,@seeker,@status)=1));
GO
CREATE FUNCTION guard.recommendation_write(@author uniqueidentifier,@seeker uniqueidentifier)
RETURNS TABLE WITH SCHEMABINDING AS RETURN SELECT 1 AS allowed WHERE guard.system_actor()=1 OR
(guard.approved()=1 AND (guard.admin()=1 OR @author=guard.actor() OR @seeker=guard.actor()));
GO
CREATE SECURITY POLICY guard.community_access
 ADD FILTER PREDICATE guard.private_owner(member_id) ON app.verifications,
 ADD BLOCK PREDICATE guard.private_owner(member_id) ON app.verifications AFTER INSERT,
 ADD BLOCK PREDICATE guard.private_owner(member_id) ON app.verifications BEFORE UPDATE,
 ADD BLOCK PREDICATE guard.private_owner(member_id) ON app.verifications AFTER UPDATE,
 ADD BLOCK PREDICATE guard.private_owner(member_id) ON app.verifications BEFORE DELETE,
 ADD FILTER PREDICATE guard.owner(inviter_id) ON app.invites,
 ADD BLOCK PREDICATE guard.owner(inviter_id) ON app.invites AFTER INSERT,
 ADD BLOCK PREDICATE guard.owner(inviter_id) ON app.invites BEFORE UPDATE,
 ADD BLOCK PREDICATE guard.owner(inviter_id) ON app.invites AFTER UPDATE,
 ADD BLOCK PREDICATE guard.owner(inviter_id) ON app.invites BEFORE DELETE,
 ADD FILTER PREDICATE guard.job_read(creator_id,is_open,expires_at,deleted_at) ON app.jobs,
 ADD BLOCK PREDICATE guard.job_write(creator_id) ON app.jobs AFTER INSERT,
 ADD BLOCK PREDICATE guard.job_write(creator_id) ON app.jobs BEFORE UPDATE,
 ADD BLOCK PREDICATE guard.job_write(creator_id) ON app.jobs AFTER UPDATE,
 ADD BLOCK PREDICATE guard.job_write(creator_id) ON app.jobs BEFORE DELETE,
 ADD FILTER PREDICATE guard.profile_read(member_id,status,moderated_at) ON app.profiles,
 ADD BLOCK PREDICATE guard.profile_write(member_id) ON app.profiles AFTER INSERT,
 ADD BLOCK PREDICATE guard.profile_write(member_id) ON app.profiles BEFORE UPDATE,
 ADD BLOCK PREDICATE guard.profile_write(member_id) ON app.profiles AFTER UPDATE,
 ADD BLOCK PREDICATE guard.profile_write(member_id) ON app.profiles BEFORE DELETE,
 ADD FILTER PREDICATE guard.cv_read(owner_id,id,state) ON app.cv_documents,
 ADD BLOCK PREDICATE guard.profile_write(owner_id) ON app.cv_documents AFTER INSERT,
 ADD BLOCK PREDICATE guard.profile_write(owner_id) ON app.cv_documents BEFORE UPDATE,
 ADD BLOCK PREDICATE guard.profile_write(owner_id) ON app.cv_documents AFTER UPDATE,
 ADD BLOCK PREDICATE guard.profile_write(owner_id) ON app.cv_documents BEFORE DELETE,
 ADD FILTER PREDICATE guard.application_read(job_id,applicant_id) ON app.applications,
 ADD BLOCK PREDICATE guard.profile_write(applicant_id) ON app.applications AFTER INSERT,
 ADD BLOCK PREDICATE guard.owner(applicant_id) ON app.applications BEFORE UPDATE,
 ADD BLOCK PREDICATE guard.owner(applicant_id) ON app.applications AFTER UPDATE,
 ADD BLOCK PREDICATE guard.owner(applicant_id) ON app.applications BEFORE DELETE,
 ADD FILTER PREDICATE guard.card_read(member_id,published) ON app.member_cards,
 ADD BLOCK PREDICATE guard.owner(member_id) ON app.member_cards AFTER INSERT,
 ADD BLOCK PREDICATE guard.owner(member_id) ON app.member_cards BEFORE UPDATE,
 ADD BLOCK PREDICATE guard.owner(member_id) ON app.member_cards AFTER UPDATE,
 ADD BLOCK PREDICATE guard.owner(member_id) ON app.member_cards BEFORE DELETE,
 ADD FILTER PREDICATE guard.recommendation_read(author_id,seeker_id,status) ON app.recommendations,
 ADD BLOCK PREDICATE guard.recommendation_write(author_id,seeker_id) ON app.recommendations AFTER INSERT,
 ADD BLOCK PREDICATE guard.recommendation_write(author_id,seeker_id) ON app.recommendations BEFORE UPDATE,
 ADD BLOCK PREDICATE guard.recommendation_write(author_id,seeker_id) ON app.recommendations AFTER UPDATE,
 ADD BLOCK PREDICATE guard.recommendation_write(author_id,seeker_id) ON app.recommendations BEFORE DELETE,
 ADD FILTER PREDICATE guard.owner(owner_id) ON app.saved_searches,
 ADD BLOCK PREDICATE guard.owner(owner_id) ON app.saved_searches AFTER INSERT,
 ADD BLOCK PREDICATE guard.owner(owner_id) ON app.saved_searches BEFORE UPDATE,
 ADD BLOCK PREDICATE guard.owner(owner_id) ON app.saved_searches AFTER UPDATE,
 ADD BLOCK PREDICATE guard.owner(owner_id) ON app.saved_searches BEFORE DELETE,
 ADD FILTER PREDICATE guard.admin_only(id) ON app.audit_events
 WITH(STATE=ON,SCHEMABINDING=ON);
GO
CREATE VIEW app.profile_cards AS
 SELECT p.*, CONVERT(bit,CASE WHEN p.status<>'hidden' AND p.moderated_at IS NULL
 AND a.status='approved' AND a.can_seek=1 THEN 1 ELSE 0 END) AS discoverable,
 (SELECT COUNT(*) FROM app.recommendations r WHERE r.seeker_id=p.member_id
 AND guard.recommendation_published(r.author_id,r.seeker_id,r.status)=1) AS recommendation_count
 FROM app.profiles p JOIN authn.accounts a ON a.id=p.member_id;
GO
CREATE VIEW app.job_cards AS
 SELECT j.*,CONVERT(bit,CASE WHEN j.is_open=1 AND j.deleted_at IS NULL AND j.expires_at>SYSUTCDATETIME()
 AND a.status='approved' THEN 1 ELSE 0 END) AS available
 FROM app.jobs j JOIN authn.accounts a ON a.id=j.creator_id;
GO
CREATE VIEW app.applicant_cards AS
 SELECT a.id,a.job_id,a.applicant_id,a.created_at,p.full_name,p.headline,p.skills,p.status,p.recommendation_count
 FROM app.applications a LEFT JOIN app.profile_cards p ON p.member_id=a.applicant_id;
GO
GRANT SELECT ON SCHEMA::app TO ofek_runtime;
DENY SELECT ON OBJECT::app.invites(code_hash) TO ofek_runtime;
GRANT SELECT ON SCHEMA::app TO ofek_worker;
GRANT SELECT,INSERT,UPDATE,DELETE ON SCHEMA::authn TO ofek_worker;
