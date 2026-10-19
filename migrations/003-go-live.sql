-- Cabin Haul go-live. Run once in Supabase > SQL Editor > New query > Run. Safe to re-run.
-- Brings a database that ran schema.sql (items + kv) up to everything the live site uses:
-- predictions (picks, hibachi orders, the dinner vote), comments (the wall and trash talk), reactions,
-- and the Still needed list to start from. Photos are not used by the app, so no bucket is needed.

-- items: make sure every column the page writes exists, and allow two people to bring the same thing
-- (the page warns about doubles itself; the old unique index would reject the second one).
alter table items add column if not exists party text;
alter table items add column if not exists claimed_by text;
alter table items add column if not exists added_by text;
alter table items add column if not exists adder_id text;
alter table items add column if not exists meta jsonb;
drop index if exists items_unique_name;

-- predictions: one row per question per voter. pick is text so hibachi orders (JSON) and
-- the anonymous dinner vote (voter 'dev-...') fit alongside the six prediction questions.
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

-- comments: question_id 'wall' is the chat wall; a question id is that question's trash talk.
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

-- reactions: one emoji per person per comment.
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
drop policy if exists "remove reactions" on reactions;
create policy "read reactions"   on reactions for select using (true);
create policy "add reactions"    on reactions for insert with check (true);
create policy "remove reactions" on reactions for delete using (true);

-- kv (shared game state, leaderboards) exists from schema.sql; nothing to add.

-- Live updates for everyone who has the page open (items and kv were added by schema.sql).
do $$
declare t text;
begin
  foreach t in array array['items', 'kv', 'predictions', 'comments', 'reactions'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

-- Clean slate: wipe whatever the old list app or testing left behind.
truncate table reactions, comments, predictions, items, kv;

-- The Still needed list, in this order, asked by Mitch.
insert into items (name, category, party, claimed_by, added_by, created_at)
select name, 'Other', null, null, 'Mitch', now() + (ord || ' seconds')::interval
from (values
  (1, 'High Noons'), (2, 'Cocktail supplies'), (3, 'Beer'), (4, 'Snacks'), (5, 'Fruit'), (6, 'Gatorade'), (7, 'Water'),
  (8, 'Board games'), (9, 'Video games'), (10, 'Paper towels'), (11, 'Cleaning supplies'), (12, 'Saturday lunch'),
  (13, 'Breakfast food'), (14, 'Popcorn'), (15, 'Paper plates'), (16, 'Cornhole'), (17, 'Bags of ice')
) as v (ord, name);
