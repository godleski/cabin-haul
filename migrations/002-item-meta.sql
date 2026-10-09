-- Adds the details column used by the Weed category. Run once if your items table predates it.
alter table items add column if not exists meta jsonb;
