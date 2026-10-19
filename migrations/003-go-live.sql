-- Cabin Haul go-live. Run once in Supabase > SQL Editor > New query > Run. Safe to re-run: it only wipes and seeds the first time.
-- Brings a database that ran ANY version of schema.sql (with or without migrations 001/002) up to everything the live site uses.

-- The +1-era table referenced items; it would block the wipe below.
drop table if exists plus_ones;

-- items: make sure every column the page writes exists, and allow two people to bring the same thing.
alter table items add column if not exists party text;
alter table items add column if not exists claimed_by text;
alter table items add column if not exists added_by text;
alter table items add column if not exists adder_id text;
alter table items add column if not exists meta jsonb;
drop index if exists items_unique_name;
alter table items enable row level security;
drop policy if exists "read items"   on items;
drop policy if exists "add items"    on items;
drop policy if exists "claim items"  on items;
drop policy if exists "remove items" on items;
create policy "read items"   on items for select using (true);
create policy "add items"    on items for insert with check (true);
create policy "claim items"  on items for update using (true) with check (true);
create policy "remove items" on items for delete using (true);

-- kv: shared game state and the leaderboards. Older schema.sql versions never created it.
create table if not exists kv (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table kv enable row level security;
drop policy if exists "read kv"   on kv;
drop policy if exists "write kv"  on kv;
drop policy if exists "update kv" on kv;
create policy "read kv"   on kv for select using (true);
create policy "write kv"  on kv for insert with check (true);
create policy "update kv" on kv for update using (true) with check (true);

-- predictions
create table if not exists predictions (
  question_id text not null,
  voter text not null,
  pick text not null,
  updated_at timestamptz not null default now(),
  primary key (question_id, voter)
);
alter table predictions enable row level security;
drop policy if exists "read predictions" on predictions;
drop policy if exists "add predictions" on predictions;
drop policy if exists "change predictions" on predictions;
create policy "read predictions"   on predictions for select using (true);
create policy "add predictions"    on predictions for insert with check (true);
create policy "change predictions" on predictions for update using (true) with check (true);

-- comments
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  question_id text not null,
  author text not null,
  text text not null,
  created_at timestamptz not null default now()
);
alter table comments enable row level security;
drop policy if exists "read comments" on comments;
drop policy if exists "add comments" on comments;
create policy "read comments" on comments for select using (true);
create policy "add comments"  on comments for insert with check (true);

-- reactions: the page upserts, so a repeat tap takes the UPDATE path and needs an update policy too.
create table if not exists reactions (
  comment_id uuid not null references comments (id) on delete cascade,
  reactor text not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, reactor, emoji)
);
alter table reactions enable row level security;
drop policy if exists "read reactions" on reactions;
drop policy if exists "add reactions" on reactions;
drop policy if exists "change reactions" on reactions;
drop policy if exists "remove reactions" on reactions;
create policy "read reactions"   on reactions for select using (true);
create policy "add reactions"    on reactions for insert with check (true);
create policy "change reactions" on reactions for update using (true) with check (true);
create policy "remove reactions" on reactions for delete using (true);

-- Live updates for everyone who has the page open.
do $$
declare t text;
begin
  foreach t in array array['items', 'kv', 'predictions', 'comments', 'reactions'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

-- First run only: wipe whatever the old list app or testing left behind, then seed the Still needed list.
-- A marker row in kv remembers that this already happened, so re-running never touches live data.
do $$
begin
  if exists (select 1 from kv where key = 'went-live') then return; end if;
  truncate table reactions, comments, predictions, items, kv;
  insert into items (name, category, party, claimed_by, added_by, created_at)
  select name, 'Other', null, null, 'Mitch', now() + (ord || ' seconds')::interval
  from (values
    (1, 'High Noons'), (2, 'Cocktail supplies'), (3, 'Beer'), (4, 'Snacks'), (5, 'Fruit'), (6, 'Gatorade'), (7, 'Water'),
    (8, 'Board games'), (9, 'Video games'), (10, 'Paper towels'), (11, 'Cleaning supplies'), (12, 'Saturday lunch'),
    (13, 'Breakfast food'), (14, 'Popcorn'), (15, 'Paper plates'), (16, 'Cornhole'), (17, 'Bags of ice')
  ) as v (ord, name);
  insert into kv (key, value) values ('went-live', jsonb_build_object('at', now()));
end $$;
