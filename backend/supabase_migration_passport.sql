-- Migration to add passport_verified column
ALTER TABLE agents ADD COLUMN passport_verified BOOLEAN DEFAULT FALSE;
