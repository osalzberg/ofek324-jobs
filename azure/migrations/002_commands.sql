CREATE PROCEDURE authn.request_link
 @email nvarchar(254),@token_hash binary(32),@challenge_hash binary(32),@ip_hash binary(32)
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 IF @email NOT LIKE '%_@_%._%' THROW 50000,'invalid',1;
 BEGIN TRANSACTION;
 DECLARE @lock int;
 EXEC @lock=sys.sp_getapplock @Resource='ofek-login-rate',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
 IF @lock<0 THROW 50002,'busy',1;
 IF (SELECT COUNT(*) FROM authn.login_links WHERE created_at>DATEADD(hour,-1,SYSUTCDATETIME()) AND email=@email)>=5
 OR (SELECT COUNT(*) FROM authn.login_links WHERE created_at>DATEADD(hour,-1,SYSUTCDATETIME()) AND ip_hash=@ip_hash)>=20
 OR (SELECT COUNT(*) FROM authn.login_links WHERE created_at>DATEADD(day,-1,SYSUTCDATETIME()))>=200
 THROW 50003,'rate_limited',1;
 INSERT authn.login_links(email,token_hash,challenge_hash,ip_hash) VALUES(LOWER(@email),@token_hash,@challenge_hash,@ip_hash);
 COMMIT;
END;
GO
CREATE PROCEDURE authn.establish_session @email nvarchar(254),@session_hash binary(32)
AS BEGIN
 SET NOCOUNT ON;
 DECLARE @id uniqueidentifier;
 SELECT @id=id FROM authn.accounts WITH(UPDLOCK,HOLDLOCK) WHERE email=LOWER(@email);
 IF @id IS NULL BEGIN
  SET @id=NEWID(); INSERT authn.accounts(id,email) VALUES(@id,LOWER(@email));
 END;
 INSERT authn.sessions(token_hash,member_id) VALUES(@session_hash,@id);
END;
GO
CREATE PROCEDURE authn.consume_link @token_hash binary(32),@challenge_hash binary(32),@session_hash binary(32)
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON; BEGIN TRANSACTION;
 DECLARE @email nvarchar(254);
 SELECT @email=email FROM authn.login_links WITH(UPDLOCK,HOLDLOCK)
 WHERE token_hash=@token_hash AND challenge_hash=@challenge_hash AND consumed_at IS NULL AND expires_at>SYSUTCDATETIME();
 IF @email IS NULL THROW 50001,'invalid_or_expired_link',1;
 UPDATE authn.login_links SET consumed_at=SYSUTCDATETIME() WHERE token_hash=@token_hash;
 EXEC authn.establish_session @email,@session_hash;
 COMMIT;
END;
GO
CREATE PROCEDURE authn.google_session @email nvarchar(254),@session_hash binary(32)
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 IF @email NOT LIKE '%_@_%._%' THROW 50000,'invalid',1;
 BEGIN TRANSACTION;
 EXEC authn.establish_session @email,@session_hash;
 COMMIT;
END;
GO
CREATE PROCEDURE authn.me
AS BEGIN
 SET NOCOUNT ON;
 SELECT id,email,status,kind,can_seek,can_post,is_admin,verified_name,created_at,
 guard.alumnus(id) AS can_recommend FROM authn.accounts WHERE id=guard.actor();
END;
GO
CREATE PROCEDURE authn.sign_out
AS BEGIN
 UPDATE authn.sessions SET revoked=1 WHERE token_hash=TRY_CONVERT(binary(32),SESSION_CONTEXT(N'session_hash'));
END;
GO
CREATE PROCEDURE app.submit_verification @data nvarchar(max)
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @actor uniqueidentifier=guard.actor();
 IF ISJSON(@data)<>1 THROW 50000,'invalid',1;
 BEGIN TRANSACTION;
 IF NOT EXISTS(SELECT 1 FROM authn.accounts WITH(UPDLOCK,HOLDLOCK) WHERE id=@actor AND status IN('pending','rejected')) THROW 50001,'forbidden',1;
 UPDATE authn.accounts SET status='pending' WHERE id=@actor;
 DELETE FROM app.verifications WHERE member_id=@actor;
 INSERT app.verifications(member_id,full_name,requested_kind,unit_start_year,unit_end_year,release_date,already_released,linkedin_url)
 SELECT @actor,full_name,requested_kind,unit_start_year,unit_end_year,release_date,already_released,linkedin_url
 FROM OPENJSON(@data) WITH(full_name nvarchar(120),requested_kind varchar(20),unit_start_year int,unit_end_year int,
 release_date date,already_released bit,linkedin_url nvarchar(500));
 COMMIT;
END;
GO
CREATE PROCEDURE authn.approve_account @member uniqueidentifier,@inviter uniqueidentifier=NULL
AS BEGIN
 IF @@TRANCOUNT=0 THROW 50002,'transaction_required',1;
 IF NOT EXISTS(SELECT 1 FROM app.verifications WHERE member_id=@member) THROW 50000,'verification_required',1;
 UPDATE a SET status='approved',kind=v.requested_kind,can_post=1,can_seek=CASE WHEN v.requested_kind='unit_member' THEN 1 ELSE 0 END,
 invited_by=COALESCE(a.invited_by,@inviter),approved_at=SYSUTCDATETIME(),verified_name=v.full_name,
 unit_start_year=v.unit_start_year,unit_end_year=v.unit_end_year,
 verified_release_date=v.release_date,verified_released=v.already_released
 FROM authn.accounts a JOIN app.verifications v ON v.member_id=a.id WHERE a.id=@member;
 UPDATE c SET full_name=a.verified_name,unit_start_year=a.unit_start_year,unit_end_year=a.unit_end_year
 FROM app.member_cards c JOIN authn.accounts a ON a.id=c.member_id WHERE a.id=@member;
 INSERT app.member_cards(member_id,full_name,unit_start_year,unit_end_year)
 SELECT id,verified_name,unit_start_year,unit_end_year FROM authn.accounts a WHERE id=@member
 AND NOT EXISTS(SELECT 1 FROM app.member_cards WHERE member_id=@member);
 INSERT app.invites(inviter_id,slot)
 SELECT @member,s.n FROM (VALUES(1),(2),(3),(4),(5)) s(n)
 WHERE EXISTS(SELECT 1 FROM authn.accounts WHERE id=@member AND kind='unit_member')
 AND NOT EXISTS(SELECT 1 FROM app.invites WHERE inviter_id=@member AND slot=s.n);
 INSERT app.audit_events(actor_id,action,entity_id) VALUES(guard.actor(),CASE WHEN @inviter IS NULL THEN 'member_approved' ELSE 'invite_redeemed' END,@member);
END;
GO
CREATE PROCEDURE app.admin_members
AS BEGIN
 SET NOCOUNT ON;
 IF guard.admin()<>1 THROW 50001,'forbidden',1;
 SELECT a.id,a.email,a.status,a.kind,a.is_admin,a.invited_by,a.created_at,v.full_name,v.unit_start_year,v.unit_end_year,
 v.release_date,v.already_released,v.linkedin_url,v.requested_kind
 FROM authn.accounts a LEFT JOIN app.verifications v ON v.member_id=a.id
 ORDER BY CASE WHEN a.status='pending' THEN 0 ELSE 1 END,a.created_at DESC;
END;
GO
CREATE PROCEDURE app.admin_decide @member uniqueidentifier,@decision varchar(10),@reason nvarchar(1000)=NULL
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 IF guard.admin()<>1 OR @member=guard.actor() THROW 50001,'forbidden',1;
 BEGIN TRANSACTION;
 IF NOT EXISTS(SELECT 1 FROM authn.accounts WITH(UPDLOCK,HOLDLOCK) WHERE id=@member) THROW 50004,'not_found',1;
 IF @decision='approve' BEGIN
  EXEC authn.approve_account @member;
 END ELSE IF @decision IN('reject','ban') BEGIN
  IF EXISTS(SELECT 1 FROM authn.accounts WHERE id=@member AND is_admin=1) THROW 50001,'operator_required',1;
  UPDATE authn.accounts SET status=CASE WHEN @decision='ban' THEN 'banned' ELSE 'rejected' END WHERE id=@member;
  UPDATE authn.sessions SET revoked=1 WHERE member_id=@member;
  UPDATE authn.email_outbox SET state='cancelled' WHERE recipient_id=@member AND state IN('pending','failed','processing');
  INSERT app.audit_events(actor_id,action,entity_id,reason) VALUES(guard.actor(),@decision,@member,@reason);
 END ELSE THROW 50000,'invalid',1;
 COMMIT;
END;
GO
CREATE PROCEDURE app.issue_invite @slot tinyint,@hash binary(32)
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 IF NOT EXISTS(SELECT 1 FROM authn.accounts WHERE id=guard.actor() AND status='approved' AND kind='unit_member') THROW 50001,'forbidden',1;
 UPDATE app.invites SET code_hash=@hash,issued_at=SYSUTCDATETIME(),revoked_at=NULL
 WHERE inviter_id=guard.actor() AND slot=@slot AND redeemed_by IS NULL;
 IF @@ROWCOUNT<>1 THROW 50002,'invite_unavailable',1;
END;
GO
CREATE PROCEDURE app.revoke_invite @slot tinyint
AS BEGIN
 SET NOCOUNT ON;
 IF guard.approved()<>1 THROW 50001,'forbidden',1;
 UPDATE app.invites SET revoked_at=SYSUTCDATETIME(),code_hash=NULL
 WHERE inviter_id=guard.actor() AND slot=@slot AND redeemed_by IS NULL;
 IF @@ROWCOUNT<>1 THROW 50002,'invite_unavailable',1;
END;
GO
CREATE PROCEDURE app.redeem_invite @hash binary(32)
WITH EXECUTE AS 'ofek_worker'
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON; BEGIN TRANSACTION;
 DECLARE @actor uniqueidentifier=guard.actor(),@inviter uniqueidentifier,@invite uniqueidentifier;
 IF NOT EXISTS(SELECT 1 FROM authn.accounts WITH(UPDLOCK,HOLDLOCK) WHERE id=@actor AND status='pending')
 OR NOT EXISTS(SELECT 1 FROM app.verifications WHERE member_id=@actor AND requested_kind='unit_member')
 THROW 50001,'verification_required',1;
 SELECT @inviter=i.inviter_id,@invite=i.id FROM app.invites i WITH(UPDLOCK,HOLDLOCK)
 JOIN authn.accounts a WITH(UPDLOCK,HOLDLOCK) ON a.id=i.inviter_id
 WHERE i.code_hash=@hash AND i.redeemed_by IS NULL AND i.revoked_at IS NULL
 AND i.inviter_id<>@actor AND a.status='approved' AND a.kind='unit_member';
 IF @inviter IS NULL THROW 50001,'invalid_invite',1;
 UPDATE app.invites SET redeemed_by=@actor,redeemed_at=SYSUTCDATETIME() WHERE id=@invite;
 EXEC authn.approve_account @actor,@inviter;
 COMMIT;
END;
GO
CREATE PROCEDURE app.save_job @data nvarchar(max),@id uniqueidentifier=NULL
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @actor uniqueidentifier=guard.actor();
 IF guard.approved()<>1 OR NOT EXISTS(SELECT 1 FROM authn.accounts WHERE id=@actor AND (can_post=1 OR is_admin=1)) THROW 50001,'forbidden',1;
 IF ISJSON(@data)<>1 OR JSON_QUERY(@data,'$.tech_tags') IS NULL THROW 50000,'invalid',1;
 IF (SELECT COUNT(*) FROM OPENJSON(@data,'$.tech_tags'))>30 THROW 50000,'invalid',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@data,'$.tech_tags') WHERE type<>1 OR LEN(value) NOT BETWEEN 1 AND 40) THROW 50000,'invalid',1;
 BEGIN TRANSACTION;
 DECLARE @new bit=CASE WHEN @id IS NULL THEN 1 ELSE 0 END;
 IF @id IS NULL SET @id=NEWID();
 IF @new=0 AND NOT EXISTS(SELECT 1 FROM app.jobs WITH(UPDLOCK,HOLDLOCK) WHERE id=@id AND deleted_at IS NULL
 AND (creator_id=@actor OR guard.admin()=1)) THROW 50001,'forbidden',1;
 DECLARE @v TABLE(title nvarchar(160),company nvarchar(120),city nvarchar(120),work_mode varchar(10),job_type varchar(12),
 seniority varchar(10),description nvarchar(max),salary_min decimal(12,2),salary_max decimal(12,2),
 salary_currency char(3),salary_period varchar(6),apply_method varchar(15),apply_email nvarchar(254),apply_url nvarchar(2000),referral_available bit);
 INSERT @v SELECT * FROM OPENJSON(@data) WITH(title nvarchar(160),company nvarchar(120),city nvarchar(120),
 work_mode varchar(10),job_type varchar(12),seniority varchar(10),description nvarchar(max),salary_min decimal(12,2),
 salary_max decimal(12,2),salary_currency char(3),salary_period varchar(6),apply_method varchar(15),
 apply_email nvarchar(254),apply_url nvarchar(2000),referral_available bit);
 IF @new=1 INSERT app.jobs(id,creator_id,title,company,city,work_mode,job_type,seniority,tech_tags,description,
 salary_min,salary_max,salary_currency,salary_period,apply_method,apply_email,apply_url,referral_available)
 SELECT @id,@actor,title,company,city,work_mode,job_type,seniority,JSON_QUERY(@data,'$.tech_tags'),description,
 salary_min,salary_max,salary_currency,salary_period,apply_method,apply_email,apply_url,referral_available FROM @v;
 ELSE UPDATE j SET title=v.title,company=v.company,city=v.city,work_mode=v.work_mode,job_type=v.job_type,seniority=v.seniority,
 tech_tags=JSON_QUERY(@data,'$.tech_tags'),description=v.description,salary_min=v.salary_min,salary_max=v.salary_max,
 salary_currency=v.salary_currency,salary_period=v.salary_period,apply_method=v.apply_method,apply_email=v.apply_email,
 apply_url=v.apply_url,referral_available=v.referral_available,updated_at=SYSUTCDATETIME()
 FROM app.jobs j CROSS JOIN @v v WHERE j.id=@id;
 COMMIT; SELECT @id AS id;
END;
GO
CREATE PROCEDURE app.job_action @id uniqueidentifier,@action varchar(10)
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON; BEGIN TRANSACTION;
 IF NOT EXISTS(SELECT 1 FROM app.jobs WITH(UPDLOCK,HOLDLOCK) WHERE id=@id AND deleted_at IS NULL
 AND (creator_id=guard.actor() OR guard.admin()=1)) THROW 50001,'forbidden',1;
 IF @action='renew' UPDATE app.jobs SET expires_at=DATEADD(day,60,SYSUTCDATETIME()),is_open=1,updated_at=SYSUTCDATETIME() WHERE id=@id;
 ELSE IF @action='close' UPDATE app.jobs SET is_open=0,updated_at=SYSUTCDATETIME() WHERE id=@id;
 ELSE IF @action='delete' UPDATE app.jobs SET deleted_at=SYSUTCDATETIME(),is_open=0 WHERE id=@id;
 ELSE THROW 50000,'invalid',1;
 INSERT app.audit_events(actor_id,action,entity_id) VALUES(guard.actor(),'job_'+@action,@id);
 UPDATE authn.email_outbox SET state='cancelled' WHERE reference_id=@id AND kind='job_expiring' AND state IN('pending','processing','failed');
 COMMIT;
END;
GO
CREATE PROCEDURE app.save_profile @data nvarchar(max)
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @actor uniqueidentifier=guard.actor();
 IF NOT EXISTS(SELECT 1 FROM authn.accounts WHERE id=@actor AND status='approved' AND can_seek=1) THROW 50001,'forbidden',1;
 IF ISJSON(@data)<>1 OR JSON_QUERY(@data,'$.skills') IS NULL OR JSON_QUERY(@data,'$.preferred_roles') IS NULL
 OR JSON_QUERY(@data,'$.preferred_locations') IS NULL THROW 50000,'invalid',1;
 IF (SELECT COUNT(*) FROM OPENJSON(@data,'$.skills'))>50 OR (SELECT COUNT(*) FROM OPENJSON(@data,'$.preferred_roles'))>15
 OR (SELECT COUNT(*) FROM OPENJSON(@data,'$.preferred_locations'))>15 THROW 50000,'invalid',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@data,'$.skills') WHERE type<>1 OR LEN(value) NOT BETWEEN 1 AND 40) THROW 50000,'invalid',1;
 DECLARE @v TABLE(full_name nvarchar(120),headline nvarchar(200),release_date date,already_released bit,
 years_experience decimal(4,1),linkedin_url nvarchar(500),github_url nvarchar(500),bio nvarchar(3000),status varchar(20));
 INSERT @v SELECT * FROM OPENJSON(@data) WITH(full_name nvarchar(120),headline nvarchar(200),release_date date,
 already_released bit,years_experience decimal(4,1),linkedin_url nvarchar(500),github_url nvarchar(500),bio nvarchar(3000),status varchar(20));
 BEGIN TRANSACTION;
 IF EXISTS(SELECT 1 FROM app.profiles WITH(UPDLOCK,HOLDLOCK) WHERE member_id=@actor)
 UPDATE p SET full_name=v.full_name,headline=v.headline,release_date=v.release_date,already_released=v.already_released,
 years_experience=v.years_experience,skills=JSON_QUERY(@data,'$.skills'),preferred_roles=JSON_QUERY(@data,'$.preferred_roles'),
 preferred_locations=JSON_QUERY(@data,'$.preferred_locations'),linkedin_url=v.linkedin_url,github_url=v.github_url,
 bio=v.bio,status=v.status,updated_at=SYSUTCDATETIME() FROM app.profiles p CROSS JOIN @v v WHERE p.member_id=@actor;
 ELSE INSERT app.profiles(member_id,full_name,headline,release_date,already_released,years_experience,skills,preferred_roles,
 preferred_locations,linkedin_url,github_url,bio,status)
 SELECT @actor,full_name,headline,release_date,already_released,years_experience,JSON_QUERY(@data,'$.skills'),
 JSON_QUERY(@data,'$.preferred_roles'),JSON_QUERY(@data,'$.preferred_locations'),linkedin_url,github_url,bio,status FROM @v;
 COMMIT;
END;
GO
CREATE PROCEDURE app.save_card @headline nvarchar(200),@title nvarchar(120),@company nvarchar(120),@published bit
AS BEGIN
 SET NOCOUNT ON;
 IF guard.approved()<>1 THROW 50001,'forbidden',1;
 UPDATE app.member_cards SET headline=@headline,current_title=@title,company=@company,published=@published,updated_at=SYSUTCDATETIME()
 WHERE member_id=guard.actor();
 IF @@ROWCOUNT<>1 THROW 50000,'verification_required',1;
END;
GO
CREATE PROCEDURE app.begin_cv @id uniqueidentifier,@filename nvarchar(200),@size int,@sha256 binary(32),@attested bit
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON; BEGIN TRANSACTION;
 DECLARE @actor uniqueidentifier=guard.actor();
 IF @attested<>1 OR @attested IS NULL THROW 50000,'attestation_required',1;
 IF NOT EXISTS(SELECT 1 FROM app.profiles WITH(UPDLOCK,HOLDLOCK) WHERE member_id=@actor AND moderated_at IS NULL) THROW 50001,'forbidden',1;
 IF (SELECT COUNT(*) FROM app.cv_documents WHERE owner_id=@actor AND state='pending')>=3 THROW 50003,'pending_upload_limit',1;
 INSERT app.cv_documents(id,owner_id,original_filename,byte_size,sha256) VALUES(@id,@actor,@filename,@size,@sha256);
 COMMIT;
 SELECT object_name FROM app.cv_documents WHERE id=@id;
END;
GO
CREATE PROCEDURE app.finish_cv @id uniqueidentifier
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON; BEGIN TRANSACTION;
 DECLARE @actor uniqueidentifier=guard.actor(),@old uniqueidentifier;
 SELECT @old=cv_document_id FROM app.profiles WITH(UPDLOCK,HOLDLOCK) WHERE member_id=@actor AND moderated_at IS NULL;
 IF NOT EXISTS(SELECT 1 FROM app.cv_documents WHERE id=@id AND owner_id=@actor AND state='pending') THROW 50001,'forbidden',1;
 UPDATE app.cv_documents SET state='ready',verified_at=SYSUTCDATETIME() WHERE id=@id;
 UPDATE app.profiles SET cv_document_id=@id,updated_at=SYSUTCDATETIME() WHERE member_id=@actor AND moderated_at IS NULL;
 IF @@ROWCOUNT<>1 THROW 50001,'forbidden',1;
 INSERT authn.blob_cleanup(object_name) SELECT object_name FROM app.cv_documents WHERE id=@old;
 DELETE app.cv_documents WHERE id=@old;
 COMMIT;
END;
GO
CREATE PROCEDURE app.remove_cv @id uniqueidentifier
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON; BEGIN TRANSACTION;
 IF NOT EXISTS(SELECT 1 FROM app.cv_documents WHERE id=@id AND (owner_id=guard.actor() OR guard.admin()=1)) THROW 50001,'forbidden',1;
 UPDATE app.profiles SET cv_document_id=NULL WHERE cv_document_id=@id;
 INSERT authn.blob_cleanup(object_name) SELECT object_name FROM app.cv_documents WHERE id=@id;
 DELETE app.cv_documents WHERE id=@id;
 COMMIT;
END;
GO
CREATE PROCEDURE app.profile_action @member uniqueidentifier,@action varchar(10)
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 IF guard.approved()<>1 OR (@member<>guard.actor() AND guard.admin()<>1) THROW 50001,'forbidden',1;
 BEGIN TRANSACTION;
 IF @action='delete' BEGIN
  UPDATE app.profiles SET cv_document_id=NULL WHERE member_id=@member;
  INSERT authn.blob_cleanup(object_name) SELECT object_name FROM app.cv_documents WHERE owner_id=@member;
  DELETE app.cv_documents WHERE owner_id=@member;
  DELETE authn.email_outbox WHERE kind='recommendation' AND reference_id IN(SELECT id FROM app.recommendations WHERE seeker_id=@member);
  DELETE app.recommendations WHERE seeker_id=@member;
  DELETE app.applications WHERE applicant_id=@member;
  DELETE app.profiles WHERE member_id=@member;
 END ELSE IF @action IN('moderate','restore') AND guard.admin()=1
  UPDATE app.profiles SET moderated_at=CASE WHEN @action='moderate' THEN SYSUTCDATETIME() ELSE NULL END WHERE member_id=@member;
 ELSE THROW 50000,'invalid',1;
 INSERT app.audit_events(actor_id,action,entity_id) VALUES(guard.actor(),'profile_'+@action,@member);
 COMMIT;
END;
GO
CREATE PROCEDURE app.apply @job uniqueidentifier
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON; BEGIN TRANSACTION;
 DECLARE @actor uniqueidentifier=guard.actor();
 IF NOT EXISTS(SELECT 1 FROM app.jobs WITH(UPDLOCK,HOLDLOCK) WHERE id=@job AND creator_id<>@actor AND is_open=1
 AND deleted_at IS NULL AND expires_at>SYSUTCDATETIME() AND apply_method='profile'
 AND EXISTS(SELECT 1 FROM authn.accounts WHERE id=creator_id AND status='approved')) THROW 50001,'job_unavailable',1;
 IF NOT EXISTS(SELECT 1 FROM app.profiles WHERE member_id=@actor AND status<>'hidden' AND moderated_at IS NULL) THROW 50000,'visible_profile_required',1;
 IF EXISTS(SELECT 1 FROM app.applications WHERE job_id=@job AND applicant_id=@actor) THROW 50002,'already_applied',1;
 INSERT app.applications(job_id,applicant_id) VALUES(@job,@actor);
 COMMIT;
END;
GO
CREATE PROCEDURE app.withdraw @job uniqueidentifier
AS BEGIN
 SET NOCOUNT ON;
 DELETE app.applications WHERE job_id=@job AND applicant_id=guard.actor();
 IF @@ROWCOUNT<>1 THROW 50004,'not_found',1;
END;
GO
CREATE PROCEDURE app.write_recommendation @seeker uniqueidentifier,@text nvarchar(4000),@relationship nvarchar(160)=NULL,@revision int=NULL
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON; BEGIN TRANSACTION;
 DECLARE @actor uniqueidentifier=guard.actor(),@id uniqueidentifier;
 IF guard.alumnus(@actor)<>1 OR @actor=@seeker THROW 50001,'alumni_only',1;
 IF NOT EXISTS(SELECT 1 FROM app.member_cards WHERE member_id=@actor AND published=1) THROW 50000,'published_card_required',1;
 SELECT @id=id FROM app.recommendations WITH(UPDLOCK,HOLDLOCK) WHERE author_id=@actor AND seeker_id=@seeker;
 IF @id IS NULL BEGIN
  IF NOT EXISTS(SELECT 1 FROM app.profiles WHERE member_id=@seeker AND status<>'hidden' AND moderated_at IS NULL) THROW 50001,'forbidden',1;
  SET @id=NEWID();
  INSERT app.recommendations(id,author_id,seeker_id,text,relationship) VALUES(@id,@actor,@seeker,@text,@relationship);
  INSERT authn.email_outbox(recipient_id,kind,reference_id,dedupe_key)
  VALUES(@seeker,'recommendation',@id,'recommendation:'+CONVERT(varchar(36),@id));
 END ELSE BEGIN
  IF @revision IS NULL OR NOT EXISTS(SELECT 1 FROM app.recommendations WHERE id=@id AND revision=@revision) THROW 50002,'stale_revision',1;
  UPDATE app.recommendations SET text=@text,relationship=@relationship,revision=revision+1,approved_revision=NULL,
  status=CASE WHEN status='hidden' THEN 'hidden' ELSE 'pending' END,updated_at=SYSUTCDATETIME()
  WHERE id=@id AND (text COLLATE Latin1_General_100_BIN2<>@text COLLATE Latin1_General_100_BIN2
  OR ISNULL(relationship,N'') COLLATE Latin1_General_100_BIN2<>ISNULL(@relationship,N'') COLLATE Latin1_General_100_BIN2);
 END;
 COMMIT;
END;
GO
CREATE PROCEDURE app.review_recommendation @id uniqueidentifier,@revision int,@status varchar(10)
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 IF @status NOT IN('approved','hidden') OR guard.approved()<>1 THROW 50001,'forbidden',1;
 BEGIN TRANSACTION;
 UPDATE app.recommendations SET status=@status,approved_revision=CASE WHEN @status='approved' THEN revision ELSE NULL END,
 updated_at=SYSUTCDATETIME() WHERE id=@id AND seeker_id=guard.actor() AND revision=@revision;
 IF @@ROWCOUNT<>1 THROW 50002,'stale_revision',1;
 UPDATE authn.email_outbox SET state='cancelled' WHERE reference_id=@id AND kind='recommendation' AND state IN('pending','failed','processing');
 COMMIT;
END;
GO
CREATE PROCEDURE app.delete_recommendation @id uniqueidentifier
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON; BEGIN TRANSACTION;
 IF NOT EXISTS(SELECT 1 FROM app.recommendations WHERE id=@id AND (author_id=guard.actor() OR seeker_id=guard.actor() OR guard.admin()=1))
 THROW 50001,'forbidden',1;
 DELETE authn.email_outbox WHERE kind='recommendation' AND reference_id=@id;
 DELETE app.recommendations WHERE id=@id;
 INSERT app.audit_events(actor_id,action,entity_id) VALUES(guard.actor(),'recommendation_deleted',@id);
 COMMIT;
END;
GO
CREATE PROCEDURE app.save_search @name nvarchar(100),@filters nvarchar(4000),@enabled bit,@id uniqueidentifier=NULL
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @actor uniqueidentifier=guard.actor();
 IF NOT EXISTS(SELECT 1 FROM authn.accounts WHERE id=@actor AND status='approved' AND can_seek=1) THROW 50001,'forbidden',1;
 BEGIN TRANSACTION;
 IF @id IS NULL BEGIN
  IF (SELECT COUNT(*) FROM app.saved_searches WITH(UPDLOCK,HOLDLOCK) WHERE owner_id=@actor)>=10 THROW 50003,'search_limit',1;
  INSERT app.saved_searches(owner_id,name,filters,email_enabled,consent_at)
  VALUES(@actor,@name,@filters,@enabled,CASE WHEN @enabled=1 THEN SYSUTCDATETIME() ELSE NULL END);
 END ELSE BEGIN
  UPDATE app.saved_searches SET name=@name,filters=@filters,email_enabled=@enabled,
  consent_at=CASE WHEN @enabled=1 THEN SYSUTCDATETIME() ELSE NULL END,
  next_digest_at=CASE WHEN email_enabled=0 AND @enabled=1 THEN DATEADD(day,7,SYSUTCDATETIME()) ELSE next_digest_at END
  WHERE id=@id AND owner_id=@actor;
  IF @@ROWCOUNT<>1 THROW 50001,'forbidden',1;
  IF @enabled=0 UPDATE authn.email_outbox SET state='cancelled' WHERE kind='weekly_digest' AND reference_id=@id AND state IN('pending','processing','failed');
 END;
 COMMIT;
END;
GO
CREATE PROCEDURE app.delete_search @id uniqueidentifier
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON; BEGIN TRANSACTION;
 IF NOT EXISTS(SELECT 1 FROM app.saved_searches WHERE id=@id AND owner_id=guard.actor()) THROW 50001,'forbidden',1;
 DELETE authn.email_outbox WHERE kind='weekly_digest' AND reference_id=@id;
 DELETE app.saved_searches WHERE id=@id;
 COMMIT;
END;
GO
CREATE PROCEDURE app.admin_stats
AS BEGIN
 SET NOCOUNT ON;
 IF guard.admin()<>1 THROW 50001,'forbidden',1;
 SELECT (SELECT COUNT(*) FROM authn.accounts WHERE status='approved') AS members,
 (SELECT COUNT(*) FROM authn.accounts WHERE status='pending') AS pending,
 (SELECT COUNT(*) FROM app.jobs WHERE deleted_at IS NULL AND is_open=1 AND expires_at>SYSUTCDATETIME()) AS active_jobs,
 (SELECT COUNT(*) FROM app.applications) AS applications,
 (SELECT COUNT(*) FROM app.recommendations) AS recommendations;
END;
GO
GRANT EXECUTE ON OBJECT::authn.request_link TO ofek_runtime;
GRANT EXECUTE ON OBJECT::authn.consume_link TO ofek_runtime;
GRANT EXECUTE ON OBJECT::authn.google_session TO ofek_runtime;
GRANT EXECUTE ON OBJECT::authn.me TO ofek_runtime;
GRANT EXECUTE ON OBJECT::authn.sign_out TO ofek_runtime;
GRANT EXECUTE ON SCHEMA::app TO ofek_runtime;
