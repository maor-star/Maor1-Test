-- How often an agent runs, and when it last did.
--
-- The timers on the box fire often; what decides whether a run happens is
-- this, so he can change an agent's rhythm on the screen without a deploy and
-- without anyone touching systemd. Null means "every time the timer fires",
-- which is what the jobs did before this existed.
alter table agents add column if not exists run_every_minutes integer;
alter table agents add column if not exists last_ran_at timestamptz;

comment on column agents.run_every_minutes is
  'Minimum minutes between real runs. Null = whenever its timer fires.';

-- The mail answerer arrived with a two-hourly cron in its definition; keep it.
update agents set run_every_minutes = 120
where name = 'mail-answerer' and run_every_minutes is null;
