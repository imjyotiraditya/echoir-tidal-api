-- Migration: Create tokens table
-- Description: Creates the initial tokens table for storing Tidal authentication tokens

-- Create the tokens table
CREATE TABLE IF NOT EXISTS tokens (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Create indexes for faster querying
CREATE INDEX IF NOT EXISTS idx_tokens_expires ON tokens(expires);
CREATE INDEX IF NOT EXISTS idx_tokens_updated_at ON tokens(updated_at);

-- Create health_checks table for status monitoring
CREATE TABLE IF NOT EXISTS health_checks (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
