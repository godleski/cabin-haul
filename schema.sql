-- Cabin Haul: run this once in Supabase > SQL Editor > New query > Run.
-- (If you ran the older poll version, its "options" and "votes" tables are
--  unused now. Delete them in Table Editor or leave them; nothing reads them.)

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  note text,                            -- optional: "the spicy kind", "2 cases"
  category text not null,               -- Food, Drinks, Booze, Snacks, Supplies, Other
  added_by text,                        -- null = starter item
  adder_id text,                        -- random id kept in the adder's browser
  created_at timestamptz not null default now()
);
create unique index if not exists items_unique_name on items (lower(name));

create table if not exists plus_ones (
  item_id uuid not null references items(id) on delete cascade,
  voter_id text not null,               -- random id kept in each person's browser
  voter_name text not null,
  created_at timestamptz not null default now(),
  primary key (item_id, voter_id)
);

-- Anyone with the link may read, add items, +1, un-+1, and remove items.
alter table items enable row level security;
alter table plus_ones enable row level security;
create policy "read items"    on items     for select using (true);
create policy "add items"     on items     for insert with check (true);
create policy "remove items"  on items     for delete using (true);
create policy "read plus"     on plus_ones for select using (true);
create policy "give plus"     on plus_ones for insert with check (true);
create policy "take plus"     on plus_ones for delete using (true);

-- Live updates for everyone who has the page open.
alter publication supabase_realtime add table items, plus_ones;

-- A few starters so the page isn't empty. Delete these lines for a blank slate.
insert into items (name, category) values
  ('Coffee', 'Drinks'),
  ('Eggs', 'Food'),
  ('Bacon', 'Food'),
  ('Burger stuff', 'Food'),
  ('Beer', 'Booze'),
  ('Ice', 'Supplies'),
  ('Paper towels', 'Supplies'),
  ('S''mores kit', 'Snacks'),
  ('Chips & salsa', 'Snacks')
on conflict do nothing;
