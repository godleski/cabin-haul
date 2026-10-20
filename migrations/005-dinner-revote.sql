-- Optional housekeeping after the dinner vote moved from a random per-browser id to the person's name.
-- The app already ignores the old anonymous rows (voter 'dev-...'), so this only tidies the table.
delete from predictions where question_id = 'dinner' and voter like 'dev-%';
