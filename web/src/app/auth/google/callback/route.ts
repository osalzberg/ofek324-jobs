import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { config, cookieOptions, googleCookie, sessionCookie } from "@/lib/config";
import { email, token } from "@/lib/validation";
import { hash, TYPES, withDb } from "@/lib/sql";
const keys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function GET(request: Request) {
  let response: NextResponse;
  try {
    const client = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
    if (!client || !secret) throw new Error("Google is not configured");
    const jar = await cookies();
    const state = z.object({ state: token, verifier: token, nonce: token }).parse(JSON.parse(jar.get(googleCookie)?.value ?? "{}"));
    const params = new URL(request.url).searchParams;
    if (!same(token.parse(params.get("state")), state.state)) throw new Error("OAuth state mismatch");
    const code = z.string().min(1).max(2048).parse(params.get("code"));
    const result = await fetch("https://oauth2.googleapis.com/token", { method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({ client_id: client, client_secret: secret, code, code_verifier: state.verifier,
        grant_type: "authorization_code", redirect_uri: `${config.url}/auth/google/callback` }),
    });
    if (!result.ok) throw new Error("Google token exchange failed");
    const data = z.object({ id_token: z.string().max(12000) }).parse(await result.json());
    const { payload } = await jwtVerify(data.id_token, keys, { issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: client, maxTokenAge: "10m", clockTolerance: 5, requiredClaims: ["sub", "email", "email_verified", "nonce"] });
    if (payload.email_verified !== true || typeof payload.nonce !== "string" || !same(payload.nonce, state.nonce))
      throw new Error("Google identity proof is invalid");
    const address = email.parse(payload.email), session = randomBytes(32).toString("base64url");
    await withDb(undefined, db => db.query("EXEC authn.google_session @email,@hash;", [
      ["email", TYPES.NVarChar, address], ["hash", TYPES.Binary, hash(session)],
    ]));
    response = NextResponse.redirect(new URL("/", config.url));
    response.cookies.set(sessionCookie, session, { ...cookieOptions, maxAge: 14 * 86400 });
  } catch (error) {
    console.error({ event: "google_signin_failed", type: error instanceof Error ? error.name : "Unknown" });
    response = NextResponse.redirect(new URL("/login?error=google", config.url));
  }
  response.cookies.delete(googleCookie);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
