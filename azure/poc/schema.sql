-- Isolated Azure SQL feasibility fixture, NOT the application's migrated schema.
-- All identities and jobs are synthetic. Apply once to ofek-jobs-poc only.
CREATE SCHEMA ofek_poc AUTHORIZATION dbo;
GO
CREATE TABLE ofek_poc.members (
    id uniqueidentifier NOT NULL PRIMARY KEY,
    status varchar(12) NOT NULL CHECK (status IN ('pending', 'approved', 'banned')),
    can_post bit NOT NULL DEFAULT 0,
    is_admin bit NOT NULL DEFAULT 0
);
CREATE TABLE ofek_poc.jobs (
    id uniqueidentifier NOT NULL DEFAULT NEWID() PRIMARY KEY,
    creator_id uniqueidentifier NOT NULL
        DEFAULT CONVERT(uniqueidentifier, SESSION_CONTEXT(N'member_id'))
        REFERENCES ofek_poc.members(id),
    title nvarchar(160) NOT NULL CHECK (LEN(LTRIM(RTRIM(title))) BETWEEN 3 AND 160),
    is_open bit NOT NULL DEFAULT 1,
    created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
    expires_at datetime2 NOT NULL DEFAULT DATEADD(day, 60, SYSUTCDATETIME())
);
INSERT INTO ofek_poc.members(id, status, can_post, is_admin) VALUES
('00000000-0000-4000-8000-000000000001', 'approved', 1, 1),
('00000000-0000-4000-8000-000000000002', 'approved', 1, 0),
('00000000-0000-4000-8000-000000000003', 'approved', 1, 0),
('00000000-0000-4000-8000-000000000004', 'pending', 0, 0),
('00000000-0000-4000-8000-000000000006', 'banned', 0, 0);
INSERT INTO ofek_poc.jobs(id, creator_id, title, is_open, expires_at) VALUES
('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
 N'Synthetic open software role', 1, DATEADD(day, 60, SYSUTCDATETIME())),
('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003',
 N'Synthetic second employer role', 1, DATEADD(day, 60, SYSUTCDATETIME())),
('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002',
 N'Synthetic expired role', 1, DATEADD(day, -1, SYSUTCDATETIME())),
('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000002',
 N'Synthetic closed role', 0, DATEADD(day, 60, SYSUTCDATETIME())),
('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000006',
 N'Synthetic banned author role', 1, DATEADD(day, 60, SYSUTCDATETIME()));
GO
CREATE FUNCTION ofek_poc.can_read_job(
    @creator_id uniqueidentifier, @is_open bit, @expires_at datetime2
)
RETURNS TABLE WITH SCHEMABINDING
AS RETURN
    SELECT 1 AS allowed
    FROM ofek_poc.members AS viewer
    WHERE viewer.id = TRY_CONVERT(uniqueidentifier, SESSION_CONTEXT(N'member_id'))
      AND viewer.status = 'approved'
      AND (
        viewer.is_admin = 1 OR viewer.id = @creator_id OR (
          @is_open = 1 AND @expires_at > SYSUTCDATETIME()
          AND EXISTS (
            SELECT 1 FROM ofek_poc.members AS poster
            WHERE poster.id = @creator_id AND poster.status = 'approved'
          )
        )
      );
GO
CREATE FUNCTION ofek_poc.can_write_job(@creator_id uniqueidentifier)
RETURNS TABLE WITH SCHEMABINDING
AS RETURN
    SELECT 1 AS allowed
    FROM ofek_poc.members AS actor
    WHERE actor.id = TRY_CONVERT(uniqueidentifier, SESSION_CONTEXT(N'member_id'))
      AND actor.status = 'approved'
      AND (actor.is_admin = 1 OR (actor.can_post = 1 AND actor.id = @creator_id));
GO
CREATE SECURITY POLICY ofek_poc.job_access
    ADD FILTER PREDICATE ofek_poc.can_read_job(creator_id, is_open, expires_at)
        ON ofek_poc.jobs,
    ADD BLOCK PREDICATE ofek_poc.can_write_job(creator_id) ON ofek_poc.jobs AFTER INSERT,
    ADD BLOCK PREDICATE ofek_poc.can_write_job(creator_id) ON ofek_poc.jobs BEFORE UPDATE,
    ADD BLOCK PREDICATE ofek_poc.can_write_job(creator_id) ON ofek_poc.jobs AFTER UPDATE,
    ADD BLOCK PREDICATE ofek_poc.can_write_job(creator_id) ON ofek_poc.jobs BEFORE DELETE
    WITH (STATE = ON, SCHEMABINDING = ON);
GO
CREATE PROCEDURE ofek_poc.create_job @title nvarchar(160)
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO ofek_poc.jobs(title) VALUES (@title);
END;
GO
CREATE USER ofek_poc_app WITHOUT LOGIN;
GRANT SELECT, DELETE ON OBJECT::ofek_poc.jobs TO ofek_poc_app;
GRANT UPDATE (title, is_open) ON OBJECT::ofek_poc.jobs TO ofek_poc_app;
GRANT EXECUTE ON OBJECT::ofek_poc.create_job TO ofek_poc_app;
