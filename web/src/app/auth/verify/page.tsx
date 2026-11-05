import { ActionForm } from "@/components/action-form";
import { Heading, Shell, LinkButton } from "@/components/common";
import { token } from "@/lib/validation";
export const dynamic = "force-dynamic";
export default async function Verify({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const parsed = token.safeParse((await searchParams).token);
  return <Shell user={null}><div className="narrow stack"><Heading title="ממשיכים לכניסה">הקישור לא נוצל עדיין. הכניסה תתבצע רק בלחיצה על הכפתור.</Heading>
    <div className="form-panel">{parsed.success ? <ActionForm action="consume_login" fields={{ token: parsed.data }} label="כניסה לחשבון">
      <p className="muted">יש להמשיך באותו דפדפן שבו ביקשתם את הקישור. הקישור אישי, חד־פעמי ובתוקף ל־15 דקות.</p>
    </ActionForm> : <div className="stack"><p role="alert">הקישור אינו תקין.</p><LinkButton href="/login">בקשת קישור חדש</LinkButton></div>}</div></div></Shell>;
}
