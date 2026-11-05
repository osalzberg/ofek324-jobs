import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { config, cookieOptions, googleCookie } from "@/lib/config";
export async function GET() {
  const client = process.env.GOOGLE_CLIENT_ID;
  if (!client || !process.env.GOOGLE_CLIENT_SECRET) return new Response("Google sign-in is not configured", { status: 503 });
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const parameters = new URLSearchParams({
    client_id: client, redirect_uri: `${config.url}/auth/google/callback`, response_type: "code",
    scope: "openid email profile", state, nonce, code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  });
  const response = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${parameters}`);
  response.cookies.set(googleCookie, JSON.stringify({ state, verifier, nonce }), { ...cookieOptions, maxAge: 600 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
