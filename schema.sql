-- Cabin Haul: fresh setup. Run once in Supabase > SQL Editor > New query > Run.
-- Already have the older version? Run migrations/001-who-brings-what.sql instead.

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  note text,                            -- optional: "2 cases", "the spicy kind"
  category text not null,               -- Food, Drinks, Booze, Snacks, Supplies, Gear, Weed, Other
  party text,                           -- who's bringing it, e.g. "Mitch & Jess"; null = still needed
  claimed_by text,                      -- which person in that party tapped it
  added_by text,                        -- who added the entry
  adder_id text,                        -- random id kept in the adder's browser
  meta jsonb,                           -- extra details for some categories (weed: form, type, weight, grade, vibe)
  created_at timestamptz not null default now()
);
create unique index if not exists items_unique_name on items (lower(name));

-- Anyone with the link may read, add, claim/unclaim, and remove items.
alter table items enable row level security;
create policy "read items"   on items for select using (true);
create policy "add items"    on items for insert with check (true);
create policy "claim items"  on items for update using (true) with check (true);
create policy "remove items" on items for delete using (true);

-- Small shared settings and tallies (air hockey scores, and anything else later),
-- so new features never need another table.
create table if not exists kv (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table kv enable row level security;
create policy "read kv"   on kv for select using (true);
create policy "write kv"  on kv for insert with check (true);
create policy "update kv" on kv for update using (true) with check (true);

-- Live updates for everyone who has the page open.
alter publication supabase_realtime add table items, kv;

-- A few things that always need bringing, unclaimed. Delete for a blank slate.
insert into items (name, category) values
  ('Coffee', 'Drinks'),
  ('Ice', 'Supplies'),
  ('Paper towels', 'Supplies'),
  ('Trash bags', 'Supplies'),
  ('Firewood', 'Gear')
on conflict do nothing;
