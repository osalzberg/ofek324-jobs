CREATE OR ALTER PROCEDURE app.admin_members @offset int=0
AS BEGIN
 SET NOCOUNT ON;
 IF guard.admin()<>1 THROW 50001,'forbidden',1;
 IF @offset<0 THROW 50000,'invalid',1;
 SELECT a.id,a.email,a.status,a.kind,a.is_admin,a.invited_by,a.created_at,v.full_name,v.unit_start_year,v.unit_end_year,
 v.release_date,v.already_released,v.linkedin_url,v.requested_kind
 FROM authn.accounts a LEFT JOIN app.verifications v ON v.member_id=a.id
 ORDER BY CASE WHEN a.status='pending' THEN 0 ELSE 1 END,a.created_at DESC,a.id
 OFFSET @offset ROWS FETCH NEXT 24 ROWS ONLY;
END;
GO
CREATE OR ALTER PROCEDURE app.admin_stats
AS BEGIN
 SET NOCOUNT ON;
 IF guard.admin()<>1 THROW 50001,'forbidden',1;
 SELECT (SELECT COUNT(*) FROM authn.accounts WHERE status='approved') AS members,
 (SELECT COUNT(*) FROM authn.accounts WHERE status='pending') AS pending,
 (SELECT COUNT(*) FROM app.job_cards WHERE available=1) AS active_jobs,
 (SELECT COUNT(*) FROM app.applications) AS applications,
 (SELECT COUNT(*) FROM app.recommendations) AS recommendations;
END;
GO
CREATE OR ALTER PROCEDURE app.admin_decide @member uniqueidentifier,@decision varchar(10),@reason nvarchar(1000)=NULL
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
  UPDATE app.saved_searches SET email_enabled=0,consent_at=NULL WHERE owner_id=@member;
  UPDATE authn.email_outbox SET state='cancelled' WHERE recipient_id=@member AND state IN('pending','failed','processing');
  INSERT app.audit_events(actor_id,action,entity_id,reason) VALUES(guard.actor(),@decision,@member,@reason);
 END ELSE THROW 50000,'invalid',1;
 COMMIT;
END;
