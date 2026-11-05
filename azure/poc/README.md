# Azure-only feasibility test

Historical infrastructure checkpoint. The full Azure application has since been
implemented and deployed; see [the current application guide](../../README.md).

**Result, 5 November 2026:** Azure SQL Basic and private Blob Storage work in the
personal subscription. The tested infrastructure supports a light-use estimate
around **$7-10/month before tax**. This is a feasibility proof, not a finished or
deployed job board and not a production-cost guarantee.

## What actually passed

- **16 live SQL authorization checks** using native Azure SQL RLS, a restricted
  database user, synthetic members/jobs, and real encrypted SQL connections.
  Pending/banned/unidentified sessions cannot read jobs; expired/closed/banned-
  author jobs are filtered; owners/admins can moderate; other members cannot
  edit/delete; membership escalation and forged ownership/expiry are denied.
  Request identity cannot be overwritten after read-only session binding, and
  a ban takes effect on the next query in the same authenticated session.
- **Private file access:** a valid synthetic PDF was uploaded with Entra
  authorization. Anonymous access returned `409 / PublicAccessNotPermitted`.
  A read-only, HTTPS-only user-delegation SAS returned the exact PDF (`200`),
  rejected replacement (`403`), and rejected a read after its actual expiry
  (`403`). The token lifetime was at most **60 seconds**. Shared keys are
  disabled. The exact test object was deleted; the `poc/` prefix is empty.
- **66 original PostgreSQL tests** still pass. These test the full initial
  Supabase schema locally; they are not Azure SQL integration coverage.

No real member information, CVs, passwords, or emails were used. No email was sent.

## Provisioned resources

Personal subscription: `5edb3519-a630-43b6-82ac-cf92b84ec378`.
Resource group: `rg-ofek-jobs-dev`.

| Resource | Configuration |
|---|---|
| `asp-ofek-jobs-free` / `ofek324-osalzberg-dev` | West Europe, App Service F1/Free, Node.js 24 LTS. Still serves Azure's placeholder, not the application. |
| `sql-ofek324-osalzberg-fc` / `ofek-jobs-poc` | France Central, SQL Basic, 5 DTU, 2 GB maximum, local backups, no zone redundancy. Encryption at rest enabled; paid threat detection disabled. |
| `stofek324osalzbergdev` / `cvs` | West Europe, StorageV2/Standard LRS/Hot, private container, HTTPS, no anonymous blob access or shared-key authentication. |

West Europe SQL provisioning was restricted for this subscription. France Central
was available. Only the operator's single current IP is allowed through the SQL
firewall; there is no all-Azure or worldwide allowance. The web app has not been
granted database or storage access.

SQL authentication is Entra-only, with Oren's personal tenant
`ea40c3b0-b791-4369-b99a-3c4e9f570512` explicitly configured. The initial CLI server
creation incorrectly populated its administrator's tenant from the CLI's other
signed-in tenant, despite an explicit subscription argument. This was corrected
through the resource's administrator API and reverified. Future provisioning
must verify **both** the resource subscription and administrator tenant.

## Monthly estimate

The [Azure Retail Prices API](https://prices.azure.com/api/retail/prices) returned:

- France Central single Basic SQL: **$0.201/day**, or **$6.231 for 31 days**.
  Meter `664809ff-e6ec-4687-8677-d901bd5fb936`.
- West Europe Hot LRS Blob data: **$0.0196/GB-month** at the first pricing tier.
- Writes/list/create: **$0.054 per 10,000**; reads: **$0.0043 per 10,000**.

An illustrative month with 5 GB stored, 10,000 writes, 100,000 reads, 1,000 email
recipients / 100 MB email, and a $1 network/other allowance totals **$7.688**:

`6.231 + 0.098 + 0.054 + 0.043 + 0.250 + 0.012 + 1.000`

Email uses the illustrative rates in Microsoft's
[email-pricing documentation](https://learn.microsoft.com/en-us/azure/communication-services/concepts/email-pricing):
$0.00025 per recipient and $0.00012/MB. No email service has been provisioned,
and current sender availability, pricing, quotas, and delivery still need testing.
There is no assumed free email allowance.

This is **not an invoice or a hard $15 cap**. Tax, currency conversion, credits,
traffic, extra services, and production hosting can change the result. The
database accrues charges while it exists, even idle. No budget alert or hard cap
was configured. No paid App Service upgrade, monitoring workspace, registry,
domain, email resource, or scheduler was created.

The available **Visual Studio subscription is dev/test-only**. Launching the
live alumni community needs an eligible production subscription. F1 is quota-
limited shared compute, can sleep, and is not an always-on scheduler or a
production SLA. Authentication, scheduling, and production load/cost remain open.

## Database authorization design being proved

`schema.sql` creates a dedicated `ofek_poc` schema with synthetic members and jobs.
It is **not** the full application port:

- An RLS filter evaluates the live membership table, job state, and expiry.
- Block predicates guard `AFTER INSERT`, `BEFORE UPDATE`, `AFTER UPDATE`, and
  `BEFORE DELETE`. Column grants separately prevent ownership/expiry changes.
- A narrow create procedure assigns the owner and 60-day lifetime in the database.
  The application user cannot insert arbitrary rows or update membership.
- A fresh connection receives a server-established member UUID through
  `SESSION_CONTEXT`, marked read-only, before restricted operations run.
- Each test asserts the actual restricted database execution identity, uses
  transactional fixture changes, and rolls them back. The ban test temporarily
  changes only one synthetic member and restores it in `finally`.

**Production boundary:** the test harness connects as an operator and impersonates
the restricted test user. Never deploy that operator connection or impersonation
pattern as the application's runtime. The application needs its own least-
privilege database principal/managed identity, validated login-to-member mapping,
parameterized queries, and a separate migration/operator identity. Never trust a
member ID from request JSON. Connection-pool identity reset/reuse is not tested;
this proof uses fresh connections, not a shared identity-bearing pool.

Similarly, the Blob test signs using the operator's Azure identity. A real CV
endpoint must first authorize the exact document via caller-bound database RLS
and only then mint a short-lived URL using a restricted backend identity. A SAS
is a bearer credential until expiry; never log it or expose a general signer.
The application's PDF validation, 5 MB limit, publication attestation, and
metadata lifecycle have **not** been implemented or tested against Azure.

## Reproduce

Requires Node.js 22+, Python 3, Azure CLI signed into the personal subscription,
SQL administrator access, the narrow operator firewall rule, and data-plane
storage permissions. Tests access real Azure services and incur tiny operation
charges. They contain no credentials.

```sh
npm --prefix azure/poc ci --ignore-scripts
npm --prefix azure/poc test
python3 azure/poc/verify-storage.py
```

For a **new, empty** `ofek-jobs-poc` database only:

```sh
npm --prefix azure/poc run init:db
```

Initialization is transactional and refuses to overwrite an existing PoC schema.
Do not rerun it on the already initialized database. No test creates cloud
resources, upgrades a tier, or sends email. The storage test uploads one uniquely
named synthetic PDF, waits for real expiration, and deletes that exact object
in `finally`. It never deletes the account/container or other objects.

## Still required before building the UI

Port and show the **full** schema/RLS design for Azure SQL: verification,
invitations, profiles/CV metadata, applications, recommendations, search,
moderation, and email queues. Preserve the existing PostgreSQL implementation as
the initial specification/reference. Then implement the requested sequence:
auth/approval, jobs, profiles/CVs, recommendations, search, admin, and email.
Supabase/Resend accounts are not required for the Azure-only direction.
