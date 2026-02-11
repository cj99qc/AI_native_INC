-- CREATE FILE: infra/supabase/new_tables.sql

-- Enable necessary extensions if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- Drivers table for storing driver information
CREATE TABLE IF NOT EXISTS drivers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    license_number VARCHAR(50) UNIQUE NOT NULL,
    vehicle_type VARCHAR(50) NOT NULL DEFAULT 'car',
    vehicle_capacity INTEGER NOT NULL DEFAULT 4,
    rating DECIMAL(3,2) DEFAULT 5.00,
    is_active BOOLEAN DEFAULT true,
    current_location GEOGRAPHY(POINT, 4326),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    last_location_update TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Driver status tracking
CREATE TABLE IF NOT EXISTS driver_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID REFERENCES drivers(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'offline', -- offline, available, busy, en_route
    location GEOGRAPHY(POINT, 4326),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Batches for grouping orders together
CREATE TABLE IF NOT EXISTS batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, assigned, in_progress, completed, cancelled
    total_orders INTEGER NOT NULL DEFAULT 0,
    estimated_duration_minutes INTEGER,
    estimated_distance_km DECIMAL(10, 2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Batch items linking orders to batches
CREATE TABLE IF NOT EXISTS batch_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id UUID REFERENCES batches(id) ON DELETE CASCADE,
    order_id UUID NOT NULL, -- References existing orders table
    sequence_number INTEGER NOT NULL,
    pickup_location GEOGRAPHY(POINT, 4326),
    pickup_latitude DECIMAL(10, 8),
    pickup_longitude DECIMAL(11, 8),
    delivery_location GEOGRAPHY(POINT, 4326),
    delivery_latitude DECIMAL(10, 8),
    delivery_longitude DECIMAL(11, 8),
    pickup_time_window_start TIMESTAMPTZ,
    pickup_time_window_end TIMESTAMPTZ,
    delivery_time_window_start TIMESTAMPTZ,
    delivery_time_window_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Routes for optimized delivery paths
CREATE TABLE IF NOT EXISTS routes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id UUID REFERENCES batches(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
    route_geometry GEOGRAPHY(LINESTRING, 4326),
    total_distance_km DECIMAL(10, 2),
    estimated_duration_minutes INTEGER,
    optimization_algorithm VARCHAR(50) DEFAULT 'heuristic',
    optimization_score DECIMAL(5, 2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Route stops representing each pickup/delivery point
CREATE TABLE IF NOT EXISTS route_stops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    route_id UUID REFERENCES routes(id) ON DELETE CASCADE,
    batch_item_id UUID REFERENCES batch_items(id) ON DELETE CASCADE,
    stop_type VARCHAR(20) NOT NULL, -- pickup, delivery
    sequence_number INTEGER NOT NULL,
    location GEOGRAPHY(POINT, 4326),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    estimated_arrival_time TIMESTAMPTZ,
    actual_arrival_time TIMESTAMPTZ,
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Escrow payments for managing funds during delivery
CREATE TABLE IF NOT EXISTS escrow_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL, -- References existing orders table
    batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,
    customer_id UUID NOT NULL, -- References auth.users
    vendor_id UUID NOT NULL, -- References existing vendors
    driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
    amount_total_cents INTEGER NOT NULL,
    amount_platform_fee_cents INTEGER NOT NULL DEFAULT 0,
    amount_delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
    amount_driver_payout_cents INTEGER NOT NULL DEFAULT 0,
    amount_vendor_payout_cents INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, held, released, disputed, refunded
    payment_intent_id VARCHAR(255), -- Stripe payment intent ID
    held_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    disputed_at TIMESTAMPTZ,
    refunded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Simulation runs for tracking KPI generation
CREATE TABLE IF NOT EXISTS sim_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_name VARCHAR(255) NOT NULL,
    scenario_config JSONB NOT NULL,
    total_orders INTEGER NOT NULL DEFAULT 0,
    total_drivers INTEGER NOT NULL DEFAULT 0,
    total_batches INTEGER NOT NULL DEFAULT 0,
    gross_margin_per_order_cents INTEGER,
    avg_delivery_time_minutes INTEGER,
    driver_utilization_pct DECIMAL(5, 2),
    completion_rate_pct DECIMAL(5, 2),
    kpi_summary JSONB,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Embedding index metadata for RAG system
CREATE TABLE IF NOT EXISTS embedding_index (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content_type VARCHAR(50) NOT NULL, -- order, driver, location, policy
    content_id VARCHAR(255) NOT NULL, -- Reference to the original content
    content_text TEXT NOT NULL,
    embedding VECTOR(384), -- For sentence-transformers all-MiniLM-L6-v2
    metadata JSONB,
    indexed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_drivers_location ON drivers USING GIST (current_location);
CREATE INDEX IF NOT EXISTS idx_drivers_user_id ON drivers (user_id);
CREATE INDEX IF NOT EXISTS idx_drivers_active ON drivers (is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_driver_status_driver_id ON driver_status (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_status_status ON driver_status (status);
CREATE INDEX IF NOT EXISTS idx_driver_status_location ON driver_status USING GIST (location);

CREATE INDEX IF NOT EXISTS idx_batches_driver_id ON batches (driver_id);
CREATE INDEX IF NOT EXISTS idx_batches_status ON batches (status);
CREATE INDEX IF NOT EXISTS idx_batches_created_at ON batches (created_at);

CREATE INDEX IF NOT EXISTS idx_batch_items_batch_id ON batch_items (batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_items_order_id ON batch_items (order_id);

CREATE INDEX IF NOT EXISTS idx_routes_batch_id ON routes (batch_id);
CREATE INDEX IF NOT EXISTS idx_routes_driver_id ON routes (driver_id);

CREATE INDEX IF NOT EXISTS idx_route_stops_route_id ON route_stops (route_id);
CREATE INDEX IF NOT EXISTS idx_route_stops_location ON route_stops USING GIST (location);

CREATE INDEX IF NOT EXISTS idx_escrow_payments_order_id ON escrow_payments (order_id);
CREATE INDEX IF NOT EXISTS idx_escrow_payments_status ON escrow_payments (status);
CREATE INDEX IF NOT EXISTS idx_escrow_payments_customer_id ON escrow_payments (customer_id);

CREATE INDEX IF NOT EXISTS idx_sim_runs_run_name ON sim_runs (run_name);
CREATE INDEX IF NOT EXISTS idx_sim_runs_created_at ON sim_runs (created_at);

CREATE INDEX IF NOT EXISTS idx_embedding_index_content_type ON embedding_index (content_type);
CREATE INDEX IF NOT EXISTS idx_embedding_index_content_id ON embedding_index (content_id);

-- Highway 7 Artery reference line for trajectory matching
CREATE TABLE IF NOT EXISTS highway_arteries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    route_geometry GEOGRAPHY(LINESTRING, 4326) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for spatial queries on highway arteries
CREATE INDEX IF NOT EXISTS idx_highway_arteries_geometry ON highway_arteries USING GIST (route_geometry);

-- Insert Highway 7 main artery (Ottawa area - example coordinates)
-- This represents a simplified Highway 7 corridor through the Ottawa region
INSERT INTO highway_arteries (name, route_geometry, description)
VALUES (
    'Highway 7',
    ST_GeogFromText('LINESTRING(-75.9 45.35, -75.85 45.36, -75.80 45.37, -75.75 45.38, -75.70 45.39, -75.65 45.40, -75.60 45.41, -75.55 45.42, -75.50 45.43)'),
    'Main Highway 7 artery through Ottawa region for trajectory matching'
) ON CONFLICT DO NOTHING;

-- Row Level Security policies (basic examples - adjust based on your auth system)
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrow_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sim_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE embedding_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE highway_arteries ENABLE ROW LEVEL SECURITY;

-- Basic RLS policies (you may need to adjust these based on your specific auth requirements)
CREATE POLICY "Drivers can view own data" ON drivers FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Drivers can update own data" ON drivers FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Driver status visible to drivers and admins" ON driver_status FOR SELECT USING (
    EXISTS (SELECT 1 FROM drivers WHERE drivers.id = driver_status.driver_id AND drivers.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);

-- Highway arteries are publicly readable
CREATE POLICY "Highway arteries are public" ON highway_arteries FOR SELECT USING (true);

-- TODO: Add more specific RLS policies based on your application's access patterns