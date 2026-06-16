-- Run once if your database was created from an older init.sql that included `status`.
ALTER TABLE books DROP COLUMN status;
