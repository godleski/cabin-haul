-- Fresh start before the trip: wipe everything people entered while testing and put the Still needed list back.
-- Run once in the Supabase SQL editor. Hibachi orders for Mitch, Jessie and Conner live in the app code, so they survive.
-- Running it again later wipes again, so only run it when you mean it.
truncate table reactions, comments, predictions, items, kv;
insert into items (name, category, party, claimed_by, added_by, created_at)
select name, 'Other', null, null, 'Mitch', now() + (ord || ' seconds')::interval
from (values
  (1, 'High Noons'), (2, 'Cocktail supplies'), (3, 'Beer'), (4, 'Snacks'), (5, 'Fruit'), (6, 'Gatorade'), (7, 'Water'),
  (8, 'Board games'), (9, 'Video games'), (10, 'Paper towels'), (11, 'Cleaning supplies'), (12, 'Saturday lunch'),
  (13, 'Breakfast food'), (14, 'Popcorn'), (15, 'Paper plates'), (16, 'Cornhole'), (17, 'Bags of ice')
) as v (ord, name);
insert into kv (key, value) values ('went-live', jsonb_build_object('at', now(), 'fresh_start', true));
