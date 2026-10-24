-- Cabin Haul: the photo wall. Run once in Supabase > SQL Editor > New query > Run. Safe to re-run.
-- The Photos tab reads table "photos" and uploads to the public Storage bucket "photos". Both are made here.

-- the table: one row per picture
create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  uploader text not null,
  size integer,
  created_at timestamptz not null default now()
);
alter table photos enable row level security;
drop policy if exists "read photos"   on photos;
drop policy if exists "add photos"    on photos;
drop policy if exists "remove photos" on photos;
create policy "read photos"   on photos for select using (true);
create policy "add photos"    on photos for insert with check (true);
create policy "remove photos" on photos for delete using (true);

-- live updates, so a photo someone adds shows up on every phone
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'photos') then
    alter publication supabase_realtime add table photos;
  end if;
end $$;

-- the bucket: public reads (the page shows plain URLs), anyone with the app can add or remove
insert into storage.buckets (id, name, public) values ('photos', 'photos', true)
  on conflict (id) do update set public = true;
drop policy if exists "photos read"   on storage.objects;
drop policy if exists "photos add"    on storage.objects;
drop policy if exists "photos remove" on storage.objects;
create policy "photos read"   on storage.objects for select using (bucket_id = 'photos');
create policy "photos add"    on storage.objects for insert with check (bucket_id = 'photos');
create policy "photos remove" on storage.objects for delete using (bucket_id = 'photos');
