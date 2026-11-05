import { ActionForm } from "@/components/action-form";
import { Heading, Shell } from "@/components/common";
import { token } from "@/lib/validation";
export const dynamic = "force-dynamic";
export default async function Renew({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const parsed = token.safeParse((await searchParams).token);
  return <Shell user={null}><div className="narrow stack"><Heading title="המשרה עדיין פתוחה?">לחיצה תחדש את הפרסום ל־60 ימים נוספים. פתיחת הקישור לבדה אינה משנה דבר.</Heading>
    <div className="form-panel">{parsed.success ? <ActionForm action="renew_link" label="כן, המשרה עדיין פתוחה" fields={{ token: parsed.data }} />
      : <p role="alert">קישור החידוש אינו תקין. אפשר להיכנס לחשבון ולחדש דרך המשרות שלי.</p>}</div></div></Shell>;
}
