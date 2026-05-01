-- ============================================================================
-- INC LOGISTICS PLATFORM - MASTER SCHEMA
-- ============================================================================
-- Complete database schema for The Artery Project
-- Includes: Core tables, The Pulse, PostGIS geospatial, RLS policies
-- Version: 1.0
-- Date: 2026-02-18
-- ============================================================================

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Profiles (extends Supabase auth.users)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    phone TEXT,
    role TEXT DEFAULT 'customer' CHECK (role IN ('customer', 'driver', 'vendor', 'admin')),
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Vendors (restaurants, stores, small businesses)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    business_name TEXT NOT NULL,
    description TEXT,
    category TEXT, -- restaurant, grocery, pharmacy, bakery, hardware, etc.
    location GEOGRAPHY(POINT, 4326),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    address TEXT,
    city TEXT,
    state TEXT,
    zip_code TEXT,
    phone TEXT,
    email TEXT,
    -- Hours of operation: { mon: {open, close, closed}, tue: {...}, ... }
    hours JSONB DEFAULT '{}'::jsonb,
    -- KYC
    kyc_business_license TEXT,
    kyc_tax_id TEXT,
    -- Payout
    payout_method TEXT CHECK (payout_method IN ('stripe_connect', 'manual_bank')),
    stripe_connect_id TEXT,
    -- Lifecycle
    is_active BOOLEAN DEFAULT true,
    onboarding_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (onboarding_status IN ('pending', 'approved', 'rejected')),
    rating DECIMAL(3,2) DEFAULT 5.00,
    total_orders INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotent upgrade for pre-existing deployments
ALTER TABLE vendors
    ADD COLUMN IF NOT EXISTS city TEXT,
    ADD COLUMN IF NOT EXISTS state TEXT,
    ADD COLUMN IF NOT EXISTS zip_code TEXT,
    ADD COLUMN IF NOT EXISTS hours JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS kyc_business_license TEXT,
    ADD COLUMN IF NOT EXISTS kyc_tax_id TEXT,
    ADD COLUMN IF NOT EXISTS payout_method TEXT,
    ADD COLUMN IF NOT EXISTS stripe_connect_id TEXT,
    ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'pending';

-- Trigger: auto-compute GEOGRAPHY from latitude/longitude on insert/update
-- (PostgREST clients cannot call ST_MakePoint directly)
CREATE OR REPLACE FUNCTION compute_vendor_location()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vendors_compute_location ON vendors;
CREATE TRIGGER trg_vendors_compute_location
    BEFORE INSERT OR UPDATE OF latitude, longitude ON vendors
    FOR EACH ROW EXECUTE FUNCTION compute_vendor_location();

-- ----------------------------------------------------------------------------
-- Drivers
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drivers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    license_number VARCHAR(50) UNIQUE NOT NULL,
    vehicle_type VARCHAR(50) NOT NULL DEFAULT 'car', -- car, van, truck, bike
    vehicle_capacity INTEGER NOT NULL DEFAULT 4,
    rating DECIMAL(3,2) DEFAULT 5.00,
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    current_location GEOGRAPHY(POINT, 4326),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    last_location_update TIMESTAMPTZ DEFAULT NOW(),
    total_deliveries INTEGER DEFAULT 0,
    total_earnings_cents INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Driver Status Tracking (for trajectory matching)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS driver_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID REFERENCES drivers(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'offline', -- offline, available, busy, en_route
    location GEOGRAPHY(POINT, 4326),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    speed_kmh DECIMAL(5, 2), -- Speed in km/h
    heading_degrees DECIMAL(5, 2), -- Compass heading 0-360
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Orders (main order table)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
    order_number TEXT UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, confirmed, preparing, ready, assigned, in_transit, delivered, cancelled

    -- Items and pricing
    items JSONB NOT NULL, -- Array of order items
    subtotal_cents INTEGER NOT NULL,
    delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
    platform_fee_cents INTEGER NOT NULL DEFAULT 0,
    tax_cents INTEGER NOT NULL DEFAULT 0,
    tip_cents INTEGER DEFAULT 0,
    total_cents INTEGER NOT NULL,

    -- Locations
    pickup_location GEOGRAPHY(POINT, 4326),
    pickup_latitude DECIMAL(10, 8),
    pickup_longitude DECIMAL(11, 8),
    pickup_address TEXT,

    delivery_location GEOGRAPHY(POINT, 4326),
    delivery_latitude DECIMAL(10, 8),
    delivery_longitude DECIMAL(11, 8),
    delivery_address TEXT,
    delivery_instructions TEXT,

    -- Time windows
    pickup_time_window_start TIMESTAMPTZ,
    pickup_time_window_end TIMESTAMPTZ,
    delivery_time_window_start TIMESTAMPTZ,
    delivery_time_window_end TIMESTAMPTZ,

    -- Fulfillment
    assigned_driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
    batch_id UUID, -- References batches table

    -- Timestamps
    placed_at TIMESTAMPTZ DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    ready_at TIMESTAMPTZ,
    picked_up_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,

    -- Metadata
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Batches (order groupings for delivery)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_number TEXT UNIQUE NOT NULL,
    driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, assigned, in_progress, completed, cancelled

    -- Batch characteristics
    total_orders INTEGER NOT NULL DEFAULT 0,
    estimated_duration_minutes INTEGER,
    estimated_distance_km DECIMAL(10, 2),
    actual_duration_minutes INTEGER,
    actual_distance_km DECIMAL(10, 2),

    -- Optimization details
    optimization_algorithm VARCHAR(50), -- kmeans, grid, manual
    optimization_score DECIMAL(5, 2),

    -- Financial
    total_payout_cents INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Batch Items (orders within batches)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS batch_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id UUID REFERENCES batches(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    sequence_number INTEGER NOT NULL,

    -- Pickup details
    pickup_location GEOGRAPHY(POINT, 4326),
    pickup_latitude DECIMAL(10, 8),
    pickup_longitude DECIMAL(11, 8),
    pickup_address TEXT,
    pickup_time_window_start TIMESTAMPTZ,
    pickup_time_window_end TIMESTAMPTZ,

    -- Delivery details
    delivery_location GEOGRAPHY(POINT, 4326),
    delivery_latitude DECIMAL(10, 8),
    delivery_longitude DECIMAL(11, 8),
    delivery_address TEXT,
    delivery_time_window_start TIMESTAMPTZ,
    delivery_time_window_end TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(batch_id, order_id)
);

-- ----------------------------------------------------------------------------
-- Routes (optimized delivery paths)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS routes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id UUID REFERENCES batches(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,

    -- Route geometry
    route_geometry GEOGRAPHY(LINESTRING, 4326),

    -- Route metrics
    total_distance_km DECIMAL(10, 2),
    estimated_duration_minutes INTEGER,
    actual_duration_minutes INTEGER,

    -- Optimization
    optimization_algorithm VARCHAR(50) DEFAULT 'heuristic', -- heuristic, or_tools, manual
    optimization_score DECIMAL(5, 2),
    tsp_iterations INTEGER,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Route Stops (individual pickup/delivery points)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS route_stops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    route_id UUID REFERENCES routes(id) ON DELETE CASCADE,
    batch_item_id UUID REFERENCES batch_items(id) ON DELETE CASCADE,

    stop_type VARCHAR(20) NOT NULL, -- pickup, delivery
    sequence_number INTEGER NOT NULL,

    -- Location
    location GEOGRAPHY(POINT, 4326),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    address TEXT,

    -- Timing
    estimated_arrival_time TIMESTAMPTZ,
    actual_arrival_time TIMESTAMPTZ,
    estimated_departure_time TIMESTAMPTZ,
    actual_departure_time TIMESTAMPTZ,

    -- Status
    completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMPTZ,

    -- Notes
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Escrow Payments (The Handshake)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS escrow_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,

    -- Parties
    customer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
    driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,

    -- Amounts (in cents)
    amount_total_cents INTEGER NOT NULL,
    amount_platform_fee_cents INTEGER NOT NULL DEFAULT 0,
    amount_delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
    amount_driver_payout_cents INTEGER NOT NULL DEFAULT 0,
    amount_vendor_payout_cents INTEGER NOT NULL DEFAULT 0,

    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, held, released, disputed, refunded

    -- Payment provider
    payment_provider VARCHAR(50) DEFAULT 'stripe',
    payment_intent_id VARCHAR(255),
    charge_id VARCHAR(255),

    -- Timestamps
    held_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    disputed_at TIMESTAMPTZ,
    refunded_at TIMESTAMPTZ,

    -- Metadata
    metadata JSONB,
    dispute_reason TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Pulse Matches (The Pulse - Autonomous Matching)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pulse_matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID REFERENCES drivers(id) ON DELETE CASCADE,
    batch_id UUID REFERENCES batches(id) ON DELETE CASCADE,

    -- Match scores
    match_score DECIMAL(5, 4) NOT NULL, -- 0.0000 to 1.0000
    distance_km DECIMAL(10, 2) NOT NULL,
    artery_score DECIMAL(5, 4), -- Highway 7 proximity score
    trajectory_score DECIMAL(5, 4), -- Moving toward pickup score
    capacity_utilization DECIMAL(5, 4),
    estimated_acceptance_probability DECIMAL(5, 4),

    -- Match details
    match_details JSONB, -- Full DriverScore details

    -- Status
    is_active BOOLEAN DEFAULT true,
    suggested_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ, -- Matches expire after X minutes
    notified BOOLEAN DEFAULT false, -- Whether driver has been notified
    accepted_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Highway Arteries (for trajectory matching)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS highway_arteries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    route_geometry GEOGRAPHY(LINESTRING, 4326) NOT NULL,
    description TEXT,
    region VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Simulation Runs (for testing and KPI generation)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sim_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_name VARCHAR(255) NOT NULL,
    scenario_config JSONB NOT NULL,

    -- Counts
    total_orders INTEGER NOT NULL DEFAULT 0,
    total_drivers INTEGER NOT NULL DEFAULT 0,
    total_batches INTEGER NOT NULL DEFAULT 0,

    -- KPIs
    gross_margin_per_order_cents INTEGER,
    avg_delivery_time_minutes INTEGER,
    driver_utilization_pct DECIMAL(5, 2),
    completion_rate_pct DECIMAL(5, 2),
    platform_margin_pct DECIMAL(5, 2),

    -- Summary
    kpi_summary JSONB,

    -- Timestamps
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Embedding Index (for RAG system)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS embedding_index (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content_type VARCHAR(50) NOT NULL, -- order, driver, location, policy, document
    content_id VARCHAR(255) NOT NULL, -- Reference to the original content
    content_text TEXT NOT NULL,
    embedding VECTOR(384), -- For sentence-transformers all-MiniLM-L6-v2
    metadata JSONB,
    indexed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Notifications (push notifications for drivers/customers)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    notification_type VARCHAR(50) NOT NULL, -- pulse_match, order_update, delivery_status, payment_update

    -- Related entities
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,
    pulse_match_id UUID REFERENCES pulse_matches(id) ON DELETE SET NULL,

    -- Status
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMPTZ,

    -- Delivery
    push_sent BOOLEAN DEFAULT false,
    push_sent_at TIMESTAMPTZ,

    -- Metadata
    metadata JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDICES FOR PERFORMANCE
-- ============================================================================

-- Profiles
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles (role);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles (email);

-- Vendors
CREATE INDEX IF NOT EXISTS idx_vendors_user_id ON vendors (user_id);
CREATE INDEX IF NOT EXISTS idx_vendors_location ON vendors USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_vendors_active ON vendors (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_vendors_category ON vendors (category);
CREATE INDEX IF NOT EXISTS idx_vendors_onboarding_status ON vendors (onboarding_status);

-- Drivers
CREATE INDEX IF NOT EXISTS idx_drivers_location ON drivers USING GIST (current_location);
CREATE INDEX IF NOT EXISTS idx_drivers_user_id ON drivers (user_id);
CREATE INDEX IF NOT EXISTS idx_drivers_active ON drivers (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_drivers_verified ON drivers (is_verified) WHERE is_verified = true;

-- Driver Status
CREATE INDEX IF NOT EXISTS idx_driver_status_driver_id ON driver_status (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_status_status ON driver_status (status);
CREATE INDEX IF NOT EXISTS idx_driver_status_location ON driver_status USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_driver_status_updated_at ON driver_status (updated_at DESC);

-- Orders
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_vendor_id ON orders (vendor_id);
CREATE INDEX IF NOT EXISTS idx_orders_driver_id ON orders (assigned_driver_id);
CREATE INDEX IF NOT EXISTS idx_orders_batch_id ON orders (batch_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_placed_at ON orders (placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_pickup_location ON orders USING GIST (pickup_location);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_location ON orders USING GIST (delivery_location);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders (order_number);

-- Batches
CREATE INDEX IF NOT EXISTS idx_batches_driver_id ON batches (driver_id);
CREATE INDEX IF NOT EXISTS idx_batches_status ON batches (status);
CREATE INDEX IF NOT EXISTS idx_batches_created_at ON batches (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batches_batch_number ON batches (batch_number);

-- Batch Items
CREATE INDEX IF NOT EXISTS idx_batch_items_batch_id ON batch_items (batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_items_order_id ON batch_items (order_id);
CREATE INDEX IF NOT EXISTS idx_batch_items_pickup_location ON batch_items USING GIST (pickup_location);
CREATE INDEX IF NOT EXISTS idx_batch_items_delivery_location ON batch_items USING GIST (delivery_location);

-- Routes
CREATE INDEX IF NOT EXISTS idx_routes_batch_id ON routes (batch_id);
CREATE INDEX IF NOT EXISTS idx_routes_driver_id ON routes (driver_id);
CREATE INDEX IF NOT EXISTS idx_routes_geometry ON routes USING GIST (route_geometry);

-- Route Stops
CREATE INDEX IF NOT EXISTS idx_route_stops_route_id ON route_stops (route_id);
CREATE INDEX IF NOT EXISTS idx_route_stops_location ON route_stops USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_route_stops_completed ON route_stops (completed) WHERE completed = false;

-- Escrow Payments
CREATE INDEX IF NOT EXISTS idx_escrow_payments_order_id ON escrow_payments (order_id);
CREATE INDEX IF NOT EXISTS idx_escrow_payments_batch_id ON escrow_payments (batch_id);
CREATE INDEX IF NOT EXISTS idx_escrow_payments_status ON escrow_payments (status);
CREATE INDEX IF NOT EXISTS idx_escrow_payments_customer_id ON escrow_payments (customer_id);
CREATE INDEX IF NOT EXISTS idx_escrow_payments_vendor_id ON escrow_payments (vendor_id);
CREATE INDEX IF NOT EXISTS idx_escrow_payments_driver_id ON escrow_payments (driver_id);
CREATE INDEX IF NOT EXISTS idx_escrow_payments_created_at ON escrow_payments (created_at DESC);

-- Pulse Matches
CREATE INDEX IF NOT EXISTS idx_pulse_matches_driver_id ON pulse_matches (driver_id);
CREATE INDEX IF NOT EXISTS idx_pulse_matches_batch_id ON pulse_matches (batch_id);
CREATE INDEX IF NOT EXISTS idx_pulse_matches_score ON pulse_matches (match_score DESC);
CREATE INDEX IF NOT EXISTS idx_pulse_matches_active ON pulse_matches (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_pulse_matches_expires_at ON pulse_matches (expires_at);
CREATE INDEX IF NOT EXISTS idx_pulse_matches_notified ON pulse_matches (notified) WHERE notified = false;
CREATE INDEX IF NOT EXISTS idx_pulse_matches_suggested_at ON pulse_matches (suggested_at DESC);

-- Highway Arteries
CREATE INDEX IF NOT EXISTS idx_highway_arteries_geometry ON highway_arteries USING GIST (route_geometry);
CREATE INDEX IF NOT EXISTS idx_highway_arteries_name ON highway_arteries (name);
CREATE INDEX IF NOT EXISTS idx_highway_arteries_active ON highway_arteries (is_active) WHERE is_active = true;

-- Simulation Runs
CREATE INDEX IF NOT EXISTS idx_sim_runs_run_name ON sim_runs (run_name);
CREATE INDEX IF NOT EXISTS idx_sim_runs_created_at ON sim_runs (created_at DESC);

-- Embedding Index
CREATE INDEX IF NOT EXISTS idx_embedding_index_content_type ON embedding_index (content_type);
CREATE INDEX IF NOT EXISTS idx_embedding_index_content_id ON embedding_index (content_id);

-- Notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications (is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications (notification_type);

-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_vendors_updated_at BEFORE UPDATE ON vendors FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_drivers_updated_at BEFORE UPDATE ON drivers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_batches_updated_at BEFORE UPDATE ON batches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_escrow_payments_updated_at BEFORE UPDATE ON escrow_payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Cleanup expired pulse matches
CREATE OR REPLACE FUNCTION cleanup_expired_pulse_matches()
RETURNS void AS $$
BEGIN
    UPDATE pulse_matches
    SET is_active = false
    WHERE expires_at < NOW() AND is_active = true;

    DELETE FROM pulse_matches
    WHERE expires_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Update batch order count
CREATE OR REPLACE FUNCTION update_batch_order_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE batches
        SET total_orders = (SELECT COUNT(*) FROM batch_items WHERE batch_id = NEW.batch_id)
        WHERE id = NEW.batch_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE batches
        SET total_orders = (SELECT COUNT(*) FROM batch_items WHERE batch_id = OLD.batch_id)
        WHERE id = OLD.batch_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_batch_order_count_trigger
AFTER INSERT OR DELETE ON batch_items
FOR EACH ROW EXECUTE FUNCTION update_batch_order_count();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrow_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pulse_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE highway_arteries ENABLE ROW LEVEL SECURITY;
ALTER TABLE sim_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE embedding_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Profiles: Users can view and update their own profile
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Vendors: Public read, owners can update
CREATE POLICY "Vendors are publicly visible" ON vendors FOR SELECT USING (true);
CREATE POLICY "Vendors can update own data" ON vendors FOR UPDATE USING (auth.uid() = user_id);

-- Drivers: Can view own data
CREATE POLICY "Drivers can view own data" ON drivers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Drivers can update own data" ON drivers FOR UPDATE USING (auth.uid() = user_id);

-- Driver Status: Drivers can manage their own status
CREATE POLICY "Driver status visible to owner" ON driver_status FOR SELECT USING (
    EXISTS (SELECT 1 FROM drivers WHERE drivers.id = driver_status.driver_id AND drivers.user_id = auth.uid())
);
CREATE POLICY "Drivers can update own status" ON driver_status FOR ALL USING (
    EXISTS (SELECT 1 FROM drivers WHERE drivers.id = driver_status.driver_id AND drivers.user_id = auth.uid())
);

-- Orders: Customers, vendors, and drivers can see relevant orders
CREATE POLICY "Users can view own orders" ON orders FOR SELECT USING (
    auth.uid() = customer_id OR
    auth.uid() IN (SELECT user_id FROM vendors WHERE id = orders.vendor_id) OR
    auth.uid() IN (SELECT user_id FROM drivers WHERE id = orders.assigned_driver_id)
);

-- Batches: Drivers can see assigned batches
CREATE POLICY "Drivers can view assigned batches" ON batches FOR SELECT USING (
    EXISTS (SELECT 1 FROM drivers WHERE drivers.id = batches.driver_id AND drivers.user_id = auth.uid())
);

-- Pulse Matches: Drivers can see their own matches
CREATE POLICY "Drivers can view own pulse matches" ON pulse_matches FOR SELECT USING (
    EXISTS (SELECT 1 FROM drivers WHERE drivers.id = pulse_matches.driver_id AND drivers.user_id = auth.uid())
);

-- Highway Arteries: Publicly readable
CREATE POLICY "Highway arteries are public" ON highway_arteries FOR SELECT USING (true);

-- Notifications: Users can view their own notifications
CREATE POLICY "Users can view own notifications" ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own notifications" ON notifications FOR UPDATE USING (auth.uid() = user_id);

-- Service role can do anything (for background workers)
CREATE POLICY "Service role has full access" ON drivers FOR ALL USING (auth.jwt()->>'role' = 'service_role');
CREATE POLICY "Service role has full access on orders" ON orders FOR ALL USING (auth.jwt()->>'role' = 'service_role');
CREATE POLICY "Service role has full access on batches" ON batches FOR ALL USING (auth.jwt()->>'role' = 'service_role');
CREATE POLICY "Service role has full access on pulse" ON pulse_matches FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- ============================================================================
-- SAMPLE DATA
-- ============================================================================

-- Insert Highway 7 main artery (Ottawa area)
INSERT INTO highway_arteries (name, route_geometry, description, region)
VALUES (
    'Highway 7',
    ST_GeogFromText('LINESTRING(-75.9 45.35, -75.85 45.36, -75.80 45.37, -75.75 45.38, -75.70 45.39, -75.65 45.40, -75.60 45.41, -75.55 45.42, -75.50 45.43)'),
    'Main Highway 7 artery through Ottawa region for trajectory matching',
    'Ottawa'
) ON CONFLICT DO NOTHING;

-- Insert Highway 417 (Ottawa)
INSERT INTO highway_arteries (name, route_geometry, description, region)
VALUES (
    'Highway 417',
    ST_GeogFromText('LINESTRING(-76.0 45.40, -75.95 45.41, -75.90 45.42, -75.85 45.42, -75.80 45.42, -75.75 45.42, -75.70 45.42, -75.65 45.42, -75.60 45.42)'),
    'Highway 417 corridor through Ottawa (Queensway)',
    'Ottawa'
) ON CONFLICT DO NOTHING;

-- ============================================================================
-- SERVICE PROVIDERS: Service Discovery (Phase 1 - Step 3)
-- ============================================================================

CREATE TABLE IF NOT EXISTS service_providers (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
    name          TEXT        NOT NULL,
    service_type  TEXT,
    description   TEXT,
    contact_info  JSONB,
    location      GEOGRAPHY(POINT, 4326) NOT NULL,
    hours         JSONB       DEFAULT '{}'::jsonb,
    timezone      TEXT        NOT NULL DEFAULT 'Asia/Kolkata',
    is_active     BOOLEAN     DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_providers_location
    ON service_providers USING GIST (location);

CREATE INDEX IF NOT EXISTS idx_service_providers_service_type
    ON service_providers (service_type);

CREATE INDEX IF NOT EXISTS idx_service_providers_active
    ON service_providers (is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_service_providers_user_id
    ON service_providers (user_id);

CREATE TRIGGER update_service_providers_updated_at
    BEFORE UPDATE ON service_providers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE service_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active providers are publicly discoverable"
    ON service_providers FOR SELECT
    USING (is_active = true);

CREATE POLICY "Providers can manage own record"
    ON service_providers FOR ALL
    USING (auth.uid() = user_id);

CREATE POLICY "Service role has full access on providers"
    ON service_providers FOR ALL
    USING (auth.jwt()->>'role' = 'service_role');

-- Service Categories
CREATE TABLE IF NOT EXISTS service_categories (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  parent_slug TEXT REFERENCES service_categories(slug),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

-- Provider Services (Junction Table)
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

CREATE INDEX IF NOT EXISTS idx_provider_services_provider
    ON provider_services(provider_id);

CREATE INDEX IF NOT EXISTS idx_provider_services_slug
    ON provider_services(service_slug);

CREATE INDEX IF NOT EXISTS idx_provider_services_active
    ON provider_services(is_active) WHERE is_active = true;

CREATE TRIGGER update_provider_services_updated_at
    BEFORE UPDATE ON provider_services
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE provider_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active services publicly discoverable"
    ON provider_services FOR SELECT
    USING (is_active = true AND provider_id IN (SELECT id FROM service_providers WHERE is_active = true));

CREATE POLICY "Providers manage own services"
    ON provider_services FOR ALL
    USING (provider_id IN (SELECT id FROM service_providers WHERE user_id = auth.uid()))
    WITH CHECK (provider_id IN (SELECT id FROM service_providers WHERE user_id = auth.uid()));

-- ============================================================================
-- COMPLETION MESSAGE
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'INC LOGISTICS PLATFORM - MASTER SCHEMA APPLIED SUCCESSFULLY';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Extensions: uuid-ossp, postgis, pgcrypto';
    RAISE NOTICE 'Core Tables: profiles, vendors, drivers, orders, batches, routes';
    RAISE NOTICE 'The Pulse: pulse_matches table with autonomous matching';
    RAISE NOTICE 'The Handshake: escrow_payments table for payment management';
    RAISE NOTICE 'Service Providers: service_categories, provider_services (Step 3)';
    RAISE NOTICE 'Geospatial: PostGIS GEOGRAPHY types, highway_arteries';
    RAISE NOTICE 'Security: Row Level Security policies enabled';
    RAISE NOTICE 'Performance: Indices on all key fields';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'The Artery is ready to flow. 🩸⚡';
    RAISE NOTICE '============================================================================';
END $$;
