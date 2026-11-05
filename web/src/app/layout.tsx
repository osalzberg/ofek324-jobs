import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "אופק 324 — הצעד הבא, עם האנשים שלכם", template: "%s | אופק 324" },
  description: "קהילה מקצועית פרטית לבוגרי ולבוגרות אופק 324 ולמשרתים לקראת שחרור.",
  robots: { index: false, follow: false, noarchive: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body><a className="skip-link" href="#main">דילוג לתוכן</a>{children}</body>
    </html>
  );
}
