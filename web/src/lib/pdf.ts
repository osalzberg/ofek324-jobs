import { PDFArray, PDFDict, PDFDocument, PDFName, PDFObject, PDFStream } from "pdf-lib";
export const MAX_CV_BYTES = 5 * 1024 * 1024;
export async function validatePdf(bytes: Uint8Array): Promise<void> {
  if (bytes.length < 20 || bytes.length > MAX_CV_BYTES) throw new Error("יש להעלות קובץ PDF עד 5MB");
  const header = Buffer.from(bytes.subarray(0, 8)).toString("ascii");
  const tail = Buffer.from(bytes.subarray(Math.max(0, bytes.length - 1024))).toString("ascii");
  if (!/^%PDF-[12]\.[0-9]/.test(header) || !tail.includes("%%EOF")) throw new Error("הקובץ אינו PDF תקין");
  let document: PDFDocument;
  try { document = await PDFDocument.load(bytes, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false }); }
  catch { throw new Error("לא ניתן לקרוא את ה־PDF. יש לייצא קובץ חדש ללא סיסמה"); }
  if (document.getPageCount() < 1 || document.getPageCount() > 200) throw new Error("יש להעלות PDF של 1–200 עמודים");
  const active = new Set(["JavaScript", "JS", "OpenAction", "AA", "EmbeddedFiles", "EF", "RichMedia", "XFA"]);
  const actions = new Set(["JavaScript", "Launch", "SubmitForm", "ImportData", "GoToR", "Rendition", "Movie", "Sound"]);
  const pending: PDFObject[] = document.context.enumerateIndirectObjects().map(([, object]) => object);
  const visited = new Set<PDFObject>();
  while (pending.length) {
    const object = pending.pop()!;
    if (visited.has(object)) continue;
    visited.add(object);
    if (visited.size > 50000) throw new Error("ה־PDF מורכב מדי. יש לייצא עותק פשוט יותר");
    if (object instanceof PDFStream) pending.push(object.dict);
    else if (object instanceof PDFArray) pending.push(...object.asArray());
    else if (object instanceof PDFDict) {
      for (const [key, value] of object.entries()) {
        if (active.has(key.decodeText()) || (key.decodeText() === "S" && value instanceof PDFName && actions.has(value.decodeText())))
          throw new Error("ה־PDF כולל תוכן פעיל או קבצים מצורפים. יש לייצא PDF רגיל");
        pending.push(value);
      }
    }
  }
}
