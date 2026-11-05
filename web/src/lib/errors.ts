import "server-only";
export function diagnostic(error: unknown, depth = 0): object {
  if (!(error instanceof Error)) return { type: "Unknown" };
  const extra = error as Error & { code?: string; number?: number; errors?: unknown[] };
  return {
    type: error.name, code: extra.code, number: extra.number,
    message: error.message.replace(/[A-Za-z0-9+_/.=-]{32,}/g, "[redacted]").slice(0, 240),
    ...(depth < 2 && Array.isArray(extra.errors) ? { errors: extra.errors.slice(0, 3).map(e => diagnostic(e, depth + 1)) } : {}),
    ...(depth < 2 && error.cause ? { cause: diagnostic(error.cause, depth + 1) } : {}),
  };
}
