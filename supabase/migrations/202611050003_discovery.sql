begin;

create function public.search_jobs(
  p_query text default '', p_tags text[] default '{}', p_city text default null,
  p_work_mode public.work_mode default null, p_job_type public.job_type default null,
  p_seniority public.seniority default null, p_referral_only boolean default false,
  p_posted_since timestamptz default null, p_limit integer default 30, p_offset integer default 0
)
returns setof public.jobs language plpgsql stable security invoker set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset < 0
    or p_query is null or length(p_query) > 200 or p_tags is null or cardinality(p_tags) > 30 then
    raise exception 'Invalid search parameters' using errcode = '22023';
  end if;
  return query select j.* from public.jobs j
    where j.is_open and j.expires_at > now() and private.is_verified(j.creator_id)
      and (btrim(p_query) = '' or j.search_document @@ websearch_to_tsquery('simple', p_query))
      and j.tech_tags @> private.normalize_tags(p_tags)
      and (p_city is null or lower(j.city) = lower(p_city))
      and (p_work_mode is null or j.work_mode = p_work_mode)
      and (p_job_type is null or j.job_type = p_job_type)
      and (p_seniority is null or j.seniority = p_seniority)
      and (not coalesce(p_referral_only, false) or j.referral_available)
      and (p_posted_since is null or j.created_at >= p_posted_since)
    order by j.created_at desc, j.id
    limit p_limit offset p_offset;
end;
$$;

create function public.search_profiles(
  p_skills text[] default '{}', p_release_from date default null, p_release_to date default null,
  p_status public.seeker_status default null, p_experience_min numeric default null,
  p_experience_max numeric default null, p_limit integer default 30, p_offset integer default 0
)
returns setof public.seeker_profiles language plpgsql stable security invoker set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset < 0
    or p_skills is null or cardinality(p_skills) > 50
    or p_release_from > p_release_to or p_experience_min > p_experience_max
    or p_experience_min < 0 or p_experience_max > 70 then
    raise exception 'Invalid search parameters' using errcode = '22023';
  end if;
  return query select p.* from public.seeker_profiles p
    where p.status <> 'hidden' and p.moderated_at is null and private.is_verified(p.member_id)
      and p.skills @> private.normalize_tags(p_skills)
      and (p_release_from is null or (not p.already_released and p.release_date >= p_release_from))
      and (p_release_to is null or (not p.already_released and p.release_date <= p_release_to))
      and (p_status is null or p.status = p_status)
      and (p_experience_min is null or p.years_experience >= p_experience_min)
      and (p_experience_max is null or p.years_experience <= p_experience_max)
    order by p.updated_at desc, p.member_id
    limit p_limit offset p_offset;
end;
$$;

create function public.home_stats()
returns table (active_jobs bigint, releasing_soon bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_verified() then
    raise exception 'Verified membership required' using errcode = '42501';
  end if;
  return query select
    (select count(*) from public.jobs where is_open and expires_at > now() and private.is_verified(creator_id)),
    (select count(*) from public.seeker_profiles where status <> 'hidden' and moderated_at is null
      and private.is_verified(member_id) and not already_released
      and release_date between current_date and (current_date + interval '3 months')::date);
end;
$$;

create function public.admin_stats()
returns table (members bigint, pending bigint, active_jobs bigint, applications bigint)
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
    (select count(*) from public.applications);
end;
$$;

revoke execute on function public.search_jobs(text, text[], text, public.work_mode, public.job_type,
  public.seniority, boolean, timestamptz, integer, integer),
  public.search_profiles(text[], date, date, public.seeker_status, numeric, numeric, integer, integer),
  public.home_stats(), public.admin_stats() from public, anon;
grant execute on function public.search_jobs(text, text[], text, public.work_mode, public.job_type,
  public.seniority, boolean, timestamptz, integer, integer),
  public.search_profiles(text[], date, date, public.seeker_status, numeric, numeric, integer, integer),
  public.home_stats(), public.admin_stats() to authenticated;

commit;
