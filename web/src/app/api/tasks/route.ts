import { timingSafeEqual } from "node:crypto";
import { runDelivery } from "@/lib/worker";
import { diagnostic } from "@/lib/errors";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return Response.json({ error: "Delivery is not configured" }, { status: 503 });
  const authorization = request.headers.get("authorization") ?? "";
  const actual = Buffer.from(authorization), wanted = Buffer.from(`Bearer ${expected}`);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await runDelivery();
    return Response.json(result, { status: result.failed || result.cleanupFailed ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const detail = diagnostic(error);
    console.error({ event: "delivery_run_failed", detail });
    return Response.json({ error: "Delivery failed; queued records remain retryable", diagnostic: detail }, { status: 503 });
  }
}
