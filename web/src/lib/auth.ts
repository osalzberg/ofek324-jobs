import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionCookie } from "./config";
import { token } from "./validation";
import { withDb, type Db } from "./sql";
import type { Viewer } from "./types";

export async function currentToken() {
  const value = (await cookies()).get(sessionCookie)?.value;
  return token.safeParse(value).success ? value : undefined;
}
export const viewer = cache(async (): Promise<Viewer | null> => {
  const session = await currentToken();
  if (!session) return null;
  const rows = await withDb(session, db => db.query<Viewer>("EXEC authn.me;"));
  return rows[0] ?? null;
});
export async function requireMember(admin = false): Promise<Viewer> {
  const user = await viewer();
  if (!user) redirect("/login");
  if (user.status !== "approved") redirect("/pending");
  if (admin && !user.is_admin) redirect("/");
  return user;
}
export async function userDb<T>(action: (db: Db) => Promise<T>): Promise<T> {
  return withDb(await currentToken(), action);
}
