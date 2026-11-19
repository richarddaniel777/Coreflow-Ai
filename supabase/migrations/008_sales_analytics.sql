begin;

create or replace function public.get_sales_analytics(
  p_start_date timestamptz,
  p_today date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with scoped_leads as materialized (
    select l.id, l.user_id, l.stage, l.source, l.preferred_channel,
           l.ai_score, l.deal_value, l.lost_reason
    from public.leads l
    where l.user_id = auth.uid()
      and (p_start_date is null or l.created_at >= p_start_date)
  ),
  totals as (
    select
      count(*)::integer as total_leads,
      count(*) filter (where coalesce(stage, 'new') not in ('won', 'lost'))::integer as open_leads,
      count(*) filter (where stage in ('quoted', 'negotiating', 'won') or ai_score >= 70)::integer as qualified_leads,
      count(*) filter (where stage = 'won')::integer as won_count,
      coalesce(sum(deal_value) filter (where stage = 'won'), 0)::numeric as won_value,
      count(*) filter (where stage = 'lost')::integer as lost_count,
      coalesce(sum(deal_value) filter (where coalesce(stage, 'new') not in ('won', 'lost')), 0)::numeric as open_pipeline_value
    from scoped_leads
  ),
  stages as (
    select v.stage, count(l.id)::integer as lead_count,
           coalesce(sum(l.deal_value), 0)::numeric as value,
           v.position
    from (values ('new', 1), ('contacted', 2), ('quoted', 3), ('negotiating', 4), ('won', 5), ('lost', 6)) as v(stage, position)
    left join scoped_leads l on coalesce(l.stage, 'new') = v.stage
    group by v.stage, v.position
  ),
  sources as (
    select l.source, count(*)::integer as leads,
           count(*) filter (where l.stage = 'won')::integer as won
    from scoped_leads l
    group by l.source
  ),
  channels as (
    select l.preferred_channel, count(*)::integer as leads,
           count(*) filter (where l.stage = 'won')::integer as won
    from scoped_leads l
    group by l.preferred_channel
  )
  select jsonb_build_object(
    'total_leads', totals.total_leads,
    'open_leads', totals.open_leads,
    'qualified_leads', totals.qualified_leads,
    'won_count', totals.won_count,
    'won_value', totals.won_value,
    'lost_count', totals.lost_count,
    'conversion_rate', case when totals.won_count + totals.lost_count = 0 then null::numeric
      else totals.won_count::numeric / (totals.won_count + totals.lost_count) end,
    'win_rate', case when totals.total_leads = 0 then null::numeric
      else totals.won_count::numeric / totals.total_leads end,
    'open_pipeline_value', totals.open_pipeline_value,
    'overdue_tasks', (
      select count(*)::integer
      from public.tasks t
      join scoped_leads l on l.id = t.lead_id
      where t.user_id = auth.uid()
        and t.completed is not true
        and t.due_date < p_today
        and coalesce(l.stage, 'new') not in ('won', 'lost')
    ),
    'needs_reply_count', (
      select count(*)::integer
      from scoped_leads l
      join public.lead_activity_summary s on s.lead_id = l.id
      where coalesce(l.stage, 'new') not in ('won', 'lost')
        and s.last_direction = 'inbound'
    ),
    'per_stage', coalesce((
      select jsonb_agg(jsonb_build_object('stage', stage, 'count', lead_count, 'value', value) order by position)
      from stages
    ), '[]'::jsonb),
    'per_source', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source', source,
        'leads', leads,
        'won', won,
        'conversion', won::numeric / nullif(leads, 0)
      ) order by leads desc, source)
      from sources
    ), '[]'::jsonb),
    'per_channel', coalesce((
      select jsonb_agg(jsonb_build_object(
        'channel', coalesce(preferred_channel, 'not_set'),
        'leads', leads,
        'won', won,
        'conversion', won::numeric / nullif(leads, 0)
      ) order by leads desc, preferred_channel nulls last)
      from channels
    ), '[]'::jsonb),
    'lost_reasons', coalesce((
      select jsonb_agg(jsonb_build_object('reason', reason, 'count', reason_count) order by reason_count desc, reason)
      from (
        select coalesce(nullif(btrim(lost_reason), ''), 'Unspecified') as reason, count(*)::integer as reason_count
        from scoped_leads
        where stage = 'lost'
        group by coalesce(nullif(btrim(lost_reason), ''), 'Unspecified')
      ) reason_rows
    ), '[]'::jsonb)
  )
  from totals;
$$;

revoke all on function public.get_sales_analytics(timestamptz, date) from public, anon;
grant execute on function public.get_sales_analytics(timestamptz, date) to authenticated;

commit;
