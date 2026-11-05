import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { connect, query, TYPES } from "./client.mjs";
import { cleanupFixtures, createFixtures, digest, jobData, runtime } from "./fixtures.mjs";
const c = await connect();
let fixtures, checks = 0;
const check = (condition, name) => { assert.ok(condition, name); checks++; console.log(`PASS ${name}`); };
const blocked = async (operation, name) => { await assert.rejects(operation); checks++; console.log(`PASS ${name}`); };
const idParam = id => [["id", TYPES.UniqueIdentifier, id]];
try {
  fixtures = await createFixtures(c);
  const as = runtime(c, fixtures), m = fixtures.members;
  check((await as("seeker", "SELECT USER_NAME() AS name;"))[0].name === "ofek_test_runtime", "tests execute as restricted runtime");
  await blocked(() => as("seeker", "SELECT * FROM authn.accounts;"), "private auth table is not readable");
  await blocked(() => as("seeker", "UPDATE authn.accounts SET is_admin=1;"), "direct privilege escalation is denied");
  await blocked(() => as("seeker", "SELECT code_hash FROM app.invites;"), "invitation hashes are private");
  await blocked(() => as("seeker", "UPDATE app.profiles SET status='hidden';"), "direct writes require guarded commands");
  const [job] = await as("poster", "EXEC app.save_job @data;", [["data", TYPES.NVarChar, JSON.stringify(jobData)]]);
  const jobId = job.id.toLowerCase();
  for (const role of [null, "pending", "banned"]) {
    check((await as(role, "SELECT id FROM app.jobs WHERE id=@id;", idParam(jobId))).length === 0, `${role ?? "anonymous"} cannot read jobs`);
    check((await as(role, "SELECT member_id FROM app.profiles WHERE member_id=@id;", idParam(m.seeker.id))).length === 0, `${role ?? "anonymous"} cannot read profiles`);
    await blocked(() => as(role, "EXEC app.save_job @data;", [["data", TYPES.NVarChar, JSON.stringify(jobData)]]), `${role ?? "anonymous"} cannot post`);
  }
  check((await as("seeker", "SELECT id FROM app.jobs WHERE id=@id;", idParam(jobId))).length === 1, "approved members can read active jobs");
  await blocked(() => as("seeker", "EXEC app.job_action @id,'delete';", idParam(jobId)), "non-owner cannot delete job");
  await blocked(() => as("seeker", "EXEC app.save_job @data,@id;", [["data", TYPES.NVarChar, JSON.stringify(jobData)], ...idParam(jobId)]), "non-owner cannot edit job");
  await as("poster", "EXEC app.save_job @data,@id;", [["data", TYPES.NVarChar, JSON.stringify({ ...jobData, title: "[בדיקה] Phoenix developer updated" })], ...idParam(jobId)]);
  check((await as("poster", "SELECT title FROM app.jobs WHERE id=@id;", idParam(jobId)))[0].title.endsWith("updated"), "owner can edit");
  check((await as("poster", "SELECT member_id FROM app.profiles WHERE member_id=@id;", idParam(m.hidden.id))).length === 0, "hidden profile is private");
  await as("seeker", "EXEC app.apply @id;", idParam(jobId));
  check((await as("poster", "SELECT id FROM app.applications WHERE job_id=@id;", idParam(jobId))).length === 1, "poster sees applications");
  check((await as("alumnus", "SELECT id FROM app.applications WHERE job_id=@id;", idParam(jobId))).length === 0, "unrelated member cannot see applications");
  await blocked(() => as("seeker", "EXEC app.apply @id;", idParam(jobId)), "duplicate application is rejected");
  await blocked(() => as("hidden", "EXEC app.apply @id;", idParam(jobId)), "hidden profile cannot apply");
  const cv = randomUUID(), sha = digest("synthetic-pdf");
  await blocked(() => as("seeker", "EXEC app.begin_cv @id,N'test.pdf',50,@sha,0;", [...idParam(cv), ["sha", TYPES.Binary, sha]]), "CV requires publication attestation");
  await as("seeker", "EXEC app.begin_cv @id,N'test.pdf',50,@sha,1;", [...idParam(cv), ["sha", TYPES.Binary, sha]]);
  check((await as("poster", "SELECT id FROM app.cv_documents WHERE id=@id;", idParam(cv))).length === 0, "pending CV is private");
  await as("seeker", "EXEC app.finish_cv @id;", idParam(cv));
  check((await as("poster", "SELECT id FROM app.cv_documents WHERE id=@id;", idParam(cv))).length === 1, "ready CV is visible to approved members");
  await query(c, "UPDATE app.profiles SET status='hidden' WHERE member_id=@id;", idParam(m.seeker.id));
  check((await as("poster", "SELECT id FROM app.cv_documents WHERE id=@id;", idParam(cv))).length === 0, "hiding profile revokes new CV access");
  check((await as("poster", "SELECT full_name FROM app.applicant_cards WHERE job_id=@id;", idParam(jobId)))[0].full_name === null, "applicant list respects hidden profiles");
  await query(c, "UPDATE app.profiles SET status='actively_looking' WHERE member_id=@id;", idParam(m.seeker.id));
  const recParams = [["seeker", TYPES.UniqueIdentifier, m.seeker.id], ["text", TYPES.NVarChar, "Synthetic recommendation for a capable software developer."]];
  for (const role of ["seeker", "recruiter", "pending"]) await blocked(() => as(role, "EXEC app.write_recommendation @seeker,@text;", recParams), `${role} cannot impersonate verified alumnus`);
  await blocked(() => as("alumnus", "EXEC app.write_recommendation @seeker,@text;", [["seeker", TYPES.UniqueIdentifier, m.alumnus.id], recParams[1]]), "self recommendation is rejected");
  await as("alumnus", "EXEC app.write_recommendation @seeker,@text;", recParams);
  const [rec] = await as("seeker", "SELECT id,revision FROM app.recommendations WHERE seeker_id=@id;", idParam(m.seeker.id));
  check((await as("poster", "SELECT id FROM app.recommendations WHERE id=@id;", idParam(rec.id))).length === 0, "pending recommendation is private");
  await blocked(() => as("admin", "EXEC app.review_recommendation @id,1,'approved';", idParam(rec.id)), "admin cannot approve another person's recommendation");
  await as("seeker", "EXEC app.review_recommendation @id,1,'approved';", idParam(rec.id));
  check((await as("poster", "SELECT recommendation_count FROM app.profile_cards WHERE member_id=@id;", idParam(m.seeker.id)))[0].recommendation_count === 1, "approved recommendation count appears");
  await as("alumnus", "EXEC app.write_recommendation @seeker,@text,NULL,1;", recParams);
  check((await as("seeker", "SELECT status,revision FROM app.recommendations WHERE id=@id;", idParam(rec.id)))[0].status === "approved", "no-op edit preserves approval");
  await as("alumnus", "EXEC app.write_recommendation @seeker,@text,NULL,1;", [recParams[0], ["text", TYPES.NVarChar, "Edited synthetic recommendation requiring fresh recipient approval."]]);
  check((await as("poster", "SELECT recommendation_count FROM app.profile_cards WHERE member_id=@id;", idParam(m.seeker.id)))[0].recommendation_count === 0, "content edit removes approval");
  await blocked(() => as("seeker", "EXEC app.review_recommendation @id,1,'approved';", idParam(rec.id)), "stale approval revision is rejected");
  await as("seeker", "EXEC app.review_recommendation @id,2,'hidden';", idParam(rec.id));
  await as("alumnus", "EXEC app.write_recommendation @seeker,@text,NULL,2;", recParams);
  check((await as("seeker", "SELECT status FROM app.recommendations WHERE id=@id;", idParam(rec.id)))[0].status === "hidden", "author edit cannot unhide recommendation");
  check((await as("alumnus", "SELECT id FROM app.invites;")).length === 5, "verified unit member has five invite slots");
  const invite = digest(randomBytes(32));
  await as("alumnus", "EXEC app.issue_invite 1,@hash;", [["hash", TYPES.Binary, invite]]);
  await as("pending", "EXEC app.redeem_invite @hash;", [["hash", TYPES.Binary, invite]]);
  check((await as("pending", "EXEC authn.me;"))[0].status === "approved", "valid invite approves a submitted unit member");
  check((await query(c, "SELECT invited_by FROM authn.accounts WHERE id=@id;", idParam(m.pending.id)))[0].invited_by.toLowerCase() === m.alumnus.id, "inviter relationship is retained");
  await blocked(() => as("invitee", "EXEC app.redeem_invite @hash;", [["hash", TYPES.Binary, invite]]), "invitation cannot be replayed");
  await blocked(() => as("alumnus", "EXEC app.issue_invite 6,@hash;", [["hash", TYPES.Binary, digest(randomBytes(32))]]), "sixth invite slot is rejected");
  await blocked(() => as("recruiter", "EXEC app.issue_invite 1,@hash;", [["hash", TYPES.Binary, digest(randomBytes(32))]]), "external recruiters cannot issue invites");
  await blocked(() => as("seeker", "EXEC app.admin_members;"), "member cannot access admin directory");
  await blocked(() => as("admin", "EXEC app.admin_decide @id,'ban';", idParam(m.admin.id)), "admin cannot ban self");
  await as("admin", "EXEC app.profile_action @id,'moderate';", idParam(m.seeker.id));
  check((await as("poster", "SELECT member_id FROM app.profiles WHERE member_id=@id;", idParam(m.seeker.id))).length === 0, "moderated profile is hidden");
  await as("admin", "EXEC app.profile_action @id,'restore';", idParam(m.seeker.id));
  await as("seeker", "EXEC app.save_search N'Test search',N'{\"tags\":\"python\"}',1;");
  check((await as("poster", "SELECT id FROM app.saved_searches;")).length === 0, "saved searches are owner-only");
  await blocked(() => as("seeker", "EXEC authn.lease_mail;"), "delivery worker requires a separate secret");
  await query(c, "BEGIN TRANSACTION;");
  const worker = digest(randomBytes(32));
  await query(c, `MERGE authn.service_keys t USING(SELECT 'delivery' AS name,@hash AS token_hash) s ON t.name=s.name
    WHEN MATCHED THEN UPDATE SET token_hash=s.token_hash WHEN NOT MATCHED THEN INSERT(name,token_hash) VALUES(s.name,s.token_hash);
    EXEC sys.sp_set_session_context @key=N'worker_hash',@value=@hash;
    UPDATE authn.accounts SET email='synthetic@ofek.test' WHERE id=@id;
    UPDATE authn.accounts SET email='poster@ofek.test' WHERE id=@poster;
    UPDATE app.jobs SET expires_at=DATEADD(day,6,SYSUTCDATETIME()) WHERE id=@idjob;
    UPDATE app.saved_searches SET next_digest_at=DATEADD(day,-1,SYSUTCDATETIME()),created_at=DATEADD(day,-1,SYSUTCDATETIME()) WHERE owner_id=@id;`, [
    ["hash", TYPES.Binary, worker], ...idParam(m.seeker.id), ["idjob", TYPES.UniqueIdentifier, jobId], ["poster", TYPES.UniqueIdentifier, m.poster.id],
  ]);
  const leased = await as("seeker", "EXEC authn.lease_mail;");
  check(leased.some(item => item.kind === "weekly_digest"), "worker schedules and leases due digest");
  const outbox = leased.find(item => item.kind === "weekly_digest");
  const reminder = leased.find(item => item.kind === "job_expiring");
  check(Boolean(reminder), "worker schedules seven-day job reminder");
  check((await as("seeker", "EXEC authn.mail_payload @id;", idParam(reminder.id))).length === 1, "reminder payload revalidates the poster and exact expiry");
  check((await as("seeker", "EXEC authn.mail_payload @id;", idParam(outbox.id))).length === 1, "worker revalidates eligible recipient");
  check((await as("seeker", "EXEC authn.digest_jobs @id;", idParam(outbox.id))).some(row => row.id.toLowerCase() === jobId), "digest uses saved tags and delivery watermark");
  await as("seeker", "EXEC authn.finish_mail @id,'skipped';", idParam(outbox.id));
  check((await as("seeker", "SELECT next_digest_at FROM app.saved_searches;"))[0].next_digest_at > new Date(), "empty digest can advance without pretending email was sent");
  const renewal = digest(randomBytes(32));
  await as("seeker", "EXEC authn.store_renewal @id,@hash;", [...idParam(reminder.id), ["hash", TYPES.Binary, renewal]]);
  await as(null, "EXEC authn.redeem_renewal @hash;", [["hash", TYPES.Binary, renewal]]);
  const [renewed] = await query(c, "SELECT DATEDIFF(second,SYSUTCDATETIME(),expires_at) remaining FROM app.jobs WHERE id=@id;", idParam(jobId));
  check(renewed.remaining >= 5183990 && renewed.remaining <= 5184000, "email renewal resets expiry to exactly sixty days");
  await blocked(() => as(null, "EXEC authn.redeem_renewal @hash;", [["hash", TYPES.Binary, renewal]]), "email renewal cannot be replayed");
  await query(c, "IF @@TRANCOUNT>0 ROLLBACK; EXEC sys.sp_set_session_context @key=N'worker_hash',@value=NULL;");
  const magic = digest(randomBytes(32)), challenge = digest(randomBytes(32));
  await as(null, "EXEC authn.request_link @email,@token,@challenge,@ip;", [
    ["email", TYPES.NVarChar, m.invitee.email], ["token", TYPES.Binary, magic], ["challenge", TYPES.Binary, challenge], ["ip", TYPES.Binary, digest(randomBytes(32))],
  ]);
  await blocked(() => as(null, "EXEC authn.consume_link @token,@challenge,@session;", [
    ["token", TYPES.Binary, magic], ["challenge", TYPES.Binary, digest("wrong")], ["session", TYPES.Binary, digest(randomBytes(32))],
  ]), "magic link requires the same-browser challenge");
  await as(null, "EXEC authn.consume_link @token,@challenge,@session;", [
    ["token", TYPES.Binary, magic], ["challenge", TYPES.Binary, challenge], ["session", TYPES.Binary, digest(randomBytes(32))],
  ]);
  await blocked(() => as(null, "EXEC authn.consume_link @token,@challenge,@session;", [
    ["token", TYPES.Binary, magic], ["challenge", TYPES.Binary, challenge], ["session", TYPES.Binary, digest(randomBytes(32))],
  ]), "magic link cannot be replayed");
  await query(c, "UPDATE app.jobs SET expires_at=DATEADD(day,-1,SYSUTCDATETIME()) WHERE id=@id;", idParam(jobId));
  check((await as("seeker", "SELECT id FROM app.jobs WHERE id=@id;", idParam(jobId))).length === 0, "expired jobs disappear from discovery");
  await as("poster", "EXEC app.job_action @id,'renew';", idParam(jobId));
  check((await as("seeker", "SELECT id FROM app.jobs WHERE id=@id;", idParam(jobId))).length === 1, "owner can renew expired job");
  await as("admin", "EXEC app.admin_decide @id,'ban';", idParam(m.poster.id));
  check((await as("seeker", "SELECT id FROM app.jobs WHERE id=@id;", idParam(jobId))).length === 0, "banning poster immediately removes jobs");
  check((await as("poster", "EXEC authn.me;")).length === 0, "ban revokes existing sessions");
  console.log(`PASS ${checks} full-application Azure SQL authorization checks`);
} finally {
  try { if (fixtures) await cleanupFixtures(c, fixtures); } finally { c.close(); }
}
