DECLARE @check sysname=(SELECT name FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('authn.email_outbox')
 AND parent_column_id=COLUMNPROPERTY(OBJECT_ID('authn.email_outbox'),'state','ColumnId'));
IF @check IS NULL THROW 50002,'outbox_state_constraint_missing',1;
DECLARE @ddl nvarchar(max)=N'ALTER TABLE authn.email_outbox DROP CONSTRAINT '+QUOTENAME(@check);
EXEC sys.sp_executesql @ddl;
ALTER TABLE authn.email_outbox ADD CONSTRAINT CK_email_delivery_state
 CHECK(state IN('pending','processing','sent','failed','cancelled','skipped'));
GO
CREATE TABLE authn.service_keys (name varchar(40) NOT NULL PRIMARY KEY, token_hash binary(32) NOT NULL);
GO
CREATE FUNCTION guard.worker_authorized() RETURNS bit WITH SCHEMABINDING
AS BEGIN RETURN CASE WHEN EXISTS(SELECT 1 FROM authn.service_keys WHERE name='delivery'
 AND token_hash=TRY_CONVERT(binary(32),SESSION_CONTEXT(N'worker_hash'))) THEN 1 ELSE 0 END; END;
GO
CREATE PROCEDURE app.community_stats
AS BEGIN
 SET NOCOUNT ON;
 IF guard.approved()<>1 THROW 50001,'forbidden',1;
 SELECT (SELECT COUNT(*) FROM authn.accounts WHERE status='approved') AS members,
 (SELECT COUNT(*) FROM app.job_cards WHERE available=1) AS active_jobs,
 (SELECT COUNT(*) FROM app.profile_cards WHERE discoverable=1 AND already_released=0
 AND release_date BETWEEN CONVERT(date,SYSUTCDATETIME()) AND DATEADD(month,3,CONVERT(date,SYSUTCDATETIME()))) AS releasing;
END;
GO
CREATE PROCEDURE authn.lease_mail
WITH EXECUTE AS 'ofek_worker'
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 IF guard.worker_authorized()<>1 THROW 50001,'forbidden',1;
 BEGIN TRANSACTION;
 DECLARE @lock int;
 EXEC @lock=sys.sp_getapplock @Resource='ofek-delivery',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
 IF @lock<0 THROW 50002,'busy',1;
 INSERT authn.email_outbox(recipient_id,kind,reference_id,dedupe_key)
 SELECT j.creator_id,'job_expiring',j.id,'renew:'+CONVERT(varchar(36),j.id)+':'+CONVERT(varchar(33),j.expires_at,126)
 FROM app.jobs j JOIN authn.accounts a ON a.id=j.creator_id WHERE a.status='approved' AND a.email NOT LIKE '%@example.invalid'
 AND j.deleted_at IS NULL AND j.is_open=1 AND j.expires_at>SYSUTCDATETIME() AND j.expires_at<=DATEADD(day,7,SYSUTCDATETIME())
 AND NOT EXISTS(SELECT 1 FROM authn.email_outbox WHERE dedupe_key='renew:'+CONVERT(varchar(36),j.id)+':'+CONVERT(varchar(33),j.expires_at,126));
 INSERT authn.email_outbox(recipient_id,kind,reference_id,dedupe_key)
 SELECT s.owner_id,'weekly_digest',s.id,'digest:'+CONVERT(varchar(36),s.id)+':'+CONVERT(varchar(33),s.next_digest_at,126)
 FROM app.saved_searches s JOIN authn.accounts a ON a.id=s.owner_id
 WHERE s.email_enabled=1 AND s.next_digest_at<=SYSUTCDATETIME() AND a.status='approved' AND a.can_seek=1
 AND a.email NOT LIKE '%@example.invalid'
 AND NOT EXISTS(SELECT 1 FROM authn.email_outbox WHERE dedupe_key='digest:'+CONVERT(varchar(36),s.id)+':'+CONVERT(varchar(33),s.next_digest_at,126));
 UPDATE o SET state='cancelled' FROM authn.email_outbox o JOIN authn.accounts a ON a.id=o.recipient_id
 WHERE o.state IN('pending','failed','processing') AND (a.status<>'approved' OR a.email LIKE '%@example.invalid');
 DECLARE @used int=(SELECT COUNT(*) FROM authn.email_outbox WHERE sent_at>DATEADD(day,-1,SYSUTCDATETIME())
 OR (state='processing' AND lease_until>SYSUTCDATETIME()));
 DECLARE @take int=CASE WHEN @used>=100 THEN 0 WHEN @used>95 THEN 100-@used ELSE 5 END;
 ;WITH batch AS (
  SELECT TOP(@take) * FROM authn.email_outbox WITH(UPDLOCK,READPAST,READCOMMITTEDLOCK)
  WHERE attempts<3 AND (state IN('pending','failed') OR (state='processing' AND lease_until<SYSUTCDATETIME()))
  ORDER BY created_at,id
 )
 UPDATE batch SET state='processing',attempts=attempts+1,lease_until=DATEADD(minute,10,SYSUTCDATETIME()),last_error=NULL
 OUTPUT inserted.id,inserted.kind,inserted.recipient_id,inserted.reference_id,inserted.attempts;
 DELETE authn.login_links WHERE expires_at<DATEADD(day,-1,SYSUTCDATETIME());
 DELETE authn.sessions WHERE expires_at<DATEADD(day,-7,SYSUTCDATETIME()) OR (revoked=1 AND created_at<DATEADD(day,-7,SYSUTCDATETIME()));
 DELETE authn.renewal_tokens WHERE expires_at<DATEADD(day,-7,SYSUTCDATETIME());
 INSERT authn.blob_cleanup(object_name)
 SELECT d.object_name FROM app.cv_documents d WHERE d.state='pending' AND d.created_at<DATEADD(hour,-1,SYSUTCDATETIME())
 AND NOT EXISTS(SELECT 1 FROM app.profiles WHERE cv_document_id=d.id)
 AND NOT EXISTS(SELECT 1 FROM authn.blob_cleanup c WHERE c.object_name=d.object_name);
 DELETE d FROM app.cv_documents d WHERE d.state='pending' AND d.created_at<DATEADD(hour,-1,SYSUTCDATETIME())
 AND NOT EXISTS(SELECT 1 FROM app.profiles WHERE cv_document_id=d.id);
 COMMIT;
END;
GO
CREATE PROCEDURE authn.mail_payload @id uniqueidentifier
WITH EXECUTE AS 'ofek_worker'
AS BEGIN
 SET NOCOUNT ON;
 IF guard.worker_authorized()<>1 THROW 50001,'forbidden',1;
 SELECT o.id,o.kind,o.reference_id,o.recipient_id,a.email,
 j.title AS job_title,j.expires_at AS job_expires_at,s.name AS search_name
 FROM authn.email_outbox o JOIN authn.accounts a ON a.id=o.recipient_id
 LEFT JOIN app.jobs j ON o.kind='job_expiring' AND j.id=o.reference_id
 LEFT JOIN app.saved_searches s ON o.kind='weekly_digest' AND s.id=o.reference_id
 LEFT JOIN app.recommendations r ON o.kind='recommendation' AND r.id=o.reference_id
 LEFT JOIN app.profiles p ON p.member_id=r.seeker_id
 WHERE o.id=@id AND o.state='processing' AND o.lease_until>SYSUTCDATETIME()
 AND a.status='approved' AND a.email NOT LIKE '%@example.invalid' AND (
  (o.kind='recommendation' AND r.status='pending' AND r.seeker_id=o.recipient_id
   AND guard.alumnus(r.author_id)=1 AND p.status<>'hidden' AND p.moderated_at IS NULL
   AND EXISTS(SELECT 1 FROM app.member_cards WHERE member_id=r.author_id AND published=1))
  OR (o.kind='job_expiring' AND j.creator_id=o.recipient_id AND j.deleted_at IS NULL AND j.is_open=1
   AND j.expires_at>SYSUTCDATETIME() AND j.expires_at<=DATEADD(day,7,SYSUTCDATETIME())
   AND o.dedupe_key='renew:'+CONVERT(varchar(36),j.id)+':'+CONVERT(varchar(33),j.expires_at,126))
  OR (o.kind='weekly_digest' AND s.owner_id=o.recipient_id AND s.email_enabled=1 AND a.can_seek=1)
 );
END;
GO
CREATE PROCEDURE authn.digest_jobs @id uniqueidentifier
WITH EXECUTE AS 'ofek_worker'
AS BEGIN
 SET NOCOUNT ON;
 IF guard.worker_authorized()<>1 THROW 50001,'forbidden',1;
 DECLARE @filters nvarchar(4000),@since datetime2,@until datetime2;
 SELECT @filters=s.filters,@since=COALESCE(s.last_digest_at,s.created_at),@until=o.created_at FROM authn.email_outbox o
 JOIN app.saved_searches s ON s.id=o.reference_id AND s.owner_id=o.recipient_id
 JOIN authn.accounts a ON a.id=s.owner_id
 WHERE o.id=@id AND o.kind='weekly_digest' AND o.state='processing' AND o.lease_until>SYSUTCDATETIME()
 AND a.status='approved' AND a.can_seek=1 AND s.email_enabled=1;
 IF @filters IS NULL THROW 50001,'forbidden',1;
 DECLARE @q nvarchar(200)=JSON_VALUE(@filters,'$.query'),@search nvarchar(200);
 SET @search=COALESCE(NULLIF(@q,N''),N'ofek_empty_search_sentinel');
 SELECT TOP(15) j.id,j.title,j.company FROM app.job_cards j WHERE j.available=1 AND j.created_at>@since AND j.created_at<=@until
 AND (ISNULL(@q,N'')=N'' OR j.id IN(SELECT id FROM app.jobs WHERE FREETEXT((title,company,description),@search,LANGUAGE 0)))
 AND (ISNULL(JSON_VALUE(@filters,'$.city'),N'')=N'' OR j.city=JSON_VALUE(@filters,'$.city'))
 AND (ISNULL(JSON_VALUE(@filters,'$.work_mode'),'')='' OR j.work_mode=JSON_VALUE(@filters,'$.work_mode'))
 AND (ISNULL(JSON_VALUE(@filters,'$.job_type'),'')='' OR j.job_type=JSON_VALUE(@filters,'$.job_type'))
 AND (ISNULL(JSON_VALUE(@filters,'$.seniority'),'')='' OR j.seniority=JSON_VALUE(@filters,'$.seniority'))
 AND (ISNULL(JSON_VALUE(@filters,'$.referral'),'')<>'1' OR j.referral_available=1)
 AND (NULLIF(JSON_VALUE(@filters,'$.days'),'') IS NULL OR j.created_at>=DATEADD(day,-CONVERT(int,JSON_VALUE(@filters,'$.days')),SYSUTCDATETIME()))
 AND NOT EXISTS(SELECT 1 FROM STRING_SPLIT(ISNULL(JSON_VALUE(@filters,'$.tags'),N''),',') f
 WHERE LEN(TRIM(f.value))>0 AND NOT EXISTS(SELECT 1 FROM OPENJSON(j.tech_tags) t WHERE t.value=TRIM(f.value)))
 ORDER BY j.created_at DESC,j.id;
END;
GO
CREATE PROCEDURE authn.store_renewal @outbox uniqueidentifier,@hash binary(32)
WITH EXECUTE AS 'ofek_worker'
AS BEGIN
 SET NOCOUNT ON;
 IF guard.worker_authorized()<>1 THROW 50001,'forbidden',1;
 INSERT authn.renewal_tokens(token_hash,job_id,poster_id,job_expires_at,expires_at)
 SELECT @hash,j.id,j.creator_id,j.expires_at,j.expires_at
 FROM authn.email_outbox o JOIN app.jobs j ON j.id=o.reference_id
 JOIN authn.accounts a ON a.id=j.creator_id
 WHERE o.id=@outbox AND o.kind='job_expiring' AND o.state='processing'
 AND o.lease_until>SYSUTCDATETIME() AND a.status='approved' AND j.deleted_at IS NULL AND j.is_open=1
 AND j.expires_at>SYSUTCDATETIME() AND j.expires_at<=DATEADD(day,7,SYSUTCDATETIME());
 IF @@ROWCOUNT<>1 THROW 50001,'forbidden',1;
END;
GO
CREATE PROCEDURE authn.redeem_renewal @hash binary(32)
WITH EXECUTE AS 'ofek_worker'
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON; BEGIN TRANSACTION;
 DECLARE @job uniqueidentifier,@poster uniqueidentifier,@expiry datetime2;
 SELECT @job=t.job_id,@poster=t.poster_id,@expiry=t.job_expires_at FROM authn.renewal_tokens t WITH(UPDLOCK,HOLDLOCK)
 JOIN authn.accounts a WITH(UPDLOCK,HOLDLOCK) ON a.id=t.poster_id
 WHERE t.token_hash=@hash AND t.used_at IS NULL AND t.expires_at>SYSUTCDATETIME() AND a.status='approved';
 IF @job IS NULL THROW 50001,'invalid_or_expired_link',1;
 UPDATE app.jobs SET expires_at=DATEADD(day,60,SYSUTCDATETIME()),is_open=1,updated_at=SYSUTCDATETIME()
 WHERE id=@job AND creator_id=@poster AND expires_at=@expiry AND deleted_at IS NULL;
 IF @@ROWCOUNT<>1 THROW 50001,'invalid_or_expired_link',1;
 UPDATE authn.renewal_tokens SET used_at=SYSUTCDATETIME() WHERE token_hash=@hash;
 UPDATE authn.email_outbox SET state='cancelled' WHERE reference_id=@job AND kind='job_expiring' AND state IN('pending','processing','failed');
 INSERT app.audit_events(actor_id,action,entity_id) VALUES(@poster,'job_renewed_by_link',@job);
 COMMIT;
END;
GO
CREATE PROCEDURE authn.finish_mail @id uniqueidentifier,@state varchar(12),@provider nvarchar(200)=NULL,@error nvarchar(500)=NULL
WITH EXECUTE AS 'ofek_worker'
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 IF guard.worker_authorized()<>1 THROW 50001,'forbidden',1;
 IF @state NOT IN('sent','failed','cancelled','skipped') THROW 50000,'invalid',1;
 BEGIN TRANSACTION;
 IF @state IN('sent','skipped') UPDATE s SET last_digest_at=o.created_at,next_digest_at=DATEADD(day,7,SYSUTCDATETIME())
 FROM app.saved_searches s JOIN authn.email_outbox o ON o.reference_id=s.id AND o.kind='weekly_digest'
 WHERE o.id=@id AND o.state='processing';
 UPDATE authn.email_outbox SET state=@state,lease_until=NULL,provider_id=@provider,last_error=@error,
 sent_at=CASE WHEN @state='sent' THEN SYSUTCDATETIME() ELSE NULL END WHERE id=@id AND state='processing';
 COMMIT;
END;
GO
CREATE PROCEDURE authn.cleanup_objects @path varchar(80)=NULL,@error nvarchar(500)=NULL
WITH EXECUTE AS 'ofek_worker'
AS BEGIN
 SET NOCOUNT ON;
 IF guard.worker_authorized()<>1 THROW 50001,'forbidden',1;
 IF @path IS NOT NULL BEGIN
  IF @error IS NULL DELETE authn.blob_cleanup WHERE object_name=@path;
  ELSE UPDATE authn.blob_cleanup SET attempts=attempts+1,last_error=@error WHERE object_name=@path;
 END;
 SELECT TOP(20) object_name FROM authn.blob_cleanup WHERE attempts<5 ORDER BY created_at;
END;
GO
GRANT EXECUTE ON OBJECT::authn.lease_mail TO ofek_runtime;
GRANT EXECUTE ON OBJECT::authn.mail_payload TO ofek_runtime;
GRANT EXECUTE ON OBJECT::authn.digest_jobs TO ofek_runtime;
GRANT EXECUTE ON OBJECT::authn.store_renewal TO ofek_runtime;
GRANT EXECUTE ON OBJECT::authn.redeem_renewal TO ofek_runtime;
GRANT EXECUTE ON OBJECT::authn.finish_mail TO ofek_runtime;
GRANT EXECUTE ON OBJECT::authn.cleanup_objects TO ofek_runtime;
