begin;

create or replace view public.lead_activity_summary
with (security_invoker = true)
as
select
  l.id as lead_id,
  l.name as lead_name,
  l.stage as lead_stage,
  l.created_at as lead_created_at,
  (
    select max(a.occurred_at)
    from public.activities a
    where a.lead_id = l.id
      and a.type not in ('note', 'stage_change')
  ) as last_real_activity_at,
  (
    select a.direction
    from public.activities a
    where a.lead_id = l.id
      and a.direction is not null
    order by a.occurred_at desc nulls last, a.created_at desc nulls last, a.id desc
    limit 1
  ) as last_direction,
  (
    select a.occurred_at
    from public.activities a
    where a.lead_id = l.id
      and a.direction is not null
    order by a.occurred_at desc nulls last, a.created_at desc nulls last, a.id desc
    limit 1
  ) as last_directional_at,
  (
    select count(*)::integer
    from public.tasks t
    where t.lead_id = l.id
      and t.completed = false
  ) as open_task_count
from public.leads l;

revoke all on public.lead_activity_summary from public, anon, authenticated;
grant select on public.lead_activity_summary to authenticated;

create index if not exists tasks_user_completed_due_date_idx
  on public.tasks (user_id, completed, due_date);

commit;
