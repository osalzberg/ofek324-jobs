import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { connect, query, TYPES } from "./client.mjs";

const connection = await connect();
try {
  const [tier] = await query(connection, "SELECT CONVERT(nvarchar(30),DATABASEPROPERTYEX(DB_NAME(),'Edition')) AS edition;");
  if (tier.edition !== "Basic") throw new Error("Unexpected database tier");
  await query(connection, `IF OBJECT_ID('dbo.ofek_migrations') IS NULL CREATE TABLE dbo.ofek_migrations(
    name varchar(100) NOT NULL PRIMARY KEY, checksum char(64) NOT NULL, applied_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME());`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()) {
    const sql = await readFile(new URL(file, directory), "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    const [existing] = await query(connection, "SELECT checksum FROM dbo.ofek_migrations WHERE name=@name;", [["name", TYPES.VarChar, file]]);
    if (existing) {
      if (existing.checksum !== hash) throw new Error(`Applied migration changed: ${file}; add a forward migration instead`);
      console.log(`Already applied ${file}`);
      continue;
    }
    const transactional = !file.includes("fulltext");
    if (transactional) await query(connection, "BEGIN TRANSACTION;");
    try {
      for (const batch of sql.split(/^\s*GO\s*$/gmi)) if (batch.trim()) await query(connection, batch);
      await query(connection, "INSERT dbo.ofek_migrations(name,checksum) VALUES(@name,@hash);", [
        ["name", TYPES.VarChar, file], ["hash", TYPES.VarChar, hash],
      ]);
      if (transactional) await query(connection, "COMMIT TRANSACTION;");
      console.log(`Applied ${file}`);
    } catch (error) {
      await query(connection, "IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;");
      throw error;
    }
  }
} finally {
  connection.close();
}
