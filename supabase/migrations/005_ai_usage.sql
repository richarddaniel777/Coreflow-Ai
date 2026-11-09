begin;

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  function_name text not null,
  created_at timestamptz default now()
);

create index ai_usage_user_created_idx on public.ai_usage (user_id, created_at);

alter table public.ai_usage enable row level security;
create policy ai_usage_select_own on public.ai_usage
  for select using (user_id = auth.uid());

revoke all on public.ai_usage from public, anon, authenticated;
grant select on public.ai_usage to authenticated;

create or replace function public.consume_ai_quota(p_function text, p_daily_limit int)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_count bigint;
begin
  if v_user_id is null or p_function is null or p_function = '' or p_daily_limit is null or p_daily_limit < 1 then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));
  select count(*) into v_count
  from public.ai_usage
  where user_id = v_user_id
    and function_name = p_function
    and created_at >= date_trunc('day', now())
    and created_at < date_trunc('day', now()) + interval '1 day';

  if v_count >= p_daily_limit then
    return false;
  end if;

  insert into public.ai_usage (user_id, function_name) values (v_user_id, p_function);
  return true;
end;
$$;

revoke all on function public.consume_ai_quota(text, int) from public, anon;
grant execute on function public.consume_ai_quota(text, int) to authenticated;

commit;
