begin;

create type public.recommendation_status as enum ('pending', 'approved', 'hidden');

create table public.member_cards (
  member_id uuid primary key references public.members(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 2 and 120),
  headline text not null check (length(btrim(headline)) between 3 and 200),
  current_title text check (length(btrim(current_title)) between 2 and 160),
  current_company text check (length(btrim(current_company)) between 2 and 120),
  unit_start_year integer not null check (unit_start_year between 1950 and 2200),
  unit_end_year integer check (unit_end_year between unit_start_year and 2200),
  account_path text generated always as ('/members/' || member_id::text) stored,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references public.member_cards(member_id) on delete cascade,
  seeker_id uuid not null references public.seeker_profiles(member_id) on delete cascade,
  recommendation_text text not null check (length(btrim(recommendation_text)) between 20 and 4000),
  relationship text check (length(btrim(relationship)) between 2 and 160),
  approval_status public.recommendation_status not null default 'pending',
  revision integer not null default 1 check (revision >= 1),
  approved_revision integer,
  approved_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (author_id, seeker_id),
  check (author_id <> seeker_id),
  check (
    (approval_status = 'approved' and approved_revision = revision and approved_revision is not null
      and approved_at is not null and reviewed_at is not null)
    or (approval_status <> 'approved' and approved_revision is null and approved_at is null)
  )
);

create index recommendations_seeker_idx on public.recommendations(seeker_id, approval_status);
alter table public.member_cards enable row level security;
alter table public.recommendations enable row level security;
revoke all on public.member_cards, public.recommendations from public, anon, authenticated;

alter table private.email_outbox
  add column recommendation_id uuid references public.recommendations(id) on delete cascade;
alter table private.email_outbox drop constraint email_outbox_kind_check;
alter table private.email_outbox drop constraint email_outbox_check;
alter table private.email_outbox add constraint email_outbox_kind_check
  check (kind in ('job_expiring', 'weekly_digest', 'recommendation_pending'));
alter table private.email_outbox add constraint email_outbox_source_check check (
  (kind = 'job_expiring' and job_id is not null and saved_search_id is null and recommendation_id is null)
  or (kind = 'weekly_digest' and saved_search_id is not null and job_id is null and recommendation_id is null)
  or (kind = 'recommendation_pending' and recommendation_id is not null and job_id is null and saved_search_id is null)
);
create index email_outbox_recommendation_idx on private.email_outbox(recommendation_id)
  where recommendation_id is not null;

create function private.is_alumnus(p_member uuid default auth.uid())
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.is_verified(p_member) and exists (
    select 1 from public.members m join public.verification_requests v on v.member_id = m.id
    where m.id = p_member and m.kind = 'unit_member' and v.requested_kind = 'unit_member'
      and (v.already_released or v.release_date <= current_date)
  );
$$;

create function private.profile_is_discoverable(p_member uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.is_verified(p_member) and exists (
    select 1 from public.seeker_profiles p join public.members m on m.id = p.member_id
    where p.member_id = p_member and p.status <> 'hidden' and p.moderated_at is null and m.can_seek
  );
$$;

create function private.has_published_member_card(p_member uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.is_verified(p_member) and exists (
    select 1 from public.member_cards where member_id = p_member and published_at is not null
  );
$$;

create function private.recommendation_is_publishable(p_author uuid, p_seeker uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.is_alumnus(p_author) and private.has_published_member_card(p_author)
    and private.profile_is_discoverable(p_seeker);
$$;

create function public.save_member_card(
  p_headline text, p_current_title text default null,
  p_current_company text default null, p_publish boolean default false
)
returns public.member_cards language plpgsql security definer set search_path = ''
as $$
declare
  v_verification public.verification_requests;
  v_card public.member_cards;
begin
  if not private.is_verified() or p_publish is null then
    raise exception 'Verified membership and an explicit publication choice are required' using errcode = '42501';
  end if;
  select v.* into v_verification from public.verification_requests v
    join public.members m on m.id = v.member_id
    where m.id = auth.uid() and m.kind = 'unit_member' and v.requested_kind = 'unit_member';
  if not found then
    raise exception 'Only verified unit members can publish an alumni card' using errcode = '42501';
  end if;
  insert into public.member_cards(
    member_id, full_name, headline, current_title, current_company,
    unit_start_year, unit_end_year, published_at
  ) values (
    auth.uid(), v_verification.full_name, p_headline, p_current_title, p_current_company,
    v_verification.unit_start_year, v_verification.unit_end_year,
    case when p_publish then now() else null end
  )
  on conflict (member_id) do update set
    full_name = excluded.full_name, headline = excluded.headline,
    current_title = excluded.current_title, current_company = excluded.current_company,
    unit_start_year = excluded.unit_start_year, unit_end_year = excluded.unit_end_year,
    published_at = case when p_publish then coalesce(public.member_cards.published_at, now()) else null end
  returning * into v_card;
  return v_card;
end;
$$;

create function private.prepare_recommendation_update()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.recommendation_text is distinct from old.recommendation_text
    or new.relationship is distinct from old.relationship then
    new.revision := old.revision + 1;
    new.approval_status := case when old.approval_status = 'hidden'
      then 'hidden'::public.recommendation_status else 'pending'::public.recommendation_status end;
    new.approved_revision := null;
    new.approved_at := null;
    new.reviewed_at := case when old.approval_status = 'hidden' then old.reviewed_at else null end;
  end if;
  return new;
end;
$$;

create function public.review_recommendation(
  p_recommendation uuid, p_decision public.recommendation_status, p_expected_revision integer
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_recommendation public.recommendations;
begin
  if not private.can_seek() then
    raise exception 'Verified seeker required' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'hidden') or p_expected_revision is null then
    raise exception 'An approval/hide decision and the reviewed revision are required' using errcode = '22023';
  end if;
  select * into v_recommendation from public.recommendations
    where id = p_recommendation and seeker_id = auth.uid() for update;
  if not found then
    raise exception 'Recommendation is unavailable to this seeker' using errcode = '42501';
  end if;
  if v_recommendation.revision <> p_expected_revision then
    raise exception 'Recommendation changed; reload before reviewing' using errcode = '40001';
  end if;
  if p_decision = 'approved' and (
    not private.is_alumnus(v_recommendation.author_id)
    or not private.has_published_member_card(v_recommendation.author_id)
    or exists (select 1 from public.seeker_profiles where member_id = auth.uid() and moderated_at is not null)
  ) then
    raise exception 'Recommendation is not eligible for approval' using errcode = '42501';
  end if;
  update public.recommendations set approval_status = p_decision,
    approved_revision = case when p_decision = 'approved' then revision else null end,
    approved_at = case when p_decision = 'approved' then now() else null end,
    reviewed_at = now()
    where id = p_recommendation;
  delete from private.email_outbox where recommendation_id = p_recommendation and status in ('pending', 'failed');
  insert into public.audit_events(actor_id, action, entity_type, entity_id)
    values (auth.uid(), 'recommendation_' || p_decision::text, 'recommendation', p_recommendation);
end;
$$;

create function private.queue_recommendation_notification()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.approval_status = 'pending' then
    insert into private.email_outbox(recipient_id, kind, recommendation_id, dedupe_key)
      values (new.seeker_id, 'recommendation_pending', new.id, 'recommendation_pending:' || new.id::text)
      on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

create function private.audit_recommendation_delete()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_events(actor_id, action, entity_type, entity_id)
    values ((select id from public.members where id = auth.uid()),
      'recommendation_deleted', 'recommendation', old.id);
  return old;
end;
$$;

create trigger member_cards_touch before update on public.member_cards
  for each row execute function private.touch_row();
create trigger recommendations_prepare_update before update on public.recommendations
  for each row execute function private.prepare_recommendation_update();
create trigger recommendations_notify after insert on public.recommendations
  for each row execute function private.queue_recommendation_notification();
create trigger recommendations_audit_delete after delete on public.recommendations
  for each row execute function private.audit_recommendation_delete();

create policy member_cards_read on public.member_cards for select to authenticated
  using (private.is_verified() and (
    member_id = auth.uid() or private.is_admin()
    or (published_at is not null and private.is_verified(member_id))
  ));
create policy recommendations_read on public.recommendations for select to authenticated
  using (private.is_verified() and (
    author_id = auth.uid() or seeker_id = auth.uid() or private.is_admin()
    or (approval_status = 'approved' and private.recommendation_is_publishable(author_id, seeker_id))
  ));
create policy recommendations_insert on public.recommendations for insert to authenticated
  with check (
    author_id = auth.uid() and seeker_id <> auth.uid()
    and private.recommendation_is_publishable(author_id, seeker_id)
  );
create policy recommendations_update on public.recommendations for update to authenticated
  using (author_id = auth.uid() and private.is_alumnus())
  with check (author_id = auth.uid() and private.is_alumnus());
create policy recommendations_delete on public.recommendations for delete to authenticated
  using (private.is_verified() and (author_id = auth.uid() or seeker_id = auth.uid() or private.is_admin()));

grant select on public.member_cards, public.recommendations to authenticated;
grant insert (seeker_id, recommendation_text, relationship) on public.recommendations to authenticated;
grant update (recommendation_text, relationship) on public.recommendations to authenticated;
grant delete on public.recommendations to authenticated;
grant all on public.member_cards, public.recommendations to service_role;

create function public.recommendation_count(p_seeker uuid)
returns bigint language sql stable security invoker set search_path = ''
as $$
  select count(*) from public.recommendations
  where seeker_id = p_seeker and approval_status = 'approved'
    and private.recommendation_is_publishable(author_id, seeker_id);
$$;

create view public.profile_cards with (security_invoker = true) as
  select p.*, public.recommendation_count(p.member_id) as recommendation_count
  from public.seeker_profiles p;

create view public.applicant_cards with (security_invoker = true) as
  select a.id as application_id, a.job_id, a.applicant_id, a.created_at as applied_at,
    p.member_id as profile_member_id, p.full_name, p.headline, p.status,
    public.recommendation_count(p.member_id) as recommendation_count
  from public.applications a
  left join public.seeker_profiles p on p.member_id = a.applicant_id;

revoke all on public.profile_cards, public.applicant_cards from public, anon, authenticated;
grant select on public.profile_cards, public.applicant_cards to authenticated, service_role;

drop function public.search_profiles(text[], date, date, public.seeker_status, numeric, numeric, integer, integer);
create function public.search_profiles(
  p_skills text[] default '{}', p_release_from date default null, p_release_to date default null,
  p_status public.seeker_status default null, p_experience_min numeric default null,
  p_experience_max numeric default null, p_limit integer default 30, p_offset integer default 0,
  p_has_recommendations boolean default false
)
returns setof public.profile_cards language plpgsql stable security invoker set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset < 0
    or p_skills is null or cardinality(p_skills) > 50
    or p_release_from > p_release_to or p_experience_min > p_experience_max
    or p_experience_min < 0 or p_experience_max > 70 then
    raise exception 'Invalid search parameters' using errcode = '22023';
  end if;
  return query select p.* from public.profile_cards p
    where p.status <> 'hidden' and p.moderated_at is null and private.is_verified(p.member_id)
      and p.skills @> private.normalize_tags(p_skills)
      and (p_release_from is null or (not p.already_released and p.release_date >= p_release_from))
      and (p_release_to is null or (not p.already_released and p.release_date <= p_release_to))
      and (p_status is null or p.status = p_status)
      and (p_experience_min is null or p.years_experience >= p_experience_min)
      and (p_experience_max is null or p.years_experience <= p_experience_max)
      and (not coalesce(p_has_recommendations, false) or p.recommendation_count > 0)
    order by p.updated_at desc, p.member_id
    limit p_limit offset p_offset;
end;
$$;

drop function public.admin_stats();
create function public.admin_stats()
returns table (members bigint, pending bigint, active_jobs bigint, applications bigint, recommendations bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Admin required' using errcode = '42501';
  end if;
  return query select
    (select count(*) from public.members where status = 'approved'),
    (select count(*) from public.members where status = 'pending'),
    (select count(*) from public.jobs where is_open and expires_at > now() and private.is_verified(creator_id)),
    (select count(*) from public.applications),
    (select count(*) from public.recommendations);
end;
$$;

revoke execute on function private.is_alumnus(uuid), private.profile_is_discoverable(uuid),
  private.has_published_member_card(uuid), private.recommendation_is_publishable(uuid, uuid),
  private.prepare_recommendation_update(), private.queue_recommendation_notification(),
  private.audit_recommendation_delete(), public.save_member_card(text, text, text, boolean),
  public.review_recommendation(uuid, public.recommendation_status, integer),
  public.recommendation_count(uuid),
  public.search_profiles(text[], date, date, public.seeker_status, numeric, numeric, integer, integer, boolean),
  public.admin_stats() from public, anon, authenticated;
grant execute on function private.is_alumnus(uuid), private.profile_is_discoverable(uuid),
  private.has_published_member_card(uuid), private.recommendation_is_publishable(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.save_member_card(text, text, text, boolean),
  public.review_recommendation(uuid, public.recommendation_status, integer),
  public.recommendation_count(uuid),
  public.search_profiles(text[], date, date, public.seeker_status, numeric, numeric, integer, integer, boolean),
  public.admin_stats() to authenticated;
grant execute on function public.recommendation_count(uuid) to service_role;

commit;
