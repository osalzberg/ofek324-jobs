"use client";
import { useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Markdown } from "./markdown";
export function RichEditor({ initial = "" }: { initial?: string }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  function insert(before: string, after = "") {
    const start = ref.current?.selectionStart ?? text.length;
    const end = ref.current?.selectionEnd ?? start;
    setText(text.slice(0, start) + before + text.slice(start, end) + after + text.slice(end));
    ref.current?.focus();
  }
  return <div className="stack">
    <label className="field"><span>תיאור המשרה *</span><Textarea ref={ref} dir="auto" name="description"
      rows={9} minLength={20} maxLength={30000} required value={text} onChange={e => setText(e.target.value)}
      placeholder="על התפקיד, מה מחפשים ומה כדאי לדעת על הצוות…" /></label>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" onClick={() => insert("**", "**")}>הדגשה</Button>
      <Button type="button" variant="outline" onClick={() => insert("\n## ")}>כותרת</Button>
      <Button type="button" variant="outline" onClick={() => insert("\n- ")}>רשימה</Button>
    </div>
    <details><summary className="muted">תצוגה מקדימה · תומך ב־Markdown</summary><Markdown>{text}</Markdown></details>
  </div>;
}
