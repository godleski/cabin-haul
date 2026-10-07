-- Upgrade an existing Cabin Haul database to the "who's bringing what" version.
-- Run once in Supabase > SQL Editor. Safe to re-run.

alter table items add column if not exists party text;
alter table items add column if not exists claimed_by text;

-- Claiming and unclaiming needs update permission.
drop policy if exists "claim items" on items;
create policy "claim items" on items for update using (true) with check (true);

-- The +1 table from the poll version is no longer used.
drop table if exists plus_ones;
