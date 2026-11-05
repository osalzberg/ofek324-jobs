CREATE USER ofek_web WITH SID=0xa10075ceccf49843b8b2a6bbf4da4512, TYPE=E;
ALTER ROLE ofek_runtime ADD MEMBER ofek_web;
GO
-- Explicit operator bootstrap, not first-user promotion or a browser allowlist.
-- This is a management account, not a claim of military service or alumni status.
IF NOT EXISTS(SELECT 1 FROM authn.accounts WHERE email=N'osalzberg@gmail.com')
 INSERT authn.accounts(email,status,can_post,is_admin,approved_at)
 VALUES(N'osalzberg@gmail.com','approved',1,1,SYSUTCDATETIME());
