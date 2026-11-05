import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ManagedIdentityCredential } from "@azure/identity";
import type { AccessToken, TokenCredential } from "@azure/core-auth";
import { config } from "./config";

const run = promisify(execFile);
const cache = new Map<string, AccessToken>();
const local: TokenCredential = {
  async getToken(scopes) {
    const scope = typeof scopes === "string" ? scopes : scopes[0];
    if (!["https://database.windows.net/.default", "https://storage.azure.com/.default"].includes(scope))
      throw new Error("Unsupported development credential scope");
    const cached = cache.get(scope);
    if (cached && cached.expiresOnTimestamp > Date.now() + 300000) return cached;
    const { stdout } = await run("az", ["account", "get-access-token", "--subscription", config.subscription, "--scope", scope, "-o", "json"]);
    const response = JSON.parse(stdout) as { accessToken: string };
    const claims = JSON.parse(Buffer.from(response.accessToken.split(".")[1], "base64url").toString()) as { tid: string; exp: number };
    if (claims.tid !== config.tenant) throw new Error("Wrong Azure development tenant");
    const credential = { token: response.accessToken, expiresOnTimestamp: claims.exp * 1000 };
    cache.set(scope, credential);
    return credential;
  },
};
export const credential: TokenCredential = process.env.WEBSITE_INSTANCE_ID ? new ManagedIdentityCredential() : local;
