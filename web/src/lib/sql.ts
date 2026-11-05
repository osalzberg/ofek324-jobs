import "server-only";
import { createHash } from "node:crypto";
import { Connection, Request, TYPES } from "tedious";
import { credential } from "./credential";
import { config } from "./config";
export { TYPES };
export type Parameter = readonly [name: string, type: (typeof TYPES)[keyof typeof TYPES], value: unknown];
export const hash = (value: string | Buffer) => createHash("sha256").update(value).digest();

export class Db {
  constructor(private connection: Connection) {}
  query<T>(sql: string, parameters: Parameter[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const request = new Request(sql, (error, _count, rows = []) => {
        if (error) reject(error);
        else resolve(rows.map((row: { metadata: { colName: string; type: { id: number } }; value: unknown }[]) =>
          Object.fromEntries(row.map(column => [column.metadata.colName,
            column.metadata.type.id === TYPES.UniqueIdentifier.id && typeof column.value === "string" ? column.value.toLowerCase() : column.value]))) as T[]);
      });
      for (const [name, type, value] of parameters) request.addParameter(name, type, value, {
        length: type === TYPES.NVarChar ? typeof value === "string" && value.length <= 4000 ? Math.max(1, value.length) : Infinity : undefined,
      });
      if (parameters.length) this.connection.execSql(request); else this.connection.execSqlBatch(request);
    });
  }
}

export async function withDb<T>(session: string | undefined, action: (db: Db) => Promise<T>): Promise<T> {
  const token = await credential.getToken("https://database.windows.net/.default");
  if (!token) throw new Error("Azure SQL authentication is unavailable");
  const connection = new Connection({
    server: config.server,
    authentication: { type: "azure-active-directory-access-token", options: { token: token.token } },
    options: { database: config.database, encrypt: true, trustServerCertificate: false,
      connectTimeout: 30000, requestTimeout: 30000, rowCollectionOnRequestCompletion: true },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      connection.once("connect", error => error ? reject(error) : resolve());
      connection.connect();
    });
    const db = new Db(connection);
    if (session) await db.query("EXEC sys.sp_set_session_context @key=N'session_hash',@value=@hash,@read_only=1;", [["hash", TYPES.Binary, hash(session)]]);
    // Local SQL connections also use the restricted runtime role, never the operator's privileges.
    if (!process.env.WEBSITE_INSTANCE_ID) await db.query("EXECUTE AS USER = N'ofek_test_runtime';");
    return await action(db);
  } finally { connection.close(); }
}
