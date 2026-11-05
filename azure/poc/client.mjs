import { execFileSync } from "node:child_process";
import { Connection, Request, TYPES } from "tedious";
export { TYPES };
export const subscription = "5edb3519-a630-43b6-82ac-cf92b84ec378";
export const tenant = "ea40c3b0-b791-4369-b99a-3c4e9f570512";

export async function connect() {
  const credentials = JSON.parse(execFileSync("az", ["account", "get-access-token",
    "--subscription", subscription, "--resource", "https://database.windows.net/", "-o", "json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  const claims = JSON.parse(Buffer.from(credentials.accessToken.split(".")[1], "base64url").toString());
  if (claims.tid !== tenant) throw new Error("Personal tenant mismatch");
  return new Promise((resolve, reject) => {
    const connection = new Connection({
      server: "sql-ofek324-osalzberg-fc.database.windows.net",
      authentication: { type: "azure-active-directory-access-token", options: { token: credentials.accessToken } },
      options: { database: "ofek-jobs-poc", encrypt: true, trustServerCertificate: false,
        connectTimeout: 60000, requestTimeout: 120000, rowCollectionOnRequestCompletion: true },
    });
    connection.once("connect", (error) => {
      if (error) { connection.close(); reject(error); } else resolve(connection);
    });
    connection.connect();
  });
}

export function query(connection, sql, parameters = []) {
  return new Promise((resolve, reject) => {
    const request = new Request(sql, (error, rowCount, rows = []) => {
      if (error) reject(error);
      else resolve(rows.map((row) => Object.fromEntries(row.map((column) => [column.metadata.colName, column.value]))));
    });
    for (const [name, type, value] of parameters) request.addParameter(name, type, value);
    if (parameters.length) connection.execSql(request); else connection.execSqlBatch(request);
  });
}
