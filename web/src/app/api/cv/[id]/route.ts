import { NextResponse } from "next/server";
import { currentToken, viewer } from "@/lib/auth";
import { withDb, TYPES } from "@/lib/sql";
import { signedCv } from "@/lib/storage";
import { uuid } from "@/lib/validation";
import type { CvDocument } from "@/lib/types";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await viewer();
  if (!user || user.status !== "approved") return new Response("Unauthorized", { status: 401 });
  const id = uuid.safeParse((await params).id);
  if (!id.success) return new Response("Not found", { status: 404 });
  const [document] = await withDb(await currentToken(), db => db.query<CvDocument>(
    "SELECT * FROM app.cv_documents WHERE id=@id AND state='ready';", [["id", TYPES.UniqueIdentifier, id.data]]));
  if (!document) return new Response("Not found", { status: 404 });
  const url = await signedCv(document.object_name);
  return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}
