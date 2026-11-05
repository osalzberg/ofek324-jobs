import type { Job, Profile, Verification, MemberCard, Recommendation } from "@/lib/types";
import { readTags } from "@/lib/validation";
import { ActionForm } from "./action-form";
import { Field, Area, Select, Check } from "./common";
import { RichEditor } from "./rich-editor";

export const workOptions = { onsite: "מהמשרד", remote: "מרחוק", hybrid: "היברידי" };
export const typeOptions = { full_time: "משרה מלאה", part_time: "משרה חלקית", student: "משרת סטודנט", freelance: "פרילנס" };
export const seniorityOptions = { junior: "ג׳וניור", mid: "מנוסה", senior: "סניור" };
const inputDate = (date: Date | null | undefined) => date ? new Date(date).toISOString().slice(0, 10) : "";

export function VerificationForm({ value }: { value?: Verification }) {
  return <ActionForm action="verification" label="שליחת בקשת אימות">
    <div className="form-grid">
      <Field label="שם מלא" name="full_name" required minLength={2} maxLength={120} autoComplete="name" defaultValue={value?.full_name} />
      <Select label="סוג הבקשה" name="requested_kind" value={value?.requested_kind ?? "unit_member"}
        options={{ unit_member: "בוגרי היחידה או לקראת שחרור", external_recruiter: "מגייסים חיצוניים — אישור מנהל בלבד" }} />
      <Field label="שנת תחילת השירות" name="unit_start_year" type="number" min={1950} max={2200} defaultValue={value?.unit_start_year ?? ""}
        hint="למגייסים חיצוניים אין צורך למלא שנות שירות" />
      <Field label="שנת סיום השירות" name="unit_end_year" type="number" min={1950} max={2200} defaultValue={value?.unit_end_year ?? ""} />
      <Field label="תאריך שחרור או שחרור מתוכנן" name="release_date" type="date" defaultValue={inputDate(value?.release_date)} />
      <Field label="פרופיל LinkedIn" name="linkedin_url" type="url" required maxLength={500}
        placeholder="https://www.linkedin.com/in/your-name" defaultValue={value?.linkedin_url} />
    </div>
    <Check name="already_released" label="כבר השתחררתי" defaultChecked={value?.already_released} />
    <p className="muted text-sm">הפרטים בטופס זמינים רק לכם ולמנהלי הקהילה. אין לציין תפקידים מסווגים, מספר אישי או פרטים מבצעיים.</p>
  </ActionForm>;
}
export function JobForm({ value }: { value?: Job }) {
  return <ActionForm action="save_job" fields={value ? { id: value.id } : {}} label={value ? "שמירת השינויים" : "פרסום המשרה"}>
    <div className="form-grid">
      <Field label="שם התפקיד" name="title" required minLength={3} maxLength={160} defaultValue={value?.title} placeholder="למשל, Full Stack Developer" />
      <Field label="החברה" name="company" required minLength={2} maxLength={120} defaultValue={value?.company} />
      <Field label="עיר" name="city" minLength={2} maxLength={120} defaultValue={value?.city ?? ""} placeholder="למשל, תל אביב" />
      <Select label="אופן העבודה" name="work_mode" options={workOptions} value={value?.work_mode ?? "hybrid"} />
      <Select label="סוג המשרה" name="job_type" options={typeOptions} value={value?.job_type ?? "full_time"} />
      <Select label="רמת ניסיון" name="seniority" options={seniorityOptions} value={value?.seniority ?? "junior"} />
      <Field label="טכנולוגיות ותחומי ידע" name="tech_tags" wide maxLength={1500} placeholder="React, Python, SQL"
        defaultValue={value ? readTags(value.tech_tags).join(", ") : ""} hint="עד 30 תגיות, מופרדות בפסיקים" />
    </div>
    <RichEditor initial={value?.description} />
    <div className="form-grid">
      <Field label="שכר מינימלי — לא חובה" name="salary_min" type="number" min={0} step={0.01} defaultValue={value?.salary_min ?? ""} />
      <Field label="שכר מרבי — לא חובה" name="salary_max" type="number" min={0} step={0.01} defaultValue={value?.salary_max ?? ""} />
      <Select label="מטבע" name="salary_currency" value={value?.salary_currency ?? "ILS"} options={{ ILS: "שקל", USD: "דולר", EUR: "אירו" }} />
      <Select label="תקופת השכר" name="salary_period" value={value?.salary_period ?? "month"} options={{ month: "לחודש", year: "לשנה", hour: "לשעה" }} />
      <Select label="הגשת מועמדות" name="apply_method" value={value?.apply_method ?? "profile"}
        options={{ profile: "עם הפרופיל באתר", email: "באימייל", external_link: "בקישור חיצוני" }} />
      <Field label="אימייל להגשת מועמדות" name="apply_email" type="email" maxLength={254} defaultValue={value?.apply_email ?? ""} hint="רק אם בחרתם בהגשה באימייל" />
      <Field label="קישור להגשת מועמדות" name="apply_url" type="url" maxLength={2000} defaultValue={value?.apply_url ?? ""} hint="רק אם בחרתם בקישור חיצוני; נדרש https" wide />
    </div>
    <Check name="referral_available" label="אפשר לפנות אליי להפניה אישית לחברה" defaultChecked={value?.referral_available} />
    <div className="notice">המשרה תישאר פתוחה ל־60 ימים. תזכורת לחידוש תישלח שבוע לפני התפוגה. אין לפרסם מידע שלא אושר לפרסום.</div>
  </ActionForm>;
}
export function ProfileForm({ value, name }: { value?: Profile; name?: string }) {
  return <ActionForm action="save_profile" label="שמירת הפרופיל">
    <div className="form-grid">
      <Field label="שם מלא" name="full_name" autoComplete="name" required minLength={2} maxLength={120} defaultValue={value?.full_name ?? name} />
      <Field label="כותרת מקצועית" name="headline" required minLength={3} maxLength={200} defaultValue={value?.headline} placeholder="למשל, מפתחת תוכנה לקראת שחרור" />
      <Field label="תאריך שחרור" name="release_date" type="date" defaultValue={inputDate(value?.release_date)} />
      <Field label="שנות ניסיון" name="years_experience" type="number" min={0} max={70} step={0.1} required defaultValue={value?.years_experience ?? 0} />
      <Field label="כישורים" name="skills" wide maxLength={3000} placeholder="Python, React, ניהול פרויקטים" defaultValue={value ? readTags(value.skills).join(", ") : ""} hint="עד 50 כישורים, מופרדים בפסיקים" />
      <Field label="תפקידים מועדפים" name="preferred_roles" maxLength={2000} defaultValue={value ? readTags(value.preferred_roles).join(", ") : ""} hint="מופרדים בפסיקים" />
      <Field label="מיקומים מועדפים" name="preferred_locations" maxLength={2000} defaultValue={value ? readTags(value.preferred_locations).join(", ") : ""} hint="למשל, תל אביב, חיפה, מרחוק" />
      <Field label="LinkedIn" name="linkedin_url" type="url" maxLength={500} defaultValue={value?.linkedin_url ?? ""} />
      <Field label="GitHub" name="github_url" type="url" maxLength={500} defaultValue={value?.github_url ?? ""} />
      <Select label="סטטוס החיפוש" name="status" value={value?.status ?? "hidden"}
        options={{ actively_looking: "בחיפוש פעיל", open_to_offers: "פתוח להצעות", hidden: "מוסתר — רק אני והמנהלים" }} />
    </div>
    <Check name="already_released" label="כבר השתחררתי" defaultChecked={value?.already_released} />
    <Area label="כמה מילים עליי" name="bio" maxLength={3000} rows={5} defaultValue={value?.bio ?? ""} />
    <p className="muted text-sm">גם פרופיל פעיל זמין רק לחברי קהילה מאומתים. הסתרה מסירה את הפרטים גם מרשימות מועמדים של מפרסמים.</p>
  </ActionForm>;
}
export function CardForm({ value }: { value: MemberCard }) {
  return <ActionForm action="save_card" label="שמירת כרטיס החברות">
    <div className="notice">השם ושנות השירות בכרטיס מגיעים מטופס האימות המאושר. הכותרת והתפקיד הנוכחי הם פרטים שאתם מעדכנים.</div>
    <Field label="כותרת מקצועית" name="headline" maxLength={200} defaultValue={value.headline} />
    <div className="form-grid"><Field label="תפקיד נוכחי" name="current_title" maxLength={120} defaultValue={value.current_title} />
      <Field label="חברה" name="company" maxLength={120} defaultValue={value.company} /></div>
    <Check name="published" defaultChecked={value.published} label="פרסום כרטיס החברות בקהילה והצגתו לצד המלצות שאכתוב" />
    <p className="muted text-sm">הכרטיס נפרד מפרופיל חיפוש העבודה. הוא אינו חושף קורות חיים, תאריך שחרור או פרופיל שהוסתר.</p>
  </ActionForm>;
}
export function RecommendationForm({ seeker, value }: { seeker: string; value?: Recommendation }) {
  return <ActionForm action="recommend" label={value ? "שמירת ההמלצה" : "שליחת ההמלצה לאישור"}
    fields={{ seeker_id: seeker, revision: value?.revision ?? "" }}>
    <Area label="ההמלצה" name="text" required minLength={20} maxLength={4000} rows={5} defaultValue={value?.text}
      placeholder="מה כדאי לדעת על העבודה המשותפת, הכישורים והאיכויות המקצועיות?" />
    <Field label="איך הכרתם — לא חובה" name="relationship" minLength={2} maxLength={160} defaultValue={value?.relationship ?? ""}
      placeholder="למשל, עבדנו באותו צוות" />
    <p className="muted text-sm">בלי מידע מסווג או פרטים שלא אושרו לפרסום. עריכה של המלצה מאושרת מחייבת אישור מחדש. המלצה שהוסתרה תישאר מוסתרת.</p>
  </ActionForm>;
}
