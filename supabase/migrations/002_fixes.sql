-- Stop instead of silently changing existing cross-user references.
do $$
begin
  if exists (
    select 1
    from public.activities a
    join public.leads l on l.id = a.lead_id
    where a.user_id <> l.user_id
  ) or exists (
    select 1
    from public.tasks t
    join public.leads l on l.id = t.lead_id
    where t.user_id <> l.user_id
  ) then
    raise exception
      'Cross-user activity/task lead references exist. Review and resolve them before applying 002_fixes.sql.';
  end if;
end;
$$;

-- Make lead ownership part of the foreign key relationship.
alter table public.leads
  add constraint leads_id_user_id_key unique (id, user_id);

alter table public.activities
  drop constraint activities_lead_id_fkey,
  add constraint activities_lead_user_fkey
    foreign key (lead_id, user_id)
    references public.leads (id, user_id)
    on delete cascade;

alter table public.tasks
  drop constraint tasks_lead_id_fkey,
  add constraint tasks_lead_user_fkey
    foreign key (lead_id, user_id)
    references public.leads (id, user_id)
    on delete cascade;

-- Keep policy checks aligned with the ownership relationship.
drop policy activities_insert_own on public.activities;
create policy activities_insert_own on public.activities
for insert with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.leads l
    where l.id = lead_id and l.user_id = auth.uid()
  )
);

drop policy activities_update_own on public.activities;
create policy activities_update_own on public.activities
for update
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.leads l
    where l.id = lead_id and l.user_id = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.leads l
    where l.id = lead_id and l.user_id = auth.uid()
  )
);

drop policy tasks_insert_own on public.tasks;
create policy tasks_insert_own on public.tasks
for insert with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.leads l
    where l.id = lead_id and l.user_id = auth.uid()
  )
);

drop policy tasks_update_own on public.tasks;
create policy tasks_update_own on public.tasks
for update
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.leads l
    where l.id = lead_id and l.user_id = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.leads l
    where l.id = lead_id and l.user_id = auth.uid()
  )
);

-- Keep last_activity_at monotonic, including when inserts race.
create or replace function public.update_lead_last_activity()
returns trigger
language plpgsql
as $$
begin
  if new.type not in ('stage_change', 'note')
     and new.occurred_at is not null then
    update public.leads
    set last_activity_at = new.occurred_at
    where id = new.lead_id
      and user_id = new.user_id
      and (
        last_activity_at is null
        or last_activity_at < new.occurred_at
      );
  end if;

  return new;
end;
$$;

-- Use a fixed search path and keep object references schema-qualified.
create or replace function public.create_business_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.business_profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.create_business_profile_for_new_user()
  from public, anon, authenticated;
