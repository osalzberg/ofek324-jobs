"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { challengeCookie, cookieOptions, sessionCookie } from "./config";
import { currentToken, viewer } from "./auth";
import { hash, TYPES, withDb } from "./sql";
import { sendLogin } from "./email";
import { uploadCv } from "./storage";
import { MAX_CV_BYTES, validatePdf } from "./pdf";
import { cardInput, email, jobInput, profileInput, recommendationInput, searchInput, token, uuid, verificationInput } from "./validation";

export interface ActionState { error?: string; success?: string; inviteCode?: string }
class InputError extends Error {}
const idOf = (form: FormData, key = "id") => uuid.parse(form.get(key));
const payload = (form: FormData) => Object.fromEntries([...form.entries()].filter(([key]) => !key.startsWith("$ACTION_")));
const confirmation = (form: FormData) => { if (form.get("confirm") !== "on") throw new InputError("יש לאשר את הפעולה לפני ההמשך"); };
const errorText: Record<string, string> = {
  invalid_or_expired_link: "הקישור כבר נוצל, פג תוקפו או נפתח בדפדפן אחר. יש לבקש קישור חדש.",
  rate_limited: "הגעתם למגבלת הבקשות. אפשר לנסות שוב מאוחר יותר.",
  forbidden: "אין הרשאה לפעולה הזו.", verification_required: "יש למלא קודם את טופס האימות.",
  invalid_invite: "קוד ההזמנה אינו תקין, כבר נוצל או בוטל.",
  invite_unavailable: "ההזמנה הזו כבר נוצלה. אפשר לבחור משבצת פנויה.",
  stale_revision: "התוכן השתנה מאז פתיחת העמוד. יש לרענן ולבדוק שוב לפני האישור.",
  alumni_only: "רק חברי קהילה מאומתים שכבר השתחררו יכולים לכתוב המלצה.",
  published_card_required: "יש לפרסם קודם את כרטיס החברות בעמוד החשבון.",
  visible_profile_required: "כדי להגיש מועמדות, יש לפרסם פרופיל שאינו מוסתר.",
  job_unavailable: "המשרה אינה זמינה להגשת מועמדות דרך האתר.",
  already_applied: "כבר הגשתם מועמדות למשרה הזו.",
  pending_upload_limit: "יש כמה העלאות שלא הושלמו. אפשר לנסות שוב לאחר הניקוי האוטומטי.",
  search_limit: "אפשר לשמור עד 10 חיפושים. יש להסיר חיפוש קיים כדי להוסיף חדש.",
};

async function dispatch(form: FormData): Promise<ActionState & { location?: string }> {
  const action = z.string().max(40).parse(form.get("action"));
  const jar = await cookies();
  if (action === "request_login") {
    const address = email.parse(form.get("email"));
    const secret = randomBytes(32).toString("base64url");
    const challenge = randomBytes(32).toString("base64url");
    const requestHeaders = await headers();
    const ip = (requestHeaders.get("x-forwarded-for") ?? "local").split(",")[0].trim();
    await withDb(undefined, db => db.query("EXEC authn.request_link @email,@token_hash,@challenge_hash,@ip_hash;", [
      ["email", TYPES.NVarChar, address], ["token_hash", TYPES.Binary, hash(secret)],
      ["challenge_hash", TYPES.Binary, hash(challenge)], ["ip_hash", TYPES.Binary, hash(ip)],
    ]));
    jar.set(challengeCookie, challenge, { ...cookieOptions, maxAge: 900 });
    await sendLogin(address, secret);
    return { success: "קישור הכניסה נשלח. יש לפתוח אותו באותו דפדפן בתוך 15 דקות. כדאי לבדוק גם בתיקיית הספאם." };
  }
  if (action === "consume_login") {
    const secret = token.parse(form.get("token"));
    const challenge = token.safeParse(jar.get(challengeCookie)?.value);
    if (!challenge.success) throw new InputError(errorText.invalid_or_expired_link);
    const session = randomBytes(32).toString("base64url");
    await withDb(undefined, db => db.query("EXEC authn.consume_link @token_hash,@challenge_hash,@session_hash;", [
      ["token_hash", TYPES.Binary, hash(secret)], ["challenge_hash", TYPES.Binary, hash(challenge.data)],
      ["session_hash", TYPES.Binary, hash(session)],
    ]));
    jar.set(sessionCookie, session, { ...cookieOptions, maxAge: 14 * 86400 });
    jar.delete(challengeCookie);
    return { location: "/" };
  }
  if (action === "renew_link") {
    const secret = token.parse(form.get("token"));
    await withDb(undefined, db => db.query("EXEC authn.redeem_renewal @hash;", [["hash", TYPES.Binary, hash(secret)]]));
    return { success: "המשרה חודשה ל־60 ימים נוספים. אפשר לסגור את החלון." };
  }
  const session = await currentToken();
  const user = await viewer();
  if (action === "sign_out") {
    if (session) await withDb(session, db => db.query("EXEC authn.sign_out;"));
    jar.delete(sessionCookie);
    return { location: "/login" };
  }
  if (!user || !session) throw new InputError("יש להיכנס לחשבון כדי להמשיך");
  if (action === "verification") {
    const data = verificationInput.parse(payload(form));
    await withDb(session, db => db.query("EXEC app.submit_verification @data;", [["data", TYPES.NVarChar, JSON.stringify(data)]]));
    return { success: "הבקשה נשמרה ונשלחה לבדיקה. אפשר גם להזין קוד הזמנה מחבר או חברת קהילה." };
  }
  if (action === "redeem_invite") {
    const code = token.parse(z.string().trim().parse(form.get("code")));
    await withDb(session, db => db.query("EXEC app.redeem_invite @hash;", [["hash", TYPES.Binary, hash(code)]]));
    return { location: "/" };
  }
  if (user.status !== "approved") throw new InputError("הגישה לקהילה תיפתח לאחר אישור החברות");
  return withDb(session, async db => {
    switch (action) {
      case "save_job": {
        const data = jobInput.parse(payload(form));
        const id = form.get("id") ? idOf(form) : null;
        const [result] = await db.query<{ id: string }>("EXEC app.save_job @data,@id;", [
          ["data", TYPES.NVarChar, JSON.stringify(data)], ["id", TYPES.UniqueIdentifier, id],
        ]);
        return { location: `/jobs/${result.id}` };
      }
      case "job_action": {
        const operation = z.enum(["renew", "close", "delete"]).parse(form.get("operation"));
        if (operation === "delete") confirmation(form);
        await db.query("EXEC app.job_action @id,@operation;", [
          ["id", TYPES.UniqueIdentifier, idOf(form)], ["operation", TYPES.VarChar, operation],
        ]);
        return operation === "delete" ? { location: "/my-jobs" } : { success: operation === "renew" ? "המשרה חודשה ל־60 ימים" : "המשרה נסגרה" };
      }
      case "save_profile": {
        const data = profileInput.parse(payload(form));
        await db.query("EXEC app.save_profile @data;", [["data", TYPES.NVarChar, JSON.stringify(data)]]);
        return { success: "הפרופיל נשמר" };
      }
      case "profile_action": {
        confirmation(form);
        const operation = z.enum(["delete", "moderate", "restore"]).parse(form.get("operation"));
        const member = idOf(form, "member_id");
        await db.query("EXEC app.profile_action @member,@operation;", [
          ["member", TYPES.UniqueIdentifier, member], ["operation", TYPES.VarChar, operation],
        ]);
        return { location: member === user.id ? "/my-profile" : "/admin" };
      }
      case "save_card": {
        const data = cardInput.parse(payload(form));
        await db.query("EXEC app.save_card @headline,@title,@company,@published;", [
          ["headline", TYPES.NVarChar, data.headline], ["title", TYPES.NVarChar, data.current_title],
          ["company", TYPES.NVarChar, data.company], ["published", TYPES.Bit, data.published],
        ]);
        return { success: "כרטיס החברות עודכן" };
      }
      case "upload_cv": {
        if (form.get("attested") !== "on") throw new InputError("יש לאשר שקורות החיים נקיים ממידע מסווג וממידע שלא אושר לפרסום");
        const file = form.get("cv");
        if (!(file instanceof File) || file.size === 0 || file.size > MAX_CV_BYTES || !/\.pdf$/i.test(file.name))
          throw new InputError("יש לבחור קובץ PDF עד 5MB");
        const bytes = Buffer.from(await file.arrayBuffer());
        try { await validatePdf(bytes); } catch (error) {
          if (error instanceof Error) throw new InputError(error.message);
          throw error;
        }
        const id = randomUUID();
        const name = file.name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 196).replace(/\.pdf$/i, "") + ".pdf";
        const [document] = await db.query<{ object_name: string }>("EXEC app.begin_cv @id,@name,@size,@hash,1;", [
          ["id", TYPES.UniqueIdentifier, id], ["name", TYPES.NVarChar, name],
          ["size", TYPES.Int, bytes.length], ["hash", TYPES.Binary, hash(bytes)],
        ]);
        try {
          await uploadCv(document.object_name, bytes);
          await db.query("EXEC app.finish_cv @id;", [["id", TYPES.UniqueIdentifier, id]]);
        } catch (error) {
          try { await db.query("EXEC app.remove_cv @id;", [["id", TYPES.UniqueIdentifier, id]]); }
          catch { console.error({ event: "cv_cleanup_deferred", documentId: id }); }
          throw error;
        }
        return { success: "קורות החיים הועלו לאחסון פרטי" };
      }
      case "remove_cv":
        confirmation(form);
        await db.query("EXEC app.remove_cv @id;", [["id", TYPES.UniqueIdentifier, idOf(form)]]);
        return { success: "קורות החיים הוסרו מהפרופיל ונשלחו למחיקה מהאחסון" };
      case "apply":
        await db.query("EXEC app.apply @job;", [["job", TYPES.UniqueIdentifier, idOf(form)]]);
        return { success: "המועמדות נשלחה. הפרופיל יופיע ברשימת הפניות למפרסם המשרה." };
      case "withdraw":
        confirmation(form);
        await db.query("EXEC app.withdraw @job;", [["job", TYPES.UniqueIdentifier, idOf(form)]]);
        return { success: "המועמדות בוטלה" };
      case "recommend": {
        const data = recommendationInput.parse(payload(form));
        await db.query("EXEC app.write_recommendation @seeker,@text,@relationship,@revision;", [
          ["seeker", TYPES.UniqueIdentifier, data.seeker_id], ["text", TYPES.NVarChar, data.text],
          ["relationship", TYPES.NVarChar, data.relationship], ["revision", TYPES.Int, data.revision],
        ]);
        return { success: "ההמלצה נשמרה. היא תוצג לאחר אישור האדם שעליו כתבתם." };
      }
      case "review_recommendation":
        await db.query("EXEC app.review_recommendation @id,@revision,@status;", [
          ["id", TYPES.UniqueIdentifier, idOf(form)], ["revision", TYPES.Int, z.coerce.number().int().positive().parse(form.get("revision"))],
          ["status", TYPES.VarChar, z.enum(["approved", "hidden"]).parse(form.get("status"))],
        ]);
        return { success: "ההמלצה עודכנה" };
      case "delete_recommendation":
        confirmation(form);
        await db.query("EXEC app.delete_recommendation @id;", [["id", TYPES.UniqueIdentifier, idOf(form)]]);
        return { success: "ההמלצה הוסרה" };
      case "issue_invite": {
        const code = randomBytes(32).toString("base64url");
        await db.query("EXEC app.issue_invite @slot,@hash;", [
          ["slot", TYPES.TinyInt, z.coerce.number().int().min(1).max(5).parse(form.get("slot"))], ["hash", TYPES.Binary, hash(code)],
        ]);
        return { inviteCode: code, success: "הקוד מוצג רק עכשיו. יש להעתיק ולשתף אותו באופן פרטי. קוד קודם מאותה משבצת אינו תקף עוד." };
      }
      case "revoke_invite":
        await db.query("EXEC app.revoke_invite @slot;", [["slot", TYPES.TinyInt, z.coerce.number().int().min(1).max(5).parse(form.get("slot"))]]);
        return { success: "הקוד בוטל" };
      case "save_search": {
        const filters = searchInput.parse(JSON.parse(z.string().max(4000).parse(form.get("filters"))));
        await db.query("EXEC app.save_search @name,@filters,@enabled,@id;", [
          ["name", TYPES.NVarChar, z.string().trim().min(1).max(100).parse(form.get("name"))],
          ["filters", TYPES.NVarChar, JSON.stringify(filters)], ["enabled", TYPES.Bit, form.get("email_enabled") === "on"],
          ["id", TYPES.UniqueIdentifier, form.get("id") ? idOf(form) : null],
        ]);
        return { success: "החיפוש נשמר. עדכון שבועי יישלח רק אם בחרתם לקבל אימיילים." };
      }
      case "delete_search":
        confirmation(form);
        await db.query("EXEC app.delete_search @id;", [["id", TYPES.UniqueIdentifier, idOf(form)]]);
        return { success: "החיפוש הוסר והעדכונים בוטלו" };
      case "admin_decide": {
        if (!user.is_admin) throw new InputError("הפעולה זמינה למנהלים בלבד");
        const decision = z.enum(["approve", "reject", "ban"]).parse(form.get("decision"));
        if (decision !== "approve") confirmation(form);
        await db.query("EXEC app.admin_decide @member,@decision,@reason;", [
          ["member", TYPES.UniqueIdentifier, idOf(form, "member_id")], ["decision", TYPES.VarChar, decision],
          ["reason", TYPES.NVarChar, z.string().max(1000).parse(form.get("reason") ?? "")],
        ]);
        return { success: "החלטת האימות נשמרה" };
      }
      default: throw new InputError("הפעולה אינה מוכרת");
    }
  });
}

export async function runAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  let result: ActionState & { location?: string };
  try { result = await dispatch(form); }
  catch (error) {
    if (error instanceof z.ZodError) return { error: error.issues[0]?.message ?? "יש לבדוק את פרטי הטופס" };
    if (error instanceof InputError) return { error: error.message };
    const failure = error as { number?: number; code?: string; message?: string; errors?: { message?: string }[] };
    const messages = [failure.message, ...(failure.errors ?? []).map(item => item.message)];
    for (const message of messages) if (message && errorText[message]) return { error: errorText[message] };
    if (failure.number === 2601 || failure.number === 2627) return { error: "הרשומה הזו כבר קיימת. יש לרענן ולבדוק את הפרטים." };
    console.error({ event: "action_failed", action: form.get("action"), code: failure.code, number: failure.number });
    return { error: "הפעולה לא הושלמה. יש לנסות שוב; אם התקלה נמשכת, יש לפנות למנהל הקהילה." };
  }
  revalidatePath("/", "layout");
  if (result.location) redirect(result.location);
  return result;
}
