-- Phase 2: projects + territories tables, RLS owner-only.

create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  title text not null,
  brief jsonb not null,
  format text not null default ':30',
  status text not null default 'draft',
  created_at timestamptz default now()
);

create table territories (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects on delete cascade not null,
  name text not null,
  concept_statement text not null,
  tonal_words text[] not null,
  narrative_structure text not null,
  rationale text not null,
  riskiness int not null check (riskiness between 1 and 5),
  selected boolean default false,
  created_at timestamptz default now()
);

alter table projects enable row level security;
alter table territories enable row level security;

create policy "projects_owner_select" on projects
  for select using (user_id = auth.uid());

create policy "projects_owner_insert" on projects
  for insert with check (user_id = auth.uid());

create policy "projects_owner_update" on projects
  for update using (user_id = auth.uid());

create policy "territories_owner_select" on territories
  for select using (
    exists (
      select 1 from projects
      where projects.id = territories.project_id
      and projects.user_id = auth.uid()
    )
  );

create policy "territories_owner_insert" on territories
  for insert with check (
    exists (
      select 1 from projects
      where projects.id = territories.project_id
      and projects.user_id = auth.uid()
    )
  );

create policy "territories_owner_update" on territories
  for update using (
    exists (
      select 1 from projects
      where projects.id = territories.project_id
      and projects.user_id = auth.uid()
    )
  );
