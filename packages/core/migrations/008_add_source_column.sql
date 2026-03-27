-- Add source column to track event origin (proxy-captured vs externally-ingested)
ALTER TABLE events ADD COLUMN source TEXT NOT NULL DEFAULT 'proxy';
