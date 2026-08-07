-- Phase 3: look_profiles + beats tables, RLS owner-only via territories -> projects.

create table look_profiles (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid references territories on delete cascade not null unique,
  style_description text not null,
  palette text not null,
  lighting_rules text,
  camera_grammar text,
  cast_json jsonb default '[]',
  product_ref_url text,
  locked_seed bigint,
  created_at timestamptz default now()
);

create table beats (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid references territories on delete cascade not null,
  ord int not null,
  duration_seconds numeric not null,
  action text not null,
  vo_text text,
  shot_prompt text not null
);

alter table look_profiles enable row level security;
alter table beats enable row level security;

create policy "look_profiles_owner_select" on look_profiles
  for select using (
    exists (
      select 1 from territories
      join projects on projects.id = territories.project_id
      where territories.id = look_profiles.territory_id
      and projects.user_id = auth.uid()
    )
  );

create policy "look_profiles_owner_insert" on look_profiles
  for insert with check (
    exists (
      select 1 from territories
      join projects on projects.id = territories.project_id
      where territories.id = look_profiles.territory_id
      and projects.user_id = auth.uid()
    )
  );

create policy "look_profiles_owner_update" on look_profiles
  for update using (
    exists (
      select 1 from territories
      join projects on projects.id = territories.project_id
      where territories.id = look_profiles.territory_id
      and projects.user_id = auth.uid()
    )
  );

create policy "beats_owner_select" on beats
  for select using (
    exists (
      select 1 from territories
      join projects on projects.id = territories.project_id
      where territories.id = beats.territory_id
      and projects.user_id = auth.uid()
    )
  );

create policy "beats_owner_insert" on beats
  for insert with check (
    exists (
      select 1 from territories
      join projects on projects.id = territories.project_id
      where territories.id = beats.territory_id
      and projects.user_id = auth.uid()
    )
  );

create policy "beats_owner_update" on beats
  for update using (
    exists (
      select 1 from territories
      join projects on projects.id = territories.project_id
      where territories.id = beats.territory_id
      and projects.user_id = auth.uid()
    )
  );
