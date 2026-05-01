-- Local Docker auth stub
-- Supabase provides auth.users in production. This stub makes the schema
-- work against a plain PostgreSQL container for local development.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
