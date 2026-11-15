-- GridLock leaderboard schema. Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- It is safe to run again (every statement is "if not exists", "create or replace", or checks first), and
-- running it again is also how a project made by an earlier version of this file is brought up to date.
--
-- The browser only ever holds the project's public key, so the table itself is closed to it (row level
-- security on, no policies, no grants). The four functions below are the only doors. Each runs as its
-- owner (SECURITY DEFINER), so it can read and write the table, and each checks its own arguments.
--
--   get_leaderboard(size, kind, perks, player)  → the top 10 for one board, plus the caller's own row if outside
--   submit_score(player, name, size, kind, perks, value) → keeps the highest value per player and board
--   rename_player(player, name)                 → a new name on every row of that player
--   remove_player(player)                       → a player who goes anonymous disappears from every board
--
-- A board is a size, a kind and whether perk cards were on: size is 5 or 6, kind is 'score' (best
-- single-board score) or 'level' (highest level reached), perks is false for plain games and true for runs
-- with perk cards, so there are eight boards. player is a random id the game makes up on the device; name
-- is what the player typed (1 to 16 characters). hidden is for moderation: tick it in the Table Editor and
-- the row stays but leaves the boards.
--
-- If you ever change a function's parameter list, drop the old signature first ("create or replace" with
-- different parameters makes a second overload, and the API refuses ambiguous names). The drops below take
-- care of the signatures this file used before perks were a column.

begin;

create table if not exists public.leaderboard (
  player_id  uuid        not null,
  size       smallint    not null check (size in (5, 6)),
  kind       text        not null check (kind in ('score', 'level')),
  perks      boolean     not null default false,
  name       text        not null check (char_length(name) between 1 and 16),
  value      integer     not null check (value >= 0),
  hidden     boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (player_id, size, kind, perks)
);

-- A table made by an earlier version of this script: add what is new. Existing rows are plain games (perks false).
alter table public.leaderboard add column if not exists hidden boolean not null default false;
alter table public.leaderboard add column if not exists perks boolean not null default false;

-- The primary key must include perks (one row per player and board). Replace it only if it does not yet.
do $$
declare
  v_pk text;
begin
  select c.conname into v_pk
  from pg_constraint c
  where c.conrelid = 'public.leaderboard'::regclass and c.contype = 'p';
  if v_pk is not null and not exists (
    select 1
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.leaderboard'::regclass and c.contype = 'p' and a.attname = 'perks'
  ) then
    execute format('alter table public.leaderboard drop constraint %I', v_pk);
    alter table public.leaderboard add primary key (player_id, size, kind, perks);
  end if;
end
$$;

drop index if exists public.leaderboard_rank_idx; -- the index from before perks
create index if not exists leaderboard_board_idx on public.leaderboard (size, kind, perks, value desc, updated_at asc);

alter table public.leaderboard enable row level security;
revoke all on table public.leaderboard from public, anon, authenticated;

-- The signatures from before perks: gone, so that only the new ones answer.
drop function if exists public.submit_score(uuid, text, integer, text, integer);
drop function if exists public.get_leaderboard(integer, text, uuid);

-- A name as the server keeps it: control and invisible characters removed (C0 and C1 controls, zero-width
-- spaces and joiners, direction marks, soft hyphens, the byte-order mark), every kind of whitespace collapsed
-- to one space, trimmed, at most 16 characters; null when nothing is left. The game applies the same rule
-- (cleanName in js/leaderboard.js) before sending.
create or replace function public.clean_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    btrim(left(btrim(regexp_replace(
      regexp_replace(coalesce(p_name, ''), '[\u0000-\u001f\u007f-\u009f­؜᠎​-‏‪-‮⁠-⁤⁦-⁯﻿]', '', 'g'),
      '[\s   -     　]+', ' ', 'g')), 16)),
    ''
  );
$$;

-- Post a result. The row keeps the highest value ever posted for that player and board; the name is
-- refreshed on every post so a rename shows up even if rename_player never reached the server. p_perks
-- defaults to false so a game from before the perk boards still posts to the plain ones.
create or replace function public.submit_score(p_player uuid, p_name text, p_size integer, p_kind text, p_value integer, p_perks boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := public.clean_name(p_name);
  v_max integer := case p_kind when 'score' then 5000 when 'level' then 1000 else -1 end;
begin
  if p_player is null then raise exception 'player required'; end if;
  if v_name is null then raise exception 'name required'; end if;
  if p_size is null or p_size not in (5, 6) then raise exception 'size must be 5 or 6'; end if;
  if p_kind is null or p_kind not in ('score', 'level') then raise exception 'kind must be score or level'; end if;
  if p_value is null or p_value < 0 or p_value > v_max then raise exception 'value out of range'; end if;
  insert into public.leaderboard as l (player_id, size, kind, perks, name, value)
  values (p_player, p_size, p_kind, coalesce(p_perks, false), v_name, p_value)
  on conflict (player_id, size, kind, perks) do update
    set name = excluded.name,
        value = greatest(l.value, excluded.value),
        updated_at = case when excluded.value > l.value then now() else l.updated_at end;
end;
$$;

create or replace function public.rename_player(p_player uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := public.clean_name(p_name);
begin
  if p_player is null then raise exception 'player required'; end if;
  if v_name is null then raise exception 'name required'; end if;
  update public.leaderboard set name = v_name where player_id = p_player;
end;
$$;

create or replace function public.remove_player(p_player uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_player is null then raise exception 'player required'; end if;
  delete from public.leaderboard where player_id = p_player;
end;
$$;

-- The top 10 of one board (ties broken by who got there first), plus the caller's own row with its rank
-- when it sits outside the top 10. "me" marks the caller's row. Hidden rows are left out. p_perks defaults
-- to false so a game from before the perk boards still reads the plain ones.
create or replace function public.get_leaderboard(p_size integer, p_kind text, p_player uuid default null, p_perks boolean default false)
returns table (rank integer, name text, value integer, me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select l.player_id, l.name, l.value,
           (row_number() over (order by l.value desc, l.updated_at asc, l.player_id))::integer as rank
    from public.leaderboard l
    where l.size = p_size and l.kind = p_kind and l.perks = coalesce(p_perks, false) and not l.hidden
  )
  select r.rank, r.name, r.value, (r.player_id = p_player) is true as me
  from ranked r
  where r.rank <= 10 or r.player_id = p_player
  order by r.rank;
$$;

-- Only the public key's roles may call the four doors; the helper stays internal.
revoke all on function public.clean_name(text) from public, anon, authenticated;
revoke all on function public.submit_score(uuid, text, integer, text, integer, boolean) from public;
revoke all on function public.rename_player(uuid, text) from public;
revoke all on function public.remove_player(uuid) from public;
revoke all on function public.get_leaderboard(integer, text, uuid, boolean) from public;
grant execute on function public.submit_score(uuid, text, integer, text, integer, boolean) to anon, authenticated;
grant execute on function public.rename_player(uuid, text) to anon, authenticated;
grant execute on function public.remove_player(uuid) to anon, authenticated;
grant execute on function public.get_leaderboard(integer, text, uuid, boolean) to anon, authenticated;

notify pgrst, 'reload schema'; -- the API learns the new signatures at once

commit;
