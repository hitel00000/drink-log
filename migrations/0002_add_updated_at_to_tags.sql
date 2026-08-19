-- 0002_add_updated_at_to_tags.sql
-- Add updated_at column to tags table for timestamp standardization

ALTER TABLE tags ADD COLUMN updated_at TEXT;
UPDATE tags SET updated_at = created_at WHERE updated_at IS NULL;
