begin;

-- Drop check constraints that reference each targeted table/column. Resolve
-- the column numbers from the catalog because the original checks were unnamed.
do $$
declare
  target record;
  target_relid oid;
  target_attnum smallint;
  existing_check record;
begin
  for target in
    select * from (values
      ('public', 'leads', 'source'),
      ('public', 'leads', 'preferred_channel'),
      ('public', 'activities', 'channel')
    ) as requested(schema_name, table_name, column_name)
  loop
    target_relid := format('%I.%I', target.schema_name, target.table_name)::regclass;

    select attnum into target_attnum
    from pg_attribute
    where attrelid = target_relid
      and attname = target.column_name
      and not attisdropped;

    if target_attnum is null then
      raise exception 'Column %.%.% was not found', target.schema_name, target.table_name, target.column_name;
    end if;

    for existing_check in
      select conname
      from pg_constraint
      where conrelid = target_relid
        and contype = 'c'
        and target_attnum = any(conkey)
    loop
      execute format(
        'alter table %I.%I drop constraint %I',
        target.schema_name,
        target.table_name,
        existing_check.conname
      );
    end loop;
  end loop;
end;
$$;

-- NOT VALID allows any pre-existing NULL source values to remain untouched.
-- PostgreSQL still enforces this check for new or updated rows.
alter table public.leads
  add constraint leads_source_check
  check (
    source is not null
    and source in (
      'whatsapp', 'instagram', 'facebook', 'linkedin', 'discord', 'telegram',
      'tiktok', 'x_twitter', 'other_social', 'referral', 'phone_call',
      'website', 'walk_in', 'email', 'other'
    )
  ) not valid;

alter table public.leads
  add constraint leads_preferred_channel_check
  check (
    preferred_channel is null
    or preferred_channel in (
      'whatsapp', 'instagram', 'facebook', 'linkedin', 'discord', 'telegram',
      'tiktok', 'x_twitter', 'other_social', 'email', 'phone', 'sms',
      'in_person', 'other'
    )
  ) not valid;

alter table public.activities
  add constraint activities_channel_check
  check (
    channel is null
    or channel in (
      'whatsapp', 'instagram', 'facebook', 'linkedin', 'discord', 'telegram',
      'tiktok', 'x_twitter', 'other_social', 'email', 'phone', 'sms',
      'website_form', 'in_person', 'other'
    )
  ) not valid;

-- Validate when existing data permits it; this does not alter any rows.
do $$
begin
  if not exists (select 1 from public.leads where source is null) then
    alter table public.leads validate constraint leads_source_check;
  end if;

  alter table public.leads validate constraint leads_preferred_channel_check;
  alter table public.activities validate constraint activities_channel_check;
end;
$$;

commit;
