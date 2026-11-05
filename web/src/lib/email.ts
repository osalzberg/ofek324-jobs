import "server-only";
import { EmailClient } from "@azure/communication-email";
import { config } from "./config";

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export async function sendEmail(to: string, subject: string, text: string, html: string, operationId?: string) {
  if (to.endsWith("@example.invalid")) throw new Error("Synthetic fixture recipients must never receive email");
  if (process.env.EMAIL_DELIVERY_DISABLED === "true") throw new Error("Email delivery is disabled in this local test process");
  const connection = process.env.EMAIL_CONNECTION_STRING;
  const sender = process.env.EMAIL_SENDER;
  if (!connection || !sender) throw new Error("Azure email sender is not configured");
  const client = new EmailClient(connection);
  const poller = await client.beginSend({
    senderAddress: sender, recipients: { to: [{ address: to }] },
    content: { subject, plainText: text, html: `<div lang="he" dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8">${html}</div>` },
  }, { operationId, updateIntervalInMs: 2000 });
  const result = await poller.pollUntilDone({ abortSignal: AbortSignal.timeout(90000) });
  if (result.status !== "Succeeded") throw new Error(`Azure email operation did not succeed: ${result.status}`);
  return result.id;
}
export async function sendLogin(email: string, token: string) {
  const url = `${config.url}/auth/verify?token=${encodeURIComponent(token)}`;
  await sendEmail(email, "קישור הכניסה לאופק 324",
    `לכניסה באותו דפדפן שבו ביקשתם את הקישור: ${url}\nהקישור אישי, חד־פעמי ובתוקף ל־15 דקות. אם לא ביקשתם להיכנס, אין צורך לעשות דבר.`,
    `<h1>הכניסה לאופק 324</h1><p>הקישור אישי וחד־פעמי, ובתוקף ל־15 דקות. יש לפתוח אותו באותו דפדפן שבו ביקשתם להיכנס.</p><p><a href="${escapeHtml(url)}">המשך לכניסה</a></p><p>אם לא ביקשתם להיכנס, אין צורך לעשות דבר.</p>`);
}
