import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { Connection, Request, TYPES } from "tedious";

const subscription = "5edb3519-a630-43b6-82ac-cf92b84ec378";
const tenant = "ea40c3b0-b791-4369-b99a-3c4e9f570512";
const server = "sql-ofek324-osalzberg-fc.database.windows.net";
const database = "ofek-jobs-poc";
const user = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const job = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const checks = [];

const credential = JSON.parse(execFileSync("az", [
  "account", "get-access-token", "--subscription", subscription,
  "--resource", "https://database.windows.net/", "--output", "json",
], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const claims = JSON.parse(Buffer.from(credential.accessToken.split(".")[1], "base64url").toString("utf8"));
assert.equal(claims.tid, tenant, "Wrong personal Azure tenant");

function connect() {
  return new Promise((resolve, reject) => {
    const connection = new Connection({
      server,
      authentication: {
        type: "azure-active-directory-access-token",
        options: { token: credential.accessToken },
      },
      options: {
        database, encrypt: true, trustServerCertificate: false,
        connectTimeout: 60000, requestTimeout: 30000,
        rowCollectionOnRequestCompletion: true,
      },
    });
    connection.once("connect", (error) => {
      if (error) {
        connection.close();
        reject(error);
      } else {
        resolve(connection);
      }
    });
    connection.connect();
  });
}

function query(connection, text, parameters = []) {
  return new Promise((resolve, reject) => {
    const request = new Request(text, (error, rowCount, rows = []) => {
      if (error) reject(error);
      else resolve({
        rowCount,
        rows: rows.map((row) => Object.fromEntries(row.map((column) => [column.metadata.colName, column.value]))),
      });
    });
    for (const [name, type, value] of parameters) request.addParameter(name, type, value);
    if (parameters.length) connection.execSql(request);
    else connection.execSqlBatch(request);
  });
}

async function asActor(n, action) {
  const connection = await connect();
  try {
    if (n !== null) {
      await query(connection, `EXEC sys.sp_set_session_context
        @key=N'member_id', @value=@member, @read_only=1;`, [["member", TYPES.UniqueIdentifier, user(n)]]);
    }
    await query(connection, "EXECUTE AS USER = N'ofek_poc_app'; BEGIN TRANSACTION;");
    assert.equal((await query(connection, "SELECT USER_NAME() AS actor;")).rows[0].actor, "ofek_poc_app");
    return await action(connection);
  } finally {
    try {
      await query(connection, "IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;");
    } finally {
      connection.close();
    }
  }
}

async function denied(connection, text, allowedNumbers) {
  await assert.rejects(() => query(connection, text), (error) => {
    const numbers = [error.number, ...(error.errors ?? []).map((inner) => inner.number)];
    assert.ok(numbers.some((number) => allowedNumbers.includes(number)), error.message);
    return true;
  });
}

async function check(name, action) {
  await action();
  checks.push(name);
  console.log(`PASS ${name}`);
}

let admin;
try {
  admin = await connect();
  const edition = (await query(admin, "SELECT CONVERT(nvarchar(30), DATABASEPROPERTYEX(DB_NAME(), 'Edition')) AS edition;")).rows[0].edition;
  assert.equal(edition, "Basic", "Do not run this proof on an unexpectedly priced database");
  if (process.argv.includes("--initialize-only")) {
    const exists = (await query(admin, "SELECT SCHEMA_ID(N'ofek_poc') AS id;")).rows[0].id;
    assert.equal(exists, null, "PoC schema already exists; initialization will not overwrite it");
    const schema = await readFile(new URL("schema.sql", import.meta.url), "utf8");
    await query(admin, "BEGIN TRANSACTION;");
    try {
      for (const batch of schema.split(/^\s*GO\s*$/gmi)) {
        if (batch.trim()) await query(admin, batch);
      }
      await query(admin, "COMMIT TRANSACTION;");
    } catch (error) {
      await query(admin, "IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;");
      throw error;
    }
    console.log("Created isolated synthetic PoC schema, seeds and security policy.");
  } else {
    const policy = await query(admin, "SELECT is_enabled FROM sys.security_policies WHERE name = N'job_access' AND schema_id = SCHEMA_ID(N'ofek_poc');");
    assert.equal(policy.rows[0]?.is_enabled, true, "Initialize the PoC schema first; the RLS policy must be enabled");

    await check("confirmed Basic tier with native RLS enabled", async () => {});
    await check("unidentified database session sees no jobs", () => asActor(null, async (c) => {
      assert.equal((await query(c, "SELECT COUNT(*) AS n FROM ofek_poc.jobs;")).rows[0].n, 0);
    }));
    await check("pending and banned members see no jobs", async () => {
      for (const n of [4, 6]) await asActor(n, async (c) => {
        assert.equal((await query(c, "SELECT COUNT(*) AS n FROM ofek_poc.jobs;")).rows[0].n, 0);
      });
    });
    await check("verified member sees active jobs but not expired, closed or banned-author jobs", () => asActor(3, async (c) => {
      assert.equal((await query(c, "SELECT COUNT(*) AS n FROM ofek_poc.jobs;")).rows[0].n, 2);
    }));
    await check("poster can still see their own expired and closed jobs", () => asActor(2, async (c) => {
      assert.equal((await query(c, "SELECT COUNT(*) AS n FROM ofek_poc.jobs;")).rows[0].n, 4);
    }));
    await check("database blocks editing another poster's job", () => asActor(3, (c) => denied(c,
      `UPDATE ofek_poc.jobs SET title=N'Unauthorized edit' WHERE id='${job(1)}';`, [33504])));
    await check("database blocks deleting another poster's job", () => asActor(3, (c) => denied(c,
      `DELETE FROM ofek_poc.jobs WHERE id='${job(1)}';`, [33504])));
    await check("owner can edit their own job", () => asActor(2, async (c) => {
      await query(c, `UPDATE ofek_poc.jobs SET title=N'Authorized edit' WHERE id='${job(1)}';`);
      assert.equal((await query(c, `SELECT title FROM ofek_poc.jobs WHERE id='${job(1)}';`)).rows[0].title, "Authorized edit");
    }));
    await check("admin can moderate another poster's job", () => asActor(1, async (c) => {
      assert.equal((await query(c, "SELECT COUNT(*) AS n FROM ofek_poc.jobs;")).rows[0].n, 5);
      await query(c, `UPDATE ofek_poc.jobs SET title=N'Admin edit' WHERE id='${job(1)}';`);
      await query(c, `DELETE FROM ofek_poc.jobs WHERE id='${job(2)}';`);
      assert.equal((await query(c, "SELECT COUNT(*) AS n FROM ofek_poc.jobs;")).rows[0].n, 4);
    }));
    await check("database blocks forging the owner on insert", () => asActor(3, (c) => denied(c,
      `INSERT INTO ofek_poc.jobs(creator_id,title) VALUES ('${user(2)}',N'Forged owner role');`, [229])));
    await check("database blocks pending-member writes", () => asActor(4, (c) => denied(c,
      "EXEC ofek_poc.create_job @title=N'Pending account role';", [33504])));
    await check("server supplies owner and exactly 60-day expiry for a permitted insert", () => asActor(3, async (c) => {
      await query(c, "EXEC ofek_poc.create_job @title=N'Synthetic new job';");
      const row = (await query(c, "SELECT creator_id, DATEDIFF(day,created_at,expires_at) AS days FROM ofek_poc.jobs WHERE title=N'Synthetic new job';")).rows[0];
      assert.equal(row.creator_id.toLowerCase(), user(3));
      assert.equal(row.days, 60);
    }));
    await check("membership/admin escalation is denied at the database", () => asActor(3, (c) => denied(c,
      `UPDATE ofek_poc.members SET is_admin=1 WHERE id='${user(3)}';`, [229])));
    await check("ownership and expiry columns are not writable", async () => {
      await asActor(2, (c) => denied(c,
        `UPDATE ofek_poc.jobs SET creator_id='${user(3)}' WHERE id='${job(1)}';`, [229, 230]));
      await asActor(2, (c) => denied(c,
        `UPDATE ofek_poc.jobs SET expires_at=DATEADD(year,10,SYSUTCDATETIME()) WHERE id='${job(1)}';`, [229, 230]));
    });
    await check("request identity cannot change after its read-only session binding", () => asActor(3, (c) => denied(c,
      `EXEC sys.sp_set_session_context @key=N'member_id', @value=N'${user(1)}';`, [15664])));
    await check("ban takes effect in the same authenticated session on the next query", () => asActor(3, async (c) => {
      try {
        assert.equal((await query(c, "SELECT COUNT(*) AS n FROM ofek_poc.jobs;")).rows[0].n, 2);
        await query(admin, `UPDATE ofek_poc.members SET status='banned' WHERE id='${user(3)}';`);
        assert.equal((await query(c, "SELECT COUNT(*) AS n FROM ofek_poc.jobs;")).rows[0].n, 0);
      } finally {
        await query(admin, `UPDATE ofek_poc.members SET status='approved' WHERE id='${user(3)}';`);
      }
    }));
    console.log(JSON.stringify({ server, database, edition, passed: checks.length, scope: "Synthetic Azure SQL job RLS proof; not the migrated application" }));
  }
} finally {
  admin?.close();
}
