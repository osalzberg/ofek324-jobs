import assert from "node:assert/strict";
import { before, after, beforeEach, afterEach, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const user = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const job = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const searchId = "30000000-0000-4000-8000-000000000001";
const recommendation = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const root = new URL("../", import.meta.url);
const sql = (text, params = []) => db.query(text, params);
const rows = async (text, params = []) => (await sql(text, params)).rows;
const count = async (table) => Number((await rows(`select count(*) as n from ${table}`))[0].n);

async function asUser(id, action, role = "authenticated") {
  assert.ok(["authenticated", "anon", "service_role"].includes(role));
  await db.exec("savepoint actor");
  try {
    await sql("select set_config('request.jwt.claim.sub', $1, true)", [id ?? ""]);
    await db.exec(`set local role ${role}`);
    const result = await action();
    await db.exec("reset role");
    await sql("select set_config('request.jwt.claim.sub', '', true)");
    await db.exec("release savepoint actor");
    return result;
  } catch (error) {
    await db.exec("rollback to savepoint actor; release savepoint actor");
    throw error;
  }
}

async function denied(action, code = "42501") {
  await assert.rejects(action, (error) => {
    assert.equal(error.code, code, error.message);
    return true;
  });
}

async function createJob() {
  return (await rows(`insert into public.jobs
    (title, company, work_mode, job_type, seniority, description, apply_method)
    values ('Test developer', 'Example', 'remote', 'full_time', 'junior',
      'A synthetic software engineering vacancy for testing.', 'profile') returning *`))[0];
}

async function stageCv(owner = 3, size = 5242880) {
  return asUser(user(owner), async () => (await rows(
    "select * from public.begin_cv_upload('resume.pdf', $1, true)", [size],
  ))[0]);
}

async function finishCv(document) {
  await sql("insert into storage.objects(bucket_id, name) values ('cvs', $1)", [document.object_name]);
  await asUser(null, () => sql(
    "select public.complete_cv_upload($1, $2, sha256(convert_to('test-only PDF bytes', 'UTF8')))",
    [document.id, document.byte_size],
  ), "service_role");
}

before(async () => {
  await db.exec(await readFile(new URL("tests/bootstrap.sql", root), "utf8"));
  const migrationRoot = new URL("supabase/migrations/", root);
  for (const file of (await readdir(migrationRoot)).sort()) {
    if (file.endsWith(".sql")) await db.exec(await readFile(new URL(file, migrationRoot), "utf8"));
  }
  await db.exec(await readFile(new URL("supabase/seed.sql", root), "utf8"));
});
beforeEach(() => db.exec("begin"));
afterEach(() => db.exec("rollback"));
after(() => db.close());

test("every application table has RLS enabled", async () => {
  const tables = await rows(`select c.relname, c.relrowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind = 'r'`);
  assert.equal(tables.length, 13);
  assert.ok(tables.every((table) => table.relrowsecurity));
});

test("public visitors cannot read jobs, profiles, members, applications or stats", async () => {
  for (const table of ["jobs", "seeker_profiles", "members", "applications", "cv_documents", "recommendations", "member_cards", "profile_cards", "applicant_cards"]) {
    await denied(() => asUser(null, () => rows(`select * from public.${table}`), "anon"));
  }
  await denied(() => asUser(null, () => sql("select * from public.home_stats()"), "anon"));
});

test("pending and rejected members see only their own status and request", async () => {
  for (const n of [4, 12]) {
    await asUser(user(n), async () => {
      assert.equal(await count("public.members"), 1);
      assert.equal(await count("public.verification_requests"), 1);
      for (const table of ["jobs", "seeker_profiles", "applications", "cv_documents", "saved_searches", "recommendations", "member_cards", "profile_cards", "applicant_cards"]) {
        assert.equal(await count(`public.${table}`), 0);
      }
    });
    await denied(() => asUser(user(n), createJob));
  }
});

test("sign-up ignores forged admin and approval metadata", async () => {
  const [member] = await rows("select * from public.members where id = $1", [user(4)]);
  assert.equal(member.status, "pending");
  assert.equal(member.is_admin, false);
  assert.equal(member.can_post, false);
  await denied(() => asUser(user(4), () => sql("update public.members set status = 'approved', is_admin = true")));
});

test("only the admin can review applicants and inspect verification forms", async () => {
  await asUser(user(2), async () => assert.equal(await count("public.verification_requests"), 1));
  await denied(() => asUser(user(2), () => sql("select public.review_member($1, 'approve')", [user(4)])));
  await asUser(user(1), () => sql("select public.review_member($1, 'approve')", [user(4)]));
  assert.equal((await rows("select status from public.members where id = $1", [user(4)]))[0].status, "approved");
});

test("admin rejection and ban require reasons and cannot demote an admin", async () => {
  await denied(() => asUser(user(1), () => sql("select public.review_member($1, 'reject')", [user(4)])), "22023");
  await denied(() => asUser(user(1), () => sql("select public.review_member($1, 'ban', 'Test reason')", [user(1)])), "22023");
  await asUser(user(1), () => sql("select public.review_member($1, 'reject', 'Unable to verify')", [user(4)]));
  assert.equal((await rows("select status from public.members where id = $1", [user(4)]))[0].status, "rejected");
});

test("confirmed email is mandatory even for manual approval", async () => {
  await denied(() => asUser(user(1), () => sql("select public.review_member($1, 'approve')", [user(10)])), "22023");
  await denied(() => asUser(user(10), () => sql(`select public.submit_verification(
    'Test Member', 'unit_member', 2020, 2023, null, true, 'https://linkedin.com/in/test')`)));
});

test("pending users can update only their own verification form through the RPC", async () => {
  await asUser(user(4), () => sql(`select public.submit_verification(
    'Updated Example', 'unit_member', 2020, 2024, null, true, 'https://linkedin.com/in/example')`));
  assert.equal((await rows("select full_name from public.verification_requests where member_id = $1", [user(4)]))[0].full_name, "Updated Example");
  await denied(() => asUser(user(4), () => sql("update public.verification_requests set full_name = 'Tampered'")));
});

test("five lifetime invite slots; external recruiters receive none", async () => {
  const slots = await rows("select inviter_id, count(*)::int as n from public.invite_codes group by inviter_id");
  assert.ok(slots.every((row) => row.n === 5 && row.inviter_id !== user(7)));
  await denied(() => asUser(user(2), () => sql("select public.issue_invite(6::smallint)")), "22023");
  await denied(() => asUser(user(7), () => sql("select public.issue_invite(1::smallint)")));
  await denied(() => asUser(user(2), () => rows("select code_hash from public.invite_codes")));
});

test("invite redemption records provenance, grants both roles, and cannot be replayed", async () => {
  const [issued] = await asUser(user(2), () => rows("select public.issue_invite(1::smallint) as code"));
  assert.equal(issued.code.length, 64);
  await asUser(user(4), () => sql("select public.redeem_invite($1)", [issued.code]));
  const [member] = await rows("select * from public.members where id = $1", [user(4)]);
  assert.equal(member.invited_by, user(2));
  assert.equal(member.status, "approved");
  assert.equal(member.can_seek && member.can_post, true);
  await denied(() => asUser(user(5), () => sql("select public.redeem_invite($1)", [issued.code])), "22023");
  await denied(() => asUser(user(2), () => sql("select public.issue_invite(1::smallint)")), "22023");
});

test("rotating a code invalidates its old value without creating extra slots", async () => {
  const [old] = await asUser(user(2), () => rows("select public.issue_invite(1::smallint) as code"));
  const [fresh] = await asUser(user(2), () => rows("select public.issue_invite(1::smallint) as code"));
  assert.notEqual(old.code, fresh.code);
  await denied(() => asUser(user(4), () => sql("select public.redeem_invite($1)", [old.code])), "22023");
  await asUser(user(4), () => sql("select public.redeem_invite($1)", [fresh.code]));
});

test("revoked invites, banned inviters, external and rejected applicants cannot use invitations", async () => {
  const [issued] = await asUser(user(2), () => rows("select public.issue_invite(1::smallint) as code"));
  for (const n of [8, 12, 10]) {
    await denied(() => asUser(user(n), () => sql("select public.redeem_invite($1)", [issued.code])));
  }
  await asUser(user(1), () => sql("select public.review_member($1, 'ban', 'Test moderation')", [user(2)]));
  await denied(() => asUser(user(4), () => sql("select public.redeem_invite($1)", [issued.code])), "22023");
  const [another] = await asUser(user(3), () => rows("select public.issue_invite(1::smallint) as code"));
  await asUser(user(3), () => sql("select public.revoke_invite(1::smallint)"));
  await denied(() => asUser(user(4), () => sql("select public.redeem_invite($1)", [another.code])), "22023");
});

test("external recruiters require admin approval and get posting but not seeker privileges", async () => {
  await asUser(user(1), () => sql("select public.review_member($1, 'approve')", [user(8)]));
  const [member] = await rows("select * from public.members where id = $1", [user(8)]);
  assert.equal(member.kind, "external_recruiter");
  assert.equal(member.can_post, true);
  assert.equal(member.can_seek, false);
  await asUser(user(8), createJob);
  await denied(() => asUser(user(8), () => sql(`insert into public.seeker_profiles
    (full_name, headline, already_released) values ('Example', 'Test headline', true)`)));
});

test("new jobs belong to the caller and expire in exactly 60 days", async () => {
  const created = await asUser(user(2), createJob);
  assert.equal(created.creator_id, user(2));
  assert.equal(new Date(created.expires_at) - new Date(created.created_at), 60 * 86400000);
});

test("creator and admin can edit; unrelated members cannot edit or delete", async () => {
  await asUser(user(3), async () => {
    assert.equal((await rows("update public.jobs set title = 'Unauthorized title' where id = $1 returning id", [job(1)])).length, 0);
    assert.equal((await rows("delete from public.jobs where id = $1 returning id", [job(1)])).length, 0);
  });
  for (const n of [2, 1]) {
    assert.equal((await asUser(user(n), () => rows(
      "update public.jobs set title = 'Authorized title' where id = $1 returning id", [job(1)],
    ))).length, 1);
  }
});

test("ownership, posting dates, and expiry cannot be forged via direct writes", async () => {
  for (const assignment of [`creator_id = '${user(3)}'`, "created_at = now()", "expires_at = now() + interval '10 years'"]) {
    await denied(() => asUser(user(2), () => sql(`update public.jobs set ${assignment} where id = $1`, [job(1)])));
  }
  await denied(() => asUser(user(2), () => sql(`insert into public.jobs
    (creator_id, title, company, work_mode, job_type, seniority, description, apply_method)
    values ($1, 'Forged owner', 'Example', 'remote', 'full_time', 'junior',
      'A sufficiently long synthetic description.', 'profile')`, [user(3)])));
});

test("expired, closed and banned-poster jobs are hidden from discovery and normal direct reads", async () => {
  await asUser(user(3), async () => {
    const visible = await rows("select id from public.jobs");
    for (const n of [3, 4, 5]) assert.ok(!visible.some((row) => row.id === job(n)));
    assert.equal((await rows("select * from public.search_jobs()")).length, 3);
  });
  await asUser(user(2), async () => assert.equal((await rows("select * from public.jobs where id = $1", [job(3)])).length, 1));
});

test("renewal is owner/admin-only and extends from now rather than accumulating years", async () => {
  await denied(() => asUser(user(3), () => sql("select public.renew_job($1)", [job(3)])));
  await asUser(user(2), () => sql("select public.renew_job($1)", [job(3)]));
  await asUser(user(2), () => sql("select public.renew_job($1)", [job(3)]));
  const [interval] = await rows("select extract(epoch from (expires_at - now()))::int as seconds from public.jobs where id = $1", [job(3)]);
  assert.equal(interval.seconds, 60 * 86400);
});

test("invalid apply destinations and salary ranges are rejected", async () => {
  await denied(() => asUser(user(2), () => sql(
    "update public.jobs set salary_min = 30000, salary_max = 20000 where id = $1", [job(1)],
  )), "23514");
  await denied(() => asUser(user(2), () => sql(
    "update public.jobs set apply_method = 'external_link', apply_url = 'javascript:alert(1)' where id = $1", [job(1)],
  )), "23514");
});

test("only applicant, poster and admin can see applications", async () => {
  for (const n of [1, 2, 3]) await asUser(user(n), async () => assert.equal(await count("public.applications"), 1));
  for (const n of [4, 7, 11]) await asUser(user(n), async () => assert.equal(await count("public.applications"), 0));
});

test("application eligibility excludes expired, closed, external-apply and banned jobs", async () => {
  for (const n of [2, 3, 4, 5]) {
    await denied(() => asUser(user(11), () => sql("insert into public.applications(job_id) values ($1)", [job(n)])));
  }
  await denied(() => asUser(user(9), () => sql("insert into public.applications(job_id) values ($1)", [job(1)])));
  await asUser(user(11), () => sql("insert into public.applications(job_id) values ($1)", [job(1)]));
  await denied(() => asUser(user(11), () => sql("insert into public.applications(job_id) values ($1)", [job(1)])), "23505");
});

test("applications cannot impersonate another seeker and can be withdrawn", async () => {
  await denied(() => asUser(user(11), () => sql(
    "insert into public.applications(job_id, applicant_id) values ($1, $2)", [job(1), user(3)],
  )));
  await asUser(user(11), async () => assert.equal((await rows("delete from public.applications returning id")).length, 0));
  await asUser(user(3), async () => assert.equal((await rows("delete from public.applications returning id")).length, 1));
});

test("hidden and banned profiles are excluded from directory and direct reads", async () => {
  await asUser(user(2), async () => {
    assert.equal(await count("public.seeker_profiles"), 2);
    assert.equal((await rows("select * from public.seeker_profiles where member_id = $1", [user(9)])).length, 0);
  });
  await asUser(user(9), async () => assert.equal((await rows("select * from public.seeker_profiles where member_id = $1", [user(9)])).length, 1));
  await asUser(user(1), async () => assert.equal(await count("public.seeker_profiles"), 4));
});

test("hiding a profile also removes existing applicants' profile access", async () => {
  await asUser(user(3), () => sql("update public.seeker_profiles set status = 'hidden' where member_id = $1", [user(3)]));
  await asUser(user(2), async () => {
    assert.equal(await count("public.applications"), 1);
    assert.equal((await rows("select * from public.seeker_profiles where member_id = $1", [user(3)])).length, 0);
  });
});

test("profile moderation cannot be undone by changing visibility or delete/reinsert", async () => {
  await asUser(user(1), () => sql("select public.moderate_profile($1, true, 'Test removal')", [user(3)]));
  await asUser(user(3), () => sql("update public.seeker_profiles set status = 'actively_looking' where member_id = $1", [user(3)]));
  await asUser(user(2), async () => assert.equal((await rows("select * from public.seeker_profiles where member_id = $1", [user(3)])).length, 0));
  await denied(() => asUser(user(3), () => sql("update public.seeker_profiles set moderated_at = null")));
  await denied(() => asUser(user(3), () => sql("delete from public.seeker_profiles where member_id = $1", [user(3)])));
});

test("other members cannot edit someone else's profile", async () => {
  await asUser(user(2), async () => assert.equal((await rows(
    "update public.seeker_profiles set full_name = 'Not the owner' where member_id = $1 returning member_id", [user(3)],
  )).length, 0));
});

test("CV attestation must be explicit, not false or null", async () => {
  for (const attested of [false, null]) {
    await denied(() => asUser(user(3), () => sql("select public.begin_cv_upload('resume.pdf', 100, $1)", [attested])));
  }
});

test("CV limit is exactly 5 MiB and only PDF filenames may be staged", async () => {
  const document = await stageCv();
  assert.equal(document.byte_size, 5242880);
  await denied(() => stageCv(3, 5242881), "23514");
  await denied(() => stageCv(3, 0), "23514");
  await denied(() => asUser(user(3), () => sql("select public.begin_cv_upload('malware.exe', 100, true)")), "23514");
});

test("CV bucket is private and enforces the advertised size and MIME settings", async () => {
  const [bucket] = await rows("select * from storage.buckets where id = 'cvs'");
  assert.equal(bucket.public, false);
  assert.equal(Number(bucket.file_size_limit), 5242880);
  assert.deepEqual(bucket.allowed_mime_types, ["application/pdf"]);
});

test("clients cannot access raw CV objects, even under an unrelated permissive storage policy", async () => {
  const document = await stageCv();
  await finishCv(document);
  for (const [id, role] of [[null, "anon"], [user(3), "authenticated"], [user(1), "authenticated"]]) {
    await asUser(id, async () => assert.equal(await count("storage.objects"), 0), role);
    await denied(() => asUser(id, () => sql(
      "insert into storage.objects(bucket_id, name) values ('cvs', 'forged.pdf')",
    ), role));
  }
});

test("a client cannot publish pending CV metadata or assign someone else's CV", async () => {
  const document = await stageCv();
  await denied(() => asUser(user(3), () => sql(
    "select public.complete_cv_upload($1, $2, sha256(convert_to('bad', 'UTF8')))", [document.id, document.byte_size],
  )));
  await denied(() => asUser(user(3), () => sql("update public.cv_documents set state = 'ready'")));
  await denied(() => asUser(user(11), () => sql("update public.seeker_profiles set cv_document_id = $1", [document.id])));
  await denied(() => asUser(null, () => sql(
    "select public.complete_cv_upload($1, $2, sha256(convert_to('bad', 'UTF8')))", [document.id, document.byte_size],
  ), "service_role"), "22023");
});

test("pending CVs are private; only the current verified CV becomes discoverable", async () => {
  const first = await stageCv();
  await asUser(user(2), async () => assert.equal(await count("public.cv_documents"), 0));
  await finishCv(first);
  await asUser(user(2), async () => assert.equal(await count("public.cv_documents"), 1));
  const second = await stageCv(3, 100);
  await finishCv(second);
  await asUser(user(2), async () => assert.deepEqual((await rows("select id from public.cv_documents")).map((row) => row.id), [second.id]));
  await asUser(user(3), () => sql("update public.seeker_profiles set status = 'hidden' where member_id = $1", [user(3)]));
  await asUser(user(2), async () => assert.equal(await count("public.cv_documents"), 0));
});

test("uncompleted uploads are bounded", async () => {
  await stageCv(3, 100);
  await stageCv(3, 100);
  await stageCv(3, 100);
  await denied(() => stageCv(3, 100), "54000");
});

test("pending uploads can be discarded only by their owner and only after byte cleanup", async () => {
  const document = await stageCv(3, 100);
  await denied(() => asUser(user(11), () => sql("select public.discard_cv_upload($1)", [document.id])), "22023");
  await sql("insert into storage.objects(bucket_id, name) values ('cvs', $1)", [document.object_name]);
  await denied(() => asUser(user(3), () => sql("select public.discard_cv_upload($1)", [document.id])), "55000");
  await sql("delete from storage.objects where bucket_id = 'cvs' and name = $1", [document.object_name]);
  await asUser(user(3), () => sql("select public.discard_cv_upload($1)", [document.id]));
  assert.equal((await rows("select * from public.cv_documents where id = $1", [document.id])).length, 0);
});

test("CV finalization rejects a mismatched size and a newly banned owner", async () => {
  const document = await stageCv(3, 100);
  await sql("insert into storage.objects(bucket_id, name) values ('cvs', $1)", [document.object_name]);
  await denied(() => asUser(null, () => sql(
    "select public.complete_cv_upload($1, 101, sha256(convert_to('test', 'UTF8')))", [document.id],
  ), "service_role"), "22023");
  await asUser(user(1), () => sql("select public.review_member($1, 'ban', 'Test ban')", [user(3)]));
  await denied(() => asUser(null, () => sql(
    "select public.complete_cv_upload($1, 100, sha256(convert_to('test', 'UTF8')))", [document.id],
  ), "service_role"), "22023");
});

test("self-applications are not allowed even when the poster has a visible profile", async () => {
  const created = await asUser(user(3), createJob);
  await denied(() => asUser(user(3), () => sql("insert into public.applications(job_id) values ($1)", [created.id])));
});

test("search combines full text, normalized tags, location, type, seniority, referral and posting time", async () => {
  await asUser(user(3), async () => {
    const matches = await rows(`select * from public.search_jobs(
      'פיתוח TypeScript', array['REACT'], 'תל אביב', 'hybrid', 'full_time',
      'junior', true, now() - interval '1 day', 30, 0)`);
    assert.deepEqual(matches.map((row) => row.id), [job(1)]);
    assert.equal((await rows("select * from public.search_jobs(p_query => 'nonexistentword')")).length, 0);
  });
  await asUser(user(4), async () => assert.equal((await rows("select * from public.search_jobs()")).length, 0));
});

test("profile search includes upcoming-release window, skills, status and experience", async () => {
  await asUser(user(2), async () => {
    const matches = await rows(`select * from public.search_profiles(
      array['PYTHON'], current_date, (current_date + interval '3 months')::date,
      'actively_looking', 2, 4, 30, 0)`);
    assert.deepEqual(matches.map((row) => row.member_id), [user(3)]);
  });
});

test("search rejects invalid pagination instead of returning an unbounded result", async () => {
  await denied(() => asUser(user(2), () => sql("select * from public.search_jobs(p_limit => null)")), "22023");
  await denied(() => asUser(user(2), () => sql("select * from public.search_profiles(p_limit => 1000)")), "22023");
});

test("saved searches are owner-only; email opt-in is timestamped by the database", async () => {
  await asUser(user(2), async () => assert.equal(await count("public.saved_searches"), 0));
  const [created] = await asUser(user(3), () => rows(
    "insert into public.saved_searches(name, email_enabled) values ('My search', true) returning *",
  ));
  assert.ok(created.email_consent_at);
  assert.equal(new Date(created.next_digest_at) - new Date(created.email_consent_at), 7 * 86400000);
  await asUser(user(3), () => sql("update public.saved_searches set email_enabled = false where id = $1", [created.id]));
  assert.equal((await rows("select email_consent_at from public.saved_searches where id = $1", [created.id]))[0].email_consent_at, null);
  await denied(() => asUser(user(3), () => sql("update public.saved_searches set last_digest_at = now() where id = $1", [searchId])));
});

test("ban revokes all protected reads and writes despite an unchanged user identity/JWT", async () => {
  await asUser(user(1), () => sql("select public.review_member($1, 'ban', 'Membership revoked')", [user(3)]));
  await asUser(user(3), async () => {
    for (const table of ["jobs", "seeker_profiles", "applications", "cv_documents", "saved_searches", "recommendations", "member_cards", "profile_cards", "applicant_cards"]) {
      assert.equal(await count(`public.${table}`), 0);
    }
  });
  await denied(() => asUser(user(3), createJob));
  await denied(() => asUser(user(3), () => sql("select public.home_stats()")));
});

test("home counts exclude hidden and banned profiles; admin statistics stay admin-only", async () => {
  const [stats] = await asUser(user(2), () => rows("select * from public.home_stats()"));
  assert.equal(Number(stats.active_jobs), 3);
  assert.equal(Number(stats.releasing_soon), 1);
  await denied(() => asUser(user(2), () => sql("select * from public.admin_stats()")));
  const [admin] = await asUser(user(1), () => rows("select * from public.admin_stats()"));
  assert.equal(Number(admin.applications), 1);
});

test("admin removal deletes job/application rows and writes an immutable audit record", async () => {
  await asUser(user(1), () => sql("delete from public.jobs where id = $1", [job(1)]));
  assert.equal(await count("public.applications"), 0);
  const [event] = await asUser(user(1), () => rows("select * from public.audit_events where action = 'job_deleted'"));
  assert.equal(event.actor_id, user(1));
  await denied(() => asUser(user(1), () => sql("delete from public.audit_events")));
});

test("email queues and renewal hashes are inaccessible to browser roles", async () => {
  for (const n of [1, 2, 3, 4]) {
    for (const table of ["private.email_outbox", "private.job_renewal_tokens"]) {
      await denied(() => asUser(user(n), () => rows(`select * from ${table}`)));
    }
  }
});

test("all SECURITY DEFINER functions have a fixed empty search path and no PUBLIC execution", async () => {
  const functions = await rows(`select p.proname, p.proconfig,
    exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))
      where grantee = 0 and privilege_type = 'EXECUTE') as public_execute
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef`);
  assert.ok(functions.length >= 10);
  assert.ok(functions.every((fn) => fn.proconfig.includes('search_path=""') && !fn.public_execute));
});

test("recommender cards expose only a consented subset of approved verification data", async () => {
  const [card] = await asUser(user(2), () => rows(
    "select * from public.save_member_card('Engineering leader', 'Tech lead', 'Example', true)",
  ));
  assert.equal(card.unit_start_year, 2020);
  assert.equal(card.unit_end_year, 2023);
  assert.equal(card.account_path, `/members/${user(2)}`);
  assert.equal(card.current_company, "Example");
  assert.equal("release_date" in card, false);
  assert.equal("linkedin_url" in card, false);
  await denied(() => asUser(user(2), () => sql("update public.member_cards set unit_start_year = 1980")));
  await asUser(user(7), async () => {
    assert.equal((await rows("select * from public.member_cards where member_id = $1", [user(2)])).length, 1);
    assert.equal((await rows("select * from public.verification_requests where member_id = $1", [user(2)])).length, 0);
  });
});

test("an alumnus can recommend without exposing or even having a job-seeker profile", async () => {
  await asUser(user(7), async () => {
    assert.equal((await rows("select * from public.seeker_profiles where member_id = $1", [user(2)])).length, 0);
    assert.equal((await rows("select * from public.member_cards where member_id = $1", [user(2)])).length, 1);
    assert.equal((await rows("select * from public.recommendations where id = $1", [recommendation(1)])).length, 1);
  });
});

test("member cards default to private and external recruiters cannot publish alumni cards", async () => {
  await asUser(user(3), () => sql("select public.save_member_card('Software engineer')"));
  await asUser(user(7), async () => assert.equal(
    (await rows("select * from public.member_cards where member_id = $1", [user(3)])).length, 0,
  ));
  await denied(() => asUser(user(7), () => sql("select public.save_member_card('Recruiter', null, null, true)")));
});

test("only verified released alumni may recommend, not serving members or recruiters", async () => {
  await asUser(user(3), () => sql("select public.save_member_card('Software engineer', null, null, true)"));
  await asUser(user(3), () => sql("update public.seeker_profiles set already_released = true where member_id = $1", [user(3)]));
  for (const n of [3, 4, 6, 7, 9, 10, 12]) {
    await denied(() => asUser(user(n), () => sql(`insert into public.recommendations
      (seeker_id, recommendation_text) values ($1, 'A synthetic recommendation with enough detail.')`, [user(11)])));
  }
  const [created] = await asUser(user(2), () => rows(`insert into public.recommendations
    (seeker_id, recommendation_text) values ($1, 'A synthetic recommendation with enough detail.')
    returning *`, [user(11)]));
  assert.equal(created.author_id, user(2));
  assert.equal(created.approval_status, "pending");
});

test("planned release date eligibility comes from the approved form, not editable profile dates", async () => {
  await asUser(user(9), () => sql("select public.save_member_card('Software engineer', null, null, true)"));
  await sql("update public.verification_requests set release_date = current_date where member_id = $1", [user(9)]);
  await asUser(user(9), () => sql(`insert into public.recommendations
    (seeker_id, recommendation_text) values ($1, 'A synthetic recommendation with enough detail.')`, [user(11)]));
});

test("one recommendation per author and seeker, with no self-recommendation", async () => {
  await denied(() => asUser(user(2), () => sql(`insert into public.recommendations
    (seeker_id, recommendation_text) values ($1, 'A duplicate synthetic recommendation with enough detail.')`, [user(3)])), "23505");
  await denied(() => asUser(user(11), () => sql(`insert into public.recommendations
    (seeker_id, recommendation_text) values ($1, 'A self recommendation with enough detail.')`, [user(11)])));
});

test("new recommendations cannot target a hidden, moderated or banned seeker", async () => {
  for (const n of [9, 6]) {
    await denied(() => asUser(user(2), () => sql(`insert into public.recommendations
      (seeker_id, recommendation_text) values ($1, 'A synthetic recommendation with enough detail.')`, [user(n)])));
  }
  await asUser(user(1), () => sql("select public.moderate_profile($1, true, 'Test moderation')", [user(11)]));
  await denied(() => asUser(user(2), () => sql(`insert into public.recommendations
    (seeker_id, recommendation_text) values ($1, 'A synthetic recommendation with enough detail.')`, [user(11)])));
});

test("pending and hidden recommendations are visible only to author, recipient and admin", async () => {
  await asUser(user(7), async () => assert.deepEqual(
    (await rows("select id from public.recommendations")).map((row) => row.id), [recommendation(1)],
  ));
  for (const n of [1, 3]) await asUser(user(n), async () => assert.equal(await count("public.recommendations"), 3));
  await asUser(user(11), async () => assert.equal(
    (await rows("select * from public.recommendations where id = $1", [recommendation(2)])).length, 1,
  ));
});

test("only the recipient can approve; neither author nor admin can approve on their behalf", async () => {
  for (const n of [11, 1, 2, 7]) {
    await denied(() => asUser(user(n), () => sql(
      "select public.review_recommendation($1, 'approved', 1)", [recommendation(2)],
    )));
  }
  await asUser(user(3), () => sql("select public.review_recommendation($1, 'approved', 1)", [recommendation(2)]));
  await asUser(user(7), async () => assert.equal(await count("public.recommendations"), 2));
});

test("authors cannot forge approval, identity, timestamps or revisions through direct writes", async () => {
  for (const assignment of [
    "approval_status = 'approved'", "approved_revision = revision",
    `author_id = '${user(1)}'`, `seeker_id = '${user(11)}'`, "created_at = now()", "revision = 50",
  ]) {
    await denied(() => asUser(user(11), () => sql(
      `update public.recommendations set ${assignment} where id = $1`, [recommendation(2)],
    )));
  }
  await denied(() => asUser(user(2), () => sql(`insert into public.recommendations
    (seeker_id, recommendation_text, approval_status)
    values ($1, 'A synthetic recommendation with enough detail.', 'approved')`, [user(11)])));
});

test("editing approved text or relationship revokes approval and requires the latest revision", async () => {
  await asUser(user(2), () => sql(
    "update public.recommendations set recommendation_text = 'Changed recommendation that must be reviewed again.' where id = $1",
    [recommendation(1)],
  ));
  let [changed] = await rows("select * from public.recommendations where id = $1", [recommendation(1)]);
  assert.equal(changed.approval_status, "pending");
  assert.equal(changed.revision, 2);
  assert.equal(changed.approved_at, null);
  await denied(() => asUser(user(3), () => sql(
    "select public.review_recommendation($1, 'approved', 1)", [recommendation(1)],
  )), "40001");
  await asUser(user(3), () => sql("select public.review_recommendation($1, 'approved', 2)", [recommendation(1)]));
  await asUser(user(2), () => sql(
    "update public.recommendations set relationship = 'Former colleague' where id = $1", [recommendation(1)],
  ));
  [changed] = await rows("select * from public.recommendations where id = $1", [recommendation(1)]);
  assert.equal(changed.approval_status, "pending");
  assert.equal(changed.revision, 3);
});

test("a no-op edit preserves approval, while editing a hidden recommendation does not unhide it", async () => {
  await asUser(user(2), () => sql(
    "update public.recommendations set recommendation_text = recommendation_text where id = $1", [recommendation(1)],
  ));
  assert.equal((await rows("select revision from public.recommendations where id = $1", [recommendation(1)]))[0].revision, 1);
  await asUser(user(3), () => sql("select public.review_recommendation($1, 'hidden', 1)", [recommendation(1)]));
  await asUser(user(2), () => sql(
    "update public.recommendations set recommendation_text = 'New text must not override a hide decision.' where id = $1",
    [recommendation(1)],
  ));
  assert.equal((await rows("select approval_status from public.recommendations where id = $1", [recommendation(1)]))[0].approval_status, "hidden");
});

test("recipient and admin cannot rewrite the author's recommendation text", async () => {
  for (const n of [3, 1, 7]) {
    const updated = await asUser(user(n), () => rows(
      "update public.recommendations set recommendation_text = 'Unauthorized text change with enough detail.' where id = $1 returning id",
      [recommendation(1)],
    ));
    assert.equal(updated.length, 0);
  }
});

test("author, recipient and admin can delete; other verified members cannot", async () => {
  await asUser(user(7), async () => assert.equal(
    (await rows("delete from public.recommendations where id = $1 returning id", [recommendation(2)])).length, 0,
  ));
  for (const [n, r] of [[11, 2], [3, 1], [1, 3]]) {
    await asUser(user(n), async () => assert.equal(
      (await rows("delete from public.recommendations where id = $1 returning id", [recommendation(r)])).length, 1,
    ));
  }
  assert.equal(await count("public.recommendations"), 0);
  assert.equal(Number((await rows("select count(*) as n from public.audit_events where action = 'recommendation_deleted'"))[0].n), 3);
});

test("badges and has-recommendations filters count only approved publishable recommendations", async () => {
  await asUser(user(7), async () => {
    const [card] = await rows("select * from public.profile_cards where member_id = $1", [user(3)]);
    assert.equal(Number(card.recommendation_count), 1);
    const matches = await rows("select * from public.search_profiles(p_has_recommendations => true)");
    assert.deepEqual(matches.map((row) => row.member_id), [user(3)]);
  });
  await asUser(user(2), async () => {
    const [applicant] = await rows("select * from public.applicant_cards where job_id = $1", [job(1)]);
    assert.equal(Number(applicant.recommendation_count), 1);
    assert.equal(applicant.profile_member_id, user(3));
  });
  await asUser(user(7), async () => assert.equal(await count("public.applicant_cards"), 0));
});

test("hiding a seeker hides recommendations and applicant details without leaking their count", async () => {
  await asUser(user(3), () => sql("update public.seeker_profiles set status = 'hidden' where member_id = $1", [user(3)]));
  await asUser(user(7), async () => {
    assert.equal(await count("public.recommendations"), 0);
    assert.equal(Number((await rows("select public.recommendation_count($1) as n", [user(3)]))[0].n), 0);
  });
  await asUser(user(2), async () => {
    const [applicant] = await rows("select * from public.applicant_cards where job_id = $1", [job(1)]);
    assert.equal(applicant.full_name, null);
    assert.equal(applicant.profile_member_id, null);
    assert.equal(Number(applicant.recommendation_count), 0);
    assert.equal((await rows("select * from public.recommendations where author_id = $1", [user(2)])).length, 1);
  });
});

test("banning a recommender removes their credibility card, public recommendations and badge contribution", async () => {
  await asUser(user(1), () => sql("select public.review_member($1, 'ban', 'Test ban')", [user(2)]));
  await asUser(user(7), async () => {
    assert.equal(await count("public.recommendations"), 0);
    assert.equal((await rows("select * from public.member_cards where member_id = $1", [user(2)])).length, 0);
    assert.equal(Number((await rows("select public.recommendation_count($1) as n", [user(3)]))[0].n), 0);
  });
  await asUser(user(2), async () => assert.equal(await count("public.recommendations"), 0));
});

test("withdrawing card publication hides recommendations without exposing a hidden job-seeker profile", async () => {
  await asUser(user(2), () => sql("select public.save_member_card('Engineering leader', null, null, false)"));
  await asUser(user(7), async () => {
    assert.equal(await count("public.recommendations"), 0);
    assert.equal((await rows("select * from public.member_cards where member_id = $1", [user(2)])).length, 0);
  });
  await denied(() => asUser(user(3), () => sql("select public.review_recommendation($1, 'approved', 1)", [recommendation(1)])));
});

test("new recommendation notification is queued once, with no text copied into the queue", async () => {
  const [created] = await asUser(user(2), () => rows(`insert into public.recommendations
    (seeker_id, recommendation_text) values ($1, 'A new recommendation with enough detail to review.') returning *`, [user(11)]));
  let notifications = await rows("select * from private.email_outbox where recommendation_id = $1", [created.id]);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].recipient_id, user(11));
  assert.equal(notifications[0].kind, "recommendation_pending");
  assert.equal("recommendation_text" in notifications[0], false);
  await asUser(user(2), () => sql(
    "update public.recommendations set recommendation_text = 'Revised pending text should not spam the recipient.' where id = $1", [created.id],
  ));
  notifications = await rows("select * from private.email_outbox where recommendation_id = $1", [created.id]);
  assert.equal(notifications.length, 1);
  await asUser(user(11), () => sql("select public.review_recommendation($1, 'approved', 2)", [created.id]));
  assert.equal((await rows("select * from private.email_outbox where recommendation_id = $1", [created.id])).length, 0);
});

test("deleting a recommendation removes its queued email and admin stats include recommendations", async () => {
  assert.equal((await rows("select * from private.email_outbox where recommendation_id = $1", [recommendation(2)])).length, 1);
  await asUser(user(3), () => sql("delete from public.recommendations where id = $1", [recommendation(2)]));
  assert.equal((await rows("select * from private.email_outbox where recommendation_id = $1", [recommendation(2)])).length, 0);
  const [stats] = await asUser(user(1), () => rows("select * from public.admin_stats()"));
  assert.equal(Number(stats.recommendations), 2);
});

test("derived discovery views run with caller permissions instead of view-owner privileges", async () => {
  const views = await rows(`select relname, reloptions from pg_class
    where oid in ('public.profile_cards'::regclass, 'public.applicant_cards'::regclass)`);
  assert.equal(views.length, 2);
  assert.ok(views.every((view) => view.reloptions.includes("security_invoker=true")));
});
