export default function NotFound() {
  return <main id="main" className="container page-main"><div className="narrow form-panel stack">
    <h1>העמוד אינו זמין</h1><p className="muted">יכול להיות שהוסר, הוסתר או שאינו זמין לחשבון שלכם.</p><Link prefetch={false} href="/" className="text-primary">חזרה לדף הבית ←</Link>
  </div></main>;
}
import Link from "next/link";
