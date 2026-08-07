-- Phase 4: credit-cap table + panels table, plus an atomic capped-increment
-- RPC so concurrent requests can't race past the daily limit.

create table usage_counters (
  user_id uuid references auth.users not null,
  date date not null,
  llm_calls int default 0,
  image_calls int default 0,
  tts_calls int default 0,
  primary key (user_id, date)
);

create table panels (
  id uuid primary key default gen_random_uuid(),
  beat_id uuid references beats on delete cascade not null,
  image_url text,
  seed bigint,
  model text,
  status text not null default 'pending',
  created_at timestamptz default now()
);

alter table usage_counters enable row level security;
alter table panels enable row level security;

create policy "usage_counters_owner_select" on usage_counters
  for select using (user_id = auth.uid());

create policy "panels_owner_select" on panels
  for select using (
    exists (
      select 1 from beats
      join territories on territories.id = beats.territory_id
      join projects on projects.id = territories.project_id
      where beats.id = panels.beat_id
      and projects.user_id = auth.uid()
    )
  );

create policy "panels_owner_insert" on panels
  for insert with check (
    exists (
      select 1 from beats
      join territories on territories.id = beats.territory_id
      join projects on projects.id = territories.project_id
      where beats.id = panels.beat_id
      and projects.user_id = auth.uid()
    )
  );

create policy "panels_owner_update" on panels
  for update using (
    exists (
      select 1 from beats
      join territories on territories.id = beats.territory_id
      join projects on projects.id = territories.project_id
      where beats.id = panels.beat_id
      and projects.user_id = auth.uid()
    )
  );

-- Atomically increments today's counter for p_column (one of llm_calls,
-- image_calls, tts_calls) if and only if it's currently below p_limit.
-- Returns the new count, or null if the caller is already at/over the cap.
-- Only ever called from serverless functions using the service-role key.
create or replace function increment_usage_counter(
  p_user_id uuid,
  p_column text,
  p_limit int
) returns int
language plpgsql
as $$
declare
  new_count int;
begin
  if p_column not in ('llm_calls', 'image_calls', 'tts_calls') then
    raise exception 'invalid usage counter column: %', p_column;
  end if;

  insert into usage_counters (user_id, date)
  values (p_user_id, current_date)
  on conflict (user_id, date) do nothing;

  execute format(
    'update usage_counters set %1$I = %1$I + 1
     where user_id = $1 and date = current_date and %1$I < $2
     returning %1$I',
    p_column
  )
  into new_count
  using p_user_id, p_limit;

  return new_count;
end;
$$;
