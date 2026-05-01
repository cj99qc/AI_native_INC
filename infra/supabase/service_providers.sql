-- ============================================================================
-- SERVICE PROVIDERS: Service Discovery (Phase 1)
-- ============================================================================
-- Stores service providers (plumbers, cleaners, couriers, etc.) with
-- PostGIS GEOGRAPHY location for high-performance proximity searches.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

CREATE TABLE IF NOT EXISTS service_providers (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
    name          TEXT        NOT NULL,
    service_type  TEXT        NOT NULL,
    description   TEXT,
    contact_info  JSONB,
    location      GEOGRAPHY(POINT, 4326) NOT NULL,
    is_active     BOOLEAN     DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- GIST index for ST_DWithin proximity queries (critical for performance)
CREATE INDEX IF NOT EXISTS idx_service_providers_location
    ON service_providers USING GIST (location);

-- Supporting indices
CREATE INDEX IF NOT EXISTS idx_service_providers_service_type
    ON service_providers (service_type);

CREATE INDEX IF NOT EXISTS idx_service_providers_active
    ON service_providers (is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_service_providers_user_id
    ON service_providers (user_id);

-- updated_at trigger
CREATE TRIGGER update_service_providers_updated_at
    BEFORE UPDATE ON service_providers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security
-- Add hours and timezone for service availability (Step 3)
ALTER TABLE service_providers
  ADD COLUMN IF NOT EXISTS hours JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';

ALTER TABLE service_providers ENABLE ROW LEVEL SECURITY;

-- Anyone can discover active providers
CREATE POLICY "Active providers are publicly discoverable"
    ON service_providers FOR SELECT
    USING (is_active = true);

-- Providers can manage their own record
CREATE POLICY "Providers can manage own record"
    ON service_providers FOR ALL
    USING (auth.uid() = user_id);

-- Service role has full access (for background workers)
CREATE POLICY "Service role has full access on providers"
    ON service_providers FOR ALL
    USING (auth.jwt()->>'role' = 'service_role');

-- ============================================================================
-- SERVICE CATEGORIES: Taxonomy for service offerings (Step 3)
-- ============================================================================

CREATE TABLE IF NOT EXISTS service_categories (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  parent_slug TEXT REFERENCES service_categories(slug),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed common service categories
INSERT INTO service_categories (slug, name, description) VALUES
  ('plumber',          'Plumber',                    'Plumbing repair and installation'),
  ('electrician',      'Electrician',                'Electrical repair and installation'),
  ('carpenter',        'Carpenter',                  'Carpentry and woodwork'),
  ('painter',          'Painter',                    'Interior and exterior painting'),
  ('cleaner',          'House Cleaner',              'Residential cleaning services'),
  ('handyman',         'Handyman',                   'General home repairs and maintenance'),
  ('appliance_repair', 'Appliance Repair',           'Refrigerator, washing machine, etc.'),
  ('hvac',             'HVAC Technician',            'Heating, ventilation, air conditioning'),
  ('locksmith',        'Locksmith',                  'Lock repair, rekeying, emergency access'),
  ('pest_control',     'Pest Control',               'Pest and termite control'),
  ('gardener',         'Gardener / Landscaping',     'Gardening, lawn care, landscaping'),
  ('mover',            'Mover / Hauling',            'Moving and heavy item hauling'),
  ('tutor',            'Tutor',                      'Academic tutoring and coaching'),
  ('beautician',       'Beautician / Salon at Home', 'Hair, makeup, beauty services'),
  ('caterer',          'Home Caterer / Baker',       'Catering and baking services')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- PROVIDER SERVICES: Junction table for service offerings (Step 3)
-- ============================================================================
-- Each provider can offer multiple services, each with its own pricing and availability

CREATE TABLE IF NOT EXISTS provider_services (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id               UUID NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
  service_slug              TEXT NOT NULL REFERENCES service_categories(slug),
  display_name              TEXT NOT NULL,
  description               TEXT,
  price_strategy            TEXT NOT NULL CHECK (price_strategy IN ('flat', 'hourly', 'quote')),
  base_price_cents          INTEGER,
  hourly_rate_cents         INTEGER,
  min_charge_cents          INTEGER,
  estimated_duration_minutes INTEGER,
  is_active                 BOOLEAN NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indices for fast queries
CREATE INDEX IF NOT EXISTS idx_provider_services_provider
    ON provider_services(provider_id);

CREATE INDEX IF NOT EXISTS idx_provider_services_slug
    ON provider_services(service_slug);

CREATE INDEX IF NOT EXISTS idx_provider_services_active
    ON provider_services(is_active) WHERE is_active = true;

-- updated_at trigger
CREATE TRIGGER update_provider_services_updated_at
    BEFORE UPDATE ON provider_services
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security
ALTER TABLE provider_services ENABLE ROW LEVEL SECURITY;

-- Anyone can view active services from active providers
CREATE POLICY "Active services publicly discoverable"
    ON provider_services FOR SELECT
    USING (is_active = true AND provider_id IN (SELECT id FROM service_providers WHERE is_active = true));

-- Providers manage their own services
CREATE POLICY "Providers manage own services"
    ON provider_services FOR ALL
    USING (provider_id IN (SELECT id FROM service_providers WHERE user_id = auth.uid()))
    WITH CHECK (provider_id IN (SELECT id FROM service_providers WHERE user_id = auth.uid()));
