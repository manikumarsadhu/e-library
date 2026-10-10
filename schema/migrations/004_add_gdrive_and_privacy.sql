-- 004_add_gdrive_and_privacy.sql
-- Adds storage source (cloudinary vs gdrive), visibility (public vs private), and passcode hash for creator-level access control.

ALTER TABLE books ADD COLUMN storage_source VARCHAR(32) NOT NULL DEFAULT 'cloudinary';
ALTER TABLE books ADD COLUMN visibility VARCHAR(16) NOT NULL DEFAULT 'public';
ALTER TABLE books ADD COLUMN passcode_hash VARCHAR(128) NULL;
