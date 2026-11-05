-- SQL matches service principals by application/client ID, unlike Blob RBAC,
-- which uses the principal/object ID. Recreate only the original runtime user.
IF NOT EXISTS(SELECT 1 FROM sys.database_principals WHERE name=N'ofek_web'
 AND sid=0xa10075ceccf49843b8b2a6bbf4da4512 AND type='E')
 THROW 50002,'unexpected_runtime_identity',1;
DROP USER ofek_web;
CREATE USER ofek_web WITH SID=0xe0b148072e0c7f43b365d1b2b58ed9aa, TYPE=E;
ALTER ROLE ofek_runtime ADD MEMBER ofek_web;
