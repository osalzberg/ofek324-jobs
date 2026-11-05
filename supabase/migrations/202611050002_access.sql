begin;

create function private.is_verified(p_member uuid default auth.uid())
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members m join auth.users u on u.id = m.id
    where m.id = p_member and m.status = 'approved'
      and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)
  );
$$;

create function private.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.is_verified() and exists (
    select 1 from public.members where id = auth.uid() and is_admin
  );
$$;

create function private.can_seek()
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.is_verified() and exists (
    select 1 from public.members where id = auth.uid() and can_seek and kind = 'unit_member'
  );
$$;

create function private.can_post()
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.is_verified() and exists (
    select 1 from public.members where id = auth.uid() and can_post
  );
$$;

create function private.owns_job(p_job uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.jobs where id = p_job and creator_id = auth.uid());
$$;

create function private.can_view_profile(p_owner uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.is_verified() and exists (
    select 1 from public.seeker_profiles p where p.member_id = p_owner and (
      p_owner = auth.uid() or private.is_admin() or
      (private.is_verified(p_owner) and p.status <> 'hidden' and p.moderated_at is null)
    )
  );
$$;

create function private.can_apply(p_job uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.can_seek() and exists (
    select 1 from public.jobs j join public.seeker_profiles p on p.member_id = auth.uid()
    where j.id = p_job and j.creator_id <> auth.uid()
      and private.is_verified(j.creator_id) and j.is_open and j.expires_at > now()
      and j.apply_method = 'profile' and p.status <> 'hidden' and p.moderated_at is null
  );
$$;

create function private.normalize_tags(p_values text[])
returns text[] language plpgsql immutable set search_path = ''
as $$
begin
  if exists (select 1 from unnest(p_values) as t(value)
    where value is null or length(btrim(value)) not between 1 and 80) then
    raise exception 'Tags must contain 1 to 80 characters' using errcode = '22023';
  end if;
  return array(select distinct lower(btrim(value)) from unnest(p_values) as t(value) order by 1);
end;
$$;

create function private.touch_row()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function private.prepare_job()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.tech_tags := private.normalize_tags(new.tech_tags);
  return new;
end;
$$;

create function private.prepare_profile()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.skills := private.normalize_tags(new.skills);
  new.preferred_roles := private.normalize_tags(new.preferred_roles);
  new.preferred_locations := private.normalize_tags(new.preferred_locations);
  return new;
end;
$$;

create function private.prepare_saved_search()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.tags := private.normalize_tags(new.tags);
  if new.email_enabled then
    if tg_op = 'INSERT' then
      new.email_consent_at := now();
      new.next_digest_at := now() + interval '7 days';
    elsif not old.email_enabled then
      new.email_consent_at := now();
      new.next_digest_at := now() + interval '7 days';
    end if;
  else
    new.email_consent_at := null;
  end if;
  return new;
end;
$$;

create function private.create_pending_member()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  -- User-editable OAuth/auth metadata must never confer membership or admin rights.
  insert into public.members(id) values (new.id);
  return new;
end;
$$;

create function private.allocate_invites()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'approved' and new.kind = 'unit_member' then
    insert into public.invite_codes(inviter_id, slot)
      select new.id, n from generate_series(1, 5) as n
      on conflict (inviter_id, slot) do nothing;
  end if;
  return new;
end;
$$;

create function private.audit_job_delete()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_events(actor_id, action, entity_type, entity_id)
  values (auth.uid(), 'job_deleted', 'job', old.id);
  return old;
end;
$$;

create trigger auth_user_created after insert on auth.users
  for each row execute function private.create_pending_member();
create trigger members_allocate_invites after insert or update of status on public.members
  for each row execute function private.allocate_invites();
create trigger members_touch before update on public.members
  for each row execute function private.touch_row();
create trigger jobs_touch before update on public.jobs
  for each row execute function private.touch_row();
create trigger jobs_prepare before insert or update on public.jobs
  for each row execute function private.prepare_job();
create trigger jobs_audit_delete after delete on public.jobs
  for each row execute function private.audit_job_delete();
create trigger profiles_touch before update on public.seeker_profiles
  for each row execute function private.touch_row();
create trigger profiles_prepare before insert or update on public.seeker_profiles
  for each row execute function private.prepare_profile();
create trigger saved_searches_touch before update on public.saved_searches
  for each row execute function private.touch_row();
create trigger saved_searches_prepare before insert or update on public.saved_searches
  for each row execute function private.prepare_saved_search();

create function public.submit_verification(
  p_full_name text, p_kind public.member_kind, p_start_year integer,
  p_end_year integer, p_release_date date, p_already_released boolean, p_linkedin_url text
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.members m join auth.users u on u.id = m.id
    where m.id = auth.uid() and m.status = 'pending'
      and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)
    for update of m;
  if not found then
    raise exception 'Only confirmed, pending accounts can submit verification' using errcode = '42501';
  end if;
  insert into public.verification_requests(
    member_id, full_name, requested_kind, unit_start_year, unit_end_year,
    release_date, already_released, linkedin_url
  ) values (auth.uid(), p_full_name, p_kind, p_start_year, p_end_year,
    p_release_date, p_already_released, p_linkedin_url)
  on conflict (member_id) do update set
    full_name = excluded.full_name, requested_kind = excluded.requested_kind,
    unit_start_year = excluded.unit_start_year, unit_end_year = excluded.unit_end_year,
    release_date = excluded.release_date, already_released = excluded.already_released,
    linkedin_url = excluded.linkedin_url, submitted_at = now();
end;
$$;

create function public.issue_invite(p_slot smallint)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_code text;
begin
  if not private.is_verified() or not exists (
    select 1 from public.members where id = auth.uid() and kind = 'unit_member'
  ) then
    raise exception 'Only verified unit members can invite' using errcode = '42501';
  end if;
  perform 1 from public.invite_codes where inviter_id = auth.uid() and slot = p_slot
    and redeemed_at is null and revoked_at is null for update;
  if not found then
    raise exception 'Invite slot is unavailable' using errcode = '22023';
  end if;
  v_code := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update public.invite_codes set code_hash = sha256(convert_to(v_code, 'UTF8')), issued_at = now()
    where inviter_id = auth.uid() and slot = p_slot;
  return v_code;
end;
$$;

create function public.revoke_invite(p_slot smallint)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_verified() then
    raise exception 'Verified membership required' using errcode = '42501';
  end if;
  update public.invite_codes set revoked_at = now()
    where inviter_id = auth.uid() and slot = p_slot and redeemed_at is null and revoked_at is null;
  if not found then
    raise exception 'Invite slot is unavailable' using errcode = '22023';
  end if;
end;
$$;

create function public.redeem_invite(p_code text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_invite public.invite_codes;
begin
  perform 1 from public.members m join auth.users u on u.id = m.id
    where m.id = auth.uid() and m.status = 'pending'
      and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)
    for update of m;
  if not found or not exists (
    select 1 from public.verification_requests
    where member_id = auth.uid() and requested_kind = 'unit_member'
  ) then
    raise exception 'A confirmed pending unit-member request is required' using errcode = '42501';
  end if;
  select * into v_invite from public.invite_codes
    where code_hash = sha256(convert_to(p_code, 'UTF8')) and redeemed_at is null and revoked_at is null
    for update;
  if not found then
    raise exception 'Invite is invalid or unavailable' using errcode = '22023';
  end if;
  perform 1 from public.members
    where id = v_invite.inviter_id and kind = 'unit_member' and private.is_verified(id) for share;
  if not found or v_invite.inviter_id = auth.uid() then
    raise exception 'Invite is invalid or unavailable' using errcode = '22023';
  end if;
  update public.invite_codes set redeemed_by = auth.uid(), redeemed_at = now() where id = v_invite.id;
  update public.members set status = 'approved', kind = 'unit_member', can_seek = true,
    can_post = true, approved_at = now(), invited_by = v_invite.inviter_id where id = auth.uid();
  insert into public.audit_events(actor_id, action, entity_type, entity_id)
    values (auth.uid(), 'approved_by_invite', 'member', auth.uid());
end;
$$;

create function public.review_member(p_member uuid, p_action text, p_reason text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.members;
  v_kind public.member_kind;
begin
  if not private.is_admin() then
    raise exception 'Admin required' using errcode = '42501';
  end if;
  select * into v_member from public.members where id = p_member for update;
  if not found or v_member.is_admin or p_member = auth.uid() then
    raise exception 'Member cannot be reviewed with this operation' using errcode = '22023';
  end if;
  if p_action = 'approve' and v_member.status = 'pending' then
    select requested_kind into v_kind from public.verification_requests where member_id = p_member;
    if not found or not exists (
      select 1 from auth.users where id = p_member and email_confirmed_at is not null
        and not coalesce(is_anonymous, false)
    ) then
      raise exception 'A confirmed account and verification form are required' using errcode = '22023';
    end if;
    update public.members set status = 'approved', kind = v_kind, approved_at = now(),
      can_post = true, can_seek = (v_kind = 'unit_member') where id = p_member;
  elsif p_action = 'reject' and v_member.status = 'pending' then
    if p_reason is null or length(btrim(p_reason)) < 3 then
      raise exception 'A rejection reason is required' using errcode = '22023';
    end if;
    update public.members set status = 'rejected' where id = p_member;
  elsif p_action = 'ban' and v_member.status <> 'banned' then
    if p_reason is null or length(btrim(p_reason)) < 3 then
      raise exception 'A ban reason is required' using errcode = '22023';
    end if;
    update public.members set status = 'banned', can_seek = false, can_post = false where id = p_member;
  else
    raise exception 'Invalid membership transition' using errcode = '22023';
  end if;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason)
    values (auth.uid(), 'member_' || p_action, 'member', p_member, p_reason);
end;
$$;

create function public.moderate_profile(p_member uuid, p_remove boolean, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Admin required' using errcode = '42501';
  end if;
  if p_remove is null or p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'A moderation decision and reason are required' using errcode = '22023';
  end if;
  update public.seeker_profiles set
    moderated_at = case when p_remove then now() else null end,
    moderation_reason = case when p_remove then p_reason else null end
    where member_id = p_member;
  if not found then
    raise exception 'Profile not found' using errcode = '22023';
  end if;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, reason)
    values (auth.uid(), case when p_remove then 'profile_removed' else 'profile_restored' end,
      'profile', p_member, p_reason);
end;
$$;

create function public.renew_job(p_job uuid)
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare
  v_expires timestamptz;
begin
  if not private.is_admin() and not (private.can_post() and private.owns_job(p_job)) then
    raise exception 'Only the poster or an admin can renew' using errcode = '42501';
  end if;
  update public.jobs set is_open = true, expires_at = now() + interval '60 days'
    where id = p_job returning expires_at into v_expires;
  if not found then
    raise exception 'Job not found' using errcode = '22023';
  end if;
  update private.job_renewal_tokens set consumed_at = now() where job_id = p_job and consumed_at is null;
  insert into public.audit_events(actor_id, action, entity_type, entity_id)
    values (auth.uid(), 'job_renewed', 'job', p_job);
  return v_expires;
end;
$$;

create function public.begin_cv_upload(p_filename text, p_byte_size integer, p_attested boolean)
returns public.cv_documents language plpgsql security definer set search_path = ''
as $$
declare
  v_document public.cv_documents;
begin
  if not private.can_seek() or p_attested is distinct from true then
    raise exception 'Verified seeker and explicit publication attestation required' using errcode = '42501';
  end if;
  perform 1 from public.seeker_profiles where member_id = auth.uid() and moderated_at is null for update;
  if not found then
    raise exception 'An unmoderated profile is required' using errcode = '42501';
  end if;
  if (select count(*) from public.cv_documents where owner_id = auth.uid() and state = 'pending') >= 3 then
    raise exception 'Finish or discard an existing upload first' using errcode = '54000';
  end if;
  insert into public.cv_documents(owner_id, original_filename, byte_size, attested_at)
    values (auth.uid(), p_filename, p_byte_size, now()) returning * into v_document;
  return v_document;
end;
$$;

create function public.complete_cv_upload(p_document uuid, p_verified_size integer, p_sha256 bytea)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_document public.cv_documents;
begin
  -- Only the trusted PDF-validation backend receives EXECUTE on this function.
  select * into v_document from public.cv_documents where id = p_document and state = 'pending' for update;
  if not found or not private.is_verified(v_document.owner_id) or p_sha256 is null then
    raise exception 'Upload is not eligible for publication' using errcode = '22023';
  end if;
  perform 1 from public.seeker_profiles
    where member_id = v_document.owner_id and moderated_at is null for update;
  if not found or p_verified_size is distinct from v_document.byte_size or not exists (
    select 1 from storage.objects where bucket_id = 'cvs' and name = v_document.object_name
  ) then
    raise exception 'Validated file does not match the pending upload' using errcode = '22023';
  end if;
  update public.cv_documents set state = 'ready', sha256 = p_sha256, verified_at = now() where id = p_document;
  update public.seeker_profiles set cv_document_id = p_document where member_id = v_document.owner_id;
end;
$$;

create function public.discard_cv_upload(p_document uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_document public.cv_documents;
begin
  if not private.can_seek() then
    raise exception 'Verified seeker required' using errcode = '42501';
  end if;
  select * into v_document from public.cv_documents
    where id = p_document and owner_id = auth.uid() and state = 'pending' for update;
  if not found then
    raise exception 'Pending upload not found' using errcode = '22023';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'cvs' and name = v_document.object_name) then
    raise exception 'The upload backend must remove the stored file first' using errcode = '55000';
  end if;
  delete from public.cv_documents where id = p_document;
end;
$$;

create policy members_read on public.members for select to authenticated
  using (id = auth.uid() or private.is_admin());
create policy verification_read on public.verification_requests for select to authenticated
  using (member_id = auth.uid() or private.is_admin());
create policy invites_read on public.invite_codes for select to authenticated
  using (private.is_verified() and (inviter_id = auth.uid() or private.is_admin()));

create policy jobs_read on public.jobs for select to authenticated
  using (private.is_verified() and (
    private.is_admin() or creator_id = auth.uid()
    or (is_open and expires_at > now() and private.is_verified(creator_id))
  ));
create policy jobs_insert on public.jobs for insert to authenticated
  with check (private.can_post() and creator_id = auth.uid());
create policy jobs_update on public.jobs for update to authenticated
  using (private.is_admin() or (private.can_post() and creator_id = auth.uid()))
  with check (private.is_admin() or (private.can_post() and creator_id = auth.uid()));
create policy jobs_delete on public.jobs for delete to authenticated
  using (private.is_admin() or (private.can_post() and creator_id = auth.uid()));

create policy profiles_read on public.seeker_profiles for select to authenticated
  using (private.can_view_profile(member_id));
create policy profiles_insert on public.seeker_profiles for insert to authenticated
  with check (private.can_seek() and member_id = auth.uid());
create policy profiles_update on public.seeker_profiles for update to authenticated
  using (private.can_seek() and member_id = auth.uid())
  with check (private.can_seek() and member_id = auth.uid());

create policy cv_metadata_read on public.cv_documents for select to authenticated
  using (private.is_verified() and (
    owner_id = auth.uid() or private.is_admin() or (
      state = 'ready' and private.can_view_profile(owner_id) and exists (
        select 1 from public.seeker_profiles p where p.member_id = owner_id and p.cv_document_id = id
      )
    )
  ));
create policy applications_read on public.applications for select to authenticated
  using (private.is_verified() and (
    applicant_id = auth.uid() or private.owns_job(job_id) or private.is_admin()
  ));
create policy applications_insert on public.applications for insert to authenticated
  with check (applicant_id = auth.uid() and private.can_apply(job_id));
create policy applications_delete on public.applications for delete to authenticated
  using (private.is_verified() and (applicant_id = auth.uid() or private.is_admin()));

create policy saved_searches_read on public.saved_searches for select to authenticated
  using (private.can_seek() and owner_id = auth.uid());
create policy saved_searches_insert on public.saved_searches for insert to authenticated
  with check (private.can_seek() and owner_id = auth.uid());
create policy saved_searches_update on public.saved_searches for update to authenticated
  using (private.can_seek() and owner_id = auth.uid())
  with check (private.can_seek() and owner_id = auth.uid());
create policy saved_searches_delete on public.saved_searches for delete to authenticated
  using (private.can_seek() and owner_id = auth.uid());
create policy audit_read on public.audit_events for select to authenticated using (private.is_admin());

grant usage on schema public, private to authenticated;
grant select on public.members, public.verification_requests, public.jobs,
  public.seeker_profiles, public.cv_documents, public.applications,
  public.saved_searches, public.audit_events to authenticated;
grant select (id, inviter_id, slot, redeemed_by, redeemed_at, revoked_at, issued_at, created_at)
  on public.invite_codes to authenticated;
grant insert (title, company, city, work_mode, job_type, seniority, tech_tags, description,
  salary_min, salary_max, salary_currency, salary_period, apply_method, apply_email,
  apply_url, referral_available, is_open) on public.jobs to authenticated;
grant update (title, company, city, work_mode, job_type, seniority, tech_tags, description,
  salary_min, salary_max, salary_currency, salary_period, apply_method, apply_email,
  apply_url, referral_available, is_open) on public.jobs to authenticated;
grant delete on public.jobs to authenticated;
grant insert (full_name, headline, release_date, already_released, years_experience, skills,
  preferred_roles, preferred_locations, linkedin_url, github_url, bio, status)
  on public.seeker_profiles to authenticated;
grant update (full_name, headline, release_date, already_released, years_experience, skills,
  preferred_roles, preferred_locations, linkedin_url, github_url, bio, status)
  on public.seeker_profiles to authenticated;
grant insert (job_id) on public.applications to authenticated;
grant delete on public.applications to authenticated;
grant insert (name, query, tags, city, work_mode, job_type, seniority, referral_only,
  posted_within_days, email_enabled) on public.saved_searches to authenticated;
grant update (name, query, tags, city, work_mode, job_type, seniority, referral_only,
  posted_within_days, email_enabled) on public.saved_searches to authenticated;
grant delete on public.saved_searches to authenticated;

revoke execute on all functions in schema public, private from public, anon, authenticated;
grant execute on function private.is_verified(uuid), private.is_admin(), private.can_seek(),
  private.can_post(), private.owns_job(uuid), private.can_view_profile(uuid),
  private.can_apply(uuid), private.normalize_tags(text[]) to authenticated;
grant execute on function public.submit_verification(text, public.member_kind, integer, integer, date, boolean, text),
  public.issue_invite(smallint), public.revoke_invite(smallint), public.redeem_invite(text),
  public.review_member(uuid, text, text), public.moderate_profile(uuid, boolean, text),
  public.renew_job(uuid), public.begin_cv_upload(text, integer, boolean),
  public.discard_cv_upload(uuid) to authenticated;

grant usage on schema public, private to service_role;
grant all on all tables in schema public, private to service_role;
grant all on all sequences in schema public, private to service_role;
grant execute on all functions in schema private to service_role;
grant execute on function public.complete_cv_upload(uuid, integer, bytea) to service_role;

commit;
