import Link from "next/link";
import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { labels, readTags, formatDate } from "@/lib/validation";
import type { Job, Profile, Recommendation, Viewer } from "@/lib/types";
import { ActionForm } from "./action-form";

export function AppLink(props: ComponentProps<typeof Link>) { return <Link {...props} prefetch={false} />; }
export function LinkButton({ href, children, secondary = false }: { href: string; children: React.ReactNode; secondary?: boolean }) {
  return <AppLink href={href} className={buttonVariants({ variant: secondary ? "outline" : "default", className: "min-h-11 px-5" })}>{children}</AppLink>;
}
export function Field({ label, hint, wide, ...props }: ComponentProps<typeof Input> & { label: string; hint?: string; wide?: boolean }) {
  return <label className={`field ${wide ? "wide" : ""}`}><span>{label}{props.required ? " *" : ""}</span>
    <Input dir="auto" {...props} />{hint && <small>{hint}</small>}</label>;
}
export function Area({ label, ...props }: ComponentProps<typeof Textarea> & { label: string }) {
  return <label className="field"><span>{label}{props.required ? " *" : ""}</span><Textarea dir="auto" {...props} /></label>;
}
export function Select({ label, name, options, value = "", empty, required = false }: {
  label: string; name: string; options: Record<string, string>; value?: string; empty?: string; required?: boolean;
}) {
  return <label className="field"><span>{label}{required ? " *" : ""}</span><select name={name} defaultValue={value} required={required} dir="rtl">
    {empty !== undefined && <option value="">{empty}</option>}
    {Object.entries(options).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
  </select></label>;
}
export function Check({ label, ...props }: ComponentProps<"input"> & { label: string }) {
  return <label className="check"><input type="checkbox" dir="auto" {...props} /><span>{label}</span></label>;
}
export function Tags({ value }: { value: string }) {
  return <div className="tags">{readTags(value).map(tag => <bdi className="tag" key={tag}>{tag}</bdi>)}</div>;
}
export function CountBadge({ count }: { count: number | null }) {
  return count ? <Badge className="recommendation-badge">{count} המלצות</Badge> : null;
}
export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="empty"><h2>{title}</h2><div className="muted">{children}</div></div>;
}
export function Heading({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1>{children && <div className="lead">{children}</div>}</div>{action}</div>;
}
export function Shell({ user, active = "/", children }: { user: Viewer | null; active?: string; children: React.ReactNode }) {
  const links = user?.status === "approved" ? [
    ["/", "הבית"], ["/jobs", "משרות"], ["/profiles", "אנשי הקהילה"],
    ...(user.can_seek ? [["/my-profile", "הפרופיל שלי"]] : []),
    ["/my-jobs", "המשרות שלי"], ["/account", "החשבון שלי"],
    ...(user.is_admin ? [["/admin", "ניהול"]] : []),
  ] : [];
  const navigation = <nav aria-label="ניווט ראשי" className="navigation">{links.map(([href, label]) =>
    <AppLink href={href} key={href} aria-current={(href === "/" ? active === "/" : active.startsWith(href)) ? "page" : undefined}>{label}</AppLink>)}</nav>;
  return <>
    <header className="site-header"><div className="container header-row">
      <AppLink href="/" className="brand"><span className="brand-mark" dir="ltr">324</span>אופק</AppLink>
      <div className="desktop-menu">{navigation}</div>
      <div className="account-nav">{user ? <>
        <span className="account-name text-sm muted"><bdi>{user.verified_name ?? "החשבון שלי"}</bdi></span>
        <ActionForm action="sign_out" label="יציאה" variant="ghost" />
      </> : <LinkButton href="/login">כניסה לקהילה</LinkButton>}</div>
      {links.length > 0 && <details className="mobile-menu"><summary>תפריט הקהילה</summary>{navigation}</details>}
    </div></header>
    <div className="test-banner">סביבת פיתוח ובדיקה · משרות ופרופילים המסומנים כדוגמה אינם אמיתיים</div>
    <main id="main" className="container page-main">{children}</main>
    <footer className="site-footer"><div className="container">אופק 324 · קהילה פרטית, קשרים אמיתיים. אין לפרסם מידע מסווג או מידע שלא אושר לפרסום.</div></footer>
  </>;
}
export function JobCard({ job }: { job: Job }) {
  return <article className="job-card"><div className="card-top">
    <div><p className="muted text-sm"><bdi>{job.company}</bdi></p><h3 className="mt-1"><AppLink href={`/jobs/${job.id}`}><bdi>{job.title}</bdi></AppLink></h3></div>
    {job.referral_available && <Badge className="referral-badge">אפשר לקבל הפניה</Badge>}
  </div><div className="meta"><span><bdi>{job.city || "מכל מקום"}</bdi> · {labels[job.work_mode]}</span>
    <span>{labels[job.job_type]}</span><span>{labels[job.seniority]}</span></div>
    <Tags value={job.tech_tags} /><div className="meta justify-between"><span>פורסם ב־<bdi>{formatDate(job.created_at)}</bdi></span>
      {!job.available && <span>המשרה אינה פתוחה כעת</span>}<AppLink href={`/jobs/${job.id}`} className="text-primary">לפרטי המשרה ←</AppLink></div>
  </article>;
}
export function ProfileCard({ profile }: { profile: Profile }) {
  return <article className="profile-card"><div className="card-top"><div className="flex items-center gap-3">
    <span className="avatar">{profile.full_name.slice(0, 1)}</span><div><h3><AppLink href={`/profiles/${profile.member_id}`}><bdi>{profile.full_name}</bdi></AppLink></h3>
      <p className="muted text-sm"><bdi>{profile.headline}</bdi></p></div></div><CountBadge count={profile.recommendation_count} /></div>
    <Tags value={profile.skills} /><div className="meta"><span>{labels[profile.status]}</span><span><bdi>{profile.years_experience}</bdi> שנות ניסיון</span>
      <span>{profile.already_released ? "אחרי השחרור" : <>שחרור: <bdi>{formatDate(profile.release_date)}</bdi></>}</span></div>
  </article>;
}
export function AuthorPreview({ item }: { item: Recommendation }) {
  if (!item.author_name) return <p className="muted text-sm">כרטיס הממליץ אינו מפורסם כרגע</p>;
  return <AppLink href={`/members/${item.author_id}`} className="author-preview">
    <span className="avatar">{item.author_name.slice(0, 1)}</span><div><strong><bdi>{item.author_name}</bdi></strong>
      <small><bdi>{[item.author_title, item.author_company].filter(Boolean).join(" · ") || item.author_headline}</bdi></small>
      <small>שירות ביחידה: <bdi>{item.unit_start_year ?? "—"}</bdi>–<bdi>{item.unit_end_year ?? "היום"}</bdi> · לכרטיס החברות ←</small></div>
  </AppLink>;
}
export function Pagination({ path, params, page, count }: { path: string; params: Record<string, string | string[] | undefined>; page: number; count: number }) {
  function url(next: number) {
    const q = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => typeof v === "string" && k !== "page" ? [[k, v]] : []));
    q.set("page", String(next)); return `${path}?${q}`;
  }
  return <nav className="pagination" aria-label="עמודי תוצאות"><span>{page > 1 && <AppLink href={url(page - 1)}>→ העמוד הקודם</AppLink>}</span>
    <span className="muted text-sm">עמוד <bdi>{page}</bdi></span><span>{count === 24 && <AppLink href={url(page + 1)}>העמוד הבא ←</AppLink>}</span></nav>;
}
