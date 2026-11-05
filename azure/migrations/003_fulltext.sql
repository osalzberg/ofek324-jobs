IF NOT EXISTS(SELECT 1 FROM sys.fulltext_catalogs WHERE name=N'ofek_search')
 CREATE FULLTEXT CATALOG ofek_search WITH ACCENT_SENSITIVITY=OFF;
GO
IF NOT EXISTS(SELECT 1 FROM sys.fulltext_indexes WHERE object_id=OBJECT_ID(N'app.jobs'))
 CREATE FULLTEXT INDEX ON app.jobs(title LANGUAGE 0,company LANGUAGE 0,description LANGUAGE 0)
 KEY INDEX PK_jobs ON ofek_search WITH CHANGE_TRACKING AUTO;
