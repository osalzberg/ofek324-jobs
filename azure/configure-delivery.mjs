import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { connect, query, TYPES, subscription, tenant } from "./poc/client.mjs";
const root = `/subscriptions/${subscription}/resourceGroups/rg-ofek-jobs-dev`;
const app = `${root}/providers/Microsoft.Web/sites/ofek324-osalzberg-dev`;
const credential = JSON.parse(execFileSync("az", ["account", "get-access-token", "--subscription", subscription,
  "--resource", "https://management.azure.com/", "-o", "json"], { encoding: "utf8" }));
if (JSON.parse(Buffer.from(credential.accessToken.split(".")[1], "base64url").toString()).tid !== tenant) throw new Error("Personal tenant mismatch");
async function arm(path, version, method, data) {
  const response = await fetch(`https://management.azure.com${path}?api-version=${version}`, {
    method, headers: { Authorization: `Bearer ${credential.accessToken}`, "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) {
    const body = await response.json();
    throw new Error(`ARM ${response.status}: ${body.error?.code ?? "request_failed"}`);
  }
  return response.json();
}
const settings = (await arm(`${app}/config/appsettings/list`, "2023-12-01", "POST", {})).properties;
if (!settings.CRON_SECRET || !settings.EMAIL_SENDER || !settings.EMAIL_CONNECTION_STRING) throw new Error("Runtime settings are incomplete");
const c = await connect();
try {
  await query(c, `MERGE authn.service_keys t USING(SELECT 'delivery' AS name,@hash AS token_hash) s ON t.name=s.name
    WHEN MATCHED THEN UPDATE SET token_hash=s.token_hash
    WHEN NOT MATCHED THEN INSERT(name,token_hash) VALUES(s.name,s.token_hash);`,
  [["hash", TYPES.Binary, createHash("sha256").update(settings.CRON_SECRET).digest()]]);
} finally { c.close(); }
console.log("Registered the delivery credential hash; no secret written locally.");
if (process.argv.includes("--enable-scheduler")) {
  const workflow = await arm(`${root}/providers/Microsoft.Logic/workflows/ofek324-hourly-delivery`, "2019-05-01", "PUT", {
    location: "westeurope", tags: { project: "ofek-jobs", environment: "development" },
    properties: {
      state: "Enabled",
      definition: {
        $schema: "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
        contentVersion: "1.0.0.0",
        parameters: { workerSecret: { type: "SecureString" } },
        triggers: { hourly: { type: "Recurrence", recurrence: { frequency: "Hour", interval: 1 },
          runtimeConfiguration: { concurrency: { runs: 1 } } } },
        actions: { deliver: { type: "Http", runAfter: {},
          inputs: { method: "POST", uri: `${settings.APP_URL}/api/tasks`,
            headers: { Authorization: "@concat('Bearer ', parameters('workerSecret'))" }, retryPolicy: { type: "none" } },
          runtimeConfiguration: { secureData: { properties: ["inputs", "outputs"] } } } },
        outputs: {},
      },
      parameters: { workerSecret: { value: settings.CRON_SECRET } },
    },
  });
  console.log(JSON.stringify({ workflow: workflow.name, state: workflow.properties.state, cadence: "hourly", secretLogs: "masked" }));
}
if (process.argv.includes("--verify-worker")) {
  const response = await fetch(`${settings.APP_URL}/api/tasks`, {
    method: "POST", headers: { Authorization: `Bearer ${settings.CRON_SECRET}` }, signal: AbortSignal.timeout(120000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Worker returned HTTP ${response.status}: ${JSON.stringify(result)}`);
  console.log(JSON.stringify({ worker: "verified", ...result }));
}
