# Ofek 324 web application

Hebrew/RTL Next.js App Router application with TypeScript, Tailwind, shadcn and
self-hosted Heebo fonts. Azure SQL enforces native RLS; private Blob Storage holds
CVs; Azure Communication Services handles email.

See the [project guide](../README.md) for setup, verification, deployment, identity,
operating costs and remaining Google OAuth configuration.

- `src/app/`: routes, root layout and API endpoints.
- `src/components/`: page renderers, forms and shared UI.
- `src/lib/`: authorization, guarded SQL access, validation, storage and delivery.
- `tests/validation.test.ts`: validation and PDF checks.
- `tests/journeys.mjs`: local/live browser journeys with temporary fixtures.

Use Node 24 and the committed lockfile. Copy `.env.example` to an ignored
`.env.local` on first setup; never commit credentials. Local requests impersonate
the restricted SQL runtime, and tests do not send real email.
