-- Add recipient_name column to units table for deterministic 1-to-1 mapping of recipient names per unit
ALTER TABLE units ADD COLUMN recipient_name TEXT;
