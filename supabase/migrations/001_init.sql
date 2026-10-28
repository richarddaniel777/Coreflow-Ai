create extension if not exists pgcrypto;

create table public.business_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  business_name text, business_type text, products_services text, pricing_notes text,
  ideal_customer text, tone text default 'friendly and professional', currency text default 'USD',
  quiet_after_days int default 5
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  name text not null, company text, phone text, email text, social_handle text,
  source text default 'other' check (source in ('whatsapp','instagram','facebook','other_social','referral','phone_call','website','walk_in','email','other')),
  preferred_channel text check (preferred_channel in ('whatsapp','instagram','facebook','other_social','email','phone','sms','in_person','other')),
  interest text, needs text, budget numeric,
  stage text default 'new' check (stage in ('new','contacted','quoted','negotiating','won','lost')),
  deal_value numeric default 0, expected_close_date date, lost_reason text, notes text,
  ai_score int, ai_analysis jsonb, last_activity_at timestamptz default now()
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  type text not null check (type in ('note','message','call','email','meeting','visit','quotation_sent','stage_change')),
  channel text check (channel in ('whatsapp','instagram','facebook','other_social','email','phone','sms','website_form','in_person','other')),
  direction text check (direction in ('inbound','outbound')), content text, occurred_at timestamptz default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  title text not null, due_date date not null, completed boolean default false, completed_at timestamptz
);

create index business_profiles_user_id_idx on public.business_profiles (user_id);
create index leads_user_id_idx on public.leads (user_id);
create index leads_stage_idx on public.leads (stage);
create index leads_last_activity_at_idx on public.leads (last_activity_at);
create index activities_user_id_idx on public.activities (user_id);
create index activities_lead_occurred_idx on public.activities (lead_id, occurred_at desc);
create index tasks_user_id_idx on public.tasks (user_id);
create index tasks_due_completed_idx on public.tasks (due_date, completed);

create function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger business_profiles_set_updated_at before update on public.business_profiles for each row execute function public.set_updated_at();
create trigger leads_set_updated_at before update on public.leads for each row execute function public.set_updated_at();
create trigger activities_set_updated_at before update on public.activities for each row execute function public.set_updated_at();
create trigger tasks_set_updated_at before update on public.tasks for each row execute function public.set_updated_at();

create function public.update_lead_last_activity() returns trigger language plpgsql as $$
begin
  if new.type not in ('stage_change', 'note') then
    update public.leads set last_activity_at = new.occurred_at
    where id = new.lead_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;
create trigger activities_update_lead_last_activity after insert on public.activities for each row execute function public.update_lead_last_activity();

create function public.create_business_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.business_profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created_create_business_profile after insert on auth.users for each row execute function public.create_business_profile_for_new_user();

alter table public.business_profiles enable row level security;
alter table public.leads enable row level security;
alter table public.activities enable row level security;
alter table public.tasks enable row level security;

create policy business_profiles_select_own on public.business_profiles for select using (user_id = auth.uid());
create policy business_profiles_insert_own on public.business_profiles for insert with check (user_id = auth.uid());
create policy business_profiles_update_own on public.business_profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy business_profiles_delete_own on public.business_profiles for delete using (user_id = auth.uid());
create policy leads_select_own on public.leads for select using (user_id = auth.uid());
create policy leads_insert_own on public.leads for insert with check (user_id = auth.uid());
create policy leads_update_own on public.leads for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy leads_delete_own on public.leads for delete using (user_id = auth.uid());
create policy activities_select_own on public.activities for select using (user_id = auth.uid());
create policy activities_insert_own on public.activities for insert with check (user_id = auth.uid());
create policy activities_update_own on public.activities for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy activities_delete_own on public.activities for delete using (user_id = auth.uid());
create policy tasks_select_own on public.tasks for select using (user_id = auth.uid());
create policy tasks_insert_own on public.tasks for insert with check (user_id = auth.uid());
create policy tasks_update_own on public.tasks for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy tasks_delete_own on public.tasks for delete using (user_id = auth.uid());
