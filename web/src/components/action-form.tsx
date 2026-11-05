"use client";
import { useActionState } from "react";
import { runAction, type ActionState } from "@/lib/actions";
import { Button } from "@/components/ui/button";

export function ActionForm({ action, children, label = "שמירה", fields = {}, confirm, variant = "default", className = "" }: {
  action: string; children?: React.ReactNode; label?: string; fields?: Record<string, string | number>;
  confirm?: string; variant?: "default" | "outline" | "destructive" | "ghost"; className?: string;
}) {
  const [state, submit, pending] = useActionState<ActionState, FormData>(runAction, {});
  return <form action={submit} className={`stack ${className}`} aria-busy={pending}>
    <input type="hidden" name="action" value={action} />
    {Object.entries(fields).map(([name, value]) => <input type="hidden" name={name} value={value} key={name} />)}
    {children}
    {confirm && <label className="check"><input type="checkbox" name="confirm" required /> <span>{confirm}</span></label>}
    {state.error && <div role="alert" className="notice error">{state.error}</div>}
    {state.success && <div role="status" className="notice success">{state.success}</div>}
    {state.inviteCode && <div className="notice"><label className="field"><span>קוד ההזמנה האישי</span>
      <input className="mono" dir="ltr" readOnly aria-label="קוד ההזמנה האישי" value={state.inviteCode} onFocus={e => e.currentTarget.select()} />
    </label></div>}
    <div><Button type="submit" variant={variant} disabled={pending}>{pending ? "הפעולה מתבצעת…" : label}</Button></div>
  </form>;
}
