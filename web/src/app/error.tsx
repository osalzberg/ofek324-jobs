"use client";
import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error({ event: "page_failed", digest: error.digest }); }, [error]);
  return <main id="main" className="container page-main"><section className="narrow form-panel stack"><h1>לא הצלחנו לטעון את העמוד</h1>
    <p className="muted">אפשר לנסות שוב. אם שיניתם את כתובת החיפוש ידנית, כדאי לחזור לדף הבית ולחפש משם.</p>
    <div className="action-row"><Button onClick={reset}>ניסיון נוסף</Button><Link prefetch={false} href="/">חזרה לבית</Link></div>
  </section></main>;
}
