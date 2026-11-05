import { z } from "zod";

const text = (min: number, max: number) => z.string().trim().min(min, `נדרשים לפחות ${min} תווים`).max(max, `עד ${max} תווים`);
const nullableText = (max: number) => z.preprocess(v => v === "" || v == null ? null : v, text(1, max).nullable());
const bool = z.preprocess(v => v === true || v === "on" || v === "1", z.boolean());
const optionalNumber = (min: number, max: number) => z.preprocess(v => v === "" || v == null ? null : Number(v), z.number().min(min).max(max).nullable());
const date = z.preprocess(v => v === "" || v == null ? null : v, z.iso.date("התאריך אינו תקין").nullable());
const linkedin = z.preprocess(v => v === "" || v == null ? null : v,
  z.string().max(500).regex(/^https:\/\/(www\.)?linkedin\.com\/in\/[^/?#\s]+\/?$/, "יש להזין קישור לפרופיל LinkedIn").nullable());
const github = z.preprocess(v => v === "" || v == null ? null : v,
  z.string().max(500).regex(/^https:\/\/(www\.)?github\.com\/[a-zA-Z0-9-]+\/?$/, "יש להזין קישור לפרופיל GitHub").nullable());
const list = (max: number, itemMax = 40) => z.preprocess(v =>
  typeof v === "string" ? [...new Set(v.split(",").map(s => s.trim().normalize("NFKC")).filter(Boolean))] : v,
z.array(text(1, itemMax)).max(max, `עד ${max} פריטים`));
export const uuid = z.uuid();
export const email = z.email("כתובת האימייל אינה תקינה").max(254).transform(v => v.toLowerCase());
export const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const verificationInput = z.object({
  full_name: text(2, 120), requested_kind: z.enum(["unit_member", "external_recruiter"]),
  unit_start_year: optionalNumber(1950, 2200), unit_end_year: optionalNumber(1950, 2200),
  release_date: date, already_released: bool, linkedin_url: linkedin,
}).superRefine((v, ctx) => {
  if (!v.linkedin_url) ctx.addIssue({ code: "custom", path: ["linkedin_url"], message: "נדרש קישור לפרופיל LinkedIn" });
  if (v.requested_kind === "unit_member" && (!v.unit_start_year || (!v.already_released && !v.release_date)))
    ctx.addIssue({ code: "custom", message: "יש למלא שנת תחילת שירות ומועד שחרור" });
  if (v.unit_start_year && !Number.isInteger(v.unit_start_year) || v.unit_end_year && !Number.isInteger(v.unit_end_year))
    ctx.addIssue({ code: "custom", message: "שנות השירות צריכות להיות שנים שלמות" });
  if (v.unit_start_year && v.unit_end_year && v.unit_end_year < v.unit_start_year)
    ctx.addIssue({ code: "custom", message: "שנת סיום השירות קודמת לשנת ההתחלה" });
}).transform(v => v.requested_kind === "external_recruiter"
  ? { ...v, unit_start_year: null, unit_end_year: null, release_date: null, already_released: false } : v);

export const jobInput = z.object({
  title: text(3, 160), company: text(2, 120), city: nullableText(120),
  work_mode: z.enum(["onsite", "remote", "hybrid"]), job_type: z.enum(["full_time", "part_time", "student", "freelance"]),
  seniority: z.enum(["junior", "mid", "senior"]), tech_tags: list(30),
  description: text(20, 30000), salary_min: optionalNumber(0, 9999999999), salary_max: optionalNumber(0, 9999999999),
  salary_currency: z.enum(["ILS", "USD", "EUR"]), salary_period: z.enum(["hour", "month", "year"]),
  apply_method: z.enum(["email", "external_link", "profile"]),
  apply_email: z.preprocess(v => v === "" || v == null ? null : v, email.nullable()),
  apply_url: z.preprocess(v => v === "" || v == null ? null : v, z.url().max(2000).refine(v => new URL(v).protocol === "https:", "הקישור חייב להתחיל ב־https").nullable()),
  referral_available: bool,
}).superRefine((v, ctx) => {
  if (v.work_mode !== "remote" && !v.city) ctx.addIssue({ code: "custom", message: "יש להזין עיר" });
  if (v.salary_min != null && v.salary_max != null && v.salary_min > v.salary_max)
    ctx.addIssue({ code: "custom", message: "טווח השכר אינו תקין" });
  if (v.apply_method === "email" && !v.apply_email) ctx.addIssue({ code: "custom", message: "נדרשת כתובת אימייל להגשת מועמדות" });
  if (v.apply_method === "external_link" && !v.apply_url) ctx.addIssue({ code: "custom", message: "נדרש קישור להגשת מועמדות" });
}).transform(v => ({ ...v, tech_tags: v.tech_tags.map(t => t.toLowerCase()),
  apply_email: v.apply_method === "email" ? v.apply_email : null,
  apply_url: v.apply_method === "external_link" ? v.apply_url : null }));

export const profileInput = z.object({
  full_name: text(2, 120), headline: text(3, 200), release_date: date, already_released: bool,
  years_experience: z.coerce.number().min(0).max(70), skills: list(50), preferred_roles: list(15, 120),
  preferred_locations: list(15, 120), linkedin_url: linkedin, github_url: github,
  bio: z.string().trim().max(3000), status: z.enum(["actively_looking", "open_to_offers", "hidden"]),
}).refine(v => v.already_released || v.release_date, "יש להזין מועד שחרור או לסמן שכבר השתחררתם")
  .transform(v => ({ ...v, skills: v.skills.map(s => s.toLowerCase()) }));
export const cardInput = z.object({
  headline: z.string().trim().max(200), current_title: z.string().trim().max(120),
  company: z.string().trim().max(120), published: bool,
});
export const recommendationInput = z.object({
  seeker_id: uuid, text: text(20, 4000), relationship: nullableText(160),
  revision: z.preprocess(v => v === "" || v == null ? null : Number(v), z.number().int().positive().nullable()),
}).refine(v => v.relationship === null || v.relationship.length >= 2, "יש להוסיף פירוט קצר של ההיכרות");
export const searchInput = z.object({
  query: z.string().trim().max(200).default(""), tags: z.string().trim().max(1000).default(""),
  city: z.string().trim().max(120).default(""),
  work_mode: z.enum(["", "onsite", "remote", "hybrid"]).default(""),
  job_type: z.enum(["", "full_time", "part_time", "student", "freelance"]).default(""),
  seniority: z.enum(["", "junior", "mid", "senior"]).default(""),
  referral: z.enum(["", "1"]).default(""), days: z.enum(["", "7", "30", "60"]).default(""),
});
export type JobFilters = z.infer<typeof searchInput>;
export const labels: Record<string, string> = {
  full_time: "משרה מלאה", part_time: "משרה חלקית", student: "משרת סטודנט", freelance: "פרילנס",
  junior: "ג׳וניור", mid: "מנוסה", senior: "סניור", onsite: "מהמשרד", remote: "מרחוק", hybrid: "היברידי",
  actively_looking: "בחיפוש פעיל", open_to_offers: "פתוח להצעות", hidden: "מוסתר",
  pending: "ממתין לאישור", approved: "מאושר", rejected: "לא אושר", banned: "חסום",
  unit_member: "חברות בקהילה", external_recruiter: "גיוס חיצוני", month: "לחודש", year: "לשנה", hour: "לשעה",
};
export function readTags(value: string): string[] { return z.array(z.string()).parse(JSON.parse(value)); }
export function formatDate(value: Date | string | null) {
  return value ? new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem" }).format(new Date(value)) : "—";
}
