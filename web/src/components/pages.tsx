import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireMember, userDb, viewer } from "@/lib/auth";
import { jobs, jobFilters, pageNumber, profiles, recommendations, scalar, type QueryParams } from "@/lib/data";
import { TYPES } from "@/lib/sql";
import { formatDate, labels, searchInput, uuid } from "@/lib/validation";
import type { AdminMember, Applicant, CvDocument, Invite, Job, MemberCard, Profile, Recommendation, SavedSearch, Stats, Verification, Viewer } from "@/lib/types";
import { ActionForm } from "./action-form";
import { AppLink, AuthorPreview, Check, CountBadge, Empty, Field, Heading, JobCard, LinkButton, Pagination, ProfileCard, Select, Shell, Tags } from "./common";
import { CardForm, JobForm, ProfileForm, RecommendationForm, seniorityOptions, typeOptions, VerificationForm, workOptions } from "./forms";
import { Markdown } from "./markdown";

function Landing() {
  return <><section className="hero landing-grid">
    <div><p className="eyebrow">קהילת הקריירה של אופק 324</p><h1 className="landing-title">הצעד הבא,<br />עם האנשים שלכם.</h1>
      <p className="lead">משרות, חיבורים והמלצות מאנשים שמכירים את הדרך.<br />לבוגרי ובוגרות היחידה ולמי שכבר מסתכלים על היום שאחרי השחרור.</p>
      <div className="action-row"><LinkButton href="/login">כניסה לקהילה ←</LinkButton><a href="#how" className="muted px-3">איך מצטרפים?</a></div>
      <p className="muted text-sm mt-5">קהילה סגורה. כניסה רק לאחר אימות ואישור.</p></div>
    <div className="landing-panel"><p className="eyebrow">נשארים מחוברים. ממשיכים קדימה.</p>
      <div className="stack"><div><h3>הזדמנויות מבפנים</h3><p className="muted">משרות דרך בוגרי היחידה ומגייסים שאושרו בקהילה.</p></div>
      <div className="divider" /><div><h3>אנשים, לא רק קורות חיים</h3><p className="muted">פרופיל מקצועי, כישורים והמלצות מאנשים שעבדו איתכם.</p></div>
      <div className="divider" /><div><h3>פרטיות כבר מהכניסה</h3><p className="muted">הפרופילים וקורות החיים אינם ציבוריים. אתם בוחרים מתי להיחשף.</p></div></div></div>
  </section><section id="how" className="form-panel"><h2>איך מצטרפים?</h2><p className="lead">נכנסים עם אימייל, ממלאים טופס אימות קצר וממתינים לאישור.
    קוד הזמנה מחבר או חברת קהילה מאומתים יכול לפתוח את הגישה מיד לאחר מילוי הטופס. מגייסים חיצוניים נדרשים לאישור מנהל.</p></section></>;
}
async function Home({ user }: { user: Viewer }) {
  const data = await userDb(async db => ({
    jobs: await jobs(db, searchInput.parse({})),
    stats: (await db.query<{ members: number; active_jobs: number; releasing: number }>("EXEC app.community_stats;"))[0],
  }));
  return <><section className="hero"><p className="eyebrow">טוב להיות בין האנשים שלכם</p><Heading title="האופק הבא מתחיל כאן."
    action={<LinkButton href="/jobs/new">פרסום משרה +</LinkButton>}>הזדמנויות חדשות, המלצות טובות והחיבור שממשיך גם אחרי השירות.</Heading>
    <div className="action-row"><LinkButton href="/jobs">לכל המשרות</LinkButton><LinkButton href="/profiles" secondary>להכיר את אנשי הקהילה</LinkButton>
      {user.can_seek && <AppLink href="/my-profile" className="text-sm text-primary px-2">עדכון הפרופיל שלי ←</AppLink>}</div></section>
    <div className="stat-grid"><div className="stat"><strong>{data.stats.members}</strong><span>חברי קהילה מאושרים</span></div>
      <div className="stat"><strong>{data.stats.active_jobs}</strong><span>משרות פתוחות</span></div>
      <div className="stat"><strong>{data.stats.releasing}</strong><span>משתחררים בשלושת החודשים הקרובים</span></div></div>
    <div className="section-heading"><h2>המשרות החדשות בקהילה</h2><AppLink href="/jobs" className="text-primary text-sm">לכל המשרות ←</AppLink></div>
    {data.jobs.length ? <div className="card-grid">{data.jobs.slice(0, 6).map(job => <JobCard key={job.id} job={job} />)}</div>
      : <Empty title="ההזדמנות הראשונה עוד בדרך">אפשר לפרסם משרה או להשלים פרופיל כדי להיות מוכנים.</Empty>}</>;
}
function Login({ params }: { params: QueryParams }) {
  return <div className="narrow stack"><Heading title="ברוכים הבאים לאופק">כניסה ללא סיסמה. הגישה לתוכן תיפתח רק אחרי אישור החברות.</Heading>
    <div className="form-panel stack">{params.error && <div role="alert" className="notice error">הכניסה באמצעות Google לא הושלמה. אפשר לנסות שוב או להיכנס עם אימייל.</div>}
      <ActionForm action="request_login" label="שליחת קישור כניסה"><Field label="כתובת אימייל" name="email" type="email" required autoComplete="email" maxLength={254} placeholder="name@example.com" /></ActionForm>
      {process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && <><div className="divider" /><form action="/auth/google" method="get"><Button type="submit" variant="outline">כניסה עם Google ←</Button></form></>}
      <p className="muted text-sm">הקישור אישי, חד־פעמי ובתוקף ל־15 דקות. יש לפתוח אותו באותו דפדפן שבו ביקשתם אותו.</p>
    </div><div className="notice">לא צריך לשלוח מסמכים צבאיים או מידע מסווג. טופס האימות מבקש רק פרטים כלליים וקישור ציבורי ל־LinkedIn.</div></div>;
}
async function Pending({ user }: { user: Viewer }) {
  const [verification] = await userDb(db => db.query<Verification>("SELECT * FROM app.verifications WHERE member_id=@id;", [["id", TYPES.UniqueIdentifier, user.id]]));
  if (user.status === "banned") return <Empty title="הגישה לחשבון נחסמה">לבירור יש לפנות למנהלי הקהילה. התוכן הפרטי אינו זמין לחשבון זה.</Empty>;
  return <div className="narrow stack"><Heading title={user.status === "rejected" ? "נדרשת בדיקה נוספת" : "עוד רגע, אתם בפנים."}>
    {verification ? "בקשת האימות שלכם נקלטה. עד האישור, המשרות והפרופילים נשארים פרטיים." : "כדי לשמור על קהילה שאפשר לסמוך עליה, מתחילים באימות קצר."}</Heading>
    <div className="notice">מחוברים כ־<bdi>{user.email}</bdi> · {labels[user.status]}</div>
    <section className="form-panel stack"><h2>{verification ? "פרטי בקשת האימות" : "ספרו לנו בקצרה מי אתם"}</h2><VerificationForm value={verification} /></section>
    <section className="form-panel stack"><h2>יש לכם קוד הזמנה?</h2><p className="muted text-sm">יש לשמור קודם את טופס האימות. הקוד מיועד לחברי היחידה, לא למגייסים חיצוניים.</p>
      <ActionForm action="redeem_invite" label="אימות באמצעות הקוד"><Field label="קוד הזמנה" name="code" required autoComplete="off" maxLength={100} /></ActionForm></section>
  </div>;
}
async function JobsPage({ params, user }: { params: QueryParams; user: Viewer }) {
  const filters = jobFilters(params), page = pageNumber(params);
  const rows = await userDb(db => jobs(db, filters, page));
  return <><Heading title="ההזדמנות הבאה שלכם" action={<LinkButton href="/jobs/new">פרסום משרה +</LinkButton>}>משרות מהקהילה, עם חיבור אישי כשאפשר.</Heading>
    <form action="/jobs" className="filters">
      <Field label="חיפוש חופשי" name="query" maxLength={200} defaultValue={filters.query} placeholder="תפקיד, חברה או מילת מפתח" />
      <Field label="טכנולוגיות" name="tags" maxLength={1000} defaultValue={filters.tags} placeholder="React, Python" />
      <Field label="עיר" name="city" maxLength={120} defaultValue={filters.city} />
      <Select label="אופן העבודה" name="work_mode" options={workOptions} value={filters.work_mode} empty="הכול" />
      <Select label="סוג המשרה" name="job_type" options={typeOptions} value={filters.job_type} empty="הכול" />
      <Select label="רמת ניסיון" name="seniority" options={seniorityOptions} value={filters.seniority} empty="הכול" />
      <Select label="מועד הפרסום" name="days" options={{ "7": "בשבוע האחרון", "30": "בחודש האחרון", "60": "בחודשיים האחרונים" }} value={filters.days} empty="בכל זמן" />
      <div className="stack"><Check name="referral" value="1" defaultChecked={filters.referral === "1"} label="רק משרות עם הפניה אישית" /><div className="flex gap-2"><Button type="submit">חיפוש</Button><AppLink className="muted text-sm self-center" href="/jobs">ניקוי</AppLink></div></div>
    </form>
    {rows.length ? <div className="card-grid">{rows.map(job => <JobCard key={job.id} job={job} />)}</div> : <Empty title="לא נמצאו משרות שמתאימות לחיפוש">כדאי להסיר חלק מהמסננים או לשמור את החיפוש לעדכון בהמשך.</Empty>}
    <Pagination path="/jobs" params={params} page={page} count={rows.length} />
    {user.can_seek && <details className="form-panel"><summary className="font-medium">שמירת החיפוש וקבלת עדכון שבועי</summary><div className="mt-4"><ActionForm action="save_search" label="שמירת החיפוש" fields={{ filters: JSON.stringify(filters) }}>
      <Field label="שם לחיפוש" name="name" required maxLength={100} defaultValue={filters.query || "החיפוש שלי"} />
      <Check name="email_enabled" label="אני רוצה לקבל פעם בשבוע אימייל עם משרות חדשות שמתאימות לחיפוש הזה" />
    </ActionForm></div></details>}</>;
}
async function JobPage({ id, user }: { id: string; user: Viewer }) {
  const data = await userDb(async db => ({
    job: (await db.query<Job>("SELECT * FROM app.job_cards WHERE id=@id;", [["id", TYPES.UniqueIdentifier, id]]))[0],
    applied: (await db.query<{ id: string }>("SELECT id FROM app.applications WHERE job_id=@id AND applicant_id=@actor;", [
      ["id", TYPES.UniqueIdentifier, id], ["actor", TYPES.UniqueIdentifier, user.id],
    ])).length > 0,
  }));
  const job = data.job; if (!job) notFound();
  const owner = job.creator_id === user.id || user.is_admin;
  return <><AppLink href="/jobs" className="muted text-sm">→ חזרה למשרות</AppLink>
    <div className="mt-5"><Heading title={job.title}>{job.company} · {job.city || "מכל מקום"} · {labels[job.work_mode]}</Heading></div>
    <div className="columns"><article className="form-panel stack">
      <div className="tags"><Badge variant="outline">{labels[job.job_type]}</Badge><Badge variant="outline">{labels[job.seniority]}</Badge>
        {job.referral_available && <Badge className="referral-badge">אפשר לקבל הפניה אישית</Badge>}</div>
      {!job.available && <div className="notice">המשרה אינה פתוחה כעת להגשת מועמדות.</div>}
      <Tags value={job.tech_tags} /><Markdown>{job.description}</Markdown>
      {(job.salary_min != null || job.salary_max != null) && <div className="notice"><strong>טווח שכר: </strong><bdi>
        {[job.salary_min, job.salary_max].filter(v => v != null).map(v => new Intl.NumberFormat("he-IL", { style: "currency", currency: job.salary_currency, maximumFractionDigits: 0 }).format(v!)).join(" – ")}
      </bdi> {labels[job.salary_period]}</div>}
      <p className="muted text-sm">פורסם ב־<bdi>{formatDate(job.created_at)}</bdi> · פתוח עד <bdi>{formatDate(job.expires_at)}</bdi></p>
    </article><aside className="stack"><section className="form-panel stack"><h2>נשמע מתאים?</h2>
      {job.available && job.apply_method === "email" && job.apply_email && <><a href={`mailto:${encodeURIComponent(job.apply_email)}`} className="text-primary font-medium">הגשת מועמדות באימייל ←</a><bdi className="text-sm muted break-all">{job.apply_email}</bdi></>}
      {job.available && job.apply_method === "external_link" && job.apply_url && <><a href={job.apply_url} target="_blank" rel="noopener noreferrer" className="text-primary font-medium">הגשה באתר החברה ←</a><bdi className="text-sm muted break-all">{new URL(job.apply_url).hostname}</bdi></>}
      {job.apply_method === "profile" && data.applied ? <><div className="notice success">המועמדות שלכם נשלחה</div>
        <ActionForm action="withdraw" fields={{ id: job.id }} label="ביטול המועמדות" variant="outline" confirm="ברצוני לבטל את המועמדות למשרה הזו" /></>
        : job.available && job.apply_method === "profile" && user.can_seek && job.creator_id !== user.id
          ? <ActionForm action="apply" fields={{ id: job.id }} label="הגשה עם הפרופיל שלי"><p className="muted text-sm">הפרופיל הפעיל שלכם יופיע ברשימת הפניות למפרסם. אפשר לבטל או להסתיר אותו בהמשך.</p></ActionForm>
          : job.apply_method === "profile" && <p className="muted text-sm">{!job.available ? "לא ניתן להגיש מועמדות כרגע." : "הגשה דרך האתר זמינה לבעלי פרופיל חיפוש עבודה מאושר."}</p>}
    </section>{owner && <section className="form-panel stack"><h2>ניהול המשרה</h2><LinkButton secondary href={`/jobs/${job.id}/edit`}>עריכת המשרה</LinkButton>
      <LinkButton secondary href={`/jobs/${job.id}/applicants`}>צפייה במועמדים</LinkButton>
      <ActionForm action="job_action" fields={{ id: job.id, operation: "renew" }} label="המשרה עדיין פתוחה — חידוש" variant="outline" />
      <ActionForm action="job_action" fields={{ id: job.id, operation: "close" }} label="סגירת המשרה" variant="outline" />
      <ActionForm action="job_action" fields={{ id: job.id, operation: "delete" }} label="מחיקת המשרה" variant="destructive" confirm="ברצוני למחוק את המשרה מהלוח" />
    </section>}</aside></div></>;
}
async function ApplicantsPage({ id, user }: { id: string; user: Viewer }) {
  const result = await userDb(async db => ({
    job: (await db.query<Job>("SELECT * FROM app.job_cards WHERE id=@id AND (creator_id=@actor OR @admin=1);", [
      ["id", TYPES.UniqueIdentifier, id], ["actor", TYPES.UniqueIdentifier, user.id], ["admin", TYPES.Bit, user.is_admin],
    ]))[0],
    applicants: await db.query<Applicant>("SELECT * FROM app.applicant_cards WHERE job_id=@id ORDER BY created_at DESC;", [["id", TYPES.UniqueIdentifier, id]]),
  }));
  if (!result.job) notFound();
  return <><Heading title="המועמדויות למשרה">{result.job.title} · פניות שהוגשו דרך האתר</Heading>
    <div className="mb-5"><AppLink href={`/jobs/${id}`} className="text-primary">→ חזרה למשרה</AppLink></div>
    {result.applicants.length ? <div className="stack">{result.applicants.map(item => <article className="form-panel" key={item.id}>
      <div className="card-top"><div><h3>{item.full_name ? <AppLink href={`/profiles/${item.applicant_id}`}><bdi>{item.full_name}</bdi></AppLink> : "הפרופיל מוסתר כרגע"}</h3>
        {item.headline && <p className="muted"><bdi>{item.headline}</bdi></p>}<p className="muted text-sm">הוגש ב־<bdi>{formatDate(item.created_at)}</bdi></p></div><CountBadge count={item.recommendation_count} /></div>
      {item.skills && <div className="mt-3"><Tags value={item.skills} /></div>}
    </article>)}</div> : <Empty title="עדיין אין פניות דרך האתר">פניות שנשלחו ישירות באימייל או באתר החברה אינן מופיעות כאן.</Empty>}</>;
}
async function MyJobs({ user, params }: { user: Viewer; params: QueryParams }) {
  const page = pageNumber(params);
  const rows = await userDb(db => db.query<Job & { application_count: number }>(`SELECT j.*,
    (SELECT COUNT(*) FROM app.applications a WHERE a.job_id=j.id) AS application_count
    FROM app.job_cards j WHERE j.creator_id=@actor AND j.deleted_at IS NULL
    ORDER BY j.created_at DESC,j.id OFFSET @offset ROWS FETCH NEXT 24 ROWS ONLY;`, [
    ["actor", TYPES.UniqueIdentifier, user.id], ["offset", TYPES.Int, (page - 1) * 24],
  ]));
  return <><Heading title="המשרות שלי" action={<LinkButton href="/jobs/new">פרסום משרה +</LinkButton>}>כל המשרות שפרסמתם, כולל משרות שפג תוקפן.</Heading>
    {rows.length ? <div className="card-grid">{rows.map(job => <div key={job.id} className="stack"><JobCard job={job} />
      <AppLink href={`/jobs/${job.id}/applicants`} className="text-sm text-primary px-3">{job.application_count} פניות דרך האתר · לצפייה במועמדים ←</AppLink></div>)}</div>
      : <Empty title="עדיין לא פרסמתם משרה">מכירים הזדמנות טובה? זה המקום לשתף את הקהילה.</Empty>}
    <Pagination path="/my-jobs" params={params} page={page} count={rows.length} /></>;
}
async function ProfilesPage({ params }: { params: QueryParams }) {
  const rows = await profiles(params);
  return <><Heading title="אנשים שכדאי להכיר">כישורים, ניסיון והמלצות — בתוך הקהילה בלבד.</Heading>
    <form action="/profiles" className="filters">
      <Field label="כישורים" name="skills" maxLength={1000} defaultValue={scalar(params.skills)} placeholder="Python, React" />
      <Select label="סטטוס" name="status" empty="הכול" value={scalar(params.status)}
        options={{ actively_looking: "בחיפוש פעיל", open_to_offers: "פתוח להצעות" }} />
      <Select label="שחרור קרוב" name="months" empty="כל מועדי השחרור" value={scalar(params.months)}
        options={{ "3": "בשלושת החודשים הקרובים", "6": "בחצי השנה הקרובה", "12": "בשנה הקרובה" }} />
      <Select label="ניסיון" name="experience" empty="כל רמות הניסיון" value={scalar(params.experience)}
        options={{ "0": "כולל ללא ניסיון", "2": "לפחות שנתיים", "5": "לפחות 5 שנים", "10": "לפחות 10 שנים" }} />
      <Check name="recommended" value="1" defaultChecked={scalar(params.recommended) === "1"} label="רק פרופילים עם המלצות" />
      <div className="flex gap-3"><Button type="submit">חיפוש</Button><AppLink href="/profiles" className="muted text-sm self-center">ניקוי</AppLink></div>
    </form>
    {rows.length ? <div className="card-grid">{rows.map(profile => <ProfileCard key={profile.member_id} profile={profile} />)}</div>
      : <Empty title="לא נמצאו פרופילים שמתאימים לחיפוש">אפשר לנסות פחות מסננים. פרופילים מוסתרים אינם מופיעים במאגר.</Empty>}
    <Pagination path="/profiles" params={params} page={pageNumber(params)} count={rows.length} /></>;
}
function RecommendationItem({ item, user, manage = false }: { item: Recommendation; user: Viewer; manage?: boolean }) {
  const mine = item.author_id === user.id, recipient = item.seeker_id === user.id;
  return <article className="form-panel"><AuthorPreview item={item} />
    <p className="recommendation-text" dir="auto">{item.text}</p>
    <div className="meta"><span>{item.relationship && <bdi>{item.relationship}</bdi>}</span><span>{formatDate(item.created_at)}</span>
      {(manage || mine || recipient || user.is_admin) && <Badge variant="outline">{labels[item.status]}</Badge>}</div>
    {recipient && <div className="action-row">
      {item.status !== "approved" && <ActionForm action="review_recommendation" fields={{ id: item.id, revision: item.revision, status: "approved" }} label="אישור ההמלצה" />}
      {item.status !== "hidden" && <ActionForm action="review_recommendation" fields={{ id: item.id, revision: item.revision, status: "hidden" }} label="הסתרת ההמלצה" variant="outline" />}
    </div>}
    {(mine || recipient || user.is_admin) && <details className="mt-4"><summary className="muted text-sm">ניהול ההמלצה</summary><div className="stack mt-4">
      {mine && <RecommendationForm seeker={item.seeker_id} value={item} />}
      <ActionForm action="delete_recommendation" fields={{ id: item.id }} label="מחיקת ההמלצה" variant="destructive" confirm="ברצוני למחוק את ההמלצה" />
    </div></details>}
  </article>;
}
async function ProfilePage({ id, user }: { id: string; user: Viewer }) {
  const data = await userDb(async db => ({
    profile: (await db.query<Profile>("SELECT * FROM app.profile_cards WHERE member_id=@id;", [["id", TYPES.UniqueIdentifier, id]]))[0],
    recommendations: await recommendations(db, id),
  }));
  const p = data.profile; if (!p) notFound();
  return <><Heading title={p.full_name} action={<CountBadge count={p.recommendation_count} />}>{p.headline}</Heading>
    <div className="columns"><div className="stack"><section className="form-panel stack">
      <div className="tags"><Badge variant="outline">{labels[p.status]}</Badge><Badge variant="outline">{p.years_experience} שנות ניסיון</Badge></div>
      {!p.discoverable && <div className="notice">הפרופיל אינו מופיע במאגר הציבורי של הקהילה כרגע.</div>}
      <div><h3>כישורים</h3><div className="mt-3"><Tags value={p.skills} /></div></div>
      <p className="recommendation-text" dir="auto">{p.bio || "טרם נוספו פרטים נוספים."}</p>
      <div><h3>תפקידים שמעניינים אותי</h3><div className="mt-3"><Tags value={p.preferred_roles} /></div></div>
      <div><h3>מיקומים מועדפים</h3><div className="mt-3"><Tags value={p.preferred_locations} /></div></div>
      <p className="muted">{p.already_released ? "כבר אחרי השחרור" : <>מועד שחרור: <bdi>{formatDate(p.release_date)}</bdi></>}</p>
    </section><div className="section-heading"><h2>המלצות מהקהילה</h2><CountBadge count={p.recommendation_count} /></div>
      {data.recommendations.length ? data.recommendations.map(item => <RecommendationItem item={item} user={user} key={item.id} />)
        : <Empty title="עוד אין כאן המלצות">המלצות מופיעות רק לאחר אישור בעל או בעלת הפרופיל.</Empty>}
      {user.can_recommend && user.id !== id && !data.recommendations.some(item => item.author_id === user.id) &&
        <section className="form-panel stack"><h2>עבדתם יחד?</h2><p className="muted text-sm">כדי לכתוב המלצה צריך לפרסם כרטיס חברות בעמוד החשבון.</p><RecommendationForm seeker={id} /></section>}
    </div><aside className="stack"><section className="form-panel stack"><h2>היכרות מקצועית</h2>
      {p.cv_document_id && <a className="text-primary font-medium" href={`/api/cv/${p.cv_document_id}`} target="_blank" rel="noreferrer">הורדת קורות חיים פרטיים ↓</a>}
      {!p.cv_document_id && <p className="muted">טרם הועלו קורות חיים</p>}
      {p.linkedin_url && <a href={p.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-primary">פרופיל LinkedIn ↗</a>}
      {p.github_url && <a href={p.github_url} target="_blank" rel="noopener noreferrer" className="text-primary">פרופיל GitHub ↗</a>}
      {user.id === id && <LinkButton href="/my-profile" secondary>עריכת הפרופיל שלי</LinkButton>}
    </section>{user.is_admin && user.id !== id && <section className="form-panel stack"><h3>ניהול</h3>
      <ActionForm action="profile_action" fields={{ member_id: id, operation: p.moderated_at ? "restore" : "moderate" }}
        label={p.moderated_at ? "החזרת הפרופיל למאגר" : "הסרת הפרופיל מהמאגר"} variant="outline" confirm="אישור פעולת הניהול בפרופיל" />
      <ActionForm action="profile_action" fields={{ member_id: id, operation: "delete" }} label="מחיקת הפרופיל" variant="destructive" confirm="מחיקת הפרופיל, קורות החיים, המועמדויות וההמלצות שהתקבלו בו" />
    </section>}</aside></div></>;
}
async function MyProfile({ user }: { user: Viewer }) {
  if (!user.can_seek) return <Empty title="החשבון הזה אינו מוגדר לחיפוש עבודה">הגישה לפרסום פרופיל דורשת אימות כחבר או חברת היחידה. חשבון ניהול או גיוס אינו מקבל זכאות אוטומטית.</Empty>;
  const data = await userDb(async db => ({
    profile: (await db.query<Profile>("SELECT * FROM app.profile_cards WHERE member_id=@actor;", [["actor", TYPES.UniqueIdentifier, user.id]]))[0],
    cv: (await db.query<CvDocument>("SELECT d.* FROM app.cv_documents d JOIN app.profiles p ON p.cv_document_id=d.id WHERE p.member_id=@actor;", [["actor", TYPES.UniqueIdentifier, user.id]]))[0],
    received: await recommendations(db, user.id), given: await recommendations(db, user.id, true),
  }));
  return <div className="narrow stack"><Heading title="הפרופיל שלי" action={data.profile && <LinkButton href={`/profiles/${user.id}`} secondary>לצפייה בפרופיל</LinkButton>}>בחרו איך להציג את הניסיון שלכם ומתי להיות גלויים לקהילה.</Heading>
    {data.profile?.moderated_at && <div className="notice error">הפרופיל הוסר מהמאגר על ידי מנהל. שמירת שינויים אינה מבטלת את ההסרה.</div>}
    <section className="form-panel"><ProfileForm value={data.profile} name={user.verified_name ?? undefined} /></section>
    <section className="form-panel stack"><h2>קורות חיים — באחסון פרטי</h2><div className="notice"><strong>מתארים את השירות באופן כללי.</strong>
      <p>אפשר לציין תחומי אחריות, יכולות טכנולוגיות ותוצאות שאושרו לפרסום. אין לכלול שמות מערכות או מבצעים, נתונים מבצעיים, פרטי גישה או פרטים מסווגים. במקרה של ספק, מסירים את המידע ומבררים מול הגורם המוסמך. סימון התיבה אינו מחליף אישור לפרסום.</p></div>
      {data.cv && <div className="stack"><p>הקובץ הנוכחי: <bdi>{data.cv.original_filename}</bdi></p><a className="text-primary" href={`/api/cv/${data.cv.id}`} target="_blank" rel="noreferrer">הורדת הקובץ הנוכחי ↓</a>
        <ActionForm action="remove_cv" fields={{ id: data.cv.id }} label="הסרת קורות החיים" variant="outline" confirm="ברצוני להסיר את הקובץ מהפרופיל" /></div>}
      {data.profile ? <ActionForm action="upload_cv" label={data.cv ? "החלפת קורות החיים" : "העלאת קורות חיים"}>
        <Check name="attested" required label="קורות החיים שלי אינם מכילים מידע מסווג או מידע שלא אושר לפרסום." />
        <Field label="קובץ PDF, עד 5MB" name="cv" type="file" accept=".pdf,application/pdf" required hint="PDF רגיל ללא סיסמה, סקריפטים או קבצים מצורפים. עד 200 עמודים." />
      </ActionForm> : <p className="muted">יש לשמור קודם את הפרופיל כדי להעלות קורות חיים.</p>}</section>
    <section className="stack"><h2>המלצות שקיבלתי</h2>{data.received.length ? data.received.map(item => <RecommendationItem key={item.id} item={item} user={user} manage />)
      : <Empty title="עדיין לא התקבלו המלצות">כשחבר או חברת קהילה יכתבו לכם המלצה, תוכלו לאשר או להסתיר אותה כאן.</Empty>}</section>
    <section className="stack"><h2>המלצות שכתבתי</h2>{data.given.length ? data.given.map(item => <RecommendationItem key={item.id} item={item} user={user} manage />) : <p className="muted">עוד לא כתבתם המלצות.</p>}</section>
    {data.profile && <details className="form-panel"><summary>מחיקת הפרופיל</summary><div className="mt-4"><ActionForm action="profile_action" fields={{ member_id: user.id, operation: "delete" }}
      label="מחיקת הפרופיל" variant="destructive" confirm="ברצוני למחוק את הפרופיל, קורות החיים, המועמדויות וההמלצות שהתקבלו בו" /></div></details>}
  </div>;
}
async function MemberPage({ id }: { id: string }) {
  const [card] = await userDb(db => db.query<MemberCard>("SELECT * FROM app.member_cards WHERE member_id=@id;", [["id", TYPES.UniqueIdentifier, id]]));
  if (!card) notFound();
  return <div className="narrow"><Heading title={card.full_name}>כרטיס חברות בקהילה</Heading><section className="form-panel stack">
    <h2><bdi>{card.headline || card.current_title || "חברוּת מאומתת בקהילה"}</bdi></h2>
    <p className="muted"><bdi>{[card.current_title, card.company].filter(Boolean).join(" · ")}</bdi></p>
    {card.unit_start_year && <p>שנות שירות שאומתו: <bdi>{card.unit_start_year}</bdi>–<bdi>{card.unit_end_year ?? "היום"}</bdi></p>}
    <div className="notice">זהו כרטיס חברות נפרד מפרופיל חיפוש עבודה. הוא אינו חושף קורות חיים, מועד שחרור או פרופיל מוסתר. התפקיד והחברה מעודכנים על ידי בעל או בעלת הכרטיס.</div>
  </section></div>;
}
async function Account({ user }: { user: Viewer }) {
  const data = await userDb(async db => ({
    card: (await db.query<MemberCard>("SELECT * FROM app.member_cards WHERE member_id=@actor;", [["actor", TYPES.UniqueIdentifier, user.id]]))[0],
    invites: await db.query<Invite>("SELECT id,slot,redeemed_by,issued_at,redeemed_at,revoked_at FROM app.invites WHERE inviter_id=@actor ORDER BY slot;", [["actor", TYPES.UniqueIdentifier, user.id]]),
    searches: await db.query<SavedSearch>("SELECT * FROM app.saved_searches WHERE owner_id=@actor ORDER BY created_at DESC;", [["actor", TYPES.UniqueIdentifier, user.id]]),
    given: user.can_seek ? [] : await recommendations(db, user.id, true),
  }));
  return <div className="narrow stack"><Heading title="החשבון שלי"><bdi>{user.email}</bdi></Heading>
    <section className="form-panel stack"><h2>כרטיס החברות שלי</h2>{data.card ? <CardForm value={data.card} />
      : <p className="muted">לחשבון הניהול אין כרטיס שירות מאומת. אין בפרטי החשבון הצהרה על שירות ביחידה.</p>}</section>
    {data.invites.length > 0 && <section className="form-panel stack"><h2>5 הזמנות לקהילה</h2>
      <p className="muted text-sm">כל הזמנה משמשת אדם אחד. יש להזמין רק אנשים שאתם מכירים כחברי היחידה. הפקת קוד חדש למשבצת פנויה מבטלת את הקוד הקודם שלה.</p>
      {data.invites.map(invite => <div key={invite.id} className="notice"><h3>הזמנה {invite.slot}</h3>
        {invite.redeemed_by ? <p className="text-sm muted">נוצלה ב־{formatDate(invite.redeemed_at)}</p> : <div className="action-row">
          <ActionForm action="issue_invite" fields={{ slot: invite.slot }} label={invite.issued_at ? "הפקת קוד חדש" : "הפקת קוד"} variant="outline" />
          {invite.issued_at && !invite.revoked_at && <ActionForm action="revoke_invite" fields={{ slot: invite.slot }} label="ביטול הקוד" variant="outline" />}
        </div>}</div>)}</section>}
    <section className="stack"><h2>החיפושים והעדכונים שלי</h2>{data.searches.length ? data.searches.map(search => <article key={search.id} className="form-panel stack">
      <h3>{search.name}</h3><p className="muted text-sm">{search.email_enabled ? `עדכון שבועי פעיל. העדכון הבא החל מ־${formatDate(search.next_digest_at)}` : "ללא עדכונים באימייל"}</p>
      <AppLink className="text-primary" href={`/jobs?${new URLSearchParams(searchInput.parse(JSON.parse(search.filters)))}`}>פתיחת החיפוש ←</AppLink>
      <ActionForm action="save_search" label="עדכון ההעדפות" fields={{ id: search.id, name: search.name, filters: search.filters }}>
        <Check name="email_enabled" defaultChecked={search.email_enabled} label="קבלת עדכון שבועי באימייל" /></ActionForm>
      <ActionForm action="delete_search" fields={{ id: search.id }} label="מחיקת החיפוש" variant="outline" confirm="ברצוני למחוק את החיפוש ולהפסיק את העדכונים" />
    </article>) : <p className="muted">אפשר לשמור חיפוש מעמוד המשרות ולבחור אם לקבל עדכון שבועי.</p>}</section>
    {data.given.length > 0 && <section className="stack"><h2>המלצות שכתבתי</h2>{data.given.map(item => <RecommendationItem key={item.id} item={item} user={user} manage />)}</section>}
  </div>;
}
async function Admin({ user, params }: { user: Viewer; params: QueryParams }) {
  const page = pageNumber(params), offset = (page - 1) * 24;
  const data = await userDb(async db => ({
    stats: (await db.query<Stats>("EXEC app.admin_stats;"))[0],
    members: await db.query<AdminMember>("EXEC app.admin_members @offset;", [["offset", TYPES.Int, offset]]),
    jobs: await db.query<Job>("SELECT * FROM app.job_cards WHERE deleted_at IS NULL ORDER BY created_at DESC,id OFFSET @offset ROWS FETCH NEXT 24 ROWS ONLY;", [["offset", TYPES.Int, offset]]),
    profiles: await db.query<Profile>("SELECT * FROM app.profile_cards ORDER BY updated_at DESC,member_id OFFSET @offset ROWS FETCH NEXT 24 ROWS ONLY;", [["offset", TYPES.Int, offset]]),
    recs: await db.query<Recommendation>(`SELECT r.*,c.full_name AS author_name,c.headline AS author_headline,c.current_title AS author_title,
      c.company AS author_company,c.unit_start_year,c.unit_end_year FROM app.recommendations r
      LEFT JOIN app.member_cards c ON c.member_id=r.author_id ORDER BY r.created_at DESC,r.id OFFSET @offset ROWS FETCH NEXT 24 ROWS ONLY;`, [["offset", TYPES.Int, offset]]),
  }));
  return <><Heading title="ניהול הקהילה">אימות חברים, שמירה על התוכן ומבט על הפעילות.</Heading>
    <div className="stat-grid">{Object.entries({ members: "חברים מאושרים", pending: "ממתינים לאישור", active_jobs: "משרות פתוחות", applications: "מועמדויות", recommendations: "המלצות" }).map(([key, label]) =>
      <div className="stat" key={key}><strong>{data.stats[key as keyof Stats]}</strong><span>{label}</span></div>)}</div>
    <section className="stack"><h2>בקשות וחברי קהילה</h2>{data.members.map(member => <article className="form-panel" key={member.id}>
      <div className="card-top"><div><h3><bdi>{member.full_name || member.email}</bdi></h3><p className="muted text-sm"><bdi>{member.email}</bdi></p></div><Badge variant="outline">{labels[member.status]}</Badge></div>
      <div className="meta mt-3"><span>{labels[member.requested_kind ?? member.kind]}</span>
        {member.unit_start_year && <span>שירות: <bdi>{member.unit_start_year}</bdi>–<bdi>{member.unit_end_year ?? "היום"}</bdi></span>}
        {member.release_date && <span>שחרור: <bdi>{formatDate(member.release_date)}</bdi></span>}
        {member.already_released && <span>כבר השתחררו</span>}
        {member.linkedin_url && <a className="text-primary" href={member.linkedin_url} target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>}
      </div>
      {member.invited_by && <p className="muted text-xs mt-2">הוזמנו על ידי: <bdi>{data.members.find(m => m.id === member.invited_by)?.full_name ?? member.invited_by}</bdi></p>}
      {member.id !== user.id && !member.is_admin && <div className="action-row">
        {member.full_name && member.status !== "approved" && <ActionForm action="admin_decide" label="אישור חברות" fields={{ member_id: member.id, decision: "approve" }} />}
        {member.status === "pending" && <ActionForm action="admin_decide" label="דחיית הבקשה" variant="outline" fields={{ member_id: member.id, decision: "reject" }} confirm="הבקשה נבדקה ולא אושרה" />}
        {member.status === "approved" && <ActionForm action="admin_decide" label="חסימת החשבון" variant="destructive" fields={{ member_id: member.id, decision: "ban" }} confirm="ברצוני לחסום את הגישה לחשבון" />}
      </div>}
      {!member.full_name && member.status === "pending" && <p className="muted text-sm mt-3">עדיין לא נשלח טופס אימות. אין אפשרות לאשר בלי פרטים.</p>}
    </article>)}</section>
    <details className="form-panel mt-6"><summary className="font-medium">משרות — ניהול תוכן</summary><div className="card-grid mt-5">{data.jobs.map(job => <JobCard key={job.id} job={job} />)}</div></details>
    <details className="form-panel mt-6"><summary className="font-medium">פרופילים — ניהול תוכן</summary><div className="card-grid mt-5">{data.profiles.map(profile => <ProfileCard key={profile.member_id} profile={profile} />)}</div></details>
    <details className="form-panel mt-6"><summary className="font-medium">המלצות — ניהול תוכן</summary><div className="stack mt-5">{data.recs.map(item => <RecommendationItem key={item.id} item={item} user={user} manage />)}</div></details>
    <Pagination path="/admin" params={params} page={page} count={Math.max(data.members.length, data.jobs.length, data.profiles.length, data.recs.length)} />
  </>;
}

export async function renderPage(route: string[], params: QueryParams) {
  const path = "/" + route.join("/");
  const current = await viewer();
  if (path === "/login") {
    if (current?.status === "approved") redirect("/");
    if (current) redirect("/pending");
    return <Shell user={null} active={path}><Login params={params} /></Shell>;
  }
  if (path === "/" && !current) return <Shell user={null}><Landing /></Shell>;
  if (!current) redirect("/login");
  if (current.status !== "approved") {
    if (path !== "/pending" && path !== "/") redirect("/pending");
    return <Shell user={current} active="/pending"><Pending user={current} /></Shell>;
  }
  if (path === "/pending") redirect("/");
  const user = await requireMember(path === "/admin");
  let content: React.ReactNode;
  if (path === "/") content = <Home user={user} />;
  else if (path === "/jobs") content = <JobsPage params={params} user={user} />;
  else if (path === "/jobs/new") content = <div className="narrow stack"><Heading title="מפרסמים הזדמנות חדשה">משרה טובה מתחילה בחיבור טוב.</Heading><div className="form-panel"><JobForm /></div></div>;
  else if (route[0] === "jobs" && uuid.safeParse(route[1]).success && route.length <= 3) {
    const id = route[1].toLowerCase();
    if (route[2] === "edit") {
      const [job] = await userDb(db => db.query<Job>("SELECT * FROM app.job_cards WHERE id=@id AND deleted_at IS NULL AND (creator_id=@actor OR @admin=1);", [
        ["id", TYPES.UniqueIdentifier, id], ["actor", TYPES.UniqueIdentifier, user.id], ["admin", TYPES.Bit, user.is_admin],
      ]));
      if (!job) notFound();
      content = <div className="narrow stack"><Heading title="עריכת המשרה">{job.company}</Heading><div className="form-panel"><JobForm value={job} /></div></div>;
    } else if (route[2] === "applicants") content = <ApplicantsPage id={id} user={user} />;
    else if (route.length === 2) content = <JobPage id={id} user={user} />;
    else notFound();
  } else if (path === "/my-jobs") content = <MyJobs user={user} params={params} />;
  else if (path === "/profiles") content = <ProfilesPage params={params} />;
  else if (route[0] === "profiles" && route.length === 2 && uuid.safeParse(route[1]).success) content = <ProfilePage id={route[1].toLowerCase()} user={user} />;
  else if (path === "/my-profile") content = <MyProfile user={user} />;
  else if (route[0] === "members" && route.length === 2 && uuid.safeParse(route[1]).success) content = <MemberPage id={route[1].toLowerCase()} />;
  else if (path === "/account") content = <Account user={user} />;
  else if (path === "/admin") content = <Admin user={user} params={params} />;
  else notFound();
  return <Shell user={user} active={path}>{content}</Shell>;
}
