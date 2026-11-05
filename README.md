# Ofek 324 private job board

Hebrew/RTL dev-test MVP using Next.js App Router, TypeScript, Tailwind and shadcn,
deployed to https://ofek324-osalzberg-dev.azurewebsites.net.
Azure SQL, private Blob Storage and Azure Communication Services Email replace
the originally proposed Supabase/Resend/Vercel services to keep this deployment
inside the authorized personal Azure subscription.

## Features

- Email magic links; pending verification; manual admin approval; five lifetime
  invite slots per verified unit member; inviter tracking; immediate ban checks.
- Jobs CRUD, Markdown rich text with preview, full-text search and all requested
  filters, 60-day expiry, renewal, referral flags, and private applicant lists.
- Private seeker profiles, release/skills/experience/recommendation filters,
  PDF-only CV uploads up to 5 MiB, publication attestation, and a publication guide.
- Seeker-approved recommendations; edits invalidate approval; hiding stays hidden;
  verified author credibility cards, author links and recommendation badges.
- Paginated admin moderation and statistics; saved searches and email preferences.
- Queued recommendation notifications, seven-day job reminders, weekly digests,
  one-use renewal tokens, retries and deferred private-blob cleanup.

Google OAuth is implemented with PKCE, state, nonce, verified email and signed
ID-token validation, but is hidden until its client credentials are configured.
The Google Cloud console requires the owner's sign-in; credentials were not
created automatically. Real email receipt is not covered by automated tests,
which deliberately never send messages to people.

## Access and privacy

`osalzberg@gmail.com` is explicitly bootstrapped as the management administrator.
Sign in at `/login`, then use `/admin`. This is not a claim that the owner served
in the unit: the management account has no fabricated service details, seeker
profile, alumni recommendation eligibility, or unit-member invitation slots.

All community reads use native Azure SQL RLS. A fresh encrypted connection binds
the SHA-256 hash of an opaque session token in read-only session context; callers
cannot choose a member UUID. The runtime has no direct table-write grants.
Guarded procedures enforce ownership, role, approval and lifecycle rules.
Local development also impersonates the restricted runtime instead of using the
operator's privileges for requests.

Profiles are never public. Hiding or moderating a profile removes its details
from discovery and applicant views and blocks new CV downloads. A previously
issued read-only SAS can remain valid for at most 60 seconds. Blob containers
reject anonymous reads and shared-key authentication. PDFs are checked for size,
format, page count and nested active content; this is not an antivirus service.

Magic links expire in 15 minutes, require the requesting browser's HttpOnly
challenge cookie, and are consumed only by an intentional POST. Renewal links
also require a confirmation button: GET never changes state, avoiding mail
scanner renewals. Sessions last 14 days and are revoked when an account is banned.

## Repository

- `web/`: application, validation/PDF tests and browser journeys.
- `azure/migrations/`: authoritative Azure schema, native RLS, commands and identity.
  Applied migrations are checksum-tracked and immutable; add forward migrations.
- `azure/seed.sql`: idempotent synthetic examples, clearly marked in Hebrew.
- `azure/poc/verify-application.mjs`: 64 real Azure SQL authorization checks.
- `supabase/`, `tests/`, `SCHEMA.md`: preserved PostgreSQL reference and its 66-test
  PGlite suite. They are not used by the running Azure application.
- `azure/poc/README.md`: earlier infrastructure/pricing proof, retained as history.

The Azure database is still named `ofek-jobs-poc`; it now contains the complete
`authn`, `app` and `guard` schemas alongside the isolated earlier proof.

## Collaborating with pull requests

The source repository is public; the running community application remains
private. Anyone can read the source, fork the repository and open a pull request
without an invitation. Public source access does not grant Azure, database,
member-profile, CV or application-admin access.

Fork the repository, create a feature branch from `main`, commit and push the
change to your fork, then open a pull request targeting this repository's `main`
for review. Include a short description and the checks run. Keep credentials,
CVs and real member data out of commits and PR attachments; use synthetic
fixtures for examples. Direct write access is reserved for separately invited
collaborators.

Run the relevant checks from the next section. The PostgreSQL reference tests,
web lint, validation tests and build can run without Azure operator access.
Live SQL/browser tests require separate operator authorization and create
temporary fixtures. Never edit applied SQL migrations; add a forward migration.

Deployment remains a separate, owner-operated step: pushing or merging on
GitHub does not automatically update the Azure website.

## Develop and verify

Prerequisites: Node 24, Python 3, Azure CLI signed into the personal subscription,
and an operator SQL firewall rule for the current machine's exact IP.
For a fresh checkout, copy `web/.env.example` to `web/.env.local`; keep email
delivery disabled during local testing. Do not overwrite existing credentials.

```sh
npm ci --ignore-scripts
npm --prefix azure/poc ci --ignore-scripts
npm --prefix web ci
node azure/poc/migrate.mjs
node azure/poc/verify-application.mjs
npm --prefix web run lint
npm --prefix web test
npm --prefix web run build
npm --prefix web run typecheck
npm test
APP_URL=http://localhost:3084 EMAIL_DELIVERY_DISABLED=true \
  npm --prefix web start -- --hostname 127.0.0.1 --port 3084
# In another terminal:
node web/tests/journeys.mjs
# Deployed integration checks:
TEST_URL=https://ofek324-osalzberg-dev.azurewebsites.net node web/tests/journeys.mjs
```

Install Chromium with `cd web && npx playwright install chromium` if missing.
Browser tests create temporary `example.invalid` accounts, exercise the actual
magic-link POST, jobs, profiles, Blob upload/download, recommendations, admin
approval, invitation redemption, verification forms and mobile layouts, then
remove their exact fixtures and test blobs.
They never add a public test-login endpoint or send real email.

Verified on 5 November 2026: production build, lint, TypeScript, eight
validation/PDF tests, 64 live Azure SQL authorization checks, 22 browser journeys
against the deployed application, and 66 preserved PostgreSQL checks all passed.
The hourly Logic App also completed a successful scheduled run. Renewal coverage
includes resetting expiry to exactly 60 days and rejecting token replay.
Google sign-in and actual human email receipt remain outside this verification.

To load persistent examples, explicitly run `node azure/poc/seed.mjs`.
This creates three synthetic accounts, three jobs, two profiles and one approved
recommendation, with no passwords, login sessions, live CVs or email subscriptions.
Never automatically seed during app startup.

## Deployment and configuration

Resource group: `rg-ofek-jobs-dev`.
Subscription: `5edb3519-a630-43b6-82ac-cf92b84ec378`.
Tenant: `ea40c3b0-b791-4369-b99a-3c4e9f570512`.

Server settings: `APP_URL`, `SQL_SERVER`, `SQL_DATABASE`, `AZURE_STORAGE_ACCOUNT`,
`AZURE_TENANT_ID`, `EMAIL_CONNECTION_STRING`, `EMAIL_SENDER`, `CRON_SECRET`.
Secrets live in App Service settings and memory, never source, command arguments,
archives or browser bundles. Database and Blob authentication use managed identity.
SQL's principal SID must derive from the identity's **application/client ID**;
Blob role assignments instead use its **principal/object ID**.
The SQL firewall allows the web app's 31 exact advertised
`possibleOutboundIpAddresses`, not merely its current outbound addresses: shared
F1 workers can use the wider pool after recycling. It does not enable the
all-Azure-services rule. Refresh this set with
`python azure/provision-runtime.py --firewall-only` if Azure changes the pool.

```sh
python azure/provision-runtime.py
node azure/configure-delivery.mjs
npm --prefix web run build
python azure/package-web.py /tmp/ofek324-deploy.zip
python azure/deploy-web.py /tmp/ofek324-deploy.zip
node azure/configure-delivery.mjs --verify-worker
node azure/configure-delivery.mjs --enable-scheduler
```

App startup is `HOSTNAME=0.0.0.0 node server.js`, with build-on-deploy disabled and
run-from-package enabled. The deploy helper uses an explicitly personal-tenant
token: the Azure CLI's Kudu deployment path selected the corporate default tenant
despite `--subscription` and returned 403. Do not change the machine's global
Azure subscription to work around that.

For Google sign-in, create a Web OAuth client, set `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` privately in App Service, and register exactly
`https://ofek324-osalzberg-dev.azurewebsites.net/auth/google/callback`.
No rebuild is required.

## Email operations and cost controls

An hourly Consumption Logic App invokes `POST /api/tasks` with a secure parameter;
HTTP inputs/outputs are masked in workflow history. The endpoint and SQL worker
both authenticate the secret. Each batch leases at most five messages for ten
minutes, allows three attempts, and caps queued delivery at 100/day. Login requests
are separately capped at five/email/hour, twenty/IP/hour and 200 globally/day.
Delivery rechecks approval, content availability and consent before sending.
Empty digests advance the search watermark without sending an email.

No fixtures at `example.invalid` are delivered. A failed operation is not reported
as success; errors remain queued and return HTTP 503. After three failures,
inspect `authn.email_outbox` as the operator and deliberately requeue only after
the cause is fixed. Blob cleanup stops after five failures for operator attention.

## Budget and limits

F1 web hosting stays free, Always On stays off, SQL stays Basic (5 DTU, 2 GB),
Blob Storage stays Standard LRS, and email is metered. No paid web-host upgrade,
Defender subscription, registry or monitoring workspace is added.

The tested SQL retail baseline is $0.201/day, about **$6.23 per 31 days**.
The earlier light-use model is **about $7.69/month before tax and credits**,
including storage, operations, illustrative email use and a $1 allowance.
An hourly two-operation Consumption workflow is about 1,488 built-in executions
per 31 days, within the subscription-wide 4,000-operation free allowance; even
without that allowance, its base action cost is about $0.04/month, plus tiny
history storage. This is an estimate, **not a hard spending cap**.

Free App Service can cold-start, throttle or exhaust its daily CPU quota. This is
the requested small dev/test environment, not a production availability promise.
