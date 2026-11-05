import { createHash, randomBytes, randomUUID } from "node:crypto";
import { query, TYPES } from "./client.mjs";
export const digest = value => createHash("sha256").update(value).digest();
export async function createFixtures(connection) {
  const run = randomUUID().slice(0, 8), members = {};
  for (const role of ["poster", "seeker", "alumnus", "pending", "hidden", "recruiter", "admin", "banned", "invitee"]) {
    const id = randomUUID(), session = randomBytes(32).toString("base64url");
    members[role] = { id, session, email: `ofek-${run}-${role}@example.invalid` };
    await query(connection, `INSERT authn.accounts(id,email,is_admin) VALUES(@id,@email,@admin);
      INSERT app.verifications(member_id,full_name,requested_kind,unit_start_year,unit_end_year,release_date,already_released,linkedin_url)
      VALUES(@id,@name,@kind,CASE WHEN @external=1 THEN NULL ELSE 2018 END,CASE WHEN @external=1 THEN NULL ELSE 2026 END,
      CASE WHEN @external=1 THEN NULL ELSE DATEADD(month,2,CONVERT(date,SYSUTCDATETIME())) END,@released,'https://www.linkedin.com/in/synthetic-ofek-test');
      INSERT authn.sessions(token_hash,member_id) VALUES(@hash,@id);`, [
      ["id", TYPES.UniqueIdentifier, id], ["email", TYPES.NVarChar, members[role].email],
      ["name", TYPES.NVarChar, `[בדיקה] ${role}`], ["admin", TYPES.Bit, role === "admin"],
      ["kind", TYPES.VarChar, role === "recruiter" ? "external_recruiter" : "unit_member"],
      ["external", TYPES.Bit, role === "recruiter"],
      ["released", TYPES.Bit, !["seeker", "recruiter", "pending", "invitee"].includes(role)],
      ["hash", TYPES.Binary, digest(session)],
    ]);
    if (!["pending", "invitee"].includes(role)) await query(connection, `BEGIN TRANSACTION; EXEC authn.approve_account @id; COMMIT;
      UPDATE app.member_cards SET headline=N'Synthetic developer',company=N'Demo only',published=1 WHERE member_id=@id;`,
    [["id", TYPES.UniqueIdentifier, id]]);
  }
  for (const role of ["seeker", "hidden", "alumnus"]) await query(connection, `INSERT app.profiles
    (member_id,full_name,headline,release_date,already_released,years_experience,skills,preferred_roles,preferred_locations,bio,status)
    VALUES(@id,@name,N'Synthetic software developer',DATEADD(month,2,CONVERT(date,SYSUTCDATETIME())),@released,3,
      N'["python","react"]',N'["Developer"]',N'["תל אביב","מרחוק"]',N'נתונים סינתטיים לבדיקת האפליקציה בלבד.',@status);`, [
    ["id", TYPES.UniqueIdentifier, members[role].id], ["name", TYPES.NVarChar, `[בדיקה] ${role}`],
    ["released", TYPES.Bit, role !== "seeker"], ["status", TYPES.VarChar, role === "hidden" ? "hidden" : "actively_looking"],
  ]);
  await query(connection, "UPDATE authn.accounts SET status='banned' WHERE id=@id;", [["id", TYPES.UniqueIdentifier, members.banned.id]]);
  return { run, members };
}
export async function cleanupFixtures(connection, fixtures) {
  const ids = JSON.stringify(Object.values(fixtures.members).map(member => member.id));
  await query(connection, `IF @@TRANCOUNT>0 ROLLBACK;
    DECLARE @ids TABLE(id uniqueidentifier PRIMARY KEY); INSERT @ids SELECT value FROM OPENJSON(@ids_json);
    BEGIN TRANSACTION;
    DELETE authn.email_outbox WHERE recipient_id IN(SELECT id FROM @ids);
    DELETE authn.renewal_tokens WHERE poster_id IN(SELECT id FROM @ids);
    DELETE app.applications WHERE applicant_id IN(SELECT id FROM @ids) OR job_id IN(SELECT id FROM app.jobs WHERE creator_id IN(SELECT id FROM @ids));
    DELETE app.recommendations WHERE author_id IN(SELECT id FROM @ids) OR seeker_id IN(SELECT id FROM @ids);
    UPDATE app.profiles SET cv_document_id=NULL WHERE member_id IN(SELECT id FROM @ids);
    DELETE authn.blob_cleanup WHERE LEFT(object_name,36) IN(SELECT CONVERT(varchar(36),id) FROM @ids);
    DELETE app.cv_documents WHERE owner_id IN(SELECT id FROM @ids);
    DELETE app.profiles WHERE member_id IN(SELECT id FROM @ids);
    DELETE app.jobs WHERE creator_id IN(SELECT id FROM @ids);
    DELETE app.saved_searches WHERE owner_id IN(SELECT id FROM @ids);
    DELETE app.member_cards WHERE member_id IN(SELECT id FROM @ids);
    DELETE app.invites WHERE inviter_id IN(SELECT id FROM @ids) OR redeemed_by IN(SELECT id FROM @ids);
    DELETE app.verifications WHERE member_id IN(SELECT id FROM @ids);
    DELETE authn.login_links WHERE email IN(SELECT email FROM authn.accounts WHERE id IN(SELECT id FROM @ids));
    DELETE authn.sessions WHERE member_id IN(SELECT id FROM @ids);
    DELETE app.audit_events WHERE actor_id IN(SELECT id FROM @ids) OR entity_id IN(SELECT id FROM @ids);
    DELETE authn.accounts WHERE id IN(SELECT id FROM @ids);
    COMMIT;`, [["ids_json", TYPES.NVarChar, ids]]);
}
export function runtime(connection, fixtures) {
  return async (role, sql, parameters = []) => {
    await query(connection, "EXEC sys.sp_set_session_context @key=N'session_hash',@value=@hash;",
      [["hash", TYPES.Binary, role ? digest(fixtures.members[role].session) : Buffer.alloc(32)]]);
    await query(connection, "EXECUTE AS USER=N'ofek_test_runtime';");
    try { return await query(connection, sql, parameters); }
    catch (error) { await query(connection, "IF @@TRANCOUNT>0 ROLLBACK;"); throw error; }
    finally { await query(connection, "REVERT;"); }
  };
}
export const jobData = {
  title: "[בדיקה] Phoenix developer", company: "Synthetic only", city: "תל אביב", work_mode: "hybrid",
  job_type: "full_time", seniority: "junior", tech_tags: ["python", "react"],
  description: "Synthetic Phoenix software engineering vacancy. No real employer or military information.",
  salary_min: 15000, salary_max: 20000, salary_currency: "ILS", salary_period: "month",
  apply_method: "profile", apply_email: null, apply_url: null, referral_available: true,
};
