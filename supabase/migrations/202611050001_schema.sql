begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.member_status as enum ('pending', 'approved', 'rejected', 'banned');
create type public.member_kind as enum ('unit_member', 'external_recruiter');
create type public.job_type as enum ('full_time', 'part_time', 'student', 'freelance');
create type public.seniority as enum ('junior', 'mid', 'senior');
create type public.work_mode as enum ('onsite', 'remote', 'hybrid');
create type public.apply_method as enum ('email', 'external_link', 'profile');
create type public.seeker_status as enum ('actively_looking', 'open_to_offers', 'hidden');

create table public.members (
  id uuid primary key references auth.users(id) on delete cascade,
  status public.member_status not null default 'pending',
  kind public.member_kind not null default 'unit_member',
  can_seek boolean not null default false,
  can_post boolean not null default false,
  is_admin boolean not null default false,
  invited_by uuid references public.members(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_admin or kind = 'unit_member'),
  check (kind <> 'external_recruiter' or not can_seek),
  check (status <> 'approved' or approved_at is not null),
  check (invited_by is distinct from id)
);

create table public.verification_requests (
  member_id uuid primary key references public.members(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 2 and 120),
  requested_kind public.member_kind not null,
  unit_start_year integer check (unit_start_year between 1950 and 2200),
  unit_end_year integer check (unit_end_year between 1950 and 2200),
  release_date date,
  already_released boolean not null default false,
  linkedin_url text not null check (
    length(linkedin_url) <= 500 and
    linkedin_url ~ '^https://(www[.])?linkedin[.]com/in/[^[:space:]?#]+/?$'
  ),
  submitted_at timestamptz not null default now(),
  check (unit_end_year is null or unit_end_year >= unit_start_year),
  check (
    (requested_kind = 'external_recruiter'
      and unit_start_year is null and unit_end_year is null and release_date is null)
    or (requested_kind = 'unit_member'
      and unit_start_year is not null
      and (already_released or release_date is not null))
  )
);

create table public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references public.members(id) on delete cascade,
  slot smallint not null check (slot between 1 and 5),
  code_hash bytea unique check (octet_length(code_hash) = 32),
  redeemed_by uuid unique references public.members(id) on delete set null,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  unique (inviter_id, slot),
  check (redeemed_by is null or redeemed_at is not null),
  check (redeemed_by is distinct from inviter_id)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null default auth.uid() references public.members(id) on delete cascade,
  title text not null check (length(btrim(title)) between 3 and 160),
  company text not null check (length(btrim(company)) between 2 and 120),
  city text check (length(btrim(city)) between 2 and 120),
  work_mode public.work_mode not null,
  job_type public.job_type not null,
  seniority public.seniority not null,
  tech_tags text[] not null default '{}' check (cardinality(tech_tags) <= 30),
  description text not null check (length(btrim(description)) between 20 and 30000),
  salary_min numeric(12,2) check (salary_min >= 0),
  salary_max numeric(12,2) check (salary_max >= 0),
  salary_currency text not null default 'ILS' check (salary_currency ~ '^[A-Z]{3}$'),
  salary_period text not null default 'month' check (salary_period in ('hour', 'month', 'year')),
  apply_method public.apply_method not null,
  apply_email text check (
    length(apply_email) <= 254 and apply_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  apply_url text check (length(apply_url) <= 2000 and apply_url ~ '^https://[^[:space:]]+$'),
  referral_available boolean not null default false,
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '60 days'),
  search_document tsvector generated always as (
    setweight(to_tsvector('simple', title), 'A') ||
    setweight(to_tsvector('simple', company), 'B') ||
    setweight(to_tsvector('simple', description), 'C')
  ) stored,
  check (work_mode = 'remote' or city is not null),
  check (salary_min is null or salary_max is null or salary_min <= salary_max),
  check (
    (apply_method = 'email' and apply_email is not null and apply_url is null)
    or (apply_method = 'external_link' and apply_url is not null and apply_email is null)
    or (apply_method = 'profile' and apply_url is null and apply_email is null)
  )
);

create table public.seeker_profiles (
  member_id uuid primary key default auth.uid() references public.members(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 2 and 120),
  headline text not null check (length(btrim(headline)) between 3 and 200),
  release_date date,
  already_released boolean not null default false,
  years_experience numeric(4,1) not null default 0 check (years_experience between 0 and 70),
  skills text[] not null default '{}' check (cardinality(skills) <= 50),
  preferred_roles text[] not null default '{}' check (cardinality(preferred_roles) <= 15),
  preferred_locations text[] not null default '{}' check (cardinality(preferred_locations) <= 15),
  linkedin_url text check (
    length(linkedin_url) <= 500 and linkedin_url ~ '^https://(www[.])?linkedin[.]com/in/[^[:space:]?#]+/?$'
  ),
  github_url text check (
    length(github_url) <= 500 and github_url ~ '^https://(www[.])?github[.]com/[A-Za-z0-9-]+/?$'
  ),
  bio text not null default '' check (length(bio) <= 3000),
  status public.seeker_status not null default 'hidden',
  cv_document_id uuid,
  moderated_at timestamptz,
  moderation_reason text check (length(moderation_reason) between 3 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (already_released or release_date is not null)
);

create table public.cv_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.seeker_profiles(member_id) on delete cascade,
  object_name text generated always as (owner_id::text || '/' || id::text || '.pdf') stored,
  original_filename text not null check (length(original_filename) between 5 and 200 and original_filename ~* '[.]pdf$'),
  byte_size integer not null check (byte_size between 1 and 5242880),
  mime_type text not null default 'application/pdf' check (mime_type = 'application/pdf'),
  attested_at timestamptz not null,
  attestation_version text not null default '2026-11-05-v1',
  state text not null default 'pending' check (state in ('pending', 'ready')),
  sha256 bytea check (octet_length(sha256) = 32),
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  unique (owner_id, id),
  unique (object_name),
  check (state <> 'ready' or (sha256 is not null and verified_at is not null))
);

alter table public.seeker_profiles add constraint profile_owns_cv
  foreign key (member_id, cv_document_id)
  references public.cv_documents(owner_id, id);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  applicant_id uuid not null default auth.uid() references public.seeker_profiles(member_id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (job_id, applicant_id)
);

create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.members(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  query text not null default '' check (length(query) <= 200),
  tags text[] not null default '{}' check (cardinality(tags) <= 30),
  city text check (length(city) <= 120),
  work_mode public.work_mode,
  job_type public.job_type,
  seniority public.seniority,
  referral_only boolean not null default false,
  posted_within_days integer check (posted_within_days between 1 and 60),
  email_enabled boolean not null default false,
  email_consent_at timestamptz,
  next_digest_at timestamptz not null default (now() + interval '7 days'),
  last_digest_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not email_enabled or email_consent_at is not null)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.members(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  reason text check (length(reason) <= 1000),
  created_at timestamptz not null default now()
);

create table private.email_outbox (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.members(id) on delete cascade,
  kind text not null check (kind in ('job_expiring', 'weekly_digest')),
  job_id uuid references public.jobs(id) on delete cascade,
  saved_search_id uuid references public.saved_searches(id) on delete cascade,
  dedupe_key text not null unique,
  scheduled_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  lease_until timestamptz,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (kind = 'job_expiring' and job_id is not null and saved_search_id is null)
    or (kind = 'weekly_digest' and saved_search_id is not null and job_id is null)
  )
);

create table private.job_renewal_tokens (
  token_hash bytea primary key check (octet_length(token_hash) = 32),
  job_id uuid not null references public.jobs(id) on delete cascade,
  poster_id uuid not null references public.members(id) on delete cascade,
  job_expires_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index jobs_search_idx on public.jobs using gin(search_document);
create index jobs_tags_idx on public.jobs using gin(tech_tags);
create index jobs_discovery_idx on public.jobs(is_open, expires_at, created_at desc);
create index jobs_creator_idx on public.jobs(creator_id);
create index profiles_skills_idx on public.seeker_profiles using gin(skills);
create index profiles_discovery_idx on public.seeker_profiles(status, release_date, years_experience);
create index applications_applicant_idx on public.applications(applicant_id);
create index cv_documents_owner_idx on public.cv_documents(owner_id, created_at);
create index members_pending_idx on public.members(status, created_at);
create index members_inviter_idx on public.members(invited_by);
create index saved_searches_owner_idx on public.saved_searches(owner_id);
create index saved_searches_due_idx on public.saved_searches(next_digest_at) where email_enabled;
create index email_outbox_due_idx on private.email_outbox(status, scheduled_at);
create index audit_events_actor_idx on public.audit_events(actor_id);

alter table public.members enable row level security;
alter table public.verification_requests enable row level security;
alter table public.invite_codes enable row level security;
alter table public.jobs enable row level security;
alter table public.seeker_profiles enable row level security;
alter table public.cv_documents enable row level security;
alter table public.applications enable row level security;
alter table public.saved_searches enable row level security;
alter table public.audit_events enable row level security;
alter table private.email_outbox enable row level security;
alter table private.job_renewal_tokens enable row level security;

-- Explicit grants follow in the access migration; no implicit public API access.
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('cvs', 'cvs', false, 5242880, array['application/pdf'])
on conflict (id) do update set
  public = false, file_size_limit = 5242880, allowed_mime_types = array['application/pdf'];

-- A browser must never mint an arbitrarily long-lived CV URL or bypass PDF validation.
create policy cvs_backend_only on storage.objects as restrictive
  for all to anon, authenticated
  using (bucket_id <> 'cvs') with check (bucket_id <> 'cvs');

commit;
