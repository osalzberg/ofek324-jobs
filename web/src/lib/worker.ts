import "server-only";
import { randomBytes } from "node:crypto";
import { config } from "./config";
import { type Db, hash, TYPES, withDb } from "./sql";
import { deleteCv } from "./storage";
import { escapeHtml, sendEmail } from "./email";
interface MailItem { id: string; kind: "recommendation" | "job_expiring" | "weekly_digest"; reference_id: string; attempts: number }
interface MailPayload extends MailItem { email: string; job_title: string | null; search_name: string | null }
export async function workerDb<T>(action: (db: Db) => Promise<T>) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("Delivery credential is not configured");
  return withDb(undefined, async db => {
    await db.query("EXEC sys.sp_set_session_context @key=N'worker_hash',@value=@hash,@read_only=1;", [["hash", TYPES.Binary, hash(secret)]]);
    return action(db);
  });
}
async function finish(db: Db, id: string, state: "sent" | "skipped" | "failed" | "cancelled", provider: string | null = null, error: string | null = null) {
  await db.query("EXEC authn.finish_mail @id,@state,@provider,@error;", [
    ["id", TYPES.UniqueIdentifier, id], ["state", TYPES.VarChar, state],
    ["provider", TYPES.NVarChar, provider], ["error", TYPES.NVarChar, error],
  ]);
}
async function deliver(item: MailItem) {
  return workerDb(async db => {
    const [payload] = await db.query<MailPayload>("EXEC authn.mail_payload @id;", [["id", TYPES.UniqueIdentifier, item.id]]);
    if (!payload) { await finish(db, item.id, "cancelled"); return "cancelled"; }
    let subject: string, text: string, html: string;
    if (item.kind === "recommendation") {
      const url = `${config.url}/my-profile`;
      subject = "התקבלה המלצה שממתינה לאישורכם";
      text = `התקבלה המלצה חדשה בקהילת אופק 324. אפשר לבדוק ולאשר או להסתיר אותה בפרופיל: ${url}`;
      html = `<p>התקבלה המלצה חדשה בקהילת אופק 324.</p><p><a href="${url}">לבדיקה ולאישור בפרופיל</a></p>`;
    } else if (item.kind === "job_expiring") {
      const secret = randomBytes(32).toString("base64url");
      await db.query("EXEC authn.store_renewal @id,@hash;", [["id", TYPES.UniqueIdentifier, item.id], ["hash", TYPES.Binary, hash(secret)]]);
      const url = `${config.url}/renew?token=${secret}`;
      subject = "המשרה שלכם באופק עומדת להסתיים";
      text = `המשרה "${payload.job_title}" תסתיים בשבוע הקרוב. אם היא עדיין פתוחה, ניתן לחדש כאן: ${url}`;
      html = `<p>המשרה <strong>${escapeHtml(payload.job_title ?? "")}</strong> תסתיים בשבוע הקרוב.</p><p><a href="${url}">המשרה עדיין פתוחה — לחידוש ל־60 ימים</a></p><p>הקישור אישי וחד־פעמי. פתיחתו אינה מחדשת את המשרה ללא לחיצה מכוונת.</p>`;
    } else {
      const jobs = await db.query<{ id: string; title: string; company: string }>("EXEC authn.digest_jobs @id;", [["id", TYPES.UniqueIdentifier, item.id]]);
      if (!jobs.length) { await finish(db, item.id, "skipped"); return "skipped"; }
      subject = `משרות חדשות באופק — ${payload.search_name}`;
      text = jobs.map(job => `${job.title} · ${job.company}\n${config.url}/jobs/${job.id}`).join("\n\n") + `\n\nהפסקת עדכונים וניהול החיפושים: ${config.url}/account`;
      html = `<h2>משרות חדשות שמתאימות לחיפוש שלכם</h2><ul>${jobs.map(job =>
        `<li><a href="${config.url}/jobs/${job.id}">${escapeHtml(job.title)}</a> · ${escapeHtml(job.company)}</li>`).join("")}</ul>
        <p><a href="${config.url}/account">הפסקת עדכונים וניהול החיפושים</a></p>`;
    }
    // Recheck the live row immediately before sending, after preparing the content.
    const [eligible] = await db.query<MailPayload>("EXEC authn.mail_payload @id;", [["id", TYPES.UniqueIdentifier, item.id]]);
    if (!eligible) { await finish(db, item.id, "cancelled"); return "cancelled"; }
    try {
      const id = await sendEmail(eligible.email, subject, text, html, item.id);
      await finish(db, item.id, "sent", id);
      return "sent";
    } catch (error) {
      console.error({ event: "email_delivery_failed", outboxId: item.id, type: error instanceof Error ? error.name : "Unknown" });
      await finish(db, item.id, "failed", null, "Azure email delivery failed; inspect operation logs without message content.");
      return "failed";
    }
  });
}
export async function runDelivery() {
  const batch = await workerDb(db => db.query<MailItem>("EXEC authn.lease_mail;"));
  const results = await Promise.all(batch.map(deliver));
  const cleanup = await workerDb(db => db.query<{ object_name: string }>("EXEC authn.cleanup_objects;"));
  let removed = 0, cleanupFailed = 0;
  for (const object of cleanup) {
    try {
      await deleteCv(object.object_name);
      await workerDb(db => db.query("EXEC authn.cleanup_objects @path;", [["path", TYPES.VarChar, object.object_name]]));
      removed++;
    } catch (error) {
      cleanupFailed++;
      console.error({ event: "blob_cleanup_failed", type: error instanceof Error ? error.name : "Unknown" });
      await workerDb(db => db.query("EXEC authn.cleanup_objects @path,@error;", [
        ["path", TYPES.VarChar, object.object_name], ["error", TYPES.NVarChar, "Private blob cleanup failed; retry required."],
      ]));
    }
  }
  return { processed: results.length, sent: results.filter(r => r === "sent").length,
    skipped: results.filter(r => r === "skipped" || r === "cancelled").length,
    failed: results.filter(r => r === "failed").length, removed, cleanupFailed };
}
