-- Add model column for cost estimation on externally-ingested events
ALTER TABLE events ADD COLUMN model TEXT;
