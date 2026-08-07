-- Prevents duplicate "Embr (Demo)" seed projects when demo-seeding runs
-- concurrently (e.g. two tabs, or React StrictMode's double effect
-- invocation in dev both racing the same check-then-insert).
create unique index projects_one_demo_per_user
  on projects (user_id)
  where title = 'Embr (Demo)';
