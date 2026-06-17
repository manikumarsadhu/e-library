-- Run once to add outline caching column to books table.
-- Already applied to the database via migrate_temp.js on 2026-06-17.
ALTER TABLE books ADD COLUMN outline TEXT NULL;
