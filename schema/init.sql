-- E-Library TiDB schema
-- Run once in TiDB Cloud SQL editor or: mysql -h <host> -P 4000 -u <user> -p <database> < schema/init.sql

CREATE TABLE IF NOT EXISTS books (
  id            CHAR(36) PRIMARY KEY,
  title         VARCHAR(255) NOT NULL,
  author        VARCHAR(255) NOT NULL,
  year          INT UNSIGNED,
  status        ENUM('available', 'on_loan') NOT NULL DEFAULT 'available',
  cover_key     VARCHAR(512) NULL,
  file_key      VARCHAR(512) NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_title (title),
  INDEX idx_author (author)
);

-- Optional seed data (remove if you prefer an empty library)
INSERT INTO books (id, title, author, year, status) VALUES
  ('a1000001-0000-4000-8000-000000000001', 'The Great Gatsby', 'F. Scott Fitzgerald', 1925, 'available'),
  ('a1000001-0000-4000-8000-000000000002', 'To Kill a Mockingbird', 'Harper Lee', 1960, 'available'),
  ('a1000001-0000-4000-8000-000000000003', '1984', 'George Orwell', 1949, 'on_loan')
ON DUPLICATE KEY UPDATE title = VALUES(title);
