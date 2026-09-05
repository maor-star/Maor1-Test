-- What a piece of work belongs to.
--
-- One row per (thing, pillar), so a task can belong to Exchange CTV and to
-- Core Publishers at once — which most of the interesting work does. The
-- pillar is stored as the activity line's own key, the same key the revenue
-- source reports against, so a tag on a task and a tile on the overview are
-- the same thing rather than two lists that drift apart.
--
-- No foreign key to the tagged row: the three things tagged live in three
-- tables (tasks, pipeline_clients, contracts) and a single column cannot
-- reference all of them. Orphans are swept when a row is archived.

create table if not exists entity_lines (
  entity_type text not null,
  entity_id   uuid not null,
  line        text not null,
  tagged_at   timestamptz not null default now(),
  tagged_by   text,
  primary key (entity_type, entity_id, line)
);

create index if not exists idx_entity_lines_line on entity_lines (line, entity_type);
create index if not exists idx_entity_lines_entity on entity_lines (entity_type, entity_id);
