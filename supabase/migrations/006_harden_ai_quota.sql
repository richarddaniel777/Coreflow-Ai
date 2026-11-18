begin;

-- The daily limit is enforced by the database so clients cannot raise it by
-- calling the authenticated RPC directly with a larger p_daily_limit value.
create or replace function public.consume_ai_quota(p_function text, p_daily_limit int)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_daily_limit integer;
  v_count bigint;
begin
  if v_user_id is null then
    return false;
  end if;

  if p_function = 'score-lead' or p_function = 'draft-message' then
    v_daily_limit := 50;
  else
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));
  select count(*) into v_count
  from public.ai_usage
  where user_id = v_user_id
    and function_name = p_function
    and created_at >= date_trunc('day', now())
    and created_at < date_trunc('day', now()) + interval '1 day';

  if v_count >= v_daily_limit then
    return false;
  end if;

  insert into public.ai_usage (user_id, function_name) values (v_user_id, p_function);
  return true;
end;
$$;

revoke all on function public.consume_ai_quota(text, int) from public, anon;
grant execute on function public.consume_ai_quota(text, int) to authenticated;

commit;
