begin;

alter table public.business_profiles
  add column if not exists logo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-logos',
  'company-logos',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists company_logos_select_own on storage.objects;
drop policy if exists company_logos_insert_own on storage.objects;
drop policy if exists company_logos_update_own on storage.objects;
drop policy if exists company_logos_delete_own on storage.objects;

create policy company_logos_select_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy company_logos_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy company_logos_update_own
  on storage.objects for update to authenticated
  using (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy company_logos_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;
